"""Faction profiles and owner-only roster management backed by existing teams."""
from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_safe
from rest_framework import serializers
from rest_framework.decorators import api_view, parser_classes, permission_classes, throttle_classes
from rest_framework.exceptions import APIException
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from accounts.appearance import AppearanceInput, ImageUploadThrottle, media_response
from accounts.models import AuditEntry
from accounts.services import lock_ladders
from rankings.eligibility import competitive_players, registered_players, registered_teams, require_unrestricted
from rankings.engine import publish_pending_events
from rankings.models import RankingEvent
from rankings.profile_images import normalize_image
from rankings.serializers import PlayerSerializer
from .models import FactionJoinRequest, FactionMedia, RegistrationMember, TeamMembership, TeamMatch, TeamRegistration
from .serializers import TeamHistorySerializer, TeamSerializer, form_for_team

MAX_MEMBERS = 10


class FactionConflict(APIException):
    status_code = 409
    default_detail = "This faction membership changed. Refresh and try again."


class JoinThrottle(UserRateThrottle):
    scope = "faction_join"
    rate = "30/hour"


def factions():
    players = registered_players().select_related("team_membership__team")
    return registered_teams().select_related("owner", "registration").prefetch_related(
        "memberships__player__user", "memberships__player__team_membership__team",
        Prefetch("roster", queryset=players))


def clear_stale_membership(player):
    """A membership in a faction the developers removed no longer counts: drop it so the player can
    join or register another faction."""
    TeamMembership.objects.filter(player=player, team__is_active=False).delete()


def own_faction(request, username, lock=False):
    require_unrestricted(request.user)
    queryset = registered_teams().filter(owner=request.user)
    if lock:
        queryset = queryset.select_for_update()
    return get_object_or_404(queryset, username__iexact=username)


def summary(team):
    return {"id": team.pk, "username": team.username, "display_name": team.display_name,
            "tag": team.tag, "region": team.region, "avatar_url": team.profile_avatar_url,
            "banner_url": team.profile_banner_url, "rating": team.rating, "rank": team.rank,
            "profile_url": f"/factions/{team.username}", "is_verified": team.is_verified}


def member_rows(team):
    return [{**PlayerSerializer(member.player).data,
             "is_leader": member.player.user_id == team.owner_id,
             "is_captain": member.is_captain, "joined_at": member.joined_at}
            for member in team.memberships.all() if member.player.is_active and member.player.registered_at
            and member.player.user_id and member.player.user.is_active]


def faction_payload(team):
    registration = getattr(team, "registration", None)
    members = member_rows(team)
    leader = next((member for member in members if member["is_leader"]), None)
    return {**TeamSerializer(team).data, "banner_url": team.profile_banner_url,
            "audio_url": team.profile_audio_url, "audio_title": team.audio_title,
            "description": registration.description if registration else "",
            "registered_at": team.registered_at, "leader": leader,
            "members": members, "member_count": len(members),
            "capacity": MAX_MEMBERS, "profile_url": f"/factions/{team.username}",
            "roblox_faction": {"faction_id": team.roblox_faction_id, "name": team.roblox_faction_name,
                               "linked_at": team.roblox_linked_at} if team.roblox_faction_id else None}


def request_payload(row, include_message=True):
    result = {"id": str(row.pk), "status": row.status, "created_at": row.created_at,
              "reviewed_at": row.reviewed_at, "faction": summary(row.team),
              "player": {"id": row.player_id, "username": row.player.username,
                         "display_name": row.player.display_name, "avatar_url": row.player.profile_avatar_url,
                         "rating": row.player.rating, "region": row.player.region}}
    if include_message:
        result["message"] = row.message
    return result


def record_change(request, states, action, team, details=None):
    audit = AuditEntry.objects.create(actor=request.user, action=action, target_type="team",
                                     target_id=str(team.pk), details=details or {})
    for state in states:
        state.revision += 1
        state.save()
        RankingEvent.objects.create(payload={"reason": "moderation", "operation_id": str(audit.pk),
            "kind": "teams" if state.pk == 2 else "players", "revision": state.revision,
            "updated_at": timezone.now().isoformat(), "players": []})
    transaction.on_commit(publish_pending_events)


