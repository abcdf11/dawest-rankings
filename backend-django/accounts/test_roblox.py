from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import IntegrityError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from rankings.models import Player
from .models import AuditEntry, RobloxLinkCode
from .roblox import code_digest
from .services import create_player_account

PASSWORD = "Frontier!River87956"
LINK = "/api/v1/auth/roblox/link/"
REDEEM = "/api/v1/game/players/link/"


def make_member(username):
    return create_player_account({"username": username, "display_name": username.title(), "region": "NA", "password": PASSWORD})


@override_settings(DAWEST_GAME_API_KEY="test-game-key", USE_REDIS=False)
class RobloxLinkTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = make_member("gunslinger")
        self.client = APIClient()
        self.client.force_login(self.user)
        self.game = APIClient()
        self.game.credentials(HTTP_AUTHORIZATION="Bearer test-game-key")

    def code(self):
        response = self.client.post(LINK)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIn("no-store", response["Cache-Control"])
        return response.json()["code"]

    def redeem(self, code, /, **extra):
        return self.game.post(REDEEM, {"code": code, "roblox_user_id": 123456,
                                      "roblox_username": "RobloxGuy", "roblox_display_name": "Roblox Guy", **extra}, format="json")

    def test_link_flow_stores_identity_and_updates_existing_public_lookup(self):
        code = self.code()
        self.assertIsNone(Player.objects.get(user=self.user).roblox_user_id)
        response = self.redeem(code)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["ok"])
        player = Player.objects.get(user=self.user)
        self.assertEqual((player.roblox_user_id, player.roblox_username, player.roblox_display_name),
                         (123456, "RobloxGuy", "Roblox Guy"))
        self.assertIsNotNone(player.roblox_linked_at)
        self.assertFalse(RobloxLinkCode.objects.exists())
        self.assertEqual(self.client.get(LINK).json()["roblox"]["user_id"], 123456)
        session = self.client.get("/api/v1/auth/session/").json()["user"]
        self.assertEqual(session["player"]["roblox"]["user_id"], 123456)
        self.assertTrue(session["roblox_link_available"])
        self.assertTrue(APIClient().get("/api/v1/roblox/123456/").json()["linked"])
        self.assertTrue(APIClient().get("/api/v1/roblox/", {"ids": "123456"}).json()["players"]["123456"]["linked"])
        audit = AuditEntry.objects.get(action="player.roblox_linked")
        self.assertEqual(audit.actor_id, self.user.pk)
        self.assertEqual(audit.details["method"], "game_code")
        self.assertNotIn(code, str(audit.details))

    def test_only_a_digest_is_persisted_and_status_never_discloses_the_code(self):
        code = self.code()
        pending = RobloxLinkCode.objects.get()
        self.assertEqual(pending.digest, code_digest(code))
        self.assertNotIn(code, pending.digest)
        response = self.client.get(LINK)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertNotIn(code, response.content.decode())
        self.assertIsNotNone(response.json()["expires_at"])

    def test_code_is_single_use(self):
        code = self.code()
        self.assertEqual(self.redeem(code).status_code, 200)
        self.assertEqual(self.redeem(code, roblox_user_id=999).status_code, 404)
        self.assertEqual(Player.objects.get(user=self.user).roblox_user_id, 123456)
        self.assertEqual(AuditEntry.objects.filter(action="player.roblox_linked").count(), 1)

    def test_new_code_invalidates_previous_code(self):
        old = self.code()
        new = self.code()
        self.assertNotEqual(new, old)
        self.assertEqual(self.redeem(old).status_code, 404)
        self.assertEqual(self.redeem(new).status_code, 200)

    def test_expired_code_is_rejected(self):
        code = self.code()
        RobloxLinkCode.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.redeem(code).status_code, 404)
        self.assertIsNone(self.client.get(LINK).json()["expires_at"])
        self.assertIsNone(Player.objects.get(user=self.user).roblox_user_id)

    def test_cancel_invalidates_pending_code(self):
        code = self.code()
        self.assertEqual(self.client.delete(LINK).status_code, 200)
        self.assertEqual(self.redeem(code).status_code, 404)

    def test_wrong_code_is_rejected_without_consuming_valid_code(self):
        code = self.code()
        wrong = ("A" if code[0] != "A" else "B") + code[1:]
        self.assertEqual(self.redeem(wrong).status_code, 404)
        self.assertEqual(self.redeem(code).status_code, 200)

    def test_lowercase_and_display_separators_are_accepted(self):
        code = self.code().lower()
        self.assertEqual(self.redeem(f" {code[:5]}-{code[5:]} ").status_code, 200)

    def test_roblox_account_can_only_link_once(self):
        other = make_member("otherplayer")
        Player.objects.filter(user=other).update(roblox_user_id=123456)
        self.assertEqual(self.redeem(self.code()).status_code, 409)
        self.assertIsNone(Player.objects.get(user=self.user).roblox_user_id)
        self.assertTrue(RobloxLinkCode.objects.exists())

    def test_existing_link_cannot_be_silently_replaced(self):
        code = self.code()
        Player.objects.filter(user=self.user).update(roblox_user_id=555)
        self.assertEqual(self.client.post(LINK).status_code, 409)
        self.assertEqual(self.redeem(code).status_code, 409)
        self.assertEqual(Player.objects.get(user=self.user).roblox_user_id, 555)

    def test_concurrent_uniqueness_error_rolls_back_and_keeps_code(self):
        code = self.code()
        with patch("accounts.roblox.Player.save", side_effect=IntegrityError("unique constraint")):
            self.assertEqual(self.redeem(code).status_code, 409)
        self.assertIsNone(Player.objects.get(user=self.user).roblox_user_id)
        self.assertTrue(RobloxLinkCode.objects.exists())
        self.assertFalse(AuditEntry.objects.filter(action="player.roblox_linked").exists())

    def test_browser_session_cannot_redeem_a_code(self):
        code = self.code()
        for client in (APIClient(), self.client):
            response = client.post(REDEEM, {"code": code, "roblox_user_id": 999}, format="json")
            self.assertEqual(response.status_code, 403)
        self.assertIsNone(Player.objects.get(user=self.user).roblox_user_id)

    def test_incorrect_game_key_is_rejected(self):
        self.game.credentials(HTTP_AUTHORIZATION="Bearer wrong")
        self.assertEqual(self.redeem(self.code()).status_code, 403)

    @override_settings(DAWEST_GAME_API_KEY="")
    def test_not_configured_fails_closed(self):
        self.assertEqual(self.client.post(LINK).status_code, 503)
        self.assertFalse(self.client.get(LINK).json()["available"])
        self.assertFalse(self.client.get("/api/v1/auth/session/").json()["user"]["roblox_link_available"])
        self.assertEqual(self.redeem("ABCDEFGHJK").status_code, 403)

    def test_signed_out_users_cannot_issue_read_or_cancel(self):
        for method in ("get", "post", "delete"):
            self.assertEqual(getattr(APIClient(), method)(LINK).status_code, 403)

    def test_developer_without_player_profile_cannot_issue(self):
        dev = get_user_model().objects.create_user("developer", password=PASSWORD, is_staff=True)
        self.client.force_login(dev)
        self.assertEqual(self.client.post(LINK).status_code, 400)

    def test_inactive_profile_cannot_issue_or_redeem(self):
        code = self.code()
        Player.objects.filter(user=self.user).update(is_active=False)
        self.assertEqual(self.client.post(LINK).status_code, 400)
        self.assertEqual(self.redeem(code).status_code, 404)

    def test_deactivated_user_cannot_redeem_an_old_code(self):
        code = self.code()
        get_user_model().objects.filter(pk=self.user.pk).update(is_active=False)
        self.assertEqual(self.redeem(code).status_code, 404)

    def test_request_body_cannot_choose_the_website_owner(self):
        other = make_member("otherplayer")
        response = self.client.post(LINK, {"player_id": other.player_profile.pk, "roblox_user_id": 999}, format="json")
        self.assertEqual(self.redeem(response.json()["code"]).status_code, 200)
        self.assertIsNone(Player.objects.get(user=other).roblox_user_id)
        self.assertEqual(Player.objects.get(user=self.user).roblox_user_id, 123456)

    def test_another_players_status_never_exposes_pending_code(self):
        self.code()
        other = make_member("otherplayer")
        stranger = APIClient()
        stranger.force_login(other)
        self.assertIsNone(stranger.get(LINK).json()["expires_at"])
        self.assertEqual(stranger.delete(LINK).status_code, 200)
        self.assertTrue(RobloxLinkCode.objects.filter(player=self.user.player_profile).exists())

    def test_game_identity_and_code_are_validated(self):
        code = self.code()
        invalid = [{"code": "短" * 10}, {"code": "A" * 33}, {"roblox_user_id": 0},
                   {"roblox_user_id": -1}, {"roblox_user_id": 2**63},
                   {"roblox_username": "not a username"}, {"roblox_display_name": ""}]
        for fields in invalid:
            with self.subTest(fields=fields):
                self.assertEqual(self.redeem(code, **fields).status_code, 400)
        self.assertIsNone(Player.objects.get(user=self.user).roblox_user_id)

    def test_issuance_is_rate_limited_but_status_can_still_be_polled(self):
        for _ in range(20):
            self.assertEqual(self.client.post(LINK).status_code, 201)
        self.assertEqual(self.client.post(LINK).status_code, 429)
        self.assertEqual(self.client.get(LINK).status_code, 200)
        self.assertEqual(self.client.delete(LINK).status_code, 200)

    def test_issue_cancel_and_unlink_require_csrf(self):
        strict = APIClient(enforce_csrf_checks=True)
        strict.force_login(self.user)
        self.assertEqual(strict.post(LINK).status_code, 403)
        self.assertEqual(strict.delete(LINK).status_code, 403)
        self.assertEqual(strict.post("/api/v1/auth/roblox/unlink/").status_code, 403)
        strict.get("/api/v1/auth/session/")
        token = strict.cookies["csrftoken"].value
        self.assertEqual(strict.post(LINK, HTTP_X_CSRFTOKEN=token).status_code, 201)
        self.assertEqual(strict.delete(LINK, HTTP_X_CSRFTOKEN=token).status_code, 200)
        self.assertEqual(strict.post("/api/v1/auth/roblox/unlink/", HTTP_X_CSRFTOKEN=token).status_code, 200)

    def test_unlink_clears_identity_and_invalidates_any_pending_code(self):
        code = self.code()
        Player.objects.filter(user=self.user).update(roblox_user_id=55, roblox_username="a", roblox_display_name="A", roblox_linked_at=timezone.now())
        self.assertEqual(self.client.post("/api/v1/auth/roblox/unlink/").status_code, 200)
        player = Player.objects.get(user=self.user)
        self.assertEqual((player.roblox_user_id, player.roblox_username, player.roblox_display_name, player.roblox_linked_at), (None, "", "", None))
        self.assertEqual(self.redeem(code).status_code, 404)
        self.assertTrue(AuditEntry.objects.filter(action="player.roblox_unlinked").exists())

    def test_legacy_oauth_routes_are_removed(self):
        self.assertEqual(self.client.get("/api/v1/auth/roblox/start/").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/auth/roblox/callback/", {"code": "old", "state": "old"}).status_code, 404)


@override_settings(USE_REDIS=False)
class RobloxGameLookupTests(TestCase):
    def setUp(self):
        cache.clear()
        user = make_member("lookupplayer")
        Player.objects.filter(user=user).update(roblox_user_id=4242, roblox_username="LookupGuy", rating=1612.4)

    def test_single_lookup(self):
        res = APIClient().get("/api/v1/roblox/4242/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["linked"])
        self.assertEqual(body["rating"], 1612)
        self.assertEqual(body["username"], "lookupplayer")

    def test_unknown_is_404(self):
        res = APIClient().get("/api/v1/roblox/999/")
        self.assertEqual(res.status_code, 404)
        self.assertFalse(res.json()["linked"])

    def test_batch_lookup(self):
        res = APIClient().get("/api/v1/roblox/", {"ids": "4242,5"})
        players = res.json()["players"]
        self.assertTrue(players["4242"]["linked"])
        self.assertFalse(players["5"]["linked"])

    def test_batch_rejects_garbage(self):
        self.assertEqual(APIClient().get("/api/v1/roblox/", {"ids": "1,abc"}).status_code, 400)
