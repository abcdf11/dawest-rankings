from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import AuditEntry
from .models import CompetitionEvent, PickemMatchup, PickemPick, Player


class PickemTests(TestCase):
    def setUp(self):
        cache.clear()
        self.now = timezone.now()
        User = get_user_model()
        self.admin = User.objects.create(username="pickadmin", is_staff=True, password="!")
        self.admin.user_permissions.add(Permission.objects.get(codename="access_dev_console"))
        self.dev = APIClient()
        self.dev.force_authenticate(self.admin)
        self.event = CompetitionEvent.objects.create(title="Open", starts_at=self.now + timedelta(days=1), is_published=True)
        self.players = []
        for name in ("alpha", "bravo", "charlie"):
            user = User.objects.create(username=name, password="!")
            Player.objects.create(user=user, username=name, display_name=name.title(), registered_at=self.now)
            client = APIClient()
            client.force_authenticate(user)
            self.players.append(client)

    def create(self, **values):
        body = {"option_a": "Red", "option_b": "Blue", **values}
        response = self.dev.post(f"/api/v1/dev/events/{self.event.pk}/pickems/", body, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def board(self, client):
        return client.get(f"/api/v1/events/{self.event.pk}/pickems/").json()

    def pick(self, client, matchup, choice):
        return client.post(f"/api/v1/events/{self.event.pk}/pickems/{matchup['id']}/pick/", {"choice": choice}, format="json")

    def test_developer_creates_matchup_that_locks_at_event_start_by_default(self):
        matchup = self.create(label="Final", points=3)
        row = PickemMatchup.objects.get(pk=matchup["id"])
        self.assertEqual(row.locks_at, self.event.starts_at)
        self.assertEqual(row.points, 3)
        self.assertTrue(AuditEntry.objects.filter(action="pickem.created").exists())
        self.assertEqual(self.players[0].post(f"/api/v1/dev/events/{self.event.pk}/pickems/", {"option_a": "x", "option_b": "y"}, format="json").status_code, 403)
        bad = self.dev.post(f"/api/v1/dev/events/{self.event.pk}/pickems/", {"option_a": "Same", "option_b": "same"}, format="json")
        self.assertEqual(bad.status_code, 400)

    def test_players_pick_change_until_lock_and_counts_stay_hidden_while_open(self):
        matchup = self.create()
        self.assertEqual(self.pick(self.players[0], matchup, "A").status_code, 200)
        self.assertEqual(self.pick(self.players[0], matchup, "B").status_code, 200)
        self.assertEqual(PickemPick.objects.get().choice, "B")
        data = self.board(self.players[0])
        self.assertEqual(data["matchups"][0]["my_pick"], "B")
        self.assertNotIn("picks", data["matchups"][0])
        self.assertTrue(data["can_pick"])
        anonymous = APIClient()
        self.assertFalse(self.board(anonymous)["can_pick"])
        self.assertEqual(self.pick(anonymous, matchup, "A").status_code, 403)
        self.assertEqual(self.pick(self.players[1], matchup, "C").status_code, 400)
        PickemMatchup.objects.filter(pk=matchup["id"]).update(locks_at=self.now - timedelta(minutes=1))
        self.assertEqual(self.pick(self.players[1], matchup, "A").status_code, 409)
        self.assertEqual(self.board(anonymous)["matchups"][0]["picks"], {"A": 0, "B": 1})

    def test_resolving_winners_scores_leaderboard_with_ties_and_points(self):
        first, second = self.create(points=1), self.create(option_a="Gold", option_b="Gray", points=5)
        a, b, c = self.players
        self.pick(a, first, "A"); self.pick(a, second, "B")
        self.pick(b, first, "A"); self.pick(b, second, "A")
        self.pick(c, first, "B"); self.pick(c, second, "B")
        for matchup, winner in ((first, "A"), (second, "B")):
            response = self.dev.patch(f"/api/v1/dev/events/{self.event.pk}/pickems/{matchup['id']}/", {"winner": winner}, format="json")
            self.assertEqual(response.status_code, 200, response.content)
        board = self.board(APIClient())["leaderboard"]
        self.assertEqual([(row["username"], row["points"], row["rank"]) for row in board], [("alpha", 6, 1), ("charlie", 5, 2), ("bravo", 1, 3)])
        self.assertEqual(self.board(c)["me"]["rank"], 2)
        self.assertEqual(self.pick(a, first, "B").status_code, 409)
        self.assertTrue(AuditEntry.objects.filter(action="pickem.resolved").exists())

    def test_options_lock_after_picks_and_drafts_are_private(self):
        matchup = self.create()
        self.pick(self.players[0], matchup, "A")
        response = self.dev.patch(f"/api/v1/dev/events/{self.event.pk}/pickems/{matchup['id']}/", {"option_a": "Green"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.dev.patch(f"/api/v1/dev/events/{self.event.pk}/pickems/{matchup['id']}/", {"label": "Semis"}, format="json").status_code, 200)
        CompetitionEvent.objects.filter(pk=self.event.pk).update(is_published=False)
        self.assertEqual(APIClient().get(f"/api/v1/events/{self.event.pk}/pickems/").status_code, 404)
        self.assertEqual(self.pick(self.players[1], matchup, "A").status_code, 404)
        self.assertEqual(self.dev.delete(f"/api/v1/dev/events/{self.event.pk}/pickems/{matchup['id']}/").status_code, 200)
        self.assertFalse(PickemPick.objects.exists())


class EventTeamPickemTests(TestCase):
    def setUp(self):
        from teams.models import Team, TeamMembership
        cache.clear()
        self.now = timezone.now()
        User = get_user_model()
        admin = User.objects.create(username="teamadmin", is_staff=True, password="!")
        admin.user_permissions.add(Permission.objects.get(codename="access_dev_console"))
        self.dev = APIClient()
        self.dev.force_authenticate(admin)
        self.event = CompetitionEvent.objects.create(title="Faction Cup", format="FACTION", starts_at=self.now + timedelta(days=1), is_published=True)
        self.leaders, self.teams = [], []
        for name, tag in (("wolves", "WLF"), ("hawks", "HWK"), ("bears", "BRS")):
            user = User.objects.create(username=f"{name}lead", password="!")
            player = Player.objects.create(user=user, username=f"{name}lead", display_name=name.title(), registered_at=self.now)
            team = Team.objects.create(username=name, display_name=name.title(), tag=tag, region="NA", owner=user, registered_at=self.now)
            TeamMembership.objects.create(team=team, player=player, is_captain=True)
            client = APIClient()
            client.force_authenticate(user)
            self.leaders.append(client)
            self.teams.append(team)

    def url(self, path=""):
        return f"/api/v1/events/{self.event.pk}/{path}"

    def test_leaders_register_own_faction_and_only_entrants_can_be_picked(self):
        wolves, hawks, _ = self.leaders
        self.assertEqual(wolves.post(self.url("entries/"), {"team": "wolves"}, format="json").status_code, 201)
        self.assertEqual(wolves.post(self.url("entries/"), {"team": "wolves"}, format="json").status_code, 409)
        self.assertEqual(wolves.post(self.url("entries/"), {"team": "hawks"}, format="json").status_code, 404)
        self.assertEqual(APIClient().post(self.url("entries/"), {"team": "wolves"}, format="json").status_code, 403)
        hawks.post(self.url("entries/"), {"team": "hawks"}, format="json")
        mine = wolves.get(self.url("entries/")).json()
        self.assertEqual([e["slug"] for e in mine["entries"]], ["wolves", "hawks"])
        self.assertEqual(mine["my_teams"][0]["registered"], True)
        dev_entries = self.dev.get(f"/api/v1/dev/events/{self.event.pk}/entries/").json()
        self.assertEqual([t["slug"] for t in dev_entries["available"]], ["bears"])
        base = f"/api/v1/dev/events/{self.event.pk}/pickems/"
        self.assertEqual(self.dev.post(base, {"team_a": "wolves", "team_b": "bears"}, format="json").status_code, 400)
        self.assertEqual(self.dev.post(base, {"option_a": "x", "option_b": "y"}, format="json").status_code, 400)
        self.assertEqual(self.dev.post(base, {"team_a": "wolves", "team_b": "wolves"}, format="json").status_code, 400)
        created = self.dev.post(base, {"team_a": "wolves", "team_b": "hawks", "option_a": "ignored"}, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        body = created.json()
        self.assertEqual((body["option_a"], body["team_a"]["slug"], body["team_b"]["url"]), ("Wolves", "wolves", "/factions/hawks"))
        self.assertEqual(wolves.delete(self.url("entries/wolves/")).status_code, 409)
        self.assertEqual(self.dev.delete(f"/api/v1/dev/events/{self.event.pk}/entries/wolves/").status_code, 409)
        self.assertEqual(self.dev.patch(f"/api/v1/dev/events/{self.event.pk}/", {"format": "SOLO"}, format="json").status_code, 400)

    def test_registration_closes_when_event_starts_but_developers_can_still_add(self):
        CompetitionEvent.objects.filter(pk=self.event.pk).update(starts_at=self.now - timedelta(minutes=5))
        self.assertEqual(self.leaders[0].post(self.url("entries/"), {"team": "wolves"}, format="json").status_code, 409)
        self.assertEqual(self.dev.post(f"/api/v1/dev/events/{self.event.pk}/entries/", {"team": "wolves"}, format="json").status_code, 201)
        self.assertEqual(self.dev.delete(f"/api/v1/dev/events/{self.event.pk}/entries/wolves/").status_code, 200)
        solo = CompetitionEvent.objects.create(title="Solo", starts_at=self.now + timedelta(days=1), is_published=True)
        self.assertEqual(self.dev.post(f"/api/v1/dev/events/{solo.pk}/entries/", {"team": "wolves"}, format="json").status_code, 400)
        self.assertEqual(self.dev.post(f"/api/v1/dev/events/{solo.pk}/pickems/", {"team_a": "wolves", "team_b": "hawks"}, format="json").status_code, 400)

    def test_public_events_list_only_their_registered_eligible_teams_and_track_withdrawals(self):
        wolves, hawks, _ = self.leaders
        wolves.post(self.url("entries/"), {"team": "wolves"}, format="json")
        hawks.post(self.url("entries/"), {"team": "hawks"}, format="json")
        anonymous = APIClient()
        listing = anonymous.get("/api/v1/events/").json()["events"][0]
        self.assertEqual(listing["team_count"], 2)
        self.assertEqual([team["slug"] for team in listing["teams"]], ["wolves", "hawks"])
        self.assertEqual(listing["teams"][0]["url"], "/factions/wolves")
        self.assertIn("logo_url", listing["teams"][0])
        self.assertEqual(anonymous.get(self.url()).json()["teams"], listing["teams"])
        self.assertEqual(self.dev.get("/api/v1/dev/events/").json()["events"][0]["team_count"], 2)
        self.assertEqual(wolves.delete(self.url("entries/wolves/")).status_code, 200)
        self.assertEqual(anonymous.get(self.url()).json()["team_count"], 1)
        self.teams[1].is_active = False
        self.teams[1].save(update_fields=["is_active"])
        empty = anonymous.get("/api/v1/events/").json()["events"][0]
        self.assertEqual(empty["teams"], [])
        self.assertEqual(empty["team_count"], 0)
        self.assertEqual(anonymous.get(self.url("entries/")).json()["entries"], [])
        other = CompetitionEvent.objects.create(title="Other Cup", format="FACTION", starts_at=self.now + timedelta(days=1), is_published=True)
        self.assertEqual(anonymous.get(f"/api/v1/events/{other.pk}/").json()["teams"], [])
