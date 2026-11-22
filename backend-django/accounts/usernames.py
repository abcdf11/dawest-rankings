"""Change the authenticated account's login and profile username atomically."""
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from rankings.engine import publish_pending_events
from rankings.models import Player, RankingEvent
from teams.models import RegistrationMember, TeamRegistration
from .models import AuditEntry, UsernameAlias
from .services import lock_ladders, user_payload


class UsernameThrottle(UserRateThrottle):
    scope = "username_changes"
    rate = "10/hour"


class UsernameInput(serializers.Serializer):
    username = serializers.RegexField(r"^[a-zA-Z0-9_]{3,30}$", max_length=30,
        error_messages={"invalid": "Use 3–30 letters, numbers, or underscores."})

    def validate_username(self, value):
        return value.lower()


class UsernameTaken(APIException):
    status_code = 409
    default_detail = "This username is already registered or reserved."


@transaction.atomic
def rename_account(user_id, username):
    states = lock_ladders()
    User = get_user_model()
    user = get_object_or_404(User.objects.select_for_update(), pk=user_id, is_active=True)
    player = Player.objects.select_for_update().filter(user=user).first()
    if player and not player.is_active:
        raise serializers.ValidationError("This player account is inactive.")
    if username == user.username and (not player or player.username == username):
        return user
    if (User.objects.filter(username__iexact=username).exclude(pk=user.pk).exists()
            or Player.objects.filter(username__iexact=username).exclude(user=user).exists()
            or UsernameAlias.objects.filter(username__iexact=username).exclude(user=user).exists()):
        raise UsernameTaken({"username": "This username is already registered or reserved."})
    previous = user.username
    old_names = {previous}
    if player:
        old_names.add(player.username)
    UsernameAlias.objects.filter(user=user, username__iexact=username).delete()
    for old in old_names - {username}:
        UsernameAlias.objects.get_or_create(username=old.lower(), defaults={"user": user})
    user.username = username
    user.save(update_fields=["username"])
    if player:
        old_profile_name = player.username
        player.username = username
        player.save(update_fields=["username", "updated_at"])
        # These pending application fields contain usernames rather than player IDs.
        # Historical approved/rejected applications remain submission snapshots.
        RegistrationMember.objects.filter(registration__status="PENDING", username__iexact=old_profile_name).update(username=username)
        TeamRegistration.objects.filter(status="PENDING", captain_username__iexact=old_profile_name).update(captain_username=username)
    audit = AuditEntry.objects.create(actor=user, action="account.username_changed", target_type="user",
        target_id=str(user.pk), details={"previous_username": previous, "username": username})
    # Invalidate player ladders and cached team rosters without altering ratings or ranks.
    for state in states:
        state.revision += 1
        state.save()
        RankingEvent.objects.create(payload={"reason": "moderation", "operation_id": str(audit.pk),
            "kind": "teams" if state.pk == 2 else "players", "revision": state.revision,
            "updated_at": timezone.now().isoformat(), "players": []})
    transaction.on_commit(publish_pending_events)
    return user


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([UsernameThrottle])
def change_username(request):
    form = UsernameInput(data=request.data)
    form.is_valid(raise_exception=True)
    if set(request.data) - {"username"}:
        return Response({"detail": "Only your own username can be changed here."}, status=400)
    try:
        user = rename_account(request.user.pk, form.validated_data["username"])
    except IntegrityError:
        return Response({"username": "This username is already registered or reserved."}, status=409)
    data = user_payload(user)
    return Response({"authenticated": True, "user": data, "csrf_token": get_token(request),
        "profile_url": f"/players/{data['player']['username']}" if data["player"] else None})
