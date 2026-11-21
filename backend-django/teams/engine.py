"""Team Elo uses team results only; roster members' solo ratings never change."""
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rankings.engine import _after_commit, calculate_outcome, tier_for_rating
from rankings.models import RankingEvent, RankingState
from .models import Team, TeamMatch, TeamRatingHistory
from rankings.eligibility import registered_teams

TEAM_STATE_ID = 2


@transaction.atomic
def simulate_team_outcome(team_a_id: int, team_b_id: int, score_a: int, score_b: int, match_type: str) -> dict:
    if team_a_id == team_b_id:
        raise ValueError("Choose two different teams.")
    teams = list(registered_teams())
    by_id = {t.pk: t for t in teams}
    if team_a_id not in by_id or team_b_id not in by_id:
        raise ValueError("Team not found.")
    a, b = by_id[team_a_id], by_id[team_b_id]
    if match_type not in TeamMatch.Type.values:
        raise ValueError("Unknown team match type.")
    outcome = calculate_outcome(a.rating, b.rating, score_a, score_b, match_type)
    proposed = {t.pk: t.rating for t in teams}
    proposed.update({a.pk: outcome["rating_a"], b.pk: outcome["rating_b"]})
    ranks = {t.pk: i + 1 for i, t in enumerate(sorted(teams, key=lambda t: (-proposed[t.pk], t.username)))}
    return {**outcome, "kind": "teams", "players": [{"id": t.pk, "username": t.username, "before": t.rating, "after": proposed[t.pk], "delta": outcome[f"delta_{key}"], "rank_before": t.rank, "rank_after": ranks[t.pk], "tier": tier_for_rating(proposed[t.pk])} for t, key in [(a, "a"), (b, "b")]]}


@transaction.atomic
def process_team_match(match_id: int) -> TeamMatch:
    RankingState.objects.get_or_create(pk=TEAM_STATE_ID)
    state = RankingState.objects.select_for_update().get(pk=TEAM_STATE_ID)
    match = TeamMatch.objects.select_for_update().get(pk=match_id)
    if match.processed_at:
        return match
    teams = list(Team.objects.select_for_update().order_by("pk"))
    by_id = {t.pk: t for t in teams}
    a, b = by_id[match.team_a_id], by_id[match.team_b_id]
    if not registered_teams().filter(pk=a.pk).exists() or not registered_teams().filter(pk=b.pk).exists():
        raise ValueError("Both factions must be active and registered.")
    for faction in (a, b):
        if faction.memberships.filter(Q(player__is_restricted=True) | Q(player__is_active=False) | Q(player__user__is_active=False)).exists():
            raise ValueError("Faction rosters cannot include banned or restricted players in a ranked match.")
    outcome = calculate_outcome(a.rating, b.rating, match.score_a, match.score_b, match.match_type)
    for team in teams:
        team.previous_rank = team.rank
    for team, key, won, scored, conceded in [(a, "a", match.score_a > match.score_b, match.score_a, match.score_b), (b, "b", match.score_b > match.score_a, match.score_b, match.score_a)]:
        team.previous_rating = team.rating
        team.rating = outcome[f"rating_{key}"]
        team.peak_rating = max(team.peak_rating, team.rating)
        team.tier = tier_for_rating(team.rating)
        team.wins += int(won)
        team.losses += int(not won)
        team.current_streak = max(0, team.current_streak) + 1 if won else min(0, team.current_streak) - 1
        team.rounds_won += scored
        team.rounds_lost += conceded
        team.kd_ratio = round(team.rounds_won / max(1, team.rounds_lost), 2)
        team.updated_at = timezone.now()
    regions = {}
    eligible_ids = set(registered_teams().values_list("pk", flat=True))
    ranked = [t for t in teams if t.pk in eligible_ids]
    for i, team in enumerate(sorted(ranked, key=lambda t: (-t.rating, t.username)), 1):
        team.rank = i
        regions[team.region] = regions.get(team.region, 0) + 1
        team.regional_rank = regions[team.region]
    Team.objects.bulk_update(teams, ["rating", "previous_rating", "peak_rating", "tier", "rank", "previous_rank", "regional_rank", "wins", "losses", "current_streak", "rounds_won", "rounds_lost", "kd_ratio", "updated_at"])
    TeamRatingHistory.objects.bulk_create([TeamRatingHistory(team=t, rating=t.rating, rank=t.rank, event_label=match.event_name) for t in teams])
    match.status = "COMPLETED"
    match.processed_at = timezone.now()
    match.rating_delta = abs(outcome["delta_a"])
    match.save(update_fields=["status", "processed_at", "rating_delta"])
    state.revision += 1
    state.save()
    RankingEvent.objects.create(payload={"kind": "teams", "revision": state.revision, "match_id": match.pk, "updated_at": match.processed_at.isoformat(), "players": [{"id": t.pk, "rating": t.rating, "rank": t.rank} for t in (a, b)]})
    transaction.on_commit(_after_commit)
    return match
