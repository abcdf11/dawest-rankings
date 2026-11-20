from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rankings.models import Player, RankingState
from .engine import process_team_match, simulate_team_outcome
from .models import Team, TeamMatch, TeamMembership, TeamRatingHistory


@override_settings(USE_REDIS=False)
class TeamRankingTests(TestCase):
    def setUp(self):
        cache.clear()
        self.player = Player.objects.create(username="deadeye", display_name="Deadeye", region="NA", rating=2100)
        self.a = Team.objects.create(username="blackwater", display_name="Blackwater", tag="BLW", region="NA", rating=1890, peak_rating=1890)
        self.b = Team.objects.create(username="red-mesa", display_name="Red Mesa", tag="RDM", region="ASIA", rating=1850, peak_rating=1850, rank=2, previous_rank=2)
        captain = get_user_model().objects.create_user(username="deadeye", password="test-password")
        other = get_user_model().objects.create_user(username="othercaptain", password="test-password")
        self.player.user = captain
        self.player.registered_at = timezone.now()
        self.player.save()
        for team, owner in ((self.a, captain), (self.b, other)):
            team.owner = owner
            team.registered_at = timezone.now()
            team.save()
        RankingState.objects.all().delete()
        TeamMembership.objects.create(team=self.a, player=self.player, is_captain=True)
        self.match = TeamMatch.objects.create(team_a=self.a, team_b=self.b, score_a=5, score_b=2)
        self.client = APIClient()

    def test_team_match_does_not_change_solo_ladder(self):
        before = list(Player.objects.values())
        process_team_match(self.match.pk)
        self.assertEqual(before, list(Player.objects.values()))
        self.a.refresh_from_db(); self.b.refresh_from_db()
        self.assertAlmostEqual(self.a.rating+self.b.rating, 3740)
        self.assertEqual(self.a.tier, "LEGEND")
        self.assertEqual(self.a.wins, 1)
        self.assertFalse(RankingState.objects.filter(pk=1).exists())

    def test_simulation_matches_finalization_and_completion_is_idempotent(self):
        result = simulate_team_outcome(self.a.pk, self.b.pk, 5, 2, "RANKED_TEAM")
        self.assertEqual(TeamRatingHistory.objects.count(), 0)
        process_team_match(self.match.pk)
        process_team_match(self.match.pk)
        self.a.refresh_from_db()
        self.assertEqual(self.a.rating, result["rating_a"])
        self.assertEqual(self.a.wins, 1)
        self.assertEqual(TeamRatingHistory.objects.count(), 2)

    def test_team_filters_profile_and_player_membership(self):
        process_team_match(self.match.pk)
        response = self.client.get("/api/v1/teams/rankings/?search=BLW&region=NA&tier=LEGEND")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["teams"]), 1)
        profile = self.client.get("/api/v1/teams/blackwater/").json()
        self.assertEqual(profile["roster"][0]["username"], "deadeye")
        self.assertEqual(profile["matches"][0]["opponent"], "Red Mesa")
        player = self.client.get("/api/v1/players/deadeye/").json()
        self.assertEqual(player["team"]["tag"], "BLW")
        self.assertEqual(self.client.get("/api/v1/teams/rankings/?region=INVALID").status_code, 400)

    def test_team_cache_revision_and_solo_cache_are_separate(self):
        before = self.client.get("/api/v1/teams/rankings/").json()
        solo_before = self.client.get("/api/v1/rankings/").json()
        process_team_match(self.match.pk)
        after = self.client.get("/api/v1/teams/rankings/").json()
        self.assertNotEqual(before["revision"], after["revision"])
        self.assertEqual(self.client.get("/api/v1/rankings/").json(), solo_before)

    def test_team_simulation_validation_and_completion_permissions(self):
        body = {"team_a_id": self.a.pk, "team_b_id": self.b.pk, "score_a": 5, "score_b": 2}
        self.assertEqual(self.client.post("/api/v1/teams/simulate/", body).status_code, 200)
        self.assertEqual(self.client.post("/api/v1/teams/simulate/", {**body, "team_b_id": self.a.pk}).status_code, 400)
        self.assertEqual(self.client.post("/api/v1/teams/simulate/", {**body, "score_b": 5}).status_code, 400)
        url = f"/api/v1/teams/matches/{self.match.pk}/complete/"
        self.assertEqual(self.client.post(url, body).status_code, 403)
        moderator = get_user_model().objects.create_superuser(username="mod", password="test-password")
        self.client.force_authenticate(moderator)
        self.assertEqual(self.client.post(url, body).status_code, 200)
        self.assertEqual(self.client.post(url, {"score_a": 2, "score_b": 5}).status_code, 409)

    def test_membership_and_match_constraints(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            TeamMembership.objects.create(team=self.b, player=self.player)
        with self.assertRaises(IntegrityError), transaction.atomic():
            TeamMatch.objects.create(team_a=self.a, team_b=self.a)
