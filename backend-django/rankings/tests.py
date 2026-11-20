from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from .engine import calculate_outcome, process_completed_match, simulate_match_outcome, tier_for_rating
from .models import Match, Player, RankingEvent, RankingState, RatingHistory

@override_settings(USE_REDIS=False)
class RankingTests(TestCase):
    def setUp(self):
        cache.clear()
        self.a = Player.objects.create(username="deadeye", display_name="Deadeye", region="NA", rating=1890, peak_rating=1890, rank=1)
        self.b = Player.objects.create(username="vex", display_name="Vex", region="EU", rating=1850, peak_rating=1850, rank=2, previous_rank=2)
        self.match = Match.objects.create(player_a=self.a, player_b=self.b, score_a=5, score_b=2)
        self.client = APIClient()
    def test_elo_is_zero_sum_and_tournament_and_sweep_have_more_weight(self):
        baseline = calculate_outcome(1500, 1500, 5, 4, "RANKED_1V1")
        sweep = calculate_outcome(1500, 1500, 5, 0, "RANKED_1V1")
        tournament = calculate_outcome(1500, 1500, 5, 4, "TOURNAMENT")
        self.assertEqual(baseline["rating_a"] + baseline["rating_b"], 3000)
        self.assertGreater(sweep["delta_a"], baseline["delta_a"])
        self.assertGreater(tournament["delta_a"], baseline["delta_a"])
    def test_upset_is_worth_more(self):
        self.assertGreater(calculate_outcome(1300, 1900, 5, 2, "RANKED_1V1")["delta_a"], calculate_outcome(1900, 1300, 5, 2, "RANKED_1V1")["delta_a"])
    def test_tier_boundaries(self):
        self.assertEqual([tier_for_rating(r) for r in [1299.99, 1300, 1500, 1700, 1900]], ["ROOKIE", "DEPUTY", "GUNSLINGER", "OUTLAW", "LEGEND"])
    def test_atomic_completion_is_idempotent_and_promotes(self):
        result = process_completed_match(self.match.pk)
        self.a.refresh_from_db(); self.b.refresh_from_db()
        rating = self.a.rating
        self.assertEqual(self.a.tier, "LEGEND")
        self.assertEqual(self.a.wins, 1)
        self.assertEqual(self.b.losses, 1)
        self.assertEqual(self.a.current_streak, 1)
        self.assertEqual(self.b.current_streak, -1)
        self.assertAlmostEqual(self.a.rating + self.b.rating, 3740)
        self.assertIsNotNone(result.processed_at)
        self.assertEqual(RatingHistory.objects.count(), 2)
        self.assertEqual(RankingEvent.objects.count(), 1)
        process_completed_match(self.match.pk)
        self.a.refresh_from_db()
        self.assertEqual(self.a.rating, rating)
        self.assertEqual(self.a.wins, 1)
        self.assertEqual(RankingState.objects.get(pk=1).revision, 1)
    def test_simulation_matches_committed_result_and_does_not_write(self):
        expected = simulate_match_outcome(self.a.pk, self.b.pk, 5, 2, "RANKED_1V1")
        self.a.refresh_from_db()
        self.assertEqual(self.a.rating, 1890)
        self.assertEqual(RatingHistory.objects.count(), 0)
        process_completed_match(self.match.pk)
        self.a.refresh_from_db(); self.b.refresh_from_db()
        self.assertEqual(self.a.rating, expected["rating_a"])
        self.assertEqual(self.b.rating, expected["rating_b"])
    def test_invalid_scores_do_not_write(self):
        self.match.score_a = 2; self.match.score_b = 2; self.match.save()
        with self.assertRaises(ValueError): process_completed_match(self.match.pk)
        self.assertEqual(RatingHistory.objects.count(), 0)
        self.assertEqual(RankingEvent.objects.count(), 0)
        for scores in [(1.5, 0), (-1, 0), (101, 0)]:
            with self.assertRaises(ValueError): calculate_outcome(1500, 1500, *scores, "RANKED_1V1")
    def test_database_rejects_self_play(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Match.objects.create(player_a=self.a, player_b=self.a)
    def test_cache_revision_serves_new_rating_after_commit(self):
        before = self.client.get("/api/v1/rankings/").json()
        process_completed_match(self.match.pk)
        after = self.client.get("/api/v1/rankings/").json()
        self.assertNotEqual(before["revision"], after["revision"])
        self.assertGreater(after["players"][0]["rating"], before["players"][0]["rating"])
    def test_filters_profile_and_form(self):
        process_completed_match(self.match.pk)
        response = self.client.get("/api/v1/rankings/?region=NA&tier=LEGEND&search=dead")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["players"]), 1)
        detail = self.client.get("/api/v1/players/deadeye/").json()
        self.assertEqual(detail["matches"][0]["result"], "W")
        self.assertEqual(detail["matches"][0]["opponent"], "Vex")
        self.assertEqual(len(detail["history"]), 1)
        self.assertEqual(self.client.get("/api/v1/rankings/?region=INVALID").status_code, 400)
    def test_moderator_permission_and_conflict(self):
        url = f"/api/v1/matches/{self.match.pk}/complete/"
        body = {"score_a": 5, "score_b": 2}
        self.assertEqual(self.client.post(url, body).status_code, 403)
        staff = get_user_model().objects.create_user(username="staff", password="test-password", is_staff=True)
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.post(url, body).status_code, 403)
        staff.is_superuser = True; staff.save(); self.client.force_authenticate(staff)
        self.assertEqual(self.client.post(url, body).status_code, 200)
        self.assertEqual(self.client.post(url, body).status_code, 200)
        self.assertEqual(self.client.post(url, {"score_a": 2, "score_b": 5}).status_code, 409)
    def test_simulation_endpoint_rejects_ties_and_self_play(self):
        body = {"player_a_id": self.a.pk, "player_b_id": self.b.pk, "score_a": 5, "score_b": 2}
        self.assertEqual(self.client.post("/api/v1/simulate/", body).status_code, 200)
        self.assertEqual(self.client.post("/api/v1/simulate/", {**body, "score_b": 5}).status_code, 400)
        self.assertEqual(self.client.post("/api/v1/simulate/", {**body, "player_b_id": self.a.pk}).status_code, 400)
