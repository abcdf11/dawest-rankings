from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from rankings.models import Player
from .services import create_player_account

PASSWORD = "Frontier!River87956"
OAUTH = dict(ROBLOX_OAUTH_CLIENT_ID="client-123", ROBLOX_OAUTH_CLIENT_SECRET="secret-xyz", ROBLOX_OAUTH_REDIRECT_URI="https://dawest.test/api/v1/auth/roblox/callback/", USE_REDIS=False)


def make_member(username):
    return create_player_account({"username": username, "display_name": username.title(), "region": "NA", "password": PASSWORD})


@override_settings(**OAUTH)
class RobloxLinkTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = make_member("gunslinger")
        self.client = APIClient()
        self.client.force_login(self.user)

    def start(self):
        res = self.client.get("/api/v1/auth/roblox/start/")
        self.assertEqual(res.status_code, 302)
        url = urlparse(res["Location"])
        self.assertEqual(url.netloc, "apis.roblox.com")
        q = parse_qs(url.query)
        self.assertEqual(q["client_id"], ["client-123"])
        self.assertEqual(q["redirect_uri"], [OAUTH["ROBLOX_OAUTH_REDIRECT_URI"]])
        self.assertEqual(q["code_challenge_method"], ["S256"])
        self.assertEqual(q["scope"], ["openid profile"])
        return q["state"][0]

    @patch("accounts.roblox.roblox_identity", return_value=(123456, "RobloxGuy", "Roblox Guy"))
    def test_link_flow_stores_roblox_account(self, identity):
        state = self.start()
        res = self.client.get("/api/v1/auth/roblox/callback/", {"code": "abc", "state": state})
        self.assertEqual(res.status_code, 302)
        self.assertEqual(res["Location"], "/players/gunslinger?roblox=linked")
        p = Player.objects.get(user=self.user)
        self.assertEqual((p.roblox_user_id, p.roblox_username, p.roblox_display_name), (123456, "RobloxGuy", "Roblox Guy"))
        self.assertIsNotNone(p.roblox_linked_at)
        session = self.client.get("/api/v1/auth/session/").json()
        self.assertEqual(session["user"]["player"]["roblox"]["user_id"], 123456)
        self.assertTrue(session["user"]["roblox_login_available"])

    @patch("accounts.roblox.roblox_identity", return_value=(1, "x", "x"))
    def test_wrong_state_is_rejected(self, identity):
        self.start()
        res = self.client.get("/api/v1/auth/roblox/callback/", {"code": "abc", "state": "forged"})
        self.assertEqual(res["Location"], "/players/gunslinger?roblox=expired")
        identity.assert_not_called()
        self.assertIsNone(Player.objects.get(user=self.user).roblox_user_id)

    @patch("accounts.roblox.roblox_identity", return_value=(1, "x", "x"))
    def test_state_is_single_use(self, identity):
        state = self.start()
        self.client.get("/api/v1/auth/roblox/callback/", {"code": "abc", "state": state})
        res = self.client.get("/api/v1/auth/roblox/callback/", {"code": "abc", "state": state})
        self.assertEqual(res["Location"], "/players/gunslinger?roblox=expired")

    @patch("accounts.roblox.roblox_identity", return_value=(777, "Shared", "Shared"))
    def test_roblox_account_can_only_link_once(self, identity):
        other = make_member("otherplayer")
        Player.objects.filter(user=other).update(roblox_user_id=777)
        state = self.start()
        res = self.client.get("/api/v1/auth/roblox/callback/", {"code": "abc", "state": state})
        self.assertEqual(res["Location"], "/players/gunslinger?roblox=taken")
        self.assertIsNone(Player.objects.get(user=self.user).roblox_user_id)

    def test_denied_on_roblox_page(self):
        state = self.start()
        res = self.client.get("/api/v1/auth/roblox/callback/", {"error": "access_denied", "state": state})
        self.assertEqual(res["Location"], "/players/gunslinger?roblox=cancelled")

    def test_signed_out_start_goes_to_login(self):
        res = APIClient().get("/api/v1/auth/roblox/start/")
        self.assertEqual(res.status_code, 302)
        self.assertTrue(res["Location"].startswith("/login"))

    @override_settings(ROBLOX_OAUTH_CLIENT_ID="", ROBLOX_OAUTH_CLIENT_SECRET="")
    def test_not_configured(self):
        res = self.client.get("/api/v1/auth/roblox/start/")
        self.assertEqual(res["Location"], "/players/gunslinger?roblox=unavailable")

    def test_unlink_requires_csrf_and_clears(self):
        Player.objects.filter(user=self.user).update(roblox_user_id=55, roblox_username="a")
        strict = APIClient(enforce_csrf_checks=True)
        strict.force_login(self.user)
        self.assertEqual(strict.post("/api/v1/auth/roblox/unlink/").status_code, 403)
        strict.get("/api/v1/auth/session/")
        res = strict.post("/api/v1/auth/roblox/unlink/", HTTP_X_CSRFTOKEN=strict.cookies["csrftoken"].value)
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(Player.objects.get(user=self.user).roblox_user_id)


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
