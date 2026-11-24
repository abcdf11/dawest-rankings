"""Link Roblox accounts using a one-time website code redeemed by a trusted game server.

The browser never submits a Roblox identity. The game takes it from the connected Player
and authenticates with DAWEST_GAME_API_KEY (the existing KOH/faction server credential).
Only code digests are stored; issuing a new code or unlinking invalidates the previous one.
"""
import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.views.decorators.cache import never_cache
from rest_framework import serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from rankings.koh import GameServerKey, GameThrottle
from rankings.models import Player
from .models import AuditEntry, RobloxLinkCode
from .services import roblox_payload

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 10
CODE_LIFETIME = timedelta(minutes=10)


def code_digest(code):
    return hashlib.sha256(code.encode("ascii")).hexdigest()


def configured():
    return bool(settings.DAWEST_GAME_API_KEY.strip())


class LinkCodeThrottle(UserRateThrottle):
    scope = "roblox_link_code"
    rate = "20/hour"

    def allow_request(self, request, view):
        return request.method != "POST" or super().allow_request(request, view)


def _player(user, lock=False):
    qs = Player.objects.filter(user=user, is_active=True, user__is_active=True)
    return (qs.select_for_update() if lock else qs).first()


@never_cache
@api_view(["GET", "POST", "DELETE"])
@permission_classes([IsAuthenticated])
@throttle_classes([UserRateThrottle, LinkCodeThrottle])
@transaction.atomic
def link(request):
    """GET: private status. POST: new code. DELETE: cancel pending verification."""
    player = _player(request.user, lock=request.method != "GET")
    if player is None:
        return Response({"detail": "Only active player accounts can link Roblox."}, status=400)
    if request.method == "DELETE":
        RobloxLinkCode.objects.filter(player=player).delete()
    if request.method == "POST":
        if not configured():
            return Response({"detail": "Roblox account linking is temporarily unavailable."}, status=503)
        if player.roblox_user_id:
            return Response({"detail": "Unlink your current Roblox account before linking another."}, status=409)
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        expires_at = timezone.now() + CODE_LIFETIME
        RobloxLinkCode.objects.update_or_create(player=player, defaults={"digest": code_digest(code), "expires_at": expires_at})
        return Response({"code": code, "expires_at": expires_at}, status=201)
    pending = RobloxLinkCode.objects.filter(player=player, expires_at__gt=timezone.now()).first()
    return Response({"available": configured(), "roblox": roblox_payload(player), "expires_at": pending.expires_at if pending else None})


class GameLinkInput(serializers.Serializer):
    code = serializers.CharField(max_length=32)
    roblox_user_id = serializers.IntegerField(min_value=1, max_value=2**63 - 1)
    roblox_username = serializers.RegexField(r"^[A-Za-z0-9_]{1,40}$")
    roblox_display_name = serializers.CharField(max_length=64)

    def validate_code(self, value):
        value = value.strip().upper().replace("-", "").replace(" ", "")
        if len(value) != CODE_LENGTH or any(c not in CODE_ALPHABET for c in value):
            raise serializers.ValidationError("Enter the 10-character code from your website profile.")
        return value


@api_view(["POST"])
@authentication_classes([])
@permission_classes([GameServerKey])
@throttle_classes([GameThrottle])
def game_link(request):
    form = GameLinkInput(data=request.data)
    form.is_valid(raise_exception=True)
    data = form.validated_data
    digest = code_digest(data["code"])
    # Resolve the owner, then lock Player first, matching issue/cancel/unlink lock order.
    player_id = RobloxLinkCode.objects.filter(digest=digest).values_list("player_id", flat=True).first()
    try:
        with transaction.atomic():
            player = Player.objects.select_for_update().filter(pk=player_id, is_active=True, user__is_active=True).first()
            pending = RobloxLinkCode.objects.select_for_update().filter(player_id=player_id, digest=digest, expires_at__gt=timezone.now()).first() if player else None
            if pending is None:
                return Response({"ok": False, "detail": "That code is wrong or expired. Get a new one on your website profile."}, status=404)
            if player.roblox_user_id or Player.objects.filter(roblox_user_id=data["roblox_user_id"]).exists():
                return Response({"ok": False, "detail": "This player or Roblox account is already linked. Unlink it on the website first."}, status=409)
            player.roblox_user_id = data["roblox_user_id"]
            player.roblox_username = data["roblox_username"]
            player.roblox_display_name = data["roblox_display_name"]
            player.roblox_linked_at = timezone.now()
            player.save(update_fields=["roblox_user_id", "roblox_username", "roblox_display_name", "roblox_linked_at"])
            pending.delete()
            AuditEntry.objects.create(actor_id=player.user_id, action="player.roblox_linked", target_type="player", target_id=str(player.pk),
                                      details={"roblox_user_id": player.roblox_user_id, "roblox_username": player.roblox_username, "method": "game_code"})
    except IntegrityError:
        # The unique Roblox user id also protects concurrent claims by different site players.
        return Response({"ok": False, "detail": "That Roblox account is already linked to another DaWest player."}, status=409)
    return Response({"ok": True, "username": player.username})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def unlink(request):
    player = _player(request.user, lock=True)
    if player is None:
        return Response({"detail": "Only active player accounts can link Roblox."}, status=400)
    old = player.roblox_user_id
    Player.objects.filter(pk=player.pk).update(roblox_user_id=None, roblox_username="", roblox_display_name="", roblox_linked_at=None)
    RobloxLinkCode.objects.filter(player=player).delete()
    if old:
        AuditEntry.objects.create(actor=request.user, action="player.roblox_unlinked", target_type="player", target_id=str(player.pk), details={"roblox_user_id": old})
    return Response({"linked": False})
