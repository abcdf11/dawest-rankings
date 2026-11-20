import json
import random
from datetime import timedelta
from pathlib import Path
from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rankings.engine import tier_for_rating
from rankings.models import Player, RankingEvent, RankingState
from teams.engine import process_team_match
from teams.models import Team, TeamMatch, TeamMembership, TeamRatingHistory
from teams.serializers import TeamHistorySerializer, TeamSerializer, form_for_team
from teams.views import team_forms, team_queryset

TEAMS = [
    ("blackwater", "Blackwater", "BLW", "NA", 2150, "#eab308", ["deadeye", "ghost"]),
    ("red-mesa", "Red Mesa", "RDM", "ASIA", 2050, "#e27a72", ["ronin", "kaizen"]),
    ("iron-vultures", "Iron Vultures", "IV", "EU", 1950, "#a7b7cd", ["vex", "sable"]),
    ("deadwood", "Deadwood", "DW", "SA", 1840, "#b394d2", ["desperado", "nomad"]),
    ("dust-devils", "Dust Devils", "DD", "OCE", 1740, "#d5a26d", ["rattlesnake", "cinder"]),
    ("silver-spurs", "Silver Spurs", "SS", "NA", 1660, "#b7c8d1", ["highnoon", "kestrel"]),
    ("night-raid", "Night Raid", "NTR", "EU", 1540, "#c794bd", ["jinx", "sundown"]),
    ("copperheads", "Copperheads", "CPR", "ASIA", 1430, "#bd956e", ["blitz", "pistolpete"]),
    ("high-plains", "High Plains", "HPL", "OCE", 1320, "#9ab99c", ["dusty", "rook"]),
    ("badlands", "Badlands", "BAD", "SA", 1200, "#8fb5bc", ["coyote", "tumbleweed"]),
]


class Command(BaseCommand):
    help = "Seed an independent 10-team ladder with rosters and verified team matches."

    def add_arguments(self, parser):
        parser.add_argument("--export", type=str)

    @transaction.atomic
    def handle(self, *args, **options):
        if Team.objects.exists():
            if options["export"]:
                self.export(options["export"])
                return
            raise CommandError("The team ladder is populated; it will not be overwritten.")
        expected = {name for row in TEAMS for name in row[-1]}
        if not expected.issubset(set(Player.objects.values_list("username", flat=True))):
            raise CommandError("Run seed_dawest first to create the demo roster players.")
        now = timezone.now()
        rng = random.Random(107)
        teams = []
        for i, (slug, name, tag, region, rating, color, roster) in enumerate(TEAMS, 1):
            team = Team.objects.create(username=slug, display_name=name, tag=tag, region=region, rating=rating, previous_rating=rating, peak_rating=rating, rank=i, previous_rank=i, tier=tier_for_rating(rating), accent_color=color)
            for position, username in enumerate(roster):
                TeamMembership.objects.create(team=team, player=Player.objects.get(username=username), is_captain=position == 0)
            TeamRatingHistory.objects.create(team=team, recorded_at=now-timedelta(days=25), rating=rating, rank=i, event_label="Team circuit placement")
            teams.append(team)
        for day in range(24):
            order = list(range(len(teams)))
            rng.shuffle(order)
            for i in range(0, len(order), 2):
                a, b = teams[order[i]], teams[order[i+1]]
                a.refresh_from_db(); b.refresh_from_db()
                a_wins = rng.random() < 1/(1+10**((b.rating-a.rating)/400))
                low = rng.randint(0, 4)
                match = TeamMatch.objects.create(team_a=a, team_b=b, score_a=5 if a_wins else low, score_b=low if a_wins else 5, played_at=now-timedelta(days=23-day, hours=i+1), event_name="Frontier Team Masters" if day % 6 == 0 else "Frontier Team Circuit", match_type="TOURNAMENT" if day % 6 == 0 else "RANKED_TEAM")
                process_team_match(match.pk)
                ids = list(TeamRatingHistory.objects.order_by("-pk").values_list("pk", flat=True)[:len(teams)])
                TeamRatingHistory.objects.filter(pk__in=ids).update(recorded_at=match.played_at)
        RankingEvent.objects.filter(payload__kind="teams", published_at__isnull=True).update(published_at=now)
        cache.clear()
        self.stdout.write(self.style.SUCCESS("Seeded 10 teams, 20 roster memberships, and 120 team matches."))
        if options["export"]:
            self.export(options["export"])

    def export(self, filename):
        teams = list(team_queryset())
        payload = {"teams": TeamSerializer(teams, many=True, context={"forms": team_forms(teams)}).data, "details": {}}
        for team in teams:
            matches = list(TeamMatch.objects.filter(Q(team_a=team) | Q(team_b=team), status="COMPLETED").select_related("team_a", "team_b")[:12])
            history = []
            for point in team.rating_history.all():
                if not history or point.rating != history[-1].rating:
                    history.append(point)
            payload["details"][team.username] = {"matches": form_for_team(team, matches), "history": TeamHistorySerializer(history[-32:], many=True).data}
        state = RankingState.objects.get(pk=2)
        payload.update({"total": len(teams), "revision": state.revision, "updated_at": state.updated_at.isoformat(), "source": "demo"})
        path = Path(filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, default=str), encoding="utf-8")
        self.stdout.write(f"Exported {path}")
