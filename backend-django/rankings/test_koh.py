from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from accounts.services import create_player_account
from teams.models import Team, TeamMatch, TeamMembership
from .koh import multiplayer_deltas
from .models import KohParticipant, KohRound, Player

KEY = "game-key-for-tests"
URL = "/api/v1/game/koh/rounds/"


def member(username, roblox_id, rating=1500):
    user = create_player_account({"username": username, "display_name": username.title(), "region": "NA", "password": "Frontier!River87956"})
    Player.objects.filter(user=user).update(roblox_user_id=roblox_id, roblox_username=username.upper(), rating=rating)
    return Player.objects.get(user=user)


@override_settings(DAWEST_GAME_API_KEY=KEY, USE_REDIS=False)
class KohResultTests(TestCase):
    def setUp(self):
        cache.clear()
        self.a, self.b, self.c = member("alpha", 101), member("bravo", 102), member("charlie", 103)
        self.game = APIClient()
        self.game.credentials(HTTP_AUTHORIZATION=f"Bearer {KEY}")

    def solo(self, **extra):
        body = {"round_id": "job-1:round-1", "mode": "SOLO", "winner_roblox_user_id": 101, "players": [
            {"roblox_user_id": 101, "kills": 9, "deaths": 2}, {"roblox_user_id": 102, "kills": 4, "deaths": 5},
            {"roblox_user_id": 103, "kills": 1, "deaths": 6}, {"roblox_user_id": 999, "roblox_username": "Guest", "kills": 3, "deaths": 3}]}
        body.update(extra)
        return self.game.post(URL, body, format="json")

    def test_rejects_missing_or_wrong_key(self):
        self.assertEqual(APIClient().post(URL, {}, format="json").status_code, 403)
        bad = APIClient()
        bad.credentials(HTTP_AUTHORIZATION="Bearer nope")
        self.assertEqual(bad.post(URL, {}, format="json").status_code, 403)

    @override_settings(DAWEST_GAME_API_KEY="")
    def test_disabled_without_configured_key(self):
        self.assertEqual(self.solo().status_code, 403)

    def test_solo_round_records_kills_and_finalizes_elo(self):
        res = self.solo()
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertTrue(data["rated"])
        by_id = {p["roblox_user_id"]: p for p in data["players"]}
        self.assertEqual(by_id[101]["placement"], 1)
        self.assertEqual(by_id[101]["kills"], 9)
        self.assertGreater(by_id[101]["rating_delta"], 0)
        self.assertLess(by_id[103]["rating_delta"], 0)
        self.assertIsNone(by_id[999]["rating_after"])  # unlinked: kills shown, no Elo
        for p in (self.a, self.b, self.c):
            p.refresh_from_db()
        self.assertAlmostEqual(self.a.rating + self.b.rating + self.c.rating, 4500, places=1)
        self.assertEqual((self.a.wins, self.b.losses, self.a.rank), (1, 1, 1))
        profile = APIClient().get("/api/v1/players/alpha/").json()["koh"]
        self.assertEqual((profile["rounds"], profile["wins"], profile["kills"], profile["deaths"]), (1, 1, 9, 2))

    def test_same_round_id_is_idempotent(self):
        self.solo()
        rating = Player.objects.get(pk=self.a.pk).rating
        self.assertEqual(self.solo().status_code, 200)
        self.assertEqual(Player.objects.get(pk=self.a.pk).rating, rating)
        self.assertEqual(KohRound.objects.count(), 1)

    def test_single_linked_player_is_recorded_but_not_rated(self):
        res = self.game.post(URL, {"round_id": "job-1:round-2", "mode": "SOLO", "winner_roblox_user_id": 101, "players": [{"roblox_user_id": 101, "kills": 3}, {"roblox_user_id": 555, "kills": 1}]}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertFalse(res.json()["rated"])
        self.assertEqual(Player.objects.get(pk=self.a.pk).rating, 1500)

    def test_restricted_player_gets_no_elo(self):
        Player.objects.filter(pk=self.c.pk).update(is_restricted=True)
        self.solo()
        self.assertIsNone(KohParticipant.objects.get(roblox_user_id=103).player_id)

    def test_faction_round_updates_faction_ladder(self):
        users = get_user_model().objects
        t1 = Team.objects.create(username="blackwater", display_name="Blackwater", tag="BLW", region="NA", owner=users.get(username="alpha"), registered_at=timezone.now())
        t2 = Team.objects.create(username="red-mesa", display_name="Red Mesa", tag="RDM", region="NA", owner=users.get(username="bravo"), registered_at=timezone.now())
        TeamMembership.objects.create(team=t1, player=self.a, is_captain=True)
        TeamMembership.objects.create(team=t2, player=self.b, is_captain=True)
        res = self.game.post(URL, {"round_id": "job-1:round-3", "mode": "FACTION", "winner_faction_tag": "blw", "players": [
            {"roblox_user_id": 101, "kills": 7, "faction_tag": "BLW"}, {"roblox_user_id": 102, "kills": 3, "faction_tag": "RDM"}]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(res.json()["rated"])
        match = TeamMatch.objects.get()
        self.assertEqual((match.team_a, match.score_a, match.score_b, match.status), (t1, 7, 3, "COMPLETED"))
        t1.refresh_from_db()
        self.assertGreater(t1.rating, 1500)
        # the players fought too: the winning side's linked player gains, the losing side's loses
        a, b = Player.objects.get(pk=self.a.pk), Player.objects.get(pk=self.b.pk)
        self.assertGreater(a.rating, 1500)
        self.assertAlmostEqual(a.rating - 1500, 1500 - b.rating, places=1)
        self.assertEqual((a.wins, b.losses), (1, 1))
        rows = {r["roblox_user_id"]: r for r in res.json()["players"]}
        self.assertGreater(rows[101]["rating_delta"], 0)

    def test_faction_war_rates_players_even_without_site_factions(self):
        # in-game factions not on the site: no faction ladder match, but the linked players still fight
        res = self.game.post(URL, {"round_id": "job-1:round-4", "mode": "FACTION", "winner_faction_id": "ingameA", "players": [
            {"roblox_user_id": 101, "kills": 4, "faction_id": "ingameA"}, {"roblox_user_id": 103, "kills": 2, "faction_id": "ingameA"},
            {"roblox_user_id": 102, "kills": 3, "faction_id": "ingameB"}, {"roblox_user_id": 999, "kills": 9}]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(res.json()["rated"])
        self.assertFalse(TeamMatch.objects.exists())
        a, b, c = (Player.objects.get(pk=p.pk) for p in (self.a, self.b, self.c))
        self.assertGreater(a.rating, 1500)
        self.assertGreater(c.rating, 1500)
        self.assertLess(b.rating, 1500)
        self.assertAlmostEqual((a.rating - 1500) + (c.rating - 1500), 1500 - b.rating, places=1)

    def test_team_war_teammates_never_trade_elo(self):
        from .koh import team_war_deltas
        d = team_war_deltas([(1, 1500), (2, 2000)], [(3, 1500)])
        self.assertGreater(d[1], 0)
        self.assertGreater(d[2], 0)  # a strong teammate still gains (a little), never pays the weak one
        self.assertLess(d[3], 0)
        self.assertAlmostEqual(sum(d.values()), 0, places=1)

    def test_kill_gap_only_counts_for_the_better_placed_player(self):
        # winner held the hill with fewer kills: a plain result, same as an equal-kills win
        upset = multiplayer_deltas([(1, 1500, 1, 0), (2, 1500, 2, 10)])
        even = multiplayer_deltas([(1, 1500, 1, 0), (2, 1500, 2, 0)])
        self.assertEqual(upset[1], even[1])
        # out-killing the player you beat still makes the result bigger
        dominant = multiplayer_deltas([(1, 1500, 1, 10), (2, 1500, 2, 0)])
        self.assertGreater(dominant[1], even[1])

    def test_multiplayer_elo_is_zero_sum(self):
        d = multiplayer_deltas([(1, 1600, 1, 5), (2, 1500, 2, 3), (3, 1400, 3, 0), (4, 1500, 2, 3)])
        self.assertAlmostEqual(sum(d.values()), 0, places=1)
        self.assertGreater(d[1], 0)
        self.assertAlmostEqual(d[2], d[4], places=2)