@api_view(["GET"])
def directory(request):
    search = request.query_params.get("search", "").strip()[:64]
    teams = registered_teams().annotate(member_count=Count("memberships", filter=Q(memberships__player__in=registered_players())))
    if search:
        teams = teams.filter(Q(display_name__icontains=search) | Q(tag__icontains=search) | Q(username__icontains=search))
    return Response({"factions": [{**summary(team), "member_count": team.member_count,
                                   "capacity": MAX_MEMBERS} for team in teams[:500]]})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def mine(request):
    owned = list(factions().filter(owner=request.user))
    membership = TeamMembership.objects.select_related("team").filter(player__user=request.user, player__in=registered_players(), team__in=registered_teams()).first()
    member_team = membership.team if membership else None
    requests = FactionJoinRequest.objects.select_related("team", "player").filter(player__user=request.user, team__in=registered_teams())[:50]
    pending_registration = TeamRegistration.objects.filter(status="PENDING").filter(
        Q(submitted_by=request.user) | Q(members__username__iexact=request.user.username)).exists()
    return Response({"owned": [summary(team) for team in owned],
                     "membership": summary(member_team) if member_team else None,
                     "pending_registration": pending_registration,
                     "requests": [request_payload(row) for row in requests]})


@api_view(["GET"])
def detail(request, username):
    team = get_object_or_404(factions(), username__iexact=username)
    matches = list(TeamMatch.objects.filter(Q(team_a=team) | Q(team_b=team), status="COMPLETED", processed_at__isnull=False).select_related("team_a", "team_b")[:20])
    history = list(team.rating_history.order_by("-recorded_at", "-pk")[:120])
    data = faction_payload(team)
    data.update({"history": TeamHistorySerializer(list(reversed(history)), many=True).data,
                 "matches": form_for_team(team, matches)})
    return Response(data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def manage(request, username):
    team = own_faction(request, username)
    pending = team.join_requests.filter(status="PENDING").select_related("player", "team")[:100]
    reviewed = team.join_requests.exclude(status="PENDING").select_related("player", "team")[:20]
    return Response({"faction": faction_payload(team), "requests": [request_payload(row) for row in pending],
                     "recent_requests": [request_payload(row) for row in reviewed]})


class JoinInput(serializers.Serializer):
    message = serializers.CharField(max_length=500, allow_blank=True, default="")


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([JoinThrottle])
@transaction.atomic
def join(request, username):
    require_unrestricted(request.user)
    lock_ladders()
    team = get_object_or_404(registered_teams().select_for_update(), username__iexact=username)
    player = get_object_or_404(registered_players().select_for_update(), user=request.user)
    clear_stale_membership(player)
    if team.owner_id == request.user.pk or TeamMembership.objects.filter(player=player).exists():
        raise FactionConflict("You already belong to a faction. Leave it before requesting another.")
    if RegistrationMember.objects.filter(username__iexact=player.username, registration__status="PENDING").exists():
        raise FactionConflict("Your account is part of a team registration awaiting review.")
    if team.memberships.count() >= MAX_MEMBERS:
        raise FactionConflict("This faction has reached its 10-member limit.")
    form = JoinInput(data=request.data)
    form.is_valid(raise_exception=True)
    row, created = FactionJoinRequest.objects.get_or_create(team=team, player=player, defaults=form.validated_data)
    reopened = not created and row.status != "PENDING"
    if reopened:
        row.status, row.message, row.reviewed_at, row.reviewed_by = "PENDING", form.validated_data["message"], None, None
        row.save()
    if created or reopened:
        AuditEntry.objects.create(actor=request.user, action="faction.join.requested", target_type="team", target_id=str(team.pk))
    return Response(request_payload(row), status=201 if created else 200)


class DecisionInput(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["ACCEPTED", "REJECTED"])


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def review(request, username, request_id):
    states = lock_ladders()
    team = own_faction(request, username, lock=True)
    row = get_object_or_404(FactionJoinRequest.objects.select_for_update().select_related("player", "team"), pk=request_id, team=team)
    form = DecisionInput(data=request.data)
    form.is_valid(raise_exception=True)
    decision = form.validated_data["decision"]
    if row.status == decision:
        return Response(request_payload(row))
    if row.status != "PENDING":
        raise FactionConflict("This request has already been resolved.")
    if decision == "ACCEPTED":
        player = get_object_or_404(competitive_players().select_for_update(), pk=row.player_id)
        clear_stale_membership(player)
        if TeamMembership.objects.filter(player=player).exists():
            raise FactionConflict("This player has already joined another faction.")
        if RegistrationMember.objects.filter(username__iexact=player.username, registration__status="PENDING").exists():
            raise FactionConflict("This player is part of a team registration awaiting review.")
        if team.memberships.count() >= MAX_MEMBERS:
            raise FactionConflict("This faction has reached its 10-member limit.")
        TeamMembership.objects.create(team=team, player=player)
        FactionJoinRequest.objects.filter(player=player, status="PENDING").exclude(pk=row.pk).update(status="CANCELLED", updated_at=timezone.now())
    row.status, row.reviewed_by, row.reviewed_at = decision, request.user, timezone.now()
    row.save()
    record_change(request, states, f"faction.join.{decision.lower()}", team, {"player": row.player.username})
    return Response(request_payload(row))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def withdraw(request, request_id):
    lock_ladders()
    row = get_object_or_404(FactionJoinRequest.objects.select_for_update().select_related("team", "player"), pk=request_id, player__user=request.user)
    if row.status not in {"PENDING", "CANCELLED"}:
        raise FactionConflict("This request has already been reviewed.")
    row.status = "CANCELLED"
    row.save(update_fields=["status", "updated_at"])
    return Response(request_payload(row))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def remove_member(request, username, player_id):
    states = lock_ladders()
    team = get_object_or_404(registered_teams().select_for_update(), username__iexact=username)
    membership = get_object_or_404(TeamMembership.objects.select_for_update().select_related("player"), team=team, player_id=player_id)
    if request.user.pk != team.owner_id and membership.player.user_id != request.user.pk:
        return Response({"detail": "Only the faction leader or this member can remove their membership."}, status=403)
    if request.user.pk == team.owner_id:
        require_unrestricted(request.user)
    if membership.is_captain or membership.player.user_id == team.owner_id:
        raise FactionConflict("The faction leader must remain in the faction.")
    member_username = membership.player.username
    membership.delete()
    record_change(request, states, "faction.member.removed", team, {"player": member_username})
    return Response({"detail": "Membership removed."})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
@throttle_classes([ImageUploadThrottle])
def appearance(request, username):
    own_faction(request, username)
    form = AppearanceInput(data=request.data)
    if set(request.data) - set(form.fields):
        return Response({"detail": "Only faction images and removal options can be changed here."}, status=400)
    form.is_valid(raise_exception=True)
    values = form.validated_data
    images = {kind: normalize_image(values[kind], kind) for kind in ("avatar", "banner") if kind in values}
    with transaction.atomic():
        states = lock_ladders()
        team = own_faction(request, username, lock=True)
        for field, kind in (("avatar", "logo"), ("banner", "banner")):
            if field in images:
                image = images[field]
                FactionMedia.objects.update_or_create(team=team, kind=kind, defaults={"version": image.version,
                    "content_type": image.content_type, "data": image.data, "poster": image.poster,
                    "byte_size": len(image.data), "poster_size": len(image.poster), "width": image.width,
                    "height": image.height, "frames": image.frames})
                setattr(team, f"{kind}_version", image.version)
            elif values.get(f"remove_{field}"):
                FactionMedia.objects.filter(team=team, kind=kind).delete()
                setattr(team, f"{kind}_version", "")
                if kind == "logo":
                    team.avatar_url = ""
        team.save(update_fields=["logo_version", "banner_version", "avatar_url", "updated_at"])
        record_change(request, states, "faction.images.updated", team)
    return Response({"avatar_url": team.profile_avatar_url, "banner_url": team.profile_banner_url})


@require_safe
def image(request, username, kind, version):
    media = get_object_or_404(FactionMedia.objects.defer("data", "poster"), team__in=registered_teams().filter(username__iexact=username), kind=kind, version=version)
    return media_response(request, media)
