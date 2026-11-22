"""Persistent event subscriptions and a private, polling-friendly notification inbox."""
from django.db import transaction
from django.db.models import BooleanField, Case, Count, Exists, OuterRef, Q, Value, When
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .eligibility import registered_players
from .models import CompetitionEvent, EventInterest, EventNotification


def eligible_interests():
    return EventInterest.objects.filter(user_id__in=registered_players().values("user_id"))


def with_interest(queryset, user):
    mine = EventInterest.objects.filter(event_id=OuterRef("pk"), user_id=user.pk) if user.is_authenticated else EventInterest.objects.none()
    return queryset.annotate(
        interested_count=Count("interests", filter=Q(interests__user_id__in=registered_players().values("user_id"))),
        is_interested=Exists(mine))


def interest_payload(event, user):
    interests = eligible_interests().filter(event=event)
    return {"interested_count": interests.count(), "is_interested": interests.filter(user=user).exists()}


@api_view(["POST", "DELETE"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def interested(request, event_id):
    # Match developer edits' event lock so a subscription cannot miss a concurrent update.
    event = get_object_or_404(CompetitionEvent.objects.select_for_update(), pk=event_id, is_published=True)
    get_object_or_404(registered_players(), user=request.user)
    if request.method == "DELETE":
        EventInterest.objects.filter(event=event, user=request.user).delete()
    else:
        if event.current_status() in {"COMPLETED", "CANCELLED"}:
            return Response({"detail": "This event is no longer accepting interest."}, status=409)
        EventInterest.objects.get_or_create(event=event, user=request.user)
    return Response(interest_payload(event, request.user))


def notify_change(event, before):
    if not before["is_published"] or not event.is_published:
        return
    changed = {field for field, value in before.items() if value != getattr(event, field)} - {"is_published"}
    if not changed:
        return
    if event.current_status() == "CANCELLED":
        message = f"{event.title} has been cancelled."
    elif changed & {"starts_at", "ends_at"}:
        message = f"The schedule for {event.title} has changed. Check the event for the new time."
    else:
        message = f"{event.title} has been updated. Check the event for the latest details."
    key = f"updated:{event.updated_at.isoformat()}"
    EventNotification.objects.bulk_create([
        EventNotification(event=event, user_id=user_id, key=key, message=message)
        for user_id in eligible_interests().filter(event=event).values_list("user_id", flat=True)
    ], ignore_conflicts=True)


def deliver_started(user):
    # Refreshing the inbox also catches events that started while the player was away.
    now = timezone.now()
    interests = eligible_interests().filter(user=user, event__is_published=True,
        event__status__in=["UPCOMING", "LIVE", "COMPLETED"]).filter(
        Q(event__starts_at__lte=now) | Q(event__status="LIVE")).select_related("event")
    notices = []
    for interest in interests:
        event = interest.event
        message = f"{event.title} is live. The event has started." if event.current_status(now) == "LIVE" else f"{event.title} has started. View the event for details and results."
        notices.append(EventNotification(event=event, user=user,
            key=f"started:{event.starts_at.isoformat()}", message=message))
    EventNotification.objects.bulk_create(notices, ignore_conflicts=True)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def inbox(request):
    deliver_started(request.user)
    notices = EventNotification.objects.filter(user=request.user, event__is_published=True)
    unread = notices.filter(read_at__isnull=True).count()
    # NULL ordering differs across SQLite/Postgres; use an explicit unread-first expression.
    rows = notices.annotate(is_read=Case(When(read_at__isnull=True, then=Value(False)), default=Value(True), output_field=BooleanField())).select_related("event").order_by("is_read", "-created_at", "-id")[:50]
    return Response({"unread_count": unread, "notifications": [
        {"id": row.pk, "message": row.message, "created_at": row.created_at, "read_at": row.read_at,
         "event": {"id": str(row.event_id), "title": row.event.title, "url": f"/events/{row.event_id}", "logo_url": row.event.logo_url}}
        for row in rows]})


class ReadInput(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(min_value=1), max_length=50, required=False, default=list)
    all = serializers.BooleanField(required=False, default=False)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def mark_read(request):
    form = ReadInput(data=request.data)
    form.is_valid(raise_exception=True)
    rows = EventNotification.objects.filter(user=request.user, read_at__isnull=True, event__is_published=True)
    if not form.validated_data["all"]:
        rows = rows.filter(pk__in=form.validated_data["ids"])
    rows.update(read_at=timezone.now())
    return Response({"detail": "Notifications marked as read."})
