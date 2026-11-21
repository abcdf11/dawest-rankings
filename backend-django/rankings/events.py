from urllib.parse import urlsplit

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from accounts.developer import DeveloperOnly
from accounts.models import AuditEntry
from .models import CompetitionEvent


class EventInput(serializers.ModelSerializer):
    class Meta:
        model = CompetitionEvent
        fields = ["title", "description", "format", "region", "location", "starts_at", "ends_at", "status", "registration_url", "is_published"]

    def validate_registration_url(self, value):
        if value and urlsplit(value).scheme not in {"http", "https"}:
            raise serializers.ValidationError("Use an HTTP or HTTPS registration link.")
        return value

    def validate(self, values):
        if self.instance and values.get("format", self.instance.format) != self.instance.format:
            if self.instance.solo_matches.exists() or self.instance.faction_matches.exists():
                raise serializers.ValidationError({"format": "An event with linked matches cannot change format."})
            if self.instance.entries.exists() or self.instance.pickems.exists():
                raise serializers.ValidationError({"format": "An event with registered teams or pick'ems cannot change format."})
        starts = values.get("starts_at", getattr(self.instance, "starts_at", None))
        ends = values.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({"ends_at": "End time must be after the start time."})
        return values


def payload(event, now=None, developer=False):
    result = {"id": str(event.pk), "title": event.title, "description": event.description,
              "format": event.format, "region": event.region, "location": event.location,
              "starts_at": event.starts_at, "ends_at": event.ends_at, "status": event.current_status(now),
              "registration_url": event.registration_url, "updated_at": event.updated_at,
              "url": f"/events/{event.pk}"}
    if developer:
        result.update({"is_published": event.is_published, "configured_status": event.status})
    return result


@api_view(["GET"])
def listing(request):
    now = timezone.now()
    search = request.query_params.get("search", "").strip()[:120]
    queryset = CompetitionEvent.objects.filter(is_published=True)
    if search:
        queryset = queryset.filter(title__icontains=search)
    events = [payload(event, now) for event in queryset.order_by("-starts_at")[:500]]
    events.sort(key=lambda event: (0 if event["status"] == "LIVE" else 1 if event["status"] == "UPCOMING" else 2,
                                   event["starts_at"].timestamp() * (1 if event["status"] in {"LIVE", "UPCOMING"} else -1)))
    return Response({"events": events})


def match_payload(match, faction=False):
    a, b = (match.team_a, match.team_b) if faction else (match.player_a, match.player_b)
    prefix = "factions" if faction else "players"
    return {"id": match.pk, "a": {"name": a.display_name, "url": f"/{prefix}/{a.username}"},
            "b": {"name": b.display_name, "url": f"/{prefix}/{b.username}"},
            "score_a": match.score_a, "score_b": match.score_b,
            "played_at": match.played_at, "status": match.status}


@api_view(["GET"])
def detail(request, event_id):
    event = get_object_or_404(CompetitionEvent, pk=event_id, is_published=True)
    if event.format == "FACTION":
        matches = event.faction_matches.filter(status="COMPLETED", processed_at__isnull=False).select_related("team_a", "team_b")[:100]
    else:
        matches = event.solo_matches.filter(status="COMPLETED", processed_at__isnull=False).select_related("player_a", "player_b")[:100]
    return Response({**payload(event), "matches": [match_payload(match, event.format == "FACTION") for match in matches]})


@api_view(["GET", "POST"])
@permission_classes([DeveloperOnly])
def manage_list(request):
    if request.method == "GET":
        return Response({"events": [payload(event, developer=True) for event in CompetitionEvent.objects.order_by("-starts_at")[:500]]})
    form = EventInput(data=request.data)
    form.is_valid(raise_exception=True)
    with transaction.atomic():
        event = form.save(created_by=request.user)
        AuditEntry.objects.create(actor=request.user, action="event.created", target_type="event", target_id=str(event.pk), details={"title": event.title, "published": event.is_published})
    return Response(payload(event, developer=True), status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([DeveloperOnly])
@transaction.atomic
def manage_detail(request, event_id):
    event = get_object_or_404(CompetitionEvent.objects.select_for_update(), pk=event_id)
    form = EventInput(event, data={"is_published": False} if request.method == "DELETE" else request.data, partial=True)
    form.is_valid(raise_exception=True)
    event = form.save()
    AuditEntry.objects.create(actor=request.user, action="event.updated" if request.method == "PATCH" else "event.unpublished", target_type="event", target_id=str(event.pk), details={"title": event.title, "published": event.is_published, "fields": list(form.validated_data)})
    return Response(payload(event, developer=True))
