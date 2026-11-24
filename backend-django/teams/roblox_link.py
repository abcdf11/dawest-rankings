"""Linking a site faction to its in-game (Roblox) faction, and the public faction rating lookup.

1. The site faction's leader asks for a one-time code (owner only, 10 minutes).
2. The in-game faction's leader enters it in the game's faction menu; the game server sends it here
   with the game key. It only links when that in-game leader IS the site owner's linked Roblox
   account, so nobody can claim another faction by typing its id.
"""
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from accounts.models import AuditEntry
from rankings.eligibility import registered_teams
from rankings.koh import GameServerKey, GameThrottle
from rankings.models import Player
from .factions import own_faction

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I: easy to type in-game
CODE_LENGTH = 8
CODE_LIFETIME = timedelta(minutes=10)
FACTION_ID = r"^[A-Za-z0-9_-]{4,32}$"


class LinkCodeThrottle(UserRateThrottle):
    scope = "faction_link_code"
    rate = "20/hour"


def link_payload(team):
    if not team.roblox_faction_id:
        return None
    return {"faction_id": team.roblox_faction_id, "name": team.roblox_faction_name, "linked_at": team.roblox_linked_at}


@api_view(["POST", "DELETE"])
@permission_classes([IsAuthenticated])
@throttle_classes([LinkCodeThrottle])
@transaction.atomic
def owner_link(request, username):
    """POST: a new link code for this faction. DELETE: unlink the in-game faction."""
    team = own_faction(request, username, lock=True)
    if request.method == "DELETE":
        if team.roblox_faction_id:
            AuditEntry.objects.create(actor=request.user, action="faction.roblox.unlinked", target_type="team", target_id=str(team.pk),
                                      details={"faction_id": team.roblox_faction_id, "name": team.roblox_faction_name})
        team.roblox_faction_id, team.roblox_faction_name, team.roblox_linked_at = None, "", None
        team.roblox_link_code, team.roblox_link_code_expires = "", None
        team.save(update_fields=["roblox_faction_id", "roblox_faction_name", "roblox_linked_at", "roblox_link_code", "roblox_link_code_expires"])
        return Response({"roblox_faction": None})
    owner = Player.objects.filter(user=request.user).first()
    if not owner or not owner.roblox_user_id:
        return Response({"detail": "Link your Roblox account on your profile first: the in-game leader must be that account."}, status=400)
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
    team.roblox_link_code, team.roblox_link_code_expires = code, timezone.now() + CODE_LIFETIME
    team.save(update_fields=["roblox_link_code", "roblox_link_code_expires"])
    return Response({"code": code, "expires_at": team.roblox_link_code_expires, "roblox_faction": link_payload(team)}, status=201)


class GameLinkInput(serializers.Serializer):
    code = serializers.CharField(max_length=CODE_LENGTH + 4)
    faction_id = serializers.RegexField(FACTION_ID)
    faction_name = serializers.CharField(max_length=64)
    leader_roblox_user_id = serializers.IntegerField(min_value=1)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([GameServerKey])
@throttle_classes([GameThrottle])
@transaction.atomic
def game_link(request):
    """Game server: the in-game faction leader entered a site link code."""
    form = GameLinkInput(data=request.data)
    form.is_valid(raise_exception=True)
    d = form.validated_data
    code = d["code"].strip().upper().replace("-", "").replace(" ", "")
    team = registered_teams().select_for_update().select_related("owner").filter(
        roblox_link_code=code, roblox_link_code_expires__gt=timezone.now()).first() if code else None
    if team is None:
        return Response({"ok": False, "detail": "That code is wrong or expired. Get a new one on the site."}, status=404)
    owner = Player.objects.filter(user_id=team.owner_id).first()
    if not owner or owner.roblox_user_id != d["leader_roblox_user_id"]:
        return Response({"ok": False, "detail": "Only the site faction's leader, playing on their linked Roblox account, can link it."}, status=403)
    taken = registered_teams().filter(roblox_faction_id=d["faction_id"]).exclude(pk=team.pk).first()
    if taken:
        return Response({"ok": False, "detail": f"This in-game faction is already linked to {taken.display_name}."}, status=409)
    team.roblox_faction_id, team.roblox_faction_name = d["faction_id"], d["faction_name"]
    team.roblox_linked_at = timezone.now()
    team.roblox_link_code, team.roblox_link_code_expires = "", None
    team.save(update_fields=["roblox_faction_id", "roblox_faction_name", "roblox_linked_at", "roblox_link_code", "roblox_link_code_expires"])
    AuditEntry.objects.create(actor_id=team.owner_id, action="faction.roblox.linked", target_type="team", target_id=str(team.pk),
                              details={"faction_id": d["faction_id"], "name": d["faction_name"]})
    return Response({"ok": True, "faction": faction_entry(team)})


def faction_entry(team):
    return {"linked": True, "faction_id": team.roblox_faction_id, "username": team.username, "display_name": team.display_name,
            "tag": team.tag, "rating": round(team.rating), "peak_rating": round(team.peak_rating), "rank": team.rank,
            "tier": team.tier, "region": team.region, "wins": team.wins, "losses": team.losses,
            "profile_url": f"/factions/{team.username}"}


@api_view(["GET"])
def roblox_factions(request):
    """Public, for game servers: ?ids=<in-game faction ids> (up to 50). Unlinked ids: {"linked": false}."""
    ids = [i.strip() for i in request.query_params.get("ids", "").split(",") if i.strip()][:50]
    found = {t.roblox_faction_id: faction_entry(t) for t in registered_teams().filter(roblox_faction_id__in=ids)}
    return Response({"factions": {i: found.get(i, {"linked": False, "faction_id": i}) for i in ids}})
