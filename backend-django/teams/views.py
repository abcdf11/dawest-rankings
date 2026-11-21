import hashlib
import json
from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import Prefetch, Q, prefetch_related_objects
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rankings.models import Player, RankingState
from rankings.eligibility import registered_players, registered_teams
from accounts.services import is_developer
from rankings.serializers import CompleteInput
from .engine import TEAM_STATE_ID, process_team_match, simulate_team_outcome
from .models import Team, TeamMatch
from .serializers import TeamHistorySerializer, TeamSerializer, TeamSimulationInput, form_for_team
from .registration import RegistrationInput, public_receipt, submit_registration
from .models import TeamRegistration


class CanRecordTeamMatch(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_staff and request.user.has_perm("teams.change_teammatch")


class RegistrationThrottle(SimpleRateThrottle):
    scope = "team_registration"
    rate = "15/hour"
    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([RegistrationThrottle])
def register(request):
    serializer = RegistrationInput(data=request.data, context={"request": request})
    serializer.is_valid(raise_exception=True)
    try:
        registration, created = submit_registration(serializer.validated_data, request.user)
    except IntegrityError:
        return Response({"detail": "The team name, tag, or roster was just reserved. Please check your details and try again."}, status=409)
    return Response(public_receipt(registration), status=201 if created else 200)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def registration_status(request, registration_id):
    qs = TeamRegistration.objects.select_related("team")
    if not is_developer(request.user):
        qs = qs.filter(submitted_by=request.user)
    registration = get_object_or_404(qs, pk=registration_id)
    return Response(public_receipt(registration))


def team_queryset():
    return registered_teams().prefetch_related(Prefetch("roster", queryset=registered_players().select_related("team_membership__team")))


def team_forms(teams):
    completed = TeamMatch.objects.filter(status="COMPLETED", processed_at__isnull=False).select_related("team_a", "team_b")[:5]
    prefetch_related_objects(teams, Prefetch("matches_a", queryset=completed, to_attr="recent_a"), Prefetch("matches_b", queryset=completed, to_attr="recent_b"))
    return {t.pk: sorted(t.recent_a + t.recent_b, key=lambda m: (m.played_at, m.pk), reverse=True)[:5] for t in teams}


@api_view(["GET"])
def rankings(request):
    tier = request.query_params.get("tier", "ALL").upper()
    region = request.query_params.get("region", "ALL").upper()
    search = request.query_params.get("search", "").strip()[:64]
    if tier not in {"ALL", *Player.Tier.values} or region not in {"ALL", *Player.Region.values}:
        return Response({"detail": "Unknown tier or region."}, status=400)
    state = RankingState.objects.filter(pk=TEAM_STATE_ID).first()
    revision = state.revision if state else 0
    key = f"leaderboard:teams:{revision}:" + hashlib.sha256(json.dumps([tier, region, search]).encode()).hexdigest()
    data = cache.get(key)
    if data is None:
        qs = team_queryset()
        if tier != "ALL": qs = qs.filter(tier=tier)
        if region != "ALL": qs = qs.filter(region=region)
        if search: qs = qs.filter(Q(username__icontains=search) | Q(display_name__icontains=search) | Q(tag__icontains=search))
        teams = list(qs[:500])
        data = {"teams": TeamSerializer(teams, many=True, context={"forms": team_forms(teams)}).data, "total": qs.count(), "revision": revision, "updated_at": state.updated_at.isoformat() if state else None, "source": "official", "realtime_enabled": settings.USE_REDIS}
        cache.set(key, data, 60)
    return Response(data)


@api_view(["GET"])
def detail(request, username):
    team = get_object_or_404(team_queryset(), username__iexact=username)
    matches = list(TeamMatch.objects.filter(Q(team_a=team) | Q(team_b=team), status="COMPLETED", processed_at__isnull=False).select_related("team_a", "team_b")[:20])
    history = list(team.rating_history.order_by("-recorded_at", "-pk")[:120])
    return Response({**TeamSerializer(team, context={"forms": {team.pk: matches}}).data, "history": TeamHistorySerializer(list(reversed(history)), many=True).data, "matches": form_for_team(team, matches)})


@api_view(["POST"])
def simulate(request):
    serializer = TeamSimulationInput(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        return Response(simulate_team_outcome(**serializer.validated_data))
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)


@api_view(["POST"])
@permission_classes([CanRecordTeamMatch])
@transaction.atomic
def complete(request, match_id):
    serializer = CompleteInput(data=request.data)
    serializer.is_valid(raise_exception=True)
    RankingState.objects.get_or_create(pk=TEAM_STATE_ID)
    RankingState.objects.select_for_update().get(pk=TEAM_STATE_ID)
    match = get_object_or_404(TeamMatch.objects.select_for_update(), pk=match_id)
    scores = serializer.validated_data
    if match.processed_at and (match.score_a != scores["score_a"] or match.score_b != scores["score_b"]):
        return Response({"detail": "This team result has already been finalized."}, status=409)
    if not match.processed_at:
        match.score_a, match.score_b = scores["score_a"], scores["score_b"]
        match.save(update_fields=["score_a", "score_b"])
    try:
        result = process_team_match(match.pk)
    except ValueError as exc:
        transaction.set_rollback(True)
        return Response({"detail": str(exc)}, status=400)
    return Response({"id": result.pk, "status": result.status, "rating_delta": result.rating_delta})
