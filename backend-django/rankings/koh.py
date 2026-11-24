"""King of the Hill results from the Roblox game: kills per player plus the Elo they finalize.

Solo rounds use multiplayer Elo (every pair of rated players is a mini-match, K split across
opponents, margin from the kill gap). Faction rounds become a TeamMatch on the faction ladder.
"""
import hmac
import math
from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from .engine import EVENT_WEIGHTS, _after_commit, tier_for_rating
from .eligibility import competitive_players, registered_teams
from .models import KohParticipant, KohRound, Player, RankingEvent, RankingState, RatingHistory

KOH_EVENT_LABEL = "King of the Hill"
MAX_PLAYERS = 50


class GameServerKey(BasePermission):
    message = "A valid game server key is required."

    def has_permission(self, request, view):
        key = settings.DAWEST_GAME_API_KEY
        header = request.headers.get("Authorization", "")
        supplied = header[7:] if header.startswith("Bearer ") else ""
        return bool(key) and bool(supplied) and hmac.compare_digest(supplied.encode(), key.encode())


class GameThrottle(SimpleRateThrottle):
    scope = "game"
    rate = "120/min"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class ParticipantInput(serializers.Serializer):
    roblox_user_id = serializers.IntegerField(min_value=1)
    roblox_username = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    kills = serializers.IntegerField(min_value=0, max_value=1000)
    deaths = serializers.IntegerField(min_value=0, max_value=1000, required=False, default=0)
    faction_tag = serializers.CharField(max_length=16, required=False, allow_blank=True, default="")
    faction_id = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")


class RoundInput(serializers.Serializer):
    round_id = serializers.RegexField(r"^[A-Za-z0-9_.:-]{6,80}$")
    mode = serializers.ChoiceField(choices=KohRound.Mode.values)
    place_id = serializers.IntegerField(required=False, allow_null=True, default=None)
    job_id = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    duration_seconds = serializers.IntegerField(min_value=0, max_value=86400, required=False, default=0)
    winner_roblox_user_id = serializers.IntegerField(min_value=1, required=False, allow_null=True, default=None)
    winner_faction_tag = serializers.CharField(max_length=16, required=False, allow_blank=True, default="")
    winner_faction_id = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")
    players = ParticipantInput(many=True)

    def validate_players(self, value):
        if not 1 <= len(value) <= MAX_PLAYERS:
            raise serializers.ValidationError(f"Send between 1 and {MAX_PLAYERS} players.")
        if len({p["roblox_user_id"] for p in value}) != len(value):
            raise serializers.ValidationError("Each Roblox user may appear once.")
        return value


def multiplayer_deltas(entries, weight=1.0, k=32):
    """entries: [(key, rating, placement, kills)]. Zero-sum pairwise Elo; lower placement wins."""
    deltas = {key: 0.0 for key, *_ in entries}
    if len(entries) < 2:
        return deltas
    k_pair = k * weight / (len(entries) - 1)
    for i, (ka, ra, pa, killa) in enumerate(entries):
        for kb, rb, pb, killb in entries[i + 1:]:
            expected_a = 1 / (1 + 10 ** (max(-4000, min(4000, rb - ra)) / 400))
            actual_a = 1.0 if pa < pb else 0.0 if pa > pb else 0.5
            # The kill gap only adds weight when the better-placed player also out-killed the other:
            # the hill winner beating someone with more kills is a normal-sized result, not a bigger one.
            gap = killa - killb if pa < pb else killb - killa if pa > pb else 0
            margin = 1 + .35 * math.log1p(max(0, gap))
            d = k_pair * margin * (actual_a - expected_a)
            deltas[ka] += d
            deltas[kb] -= d
    return {key: round(d, 2) for key, d in deltas.items()}


def team_war_deltas(winners, losers, margin=1.0, weight=1.0, k=32):
    """Faction KOH: [(key, rating)] per side. Every winner plays a zero-sum mini-match against every
    loser; teammates never trade Elo. K is split by the bigger side, so a player's swing stays about
    one match's worth however many fought."""
    deltas = {key: 0.0 for key, _ in winners + losers}
    if not winners or not losers:
        return deltas
    k_pair = k * weight * margin / max(len(winners), len(losers))
    for kw, rw in winners:
        for kl, rl in losers:
            expected = 1 / (1 + 10 ** (max(-4000, min(4000, rl - rw)) / 400))
            d = k_pair * (1 - expected)
            deltas[kw] += d
            deltas[kl] -= d
    return {key: round(d, 2) for key, d in deltas.items()}


