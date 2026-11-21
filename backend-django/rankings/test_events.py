from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.contrib.admin import AdminSite
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import AuditEntry
from teams.models import Team, TeamMatch
from .models import CompetitionEvent, Match, Player
from .admin import MatchAdmin
from teams.admin import TeamMatchAdmin


class EventTests(TestCase):
    def setUp(self):
        cache.clear()
        self.now = timezone.now()
        self.admin = get_user_model().objects.create(username="eventadmin", is_staff=True, password="!")
        self.admin.user_permissions.add(Permission.objects.get(codename="access_dev_console"))
        self.user = get_user_model().objects.create(username="eventplayer", password="!")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def body(self, **values):
        return {"title": "DaWest Open", "format": "SOLO", "region": "GLOBAL", "location": "Online",
                "starts_at": (self.now + timedelta(days=2)).isoformat(),
                "ends_at": (self.now + timedelta(days=2, hours=2)).isoformat(), **values}

    def create(self, **values):
        response = self.client.post("/api/v1/dev/events/", self.body(**values), format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_drafts_are_private_until_published_and_can_be_unpublished_without_deletion(self):
        event = self.create()
        anonymous = APIClient()
        self.assertFalse(anonymous.get("/api/v1/events/").json()["events"])
        self.assertEqual(anonymous.get(f"/api/v1/events/{event['id']}/").status_code, 404)
        self.assertFalse(self.client.get("/api/v1/dev/events/").json()["events"][0]["is_published"])
        response = self.client.patch(f"/api/v1/dev/events/{event['id']}/", {"is_published": True}, format="json")
        self.assertEqual(response.status_code, 200)
        public = anonymous.get(f"/api/v1/events/{event['id']}/").json()
        self.assertEqual(public["title"], "DaWest Open")
        self.assertNotIn("created_by", public)
        self.assertNotIn("is_published", public)
        self.assertEqual(self.client.delete(f"/api/v1/dev/events/{event['id']}/").status_code, 200)
        self.assertTrue(CompetitionEvent.objects.filter(pk=event["id"]).exists())
        self.assertEqual(anonymous.get(f"/api/v1/events/{event['id']}/").status_code, 404)

    def test_status_tracks_schedule_and_explicit_completed_or_cancelled_state(self):
        row = CompetitionEvent.objects.create(title="Scheduled", starts_at=self.now + timedelta(hours=1), ends_at=self.now + timedelta(hours=3))
        self.assertEqual(row.current_status(self.now), "UPCOMING")
        self.assertEqual(row.current_status(self.now + timedelta(hours=2)), "LIVE")
        self.assertEqual(row.current_status(self.now + timedelta(hours=4)), "COMPLETED")
        row.status = "CANCELLED"
        self.assertEqual(row.current_status(self.now + timedelta(hours=2)), "CANCELLED")
        row.status = "COMPLETED"
        self.assertEqual(row.current_status(self.now), "COMPLETED")

    def test_live_events_are_first_upcoming_events_ascending_and_past_events_descending(self):
        self.create(title="Future later", starts_at=(self.now + timedelta(days=4)).isoformat(), ends_at=None, is_published=True)
        self.create(title="Past old", starts_at=(self.now - timedelta(days=4)).isoformat(), status="COMPLETED", ends_at=None, is_published=True)
        self.create(title="Future soon", is_published=True)
        self.create(title="Current live", starts_at=(self.now - timedelta(hours=1)).isoformat(), ends_at=(self.now + timedelta(hours=1)).isoformat(), is_published=True)
        self.create(title="Past recent", starts_at=(self.now - timedelta(days=2)).isoformat(), status="COMPLETED", ends_at=None, is_published=True)
        events = APIClient().get("/api/v1/events/").json()["events"]
        self.assertEqual([row["title"] for row in events], ["Current live", "Future soon", "Future later", "Past recent", "Past old"])
        self.assertEqual(len(APIClient().get("/api/v1/events/?search=recent").json()["events"]), 1)

    def test_invalid_dates_and_registration_schemes_do_not_create_events(self):
        for changes in ({"ends_at": self.now.isoformat()}, {"starts_at": "invalid"}, {"registration_url": "javascript:alert(1)"}, {"registration_url": "ftp://example.com/file"}, {"title": " "}):
            response = self.client.post("/api/v1/dev/events/", self.body(**changes), format="json")
            self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(CompetitionEvent.objects.exists())

    def test_partial_date_changes_validate_against_the_saved_other_date(self):
        event = self.create()
        response = self.client.patch(f"/api/v1/dev/events/{event['id']}/", {"starts_at": (self.now + timedelta(days=5)).isoformat()}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.patch(f"/api/v1/dev/events/{event['id']}/", {"ends_at": None}, format="json").status_code, 200)
        with self.assertRaises(IntegrityError), transaction.atomic():
            CompetitionEvent.objects.create(title="Invalid", starts_at=self.now, ends_at=self.now - timedelta(hours=1))

    def test_only_developers_can_create_edit_list_or_unpublish_events(self):
        event = self.create()
        for user in (None, self.user, get_user_model().objects.create(username="staffonly", is_staff=True)):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get("/api/v1/dev/events/").status_code, 403)
            self.assertEqual(self.client.post("/api/v1/dev/events/", self.body(), format="json").status_code, 403)
            self.assertEqual(self.client.patch(f"/api/v1/dev/events/{event['id']}/", {"title": "Changed"}).status_code, 403)
            self.assertEqual(self.client.delete(f"/api/v1/dev/events/{event['id']}/").status_code, 403)

    def test_public_solo_results_show_only_verified_linked_matches(self):
        event = CompetitionEvent.objects.get(pk=self.create(is_published=True)["id"])
        a = Player.objects.create(username="eventa", display_name="Player A", region="NA")
        b = Player.objects.create(username="eventb", display_name="Player B", region="EU")
        Match.objects.create(event=event, player_a=a, player_b=b, score_a=5, score_b=2, status="COMPLETED", processed_at=self.now)
        Match.objects.create(event=event, player_a=a, player_b=b, score_a=1, score_b=0, status="LIVE")
        Match.objects.create(player_a=a, player_b=b, score_a=5, score_b=1, status="COMPLETED", processed_at=self.now)
        results = APIClient().get(f"/api/v1/events/{event.pk}/").json()["matches"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["a"], {"name": "Player A", "url": "/players/eventa"})
        self.assertEqual(results[0]["score_a"], 5)
        self.assertEqual(self.client.patch(f"/api/v1/dev/events/{event.pk}/", {"format": "FACTION"}).status_code, 400)

    def test_faction_event_results_link_to_faction_profiles(self):
        event = CompetitionEvent.objects.get(pk=self.create(format="FACTION", is_published=True)["id"])
        a = Team.objects.create(username="faction-a", display_name="Faction A", tag="FA", region="NA")
        b = Team.objects.create(username="faction-b", display_name="Faction B", tag="FB", region="EU")
        TeamMatch.objects.create(event=event, team_a=a, team_b=b, score_a=5, score_b=3, status="COMPLETED", processed_at=self.now)
        results = APIClient().get(f"/api/v1/events/{event.pk}/").json()["matches"]
        self.assertEqual(results[0]["a"]["url"], "/factions/faction-a")

    def test_session_csrf_is_required_and_mutations_are_audited(self):
        browser = APIClient(enforce_csrf_checks=True)
        browser.force_login(self.admin)
        self.assertEqual(browser.post("/api/v1/dev/events/", self.body(), format="json").status_code, 403)
        browser.get("/api/v1/auth/session/")
        response = browser.post("/api/v1/dev/events/", self.body(), format="json", HTTP_X_CSRFTOKEN=browser.cookies["csrftoken"].value)
        self.assertEqual(response.status_code, 201)
        row = CompetitionEvent.objects.get(pk=response.json()["id"])
        self.assertEqual(row.created_by, self.admin)
        self.assertTrue(AuditEntry.objects.filter(action="event.created", target_id=str(row.pk), actor=self.admin).exists())

    def test_match_format_validation_and_result_association_keep_scores_locked(self):
        solo = CompetitionEvent.objects.get(pk=self.create()["id"])
        faction = CompetitionEvent.objects.get(pk=self.create(format="FACTION")["id"])
        player = Player.objects.create(username="linkedplayer", display_name="Linked", region="NA")
        other = Player.objects.create(username="linkedother", display_name="Other", region="NA")
        match = Match(player_a=player, player_b=other, event=faction)
        with self.assertRaises(ValidationError):
            match.clean()
        match.event = solo
        match.clean()
        match.processed_at = self.now
        locked = MatchAdmin(Match, AdminSite()).get_readonly_fields(None, match)
        self.assertIn("score_a", locked)
        self.assertNotIn("event", locked)
        a = Team.objects.create(username="linked-a", display_name="A", tag="LA", region="NA")
        b = Team.objects.create(username="linked-b", display_name="B", tag="LB", region="EU")
        team_match = TeamMatch(team_a=a, team_b=b, event=solo)
        with self.assertRaises(ValidationError):
            team_match.clean()
        team_match.event = faction
        team_match.clean()
        team_match.processed_at = self.now
        locked = TeamMatchAdmin(TeamMatch, AdminSite()).get_readonly_fields(None, team_match)
        self.assertIn("score_a", locked)
        self.assertNotIn("event", locked)
