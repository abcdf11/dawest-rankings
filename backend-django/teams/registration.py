"""Persist public applications and atomically approve verified rosters."""
import hashlib
import json
import re
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models.functions import Lower
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import serializers
from rest_framework.exceptions import APIException
from rankings.engine import _after_commit
from rankings.models import Player, RankingEvent, RankingState, RatingHistory
from rankings.eligibility import competitive_players, registered_teams
from .models import RegistrationMember, RegistrationReview, Team, TeamMembership, TeamRatingHistory, TeamRegistration


class RegistrationConflict(APIException):
    status_code = 409
    default_detail = "A registration with this team name, tag, or roster already exists."


class RosterInput(serializers.Serializer):
    username = serializers.SlugField(max_length=40)
    display_name = serializers.CharField(max_length=64)

    def validate_username(self, value):
        return value.lower()


class RegistrationInput(serializers.Serializer):
    request_key = serializers.UUIDField()
    team_name = serializers.CharField(min_length=2, max_length=64)
    tag = serializers.CharField(min_length=2, max_length=5)
    region = serializers.ChoiceField(choices=Player.Region.choices)
    description = serializers.CharField(max_length=500, allow_blank=True, default="")
    captain_username = serializers.SlugField(max_length=40)
    contact_discord = serializers.CharField(max_length=80, allow_blank=True, default="")
    members = RosterInput(many=True, min_length=2, max_length=10)

    def validate_tag(self, value):
        value = value.upper()
        if not re.fullmatch(r"[A-Z0-9]{2,5}", value):
            raise serializers.ValidationError("Use 2–5 letters or numbers for your team tag.")
        return value

    def validate_team_name(self, value):
        return " ".join(value.split())

    def validate(self, data):
        data["captain_username"] = data["captain_username"].lower()
        names = [m["username"] for m in data["members"]]
        if len(set(names)) != len(names):
            raise serializers.ValidationError({"members": "Each roster username must be unique."})
        if data["captain_username"] not in names:
            raise serializers.ValidationError({"captain_username": "Include the captain in your roster."})
        request = self.context.get("request")
        profile = getattr(request.user, "player_profile", None) if request else None
        if not self.context.get("developer") and (not profile or not profile.is_active or profile.username != data["captain_username"]):
            raise serializers.ValidationError({"captain_username": "Sign in as the registered captain to submit this team."})
        registered = {p.username.lower(): p for p in competitive_players().filter(username__in=names)}
        missing = [name for name in names if name not in registered]
        if missing:
            raise serializers.ValidationError({"members": "These players need an active, unrestricted player account: " + ", ".join(missing)})
        for member in data["members"]:
            member["display_name"] = registered[member["username"]].display_name
        return data


def public_receipt(registration):
    """The opaque receipt never exposes contact details or roster applications."""
    return {"id": str(registration.pk), "reference": registration.reference, "team_name": registration.team_name, "tag": registration.tag, "region": registration.region, "status": registration.status, "created_at": registration.created_at.isoformat(), "reviewed_at": registration.reviewed_at.isoformat() if registration.reviewed_at else None, "review_note": registration.review_note, "team_username": registration.team.username if registration.team_id else None}


@transaction.atomic
def submit_registration(data, user):
    data = dict(data)
    request_key = data.pop("request_key")
    fingerprint = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
    RankingState.objects.get_or_create(pk=2)
    RankingState.objects.select_for_update().get(pk=2)
    existing = TeamRegistration.objects.filter(request_key=request_key).first()
    if existing:
        if existing.submitted_by_id != user.pk or existing.payload_hash != fingerprint:
            raise RegistrationConflict("This submission key was already used. Start a new registration.")
        return existing, False
    if Team.objects.filter(tag__iexact=data["tag"]).exists() or TeamRegistration.objects.filter(tag__iexact=data["tag"], status__in=["PENDING", "APPROVED"]).exists():
        raise RegistrationConflict("That team tag is already registered or awaiting review.")
    if Team.objects.filter(display_name__iexact=data["team_name"]).exists() or TeamRegistration.objects.filter(team_name__iexact=data["team_name"], status__in=["PENDING", "APPROVED"]).exists():
        raise RegistrationConflict("That team name is already registered or awaiting review.")
    members = data.pop("members")
    names = [m["username"] for m in members]
    if TeamMembership.objects.annotate(username_lower=Lower("player__username")).filter(username_lower__in=names).exists():
        raise RegistrationConflict("A roster member already belongs to another team.")
    if RegistrationMember.objects.annotate(username_lower=Lower("username")).filter(username_lower__in=names, registration__status="PENDING").exists():
        raise RegistrationConflict("A roster member is already in a pending registration.")
    application = TeamRegistration.objects.create(request_key=request_key, payload_hash=fingerprint, submitted_by=user, **data)
    RegistrationMember.objects.bulk_create([RegistrationMember(registration=application, username=member["username"], display_name=member["display_name"], is_captain=member["username"] == data["captain_username"], position=i) for i, member in enumerate(members)])
    return application, True