def placements(rows, winner_of):
    """Winner(s) first, then most kills, then fewest deaths. Equal records share a placement."""
    order = sorted(rows, key=lambda r: (not winner_of(r), -r["kills"], r["deaths"]))
    result, last, place = {}, None, 0
    for i, r in enumerate(order, 1):
        sig = (winner_of(r), r["kills"], r["deaths"])
        if sig != last:
            place, last = i, sig
        result[r["roblox_user_id"]] = place
    return result


def _rerank_players(players, eligible_ids):
    regions = {}
    for i, p in enumerate(sorted((p for p in players if p.pk in eligible_ids), key=lambda p: (-p.rating, p.username)), 1):
        p.rank = i
        regions[p.region] = regions.get(p.region, 0) + 1
        p.regional_rank = regions[p.region]


def _note(koh, text):
    koh.rating_note = (f"{koh.rating_note} {text}" if koh.rating_note else text)[:200]


def _rate_solo(koh, rows):
    RankingState.objects.get_or_create(pk=1)
    state = RankingState.objects.select_for_update().get(pk=1)
    eligible_ids = set(competitive_players().values_list("pk", flat=True))
    rated_rows = [r for r in rows if r.player_id in eligible_ids]
    if len(rated_rows) < 2:
        _note(koh, "Needs two or more linked, unrestricted players for Elo.")
        return
    players = list(Player.objects.select_for_update().order_by("pk"))
    by_id = {p.pk: p for p in players}
    deltas = multiplayer_deltas([(r.player_id, by_id[r.player_id].rating, r.placement, r.kills) for r in rated_rows], EVENT_WEIGHTS["RANKED_1V1"])
    _apply_player_deltas(koh, state, players, eligible_ids, rated_rows, deltas, lambda r: r.placement == 1)


def _rate_faction_players(koh, rows, sides):
    """Faction KOH: each linked player gains or loses Elo by their side's result (sides: roblox id ->
    "W" / "L"; players without a faction in the round aren't rated)."""
    RankingState.objects.get_or_create(pk=1)
    state = RankingState.objects.select_for_update().get(pk=1)
    eligible_ids = set(competitive_players().values_list("pk", flat=True))
    rated_rows = [r for r in rows if r.player_id in eligible_ids and sides.get(r.roblox_user_id)]
    win_rows = [r for r in rated_rows if sides[r.roblox_user_id] == "W"]
    lose_rows = [r for r in rated_rows if sides[r.roblox_user_id] == "L"]
    if not win_rows or not lose_rows:
        _note(koh, "Player Elo needs a linked, unrestricted player on each side.")
        return
    players = list(Player.objects.select_for_update().order_by("pk"))
    by_id = {p.pk: p for p in players}
    gap = sum(r.kills for r in rows if sides.get(r.roblox_user_id) == "W") - sum(r.kills for r in rows if sides.get(r.roblox_user_id) == "L")
    margin = 1 + .35 * math.log1p(max(0, gap))
    deltas = team_war_deltas([(r.player_id, by_id[r.player_id].rating) for r in win_rows],
                             [(r.player_id, by_id[r.player_id].rating) for r in lose_rows], margin, EVENT_WEIGHTS["RANKED_TEAM"])
    _apply_player_deltas(koh, state, players, eligible_ids, rated_rows, deltas, lambda r: sides[r.roblox_user_id] == "W")


