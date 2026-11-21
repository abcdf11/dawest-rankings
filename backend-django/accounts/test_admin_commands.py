import uuid

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from rankings.engine import process_completed_match
from rankings.models import Match, Player, RatingHistory
from teams.engine import process_team_match
from teams.models import Team, TeamMatch, TeamMembership, TeamRatingHistory
from .models import AccountSession, AuditEntry


class AdminCommandTests(TestCase):
    def setUp(self):
        cache.clear()
        self.admin = get_user_model().objects.create(username="consoledev", is_staff=True, password="!")
        self.admin.user_permissions.add(*Permission.objects.filter(codename__in=["access_dev_console", "change_match", "change_teammatch"]))
        self.player = self.new_player("adjustme", 1500)
        self.other = self.new_player("rival", 1800)
        self.faction = Team.objects.create(username="frontier", display_name="Frontier", tag="FT", region="NA", owner=self.other.user, registered_at=timezone.now())
        TeamMembership.objects.create(team=self.faction, player=self.other, is_captain=True)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def new_player(self, name, rating):
        user = get_user_model().objects.create(username=name, password="!")
        return Player.objects.create(user=user, username=name, display_name=name.title(), region="NA", rating=rating, peak_rating=rating, registered_at=timezone.now())

    def command(self, text, key=None):
        return self.client.post("/api/v1/dev/commands/", {"command": text, "request_key": str(key or uuid.uuid4())}, format="json")

    def rating(self, amount="25.25", kind="player", key=None, reason="Verified correction"):
        return self.client.post("/api/v1/dev/ratings/", {"request_key": str(key or uuid.uuid4()), "kind": kind, "target_id": self.player.pk if kind == "player" else self.faction.pk, "amount": amount, "reason": reason}, format="json")

    def test_player_elo_updates_rank_tier_peak_history_and_audit_without_match_results(self):
        result = self.rating("600.25")
        self.assertEqual(result.status_code, 200, result.content)
        self.player.refresh_from_db()
        self.assertEqual(self.player.rating, 2100.25)
        self.assertEqual(self.player.previous_rating, 1500)
        self.assertEqual(self.player.peak_rating, 2100.25)
        self.assertEqual(self.player.tier, "LEGEND")
        self.assertEqual(self.player.rank, 1)
        self.assertEqual(self.player.wins, 0)
        self.assertEqual(RatingHistory.objects.get(player=self.player).event_label, "Admin Elo adjustment")
        audit = AuditEntry.objects.get(pk=result.json()["operation_id"])
        self.assertEqual(audit.details["reason"], "Verified correction")
        self.assertEqual(audit.details["before"], 1500)
        self.assertEqual(self.client.get("/api/v1/rankings/").json()["players"][0]["rating"], 2100.25)

    def test_faction_elo_is_independent_from_solo_ratings(self):
        before = list(Player.objects.order_by("pk").values_list("pk", "rating", "wins"))
        result = self.rating("300.50", kind="faction")
        self.assertEqual(result.status_code, 200)
        self.faction.refresh_from_db()
        self.assertEqual(self.faction.rating, 1800.50)
        self.assertEqual(self.faction.tier, "OUTLAW")
        self.assertEqual(list(Player.objects.order_by("pk").values_list("pk", "rating", "wins")), before)
        self.assertEqual(TeamRatingHistory.objects.get(team=self.faction).rating, 1800.50)

    def test_replayed_elo_request_applies_only_once_and_keys_cannot_be_reused(self):
        key = uuid.uuid4()
        first = self.rating(key=key)
        again = self.rating(key=key)
        self.assertEqual(first.json(), again.json())
        self.player.refresh_from_db()
        self.assertEqual(self.player.rating, 1525.25)
        self.assertEqual(RatingHistory.objects.filter(player=self.player).count(), 1)
        self.assertEqual(self.rating("80", key=key).status_code, 409)

    def test_negative_adjustments_preserve_peak_and_cannot_make_rating_negative(self):
        self.assertEqual(self.rating("-100.25").status_code, 200)
        self.player.refresh_from_db()
        self.assertEqual(self.player.rating, 1399.75)
        self.assertEqual(self.player.peak_rating, 1500)
        self.assertEqual(self.player.tier, "DEPUTY")
        self.assertEqual(self.rating("-1500").status_code, 400)
        self.player.refresh_from_db()
        self.assertEqual(self.player.rating, 1399.75)

    def test_invalid_numbers_missing_reasons_and_unknown_ladders_do_not_write(self):
        for amount in ("NaN", "Infinity", "0", "100000.01", "1.001"):
            self.assertEqual(self.rating(amount).status_code, 400)
        self.assertEqual(self.rating(reason="x").status_code, 400)
        self.assertEqual(self.client.post("/api/v1/dev/ratings/", {"kind": "invalid"}, format="json").status_code, 400)
        self.assertFalse(RatingHistory.objects.exists())

    def test_only_authorized_developers_can_call_rating_and_terminal_endpoints(self):
        for user in (None, self.player.user, get_user_model().objects.create(username="plainstaff", is_staff=True)):
            self.client.force_authenticate(user)
            self.assertEqual(self.command("help").status_code, 403)
            self.assertEqual(self.rating().status_code, 403)

    def test_terminal_help_status_and_explicit_player_and_faction_elo_commands(self):
        self.assertIn("restrict <username>", self.command("help").json()["message"])
        self.assertIn("active; Elo 1500", self.command("status ADJUSTME").json()["message"])
        self.assertEqual(self.command("elo player adjustme +75 Verified result correction").status_code, 200)
        self.assertEqual(self.command("elo faction frontier +200 Official review").status_code, 200)
        self.player.refresh_from_db()
        self.faction.refresh_from_db()
        self.assertEqual(self.player.rating, 1575)
        self.assertEqual(self.faction.rating, 1700)

    def test_unknown_shell_commands_and_malformed_input_are_rejected(self):
        for command in ("whoami", "python -c print(1)", "ban", "restrict adjustme", 'ban adjustme "unfinished', "elo player adjustme NaN Invalid score", "unban adjustme x"):
            self.assertEqual(self.command(command).status_code, 400, command)
        self.player.refresh_from_db()
        self.assertTrue(self.player.is_active)
        self.assertFalse(AuditEntry.objects.exists())

    def test_ban_revokes_existing_sessions_hides_rankings_and_unban_restores_account(self):
        browser = APIClient()
        browser.force_login(self.player.user)
        AccountSession.objects.create(user=self.player.user, session_key=browser.session.session_key)
        self.assertEqual(self.command("ban adjustme Abusive behavior").status_code, 200)
        self.player.refresh_from_db()
        self.player.user.refresh_from_db()
        self.assertFalse(self.player.is_active)
        self.assertFalse(self.player.user.is_active)
        self.assertFalse(browser.get("/api/v1/auth/session/").json()["authenticated"])
        self.assertFalse(AccountSession.objects.filter(user=self.player.user).exists())
        self.assertEqual(self.client.get("/api/v1/players/adjustme/").status_code, 404)
        self.assertEqual(self.command("unban adjustme Appeal approved").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/players/adjustme/").status_code, 200)
        self.assertFalse(browser.get("/api/v1/auth/session/").json()["authenticated"])

    def test_restrictions_preserve_sessions_and_profile_while_hiding_rankings(self):
        browser = APIClient()
        browser.force_login(self.player.user)
        self.assertEqual(self.command("restrict adjustme Private review reason").status_code, 200)
        self.assertTrue(browser.get("/api/v1/auth/session/").json()["authenticated"])
        profile = browser.get("/api/v1/players/adjustme/")
        self.assertEqual(profile.status_code, 200)
        self.assertTrue(profile.json()["is_restricted"])
        self.assertNotIn("Private review reason", profile.content.decode())
        self.assertNotIn("adjustme", [row["username"] for row in browser.get("/api/v1/rankings/").json()["players"]])
        self.assertEqual(browser.post("/api/v1/factions/frontier/join/", {}).status_code, 403)
        self.assertEqual(self.command("unrestrict adjustme Review complete").status_code, 200)
        self.assertIn("adjustme", [row["username"] for row in browser.get("/api/v1/rankings/").json()["players"]])

    def test_restricted_accounts_cannot_play_solo_or_faction_matches(self):
        match = Match.objects.create(player_a=self.player, player_b=self.other, score_a=5, score_b=2)
        faction2 = Team.objects.create(username="opponents", display_name="Opponents", tag="OP", region="NA", owner=self.player.user, registered_at=timezone.now())
        TeamMembership.objects.create(team=faction2, player=self.player, is_captain=True)
        team_match = TeamMatch.objects.create(team_a=self.faction, team_b=faction2, score_a=5, score_b=2)
        self.command("restrict adjustme Competitive review")
        with self.assertRaises(ValueError):
            process_completed_match(match.pk)
        with self.assertRaises(ValueError):
            process_team_match(team_match.pk)
        self.assertEqual(self.client.post(f"/api/v1/matches/{match.pk}/complete/", {"score_a": 8, "score_b": 3}).status_code, 400)
        match.refresh_from_db()
        self.assertEqual(match.score_a, 5)
        self.assertIsNone(match.processed_at)
        self.assertEqual(self.client.get("/api/v1/factions/opponents/manage/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/v1/teams/matches/{team_match.pk}/complete/", {"score_a": 8, "score_b": 3}).status_code, 400)
        team_match.refresh_from_db()
        self.assertEqual(team_match.score_a, 5)
        self.assertIsNone(team_match.processed_at)

    def test_restricted_leader_cannot_manage_faction_or_upload_its_images(self):
        self.command("restrict rival Leader review")
        self.client.force_authenticate(self.other.user)
        self.assertEqual(self.client.get("/api/v1/factions/frontier/manage/").status_code, 403)
        self.assertEqual(self.client.post("/api/v1/factions/frontier/appearance/", {}).status_code, 403)

    def test_staff_accounts_are_protected_and_restrictions_remain_after_unban(self):
        staff = Player.objects.create(user=self.admin, username="consoledev", display_name="Admin", region="NA", registered_at=timezone.now())
        self.assertEqual(self.command("ban consoledev Disallowed target").status_code, 403)
        self.assertEqual(self.command("restrict consoledev Disallowed target").status_code, 403)
        self.command("restrict adjustme Review in progress")
        self.command("ban adjustme Account suspended")
        self.command("unban adjustme Login restored")
        self.player.refresh_from_db()
        self.assertTrue(self.player.is_active)
        self.assertTrue(self.player.is_restricted)

    def test_moderation_replay_does_not_create_duplicate_audit_entries(self):
        key = uuid.uuid4()
        first = self.command("restrict adjustme Needs review", key)
        self.assertEqual(first.json(), self.command("restrict adjustme Needs review", key).json())
        self.assertEqual(AuditEntry.objects.count(), 1)
        self.assertEqual(self.command("ban adjustme Needs review", key).status_code, 409)

    def test_admin_commands_require_csrf_with_session_authentication(self):
        browser = APIClient(enforce_csrf_checks=True)
        browser.force_login(self.admin)
        data = {"request_key": str(uuid.uuid4()), "command": "restrict adjustme Missing CSRF"}
        self.assertEqual(browser.post("/api/v1/dev/commands/", data, format="json").status_code, 403)
        browser.get("/api/v1/auth/session/")
        self.assertEqual(browser.post("/api/v1/dev/commands/", data, format="json", HTTP_X_CSRFTOKEN=browser.cookies["csrftoken"].value).status_code, 200)
