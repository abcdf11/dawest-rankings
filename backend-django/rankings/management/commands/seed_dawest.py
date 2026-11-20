import json
import random
from datetime import timedelta
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rankings.engine import process_completed_match, tier_for_rating
from rankings.models import Match, Player, RankingEvent, RankingState, RatingHistory
from rankings.serializers import PlayerSerializer, RatingHistorySerializer, form_for_player
from rankings.views import recent_forms

PLAYERS = [
    ("deadeye", "Deadeye", "NA", 2186, "#eab308"), ("vex", "Vex", "EU", 2074, "#b1bccd"),
    ("ronin", "Ronin", "ASIA", 2018, "#c18c64"), ("ghost", "Ghost", "NA", 1967, "#b7a8de"),
    ("sable", "Sable", "EU", 1892, "#e78d96"), ("desperado", "Desperado", "SA", 1854, "#e0a172"),
    ("kaizen", "Kaizen", "ASIA", 1821, "#8fb9c8"), ("rattlesnake", "Rattlesnake", "OCE", 1786, "#9fbe8e"),
    ("highnoon", "HighNoon", "NA", 1738, "#cfb67d"), ("jinx", "Jinx", "EU", 1689, "#c796ce"),
    ("cinder", "Cinder", "OCE", 1652, "#d58c6e"), ("nomad", "Nomad", "SA", 1609, "#97b9a5"),
    ("kestrel", "Kestrel", "NA", 1565, "#92a8cc"), ("blitz", "Blitz", "ASIA", 1512, "#d9b96c"),
    ("sundown", "Sundown", "EU", 1456, "#bba5cf"), ("dusty", "Dusty", "OCE", 1408, "#b7b494"),
    ("coyote", "Coyote", "SA", 1351, "#c5a28d"), ("rook", "Rook", "NA", 1287, "#9aafaa"),
    ("tumbleweed", "Tumbleweed", "EU", 1224, "#acac98"), ("pistolpete", "PistolPete", "ASIA", 1168, "#9aabbd")
]

class Command(BaseCommand):
    help = "Seed 20 fictional solo players with deterministically processed matches. Never overwrites a populated ladder."
    def add_arguments(self, parser):
        parser.add_argument("--export", type=str, help="Export a read-only demo snapshot to this JSON path.")
    @transaction.atomic
    def handle(self, *args, **options):
        if Player.objects.exists():
            if options["export"]:
                self.export(options["export"])
                return
            raise CommandError("The ladder is populated. Seed runs only against an empty database.")
        rng = random.Random(42)
        now = timezone.now()
        players = []
        for i, (username, name, region, rating, color) in enumerate(PLAYERS):
            p = Player.objects.create(username=username, display_name=name, region=region, rating=rating, previous_rating=rating, peak_rating=rating, rank=i+1, previous_rank=i+1, accent_color=color, tier=tier_for_rating(rating))
            players.append(p)
            RatingHistory.objects.create(player=p, recorded_at=now-timedelta(days=32), rating=rating, rank=i+1, event_label="Season 04 placement")
        for day in range(30):
            order = list(range(20))
            rng.shuffle(order)
            for n in range(0, 20, 2):
                a, b = players[order[n]], players[order[n+1]]
                # Skill-weighted results, including upsets, processed by the real engine.
                a.refresh_from_db(); b.refresh_from_db()
                a_wins = rng.random() < 1/(1+10**((b.rating-a.rating)/400))
                low = rng.randint(0, 4)
                m = Match.objects.create(player_a=a, player_b=b, score_a=5 if a_wins else low, score_b=low if a_wins else 5, played_at=now-timedelta(days=29-day, hours=n), event_name="High Noon Open" if day % 7 == 0 else "Frontier Ranked", match_type="TOURNAMENT" if day % 7 == 0 else "RANKED_1V1")
                process_completed_match(m.pk)
                # Place generated trajectories on the dates of the historical matches.
                history_ids = list(RatingHistory.objects.order_by("-pk").values_list("pk", flat=True)[:20])
                RatingHistory.objects.filter(pk__in=history_ids).update(recorded_at=m.played_at)
        # End with a close tournament upset so rank movement is visible in the snapshot.
        leaders = list(Player.objects.all()[1:3])
        finale = Match.objects.create(player_a=leaders[1], player_b=leaders[0], score_a=5, score_b=0, played_at=now, event_name="High Noon Open · Grand Final", match_type="TOURNAMENT")
        process_completed_match(finale.pk)
        # Seed is not an incoming live event: don't replay historical results.
        RankingEvent.objects.all().update(published_at=now)
        cache.clear()
        self.stdout.write(self.style.SUCCESS("Seeded 20 players and 301 processed 1v1 matches."))
        if options["export"]:
            self.export(options["export"])
    def export(self, filename):
        players = list(Player.objects.all())
        forms = recent_forms(players)
        payload = {"players": PlayerSerializer(players, many=True, context={"forms": forms}).data, "details": {}}
        for p in players:
            matches = list(Match.objects.filter(Q(player_a=p) | Q(player_b=p), status="COMPLETED").order_by("-played_at")[:12])
            # Reload with related players after the union for portable SQLite/Postgres behavior.
            matches = list(Match.objects.filter(pk__in=[m.pk for m in matches]).select_related("player_a", "player_b"))
            history = []
            for point in p.rating_history.all():
                if not history or point.rating != history[-1].rating:
                    history.append(point)
            payload["details"][p.username] = {"matches": form_for_player(p, matches), "history": RatingHistorySerializer(history[-32:], many=True).data}
        payload.update({"source": "demo", "total": len(players), "revision": RankingState.objects.get(pk=1).revision, "updated_at": timezone.now().isoformat()})
        path = Path(filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, default=str), encoding="utf-8")
        self.stdout.write(f"Exported {path}")