def _apply_player_deltas(koh, state, players, eligible_ids, rated_rows, deltas, won_of):
    by_id = {p.pk: p for p in players}
    for p in players:
        p.previous_rank = p.rank
    now = timezone.now()
    for r in rated_rows:
        p = by_id[r.player_id]
        won = won_of(r)
        r.rating_before = p.rating
        p.previous_rating = p.rating
        p.rating = round(max(0.0, p.rating + deltas[p.pk]), 2)
        r.rating_after, r.rating_delta = p.rating, round(p.rating - r.rating_before, 2)
        p.peak_rating = max(p.peak_rating, p.rating)
        p.tier = tier_for_rating(p.rating)
        p.wins += int(won)
        p.losses += int(not won)
        p.current_streak = max(0, p.current_streak) + 1 if won else min(0, p.current_streak) - 1
        p.updated_at = now
    _rerank_players(players, eligible_ids)
    Player.objects.bulk_update(players, ["rating", "previous_rating", "peak_rating", "tier", "rank", "previous_rank", "regional_rank", "wins", "losses", "current_streak", "updated_at"])
    RatingHistory.objects.bulk_create([RatingHistory(player=p, rating=p.rating, rank=p.rank, event_label=KOH_EVENT_LABEL) for p in players])
    KohParticipant.objects.bulk_update(rated_rows, ["rating_before", "rating_after", "rating_delta"])
    koh.rated = True
    state.revision += 1
    state.save()
    RankingEvent.objects.create(payload={"revision": state.revision, "koh_round": koh.round_id, "updated_at": now.isoformat(), "players": [{"id": by_id[r.player_id].pk, "rating": by_id[r.player_id].rating, "rank": by_id[r.player_id].rank} for r in rated_rows]})
    transaction.on_commit(_after_commit)


def _rate_factions(koh, rows, winner_team_id):
    from teams.engine import process_team_match
    from teams.models import TeamMatch
    teams = {}
    for r in rows:
        if r.team_id:
            teams.setdefault(r.team_id, []).append(r)
    winner = winner_team_id if winner_team_id in teams else None
    if len(teams) != 2 or winner is None:
        _note(koh, "Faction Elo needs exactly two registered site factions and a winner.")
        return
    loser = next(t for t in teams if t != winner)
    kw, kl = (sum(r.kills for r in teams[t]) for t in (winner, loser))
    score_w, score_l = (min(100, kw), min(99, kl)) if kw > kl else (1, 0)
    if score_w <= score_l:
        score_w, score_l = score_l + 1, score_l
    match = TeamMatch.objects.create(event_name=KOH_EVENT_LABEL, match_type=TeamMatch.Type.RANKED_TEAM, team_a_id=winner, team_b_id=loser, score_a=score_w, score_b=score_l, status="UPCOMING")
    try:
        with transaction.atomic():
            process_team_match(match.pk)
    except ValueError as exc:
        match.delete()
        _note(koh, str(exc))
        return
    koh.team_match, koh.winner_team_id, koh.rated = match, winner, True


