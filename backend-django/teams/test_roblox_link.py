from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from rankings.models import KohRound, Player
from .models import Team, TeamMembership

KEY = "game-key-for-tests"
LINK = "/api/v1/game/factions/link/"
LOOKUP = "/api/v1/roblox/factions/"


@override_settings(DAWEST_GAME_API_KEY=KEY, USE_REDIS=False)
class FactionLinkTests(TestCase):
    def setUp(self):
        cache.clear()
        self.leader = self.player("leader", 501)
        self.other = self.player("otherleader", 502)
        self.team = self.faction("frontier", self.leader, "FT")
        self.rivals = self.faction("rivals", self.other, "RV")
        self.site = APIClient()
        self.site.force_authenticate(self.leader.user)
        self.game = APIClient()
        self.game.credentials(HTTP_AUTHORIZATION=f"Bearer {KEY}")

    def player(self, name, roblox_id=None):
        user = get_user_model().objects.create(username=name, password="!")
        return Player.objects.create(user=user, username=name, display_name=name.title(), region="NA",
                                     registered_at=timezone.now(), roblox_user_id=roblox_id)

    def faction(self, name, leader, tag):
        team = Team.objects.create(username=name, display_name=name.title(), tag=tag, region="NA", owner=leader.user, registered_at=timezone.now())
        TeamMembership.objects.create(team=team, player=leader, is_captain=True)
        return team

    def code(self, client=None, slug="frontier"):
        response = (client or self.site).post(f"/api/v1/factions/{slug}/roblox-link/")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["code"]

    def link(self, code, faction_id="abc123def456", leader=501):
        return self.game.post(LINK, {"code": code, "faction_id": faction_id, "faction_name": "Frontier Gang", "leader_roblox_user_id": leader}, format="json")

    def test_leader_links_with_a_code(self):
        response = self.link(self.code())
        self.assertEqual(response.status_code, 200, response.content)
        self.team.refresh_from_db()
        self.assertEqual((self.team.roblox_faction_id, self.team.roblox_faction_name), ("abc123def456", "Frontier Gang"))
        self.assertEqual(self.team.roblox_link_code, "")
        detail = self.site.get("/api/v1/factions/frontier/").json()
        self.assertEqual(detail["roblox_faction"]["name"], "Frontier Gang")

    def test_code_is_single_use_and_expires(self):
        code = self.code()
        self.assertEqual(self.link(code).status_code, 200)
        self.assertEqual(self.link(code, faction_id="another1").status_code, 404)
        code = self.code()
        Team.objects.filter(pk=self.team.pk).update(roblox_link_code_expires=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.link(code, faction_id="another1").status_code, 404)

    def test_only_the_owners_roblox_account_can_link(self):
        self.assertEqual(self.link(self.code(), leader=999).status_code, 403)
        self.team.refresh_from_db()
        self.assertIsNone(self.team.roblox_faction_id)

    def test_owner_needs_a_linked_roblox_account_for_a_code(self):
        Player.objects.filter(pk=self.leader.pk).update(roblox_user_id=None)
        self.assertEqual(self.site.post("/api/v1/factions/frontier/roblox-link/").status_code, 400)

    def test_other_members_cannot_get_a_code(self):
        outsider = APIClient()
        outsider.force_authenticate(self.other.user)
        self.assertEqual(outsider.post("/api/v1/factions/frontier/roblox-link/").status_code, 404)

    def test_one_in_game_faction_per_site_faction(self):
        self.assertEqual(self.link(self.code()).status_code, 200)
        rivals = APIClient()
        rivals.force_authenticate(self.other.user)
        self.assertEqual(self.link(self.code(rivals, "rivals"), leader=502).status_code, 409)

    def test_game_key_required(self):
        code = self.code()
        response = APIClient().post(LINK, {"code": code, "faction_id": "abc123def456", "faction_name": "x", "leader_roblox_user_id": 501}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_unlink(self):
        self.link(self.code())
        self.assertEqual(self.site.delete("/api/v1/factions/frontier/roblox-link/").status_code, 200)
        self.team.refresh_from_db()
        self.assertIsNone(self.team.roblox_faction_id)

    def test_public_lookup_by_in_game_id(self):
        self.link(self.code())
        data = APIClient().get(LOOKUP, {"ids": "abc123def456,nope"}).json()["factions"]
        self.assertTrue(data["abc123def456"]["linked"])
        self.assertEqual(data["abc123def456"]["tag"], "FT")
        self.assertFalse(data["nope"]["linked"])

    def test_verification_follows_the_link_across_profiles_directory_and_cached_rankings(self):
        def check(verified):
            detail = self.site.get("/api/v1/factions/frontier/").json()
            self.assertEqual(detail["is_verified"], verified)
            self.assertEqual(self.site.get("/api/v1/teams/frontier/").json()["is_verified"], verified)
            self.assertEqual(self.site.get("/api/v1/factions/frontier/manage/").json()["faction"]["is_verified"], verified)
            directory = self.site.get("/api/v1/factions/").json()["factions"]
            rankings = self.site.get("/api/v1/teams/rankings/").json()["teams"]
            owned = self.site.get("/api/v1/factions/mine/").json()["owned"]
            for rows in (directory, rankings, owned):
                self.assertEqual(next(row for row in rows if row["username"] == "frontier")["is_verified"], verified)
            self.assertFalse(next(row for row in directory if row["username"] == "rivals")["is_verified"])

        check(False)  # Prime the leaderboard cache before linking.
        code = self.code()
        check(False)  # Merely requesting a code is not verification.
        self.assertEqual(self.link(code).status_code, 200)
        check(True)
        self.assertEqual(self.site.delete("/api/v1/factions/frontier/roblox-link/").status_code, 200)
        check(False)
        self.assertFalse(self.site.get(LOOKUP, {"ids": "abc123def456"}).json()["factions"]["abc123def456"]["linked"])

    def test_public_game_standings_expose_the_faction_rank_and_rating(self):
        Team.objects.filter(pk=self.team.pk).update(rank=7, rating=1725)
        self.assertEqual(self.link(self.code()).status_code, 200)
        entry = self.site.get(LOOKUP, {"ids": "abc123def456"}).json()["factions"]["abc123def456"]
        self.assertEqual((entry["rank"], entry["rating"]), (7, 1725))

    def test_koh_faction_round_matches_linked_ids(self):
        self.link(self.code(), faction_id="ingameFT01")
        rivals = APIClient()
        rivals.force_authenticate(self.other.user)
        self.link(self.code(rivals, "rivals"), faction_id="ingameRV01", leader=502)
        # unlinked guests on the in-game rosters count for their faction: tags don't need to match the site
        body = {"round_id": "job-9:round-1", "mode": "FACTION", "winner_faction_id": "ingameFT01", "players": [
            {"roblox_user_id": 501, "kills": 5, "faction_id": "ingameFT01", "faction_tag": "LONGTAG1"},
            {"roblox_user_id": 7001, "kills": 3, "faction_id": "ingameFT01"},
            {"roblox_user_id": 502, "kills": 4, "faction_id": "ingameRV01"}]}
        response = self.game.post("/api/v1/game/koh/rounds/", body, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(response.json()["rated"], response.json())
        self.team.refresh_from_db()
        self.rivals.refresh_from_db()
        self.assertGreater(self.team.rating, 1500)
        self.assertLess(self.rivals.rating, 1500)
        self.assertEqual(KohRound.objects.get().winner_team_id, self.team.pk)
