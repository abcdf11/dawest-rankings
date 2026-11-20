import hashlib
import json
from django.core.cache import cache
from django.db import transaction
from django.db.models import Prefetch, Q, prefetch_related_objects
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from .engine import process_completed_match, simulate_match_outcome
from .models import Match, Player, RankingState
from .serializers import CompleteInput, PlayerSerializer, RatingHistorySerializer, SimulationInput, form_for_player

class CanRecordMatch(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_staff and request.user.has_perm("rankings.change_match")

def recent_forms(players):
    completed = Match.objects.filter(status="COMPLETED", processed_at__isnull=False).select_related("player_a", "player_b").order_by("-played_at", "-pk")[:5]
    # Django translates sliced prefetches to partitioned ROW_NUMBER windows.
    prefetch_related_objects(players, Prefetch("matches_a", queryset=completed, to_attr="recent_a"), Prefetch("matches_b", queryset=completed, to_attr="recent_b"))
    return {p.pk: sorted(p.recent_a + p.recent_b, key=lambda m: (m.played_at, m.pk), reverse=True)[:5] for p in players}

@api_view(["GET"])
def rankings(request):
    tier = request.query_params.get("tier", "ALL").upper()
    region = request.query_params.get("region", "ALL").upper()
    search = request.query_params.get("search", "").strip()[:64]
    if tier not in {"ALL", *Player.Tier.values} or region not in {"ALL", *Player.Region.values}:
        return Response({"detail": "Unknown tier or region."}, status=400)
    state = RankingState.objects.filter(pk=1).first()
    revision = state.revision if state else 0
    key = "leaderboard:" + str(revision) + ":" + hashlib.sha256(json.dumps([tier, region, search]).encode()).hexdigest()
    data = cache.get(key)
    if data is None:
        qs = Player.objects.all()
        if tier != "ALL": qs = qs.filter(tier=tier)
        if region != "ALL": qs = qs.filter(region=region)
        if search: qs = qs.filter(Q(username__icontains=search) | Q(display_name__icontains=search))
        players = list(qs[:500])
        data = {"players": PlayerSerializer(players, many=True, context={"forms": recent_forms(players)}).data, "total": qs.count(), "revision": revision, "updated_at": state.updated_at.isoformat() if state else None, "source": "official"}
        cache.set(key, data, 60)
    return Response(data)

@api_view(["GET"])
def player_detail(request, username):
    player = get_object_or_404(Player, username__iexact=username)
    matches = list(Match.objects.filter(Q(player_a=player) | Q(player_b=player), status="COMPLETED", processed_at__isnull=False).select_related("player_a", "player_b")[:20])
    history = list(player.rating_history.order_by("-recorded_at", "-pk")[:120])
    return Response({**PlayerSerializer(player, context={"forms": {player.pk: matches}}).data, "history": RatingHistorySerializer(list(reversed(history)), many=True).data, "matches": form_for_player(player, matches)})

@api_view(["POST"])
def simulate(request):
    serializer = SimulationInput(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        return Response(simulate_match_outcome(**serializer.validated_data))
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)

@api_view(["POST"])
@permission_classes([CanRecordMatch])
@transaction.atomic
def complete(request, match_id):
    serializer = CompleteInput(data=request.data)
    serializer.is_valid(raise_exception=True)
    RankingState.objects.get_or_create(pk=1)
    RankingState.objects.select_for_update().get(pk=1)
    match = get_object_or_404(Match.objects.select_for_update(), pk=match_id)
    if match.processed_at and (match.score_a != serializer.validated_data["score_a"] or match.score_b != serializer.validated_data["score_b"]):
        return Response({"detail": "This result has already been finalized."}, status=status.HTTP_409_CONFLICT)
    if not match.processed_at:
        match.score_a = serializer.validated_data["score_a"]
        match.score_b = serializer.validated_data["score_b"]
        match.save(update_fields=["score_a", "score_b"])
    match = process_completed_match(match.pk)
    return Response({"id": match.pk, "status": match.status, "rating_delta": match.rating_delta})

@api_view(["GET"])
def health(request):
    RankingState.objects.exists()
    return Response({"status": "ok", "service": "dawest-core"})