@api_view(["POST"])
@authentication_classes([])
@permission_classes([GameServerKey])
@throttle_classes([GameThrottle])
def report_round(request):
    existing = KohRound.objects.filter(round_id=str(request.data.get("round_id", ""))[:80]).first()
    if existing:
        return Response(round_payload(existing))
    data = RoundInput(data=request.data)
    data.is_valid(raise_exception=True)
    d = data.validated_data
    with transaction.atomic():
        if KohRound.objects.select_for_update().filter(round_id=d["round_id"]).exists():
            return Response(round_payload(KohRound.objects.get(round_id=d["round_id"])))
        linked = {p.roblox_user_id: p for p in competitive_players().select_related("team_membership__team").filter(roblox_user_id__in=[r["roblox_user_id"] for r in d["players"]])}
        faction = d["mode"] == "FACTION"
        # A site faction linked to its in-game faction (teams/roblox_link.py) is matched by that id, and
        # the game server is trusted for who is in it. Otherwise fall back to the tag, counting only
        # linked players who are on that site faction's roster.
        by_fid = {t.roblox_faction_id: t for t in registered_teams().filter(roblox_faction_id__in=[r["faction_id"] for r in d["players"] if r["faction_id"]] + [d["winner_faction_id"]])} if faction else {}
        tags = {t.tag.upper(): t for t in registered_teams().filter(tag__in=[r["faction_tag"] for r in d["players"] if r["faction_tag"]] + [d["winner_faction_tag"]])} if faction else {}

        def site_team(r):
            if r["faction_id"] in by_fid:
                return by_fid[r["faction_id"]]
            team = tags.get(r["faction_tag"].upper()) if r["faction_tag"] else None
            player = linked.get(r["roblox_user_id"])
            membership = getattr(player, "team_membership", None) if player else None
            return team if team and membership is not None and membership.team_id == team.pk else None

        winner_team = by_fid.get(d["winner_faction_id"]) or tags.get(d["winner_faction_tag"].upper())
        if d["mode"] == "SOLO":
            winner_of = lambda r: r["roblox_user_id"] == d["winner_roblox_user_id"]
        elif d["winner_faction_id"]:
            winner_of = lambda r: r["faction_id"] == d["winner_faction_id"]
        else:
            winner_of = lambda r: bool(d["winner_faction_tag"]) and r["faction_tag"].upper() == d["winner_faction_tag"].upper()
        places = placements(d["players"], winner_of)
        koh = KohRound.objects.create(round_id=d["round_id"], mode=d["mode"], place_id=d["place_id"], job_id=d["job_id"], duration_seconds=d["duration_seconds"], winner_roblox_user_id=d["winner_roblox_user_id"])
        rows, sides = [], {}
        for r in d["players"]:
            if faction:
                sides[r["roblox_user_id"]] = "W" if winner_of(r) else ("L" if (r["faction_id"] or r["faction_tag"]) else None)
            player = linked.get(r["roblox_user_id"])
            team = site_team(r) if faction else None
            rows.append(KohParticipant(round=koh, roblox_user_id=r["roblox_user_id"], roblox_username=r["roblox_username"] or (player.roblox_username if player else ""), player=player, team=team, kills=r["kills"], deaths=r["deaths"], placement=places[r["roblox_user_id"]], is_winner=winner_of(r)))
        rows = KohParticipant.objects.bulk_create(rows)
        rows = list(koh.participants.select_related("team"))
        if d["mode"] == "SOLO":
            _rate_solo(koh, rows)
        else:
            _rate_faction_players(koh, rows, sides)
            _rate_factions(koh, rows, winner_team.pk if winner_team else None)
        koh.save()
    return Response(round_payload(koh), status=201)


def round_payload(koh):
    parts = list(koh.participants.select_related("player", "team"))
    return {"round_id": koh.round_id, "mode": koh.mode, "ended_at": koh.ended_at, "duration_seconds": koh.duration_seconds, "rated": koh.rated, "rating_note": koh.rating_note, "winner_faction": koh.winner_team.display_name if koh.winner_team_id else None, "team_rating_delta": koh.team_match.rating_delta if koh.team_match_id else None,
            "players": [{"roblox_user_id": p.roblox_user_id, "roblox_username": p.roblox_username, "username": p.player.username if p.player_id else None, "display_name": p.player.display_name if p.player_id else (p.roblox_username or None), "faction_tag": p.team.tag if p.team_id else None, "kills": p.kills, "deaths": p.deaths, "placement": p.placement, "is_winner": p.is_winner, "rating_before": p.rating_before, "rating_after": p.rating_after, "rating_delta": p.rating_delta} for p in parts]}


def player_koh_summary(player, limit=10):
    totals = player.koh_results.aggregate(rounds=Count("pk"), wins=Count("pk", filter=Q(is_winner=True)), kills=Sum("kills"), deaths=Sum("deaths"))
    kills, deaths = totals["kills"] or 0, totals["deaths"] or 0
    recent = player.koh_results.select_related("round").order_by("-round__ended_at", "-pk")[:limit]
    return {"rounds": totals["rounds"], "wins": totals["wins"], "kills": kills, "deaths": deaths, "kd": round(kills / max(1, deaths), 2),
            "recent": [{"round_id": r.round.round_id, "mode": r.round.mode, "ended_at": r.round.ended_at, "kills": r.kills, "deaths": r.deaths, "placement": r.placement, "players": r.round.participants.count(), "is_winner": r.is_winner, "rating_delta": r.rating_delta if r.rating_after is not None else None} for r in recent]}


@api_view(["GET"])
def recent_rounds(request):
    rounds = KohRound.objects.select_related("winner_team", "team_match")[:20]
    return Response({"rounds": [round_payload(k) for k in rounds]})
