"""Dynamic Elo (not Glicko-2): zero-sum, event-weighted, margin-adjusted."""
import json
import logging
import math
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from .models import Match, Player, RankingEvent, RankingState, RatingHistory
from .eligibility import registered_players

logger = logging.getLogger(__name__)
EVENT_WEIGHTS = {"RANKED_1V1": 1.0, "RANKED_TEAM": 1.0, "SHOWMATCH": 1.2, "TOURNAMENT": 1.5, "QUALIFIER": 1.25}

def tier_for_rating(rating: float) -> str:
    for threshold, tier in [(1900, "LEGEND"), (1700, "OUTLAW"), (1500, "GUNSLINGER"), (1300, "DEPUTY")]:
        if rating >= threshold:
            return tier
    return "ROOKIE"

def calculate_outcome(rating_a: float, rating_b: float, score_a: int, score_b: int, match_type: str) -> dict:
    if type(score_a) is not int or type(score_b) is not int or not 0 <= score_a <= 100 or not 0 <= score_b <= 100 or score_a == score_b:
        raise ValueError("Scores must be distinct integers between 0 and 100.")
    if match_type not in EVENT_WEIGHTS:
        raise ValueError("Unknown match type.")
    expected_a = 1 / (1 + 10 ** (max(-4000, min(4000, rating_b - rating_a)) / 400))
    margin = 1 + .35 * math.log1p(abs(score_a - score_b))
    delta = 32 * EVENT_WEIGHTS[match_type] * margin * ((1 if score_a > score_b else 0) - expected_a)
    delta = round(max(-rating_a, min(rating_b, delta)), 2)
    return {"delta_a": delta, "delta_b": -delta, "rating_a": round(rating_a + delta, 2), "rating_b": round(rating_b - delta, 2), "expected_a": expected_a, "margin_multiplier": margin, "event_weight": EVENT_WEIGHTS[match_type]}

@transaction.atomic
def simulate_match_outcome(player_a_id: int, player_b_id: int, score_a: int, score_b: int, match_type: str) -> dict:
    if player_a_id == player_b_id:
        raise ValueError("Choose two different players.")
    # One query yields a consistent ladder snapshot without mutating it.
    players = list(registered_players())
    by_id = {p.pk: p for p in players}
    if player_a_id not in by_id or player_b_id not in by_id:
        raise ValueError("Player not found.")
    a, b = by_id[player_a_id], by_id[player_b_id]
    outcome = calculate_outcome(a.rating, b.rating, score_a, score_b, match_type)
    proposed = {p.pk: p.rating for p in players}
    proposed.update({a.pk: outcome["rating_a"], b.pk: outcome["rating_b"]})
    ranks = {p.pk: i + 1 for i, p in enumerate(sorted(players, key=lambda p: (-proposed[p.pk], p.username)))}
    return {**outcome, "players": [{"id": p.pk, "username": p.username, "before": p.rating, "after": proposed[p.pk], "delta": outcome[f"delta_{key}"], "rank_before": p.rank, "rank_after": ranks[p.pk], "tier": tier_for_rating(proposed[p.pk])} for p, key in [(a, "a"), (b, "b")]]}

def publish_pending_events() -> int:
    if not settings.USE_REDIS:
        return 0
    from django_redis import get_redis_connection
    count = 0
    try:
        connection = get_redis_connection("default")
        for event in RankingEvent.objects.filter(published_at__isnull=True).order_by("pk")[:100]:
            connection.publish(event.channel, json.dumps({**event.payload, "event_id": event.pk}))
            RankingEvent.objects.filter(pk=event.pk, published_at__isnull=True).update(published_at=timezone.now())
            count += 1
    except Exception:
        logger.exception("Redis publication deferred; the outbox relay will retry.")
    return count

def _after_commit():
    try:
        if hasattr(cache, "delete_pattern"):
            cache.delete_pattern("leaderboard:*")
        else:
            cache.clear()
    except Exception:
        logger.exception("Cache invalidation failed; revisioned keys prevent stale reads.")
    publish_pending_events()

@transaction.atomic
def process_completed_match(match_id: int) -> Match:
    RankingState.objects.get_or_create(pk=1)
    state = RankingState.objects.select_for_update().get(pk=1)
    match = Match.objects.select_for_update().get(pk=match_id)
    if match.processed_at:
        return match
    players = list(Player.objects.select_for_update().order_by("pk"))
    by_id = {p.pk: p for p in players}
    a, b = by_id[match.player_a_id], by_id[match.player_b_id]
    outcome = calculate_outcome(a.rating, b.rating, match.score_a, match.score_b, match.match_type)
    for p in players:
        p.previous_rank = p.rank
    for p, key, won, scored, conceded in [(a, "a", match.score_a > match.score_b, match.score_a, match.score_b), (b, "b", match.score_b > match.score_a, match.score_b, match.score_a)]:
        p.previous_rating = p.rating
        p.rating = outcome[f"rating_{key}"]
        p.peak_rating = max(p.peak_rating, p.rating)
        p.tier = tier_for_rating(p.rating)
        p.wins += int(won)
        p.losses += int(not won)
        p.current_streak = max(0, p.current_streak) + 1 if won else min(0, p.current_streak) - 1
        p.rounds_won += scored
        p.rounds_lost += conceded
        p.kd_ratio = round(p.rounds_won / max(1, p.rounds_lost), 2)
        p.updated_at = timezone.now()
    regions: dict[str, int] = {}
    eligible_ids = set(registered_players().values_list("pk", flat=True))
    ranked = [p for p in players if p.pk in eligible_ids]
    for i, p in enumerate(sorted(ranked, key=lambda p: (-p.rating, p.username)), 1):
        p.rank = i
        regions[p.region] = regions.get(p.region, 0) + 1
        p.regional_rank = regions[p.region]
    Player.objects.bulk_update(players, ["rating", "previous_rating", "peak_rating", "tier", "rank", "previous_rank", "regional_rank", "wins", "losses", "current_streak", "rounds_won", "rounds_lost", "kd_ratio", "updated_at"])
    RatingHistory.objects.bulk_create([RatingHistory(player=p, rating=p.rating, rank=p.rank, event_label=match.event_name) for p in players])
    match.status = Match.Status.COMPLETED
    match.processed_at = timezone.now()
    match.rating_delta = abs(outcome["delta_a"])
    match.save(update_fields=["status", "processed_at", "rating_delta"])
    state.revision += 1
    state.save()
    RankingEvent.objects.create(payload={"revision": state.revision, "match_id": match.pk, "updated_at": match.processed_at.isoformat(), "players": [{"id": p.pk, "rating": p.rating, "rank": p.rank} for p in [a, b]]})
    transaction.on_commit(_after_commit)
    return match