def _place_competitors(model, newcomers):
    qs = competitive_players() if model is Player else registered_teams()
    rows = list(qs.select_for_update().order_by("-rating", "username"))
    regions = {}
    for rank, row in enumerate(rows, 1):
        row.previous_rank = rank if row.pk in newcomers else row.rank
        row.rank = rank
        regions[row.region] = regions.get(row.region, 0) + 1
        row.regional_rank = regions[row.region]
    model.objects.bulk_update(rows, ["rank", "previous_rank", "regional_rank"])
    return rows


@transaction.atomic
def review_registration(registration_id, actor, approve, note=""):
    if not actor.is_staff or not actor.has_perm("teams.approve_teamregistration"):
        raise PermissionDenied("You do not have permission to review team registrations.")
    for state_id in (2, 1):
        RankingState.objects.get_or_create(pk=state_id)
    team_state = RankingState.objects.select_for_update().get(pk=2)
    player_state = RankingState.objects.select_for_update().get(pk=1)
    registration = TeamRegistration.objects.select_for_update().get(pk=registration_id)
    target = "APPROVED" if approve else "REJECTED"
    if registration.status == target:
        return registration
    if registration.status != "PENDING":
        raise RegistrationConflict("This registration has already been reviewed.")
    if approve:
        members = list(registration.members.all())
        if not 2 <= len(members) <= 10 or sum(m.is_captain for m in members) != 1:
            raise RegistrationConflict("A valid roster must contain 2–10 players and exactly one captain.")
        if Team.objects.filter(tag__iexact=registration.tag).exists() or Team.objects.filter(display_name__iexact=registration.team_name).exists():
            raise RegistrationConflict("The team name or tag has been taken.")
        names = [m.username for m in members]
        if TeamMembership.objects.annotate(username_lower=Lower("player__username")).filter(username_lower__in=names).exists():
            raise RegistrationConflict("A roster member has joined another team since this application.")
        slug = (slugify(registration.team_name)[:30] or "team") + "-" + registration.id.hex[:8]
        if not registration.submitted_by_id or not registration.submitted_by.is_active:
            raise RegistrationConflict("The captain must have an active registered account.")
        team = Team.objects.create(username=slug, display_name=registration.team_name, tag=registration.tag, region=registration.region, accent_color="#dddddd", owner=registration.submitted_by, registered_at=timezone.now())
        created_players = set()
        for member in members:
            player = competitive_players().filter(username__iexact=member.username).first()
            if player is None:
                raise RegistrationConflict(f"{member.username} must register an active player account first.")
            TeamMembership.objects.create(team=team, player=player, is_captain=member.is_captain)
        players = _place_competitors(Player, created_players)
        teams = _place_competitors(Team, {team.pk})
        RatingHistory.objects.bulk_create([RatingHistory(player=p, rating=p.rating, rank=p.rank, event_label="Team registration") for p in players])
        TeamRatingHistory.objects.bulk_create([TeamRatingHistory(team=t, rating=t.rating, rank=t.rank, event_label="Team registration") for t in teams])
        for state, kind, competitors in ((team_state, "teams", teams), (player_state, "players", players)):
            state.revision += 1
            state.save()
            RankingEvent.objects.create(payload={"reason": "registration", "registration_id": str(registration.pk), "kind": kind, "revision": state.revision, "updated_at": timezone.now().isoformat(), "players": [{"id": c.pk, "rating": c.rating, "rank": c.rank} for c in competitors]})
        registration.team = team
        transaction.on_commit(_after_commit)
    registration.status = target
    registration.reviewed_by = actor
    registration.reviewed_at = timezone.now()
    registration.review_note = note[:500]
    registration.save()
    RegistrationReview.objects.create(registration=registration, actor=actor, decision=target, note=note[:500])
    return registration
