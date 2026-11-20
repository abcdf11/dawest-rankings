import io
import uuid
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rankings.models import Player
from teams.models import Team, TeamRegistration
from .services import create_player_account

PASSWORD = "Frontier!River87956"


@override_settings(USE_REDIS=False)
class AccountTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)

    def csrf(self, client=None):
        client = client or self.client
        client.get("/api/v1/auth/session/")
        return {"HTTP_X_CSRFTOKEN": client.cookies["csrftoken"].value}

    def signup(self, username="frontierplayer", client=None):
        client = client or self.client
        return client.post("/api/v1/auth/signup/", {"username":username,"display_name":username,"region":"NA","password":PASSWORD,"password_confirm":PASSWORD}, format="json", **self.csrf(client))

    def developer(self):
        return get_user_model().objects.create_superuser(username="developer", password=PASSWORD)

    def test_signup_uses_hashed_password_session_and_registered_database_profile(self):
        response = self.signup()
        self.assertEqual(response.status_code, 201)
        user = get_user_model().objects.get(username="frontierplayer")
        self.assertNotEqual(user.password, PASSWORD)
        self.assertTrue(user.check_password(PASSWORD))
        self.assertFalse(user.is_staff)
        self.assertTrue(self.client.get("/api/v1/auth/session/").json()["authenticated"])
        self.assertTrue(self.client.cookies["sessionid"]["httponly"])
        self.assertEqual(self.client.get("/api/v1/rankings/").json()["total"], 1)
        self.assertEqual(response.json()["user"]["player"]["rank"], 1)

    def test_login_signup_and_logout_require_csrf(self):
        body = {"username":"frontierplayer","password":PASSWORD}
        self.assertEqual(self.client.post("/api/v1/auth/login/", body).status_code, 403)
        self.assertEqual(self.client.post("/api/v1/auth/signup/", body).status_code, 403)
        self.signup()
        self.assertEqual(self.client.post("/api/v1/auth/logout/", {}).status_code, 403)
        self.assertEqual(self.client.post("/api/v1/auth/logout/", {}, **self.csrf()).status_code, 200)
        self.assertFalse(self.client.get("/api/v1/auth/session/").json()["authenticated"])

    @override_settings(
        ALLOWED_HOSTS=["dawest-test.onrender.com"],
        SECURE_PROXY_SSL_HEADER=("HTTP_X_FORWARDED_PROTO", "https"),
        SESSION_COOKIE_SECURE=True,
        CSRF_COOKIE_SECURE=True,
    )
    def test_https_proxy_preserves_same_origin_csrf_and_secure_session_cookies(self):
        headers = {"HTTP_HOST": "dawest-test.onrender.com", "HTTP_X_FORWARDED_PROTO": "https"}
        self.client.get("/api/v1/auth/session/", **headers)
        token = self.client.cookies["csrftoken"].value
        response = self.client.post(
            "/api/v1/auth/signup/",
            {"username": "renderplayer", "display_name": "Render Player", "region": "ASIA", "password": PASSWORD, "password_confirm": PASSWORD},
            format="json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://dawest-test.onrender.com", **headers,
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(self.client.cookies["sessionid"]["secure"])
        self.assertTrue(self.client.cookies["csrftoken"]["secure"])
        self.assertTrue(self.client.get("/api/v1/auth/session/", **headers).json()["authenticated"])
        response = self.client.post(
            "/api/v1/auth/logout/", {},
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
            HTTP_ORIGIN="https://other.onrender.com", **headers,
        )
        self.assertEqual(response.status_code, 403)

    def test_login_is_real_case_insensitive_and_rejects_wrong_password(self):
        self.signup()
        self.client.post("/api/v1/auth/logout/", {}, **self.csrf())
        self.assertEqual(self.client.post("/api/v1/auth/login/", {"username":"FRONTIERPLAYER","password":"wrong"}, format="json", **self.csrf()).status_code, 400)
        response = self.client.post("/api/v1/auth/login/", {"username":"FRONTIERPLAYER","password":PASSWORD}, format="json", **self.csrf())
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["authenticated"])

    def test_public_signup_cannot_create_developer_privileges(self):
        response = self.client.post("/api/v1/auth/signup/", {"username":"hacker","password":PASSWORD,"is_staff":True}, format="json", **self.csrf())
        self.assertEqual(response.status_code, 400)
        self.assertFalse(get_user_model().objects.filter(username="hacker").exists())

    def test_duplicate_username_and_weak_password_are_rejected(self):
        self.signup()
        self.assertEqual(self.signup("FRONTIERPLAYER").status_code, 400)
        weak = {"username":"weakplayer","display_name":"Weak","region":"EU","password":"password","password_confirm":"password"}
        self.assertEqual(self.client.post("/api/v1/auth/signup/", weak, format="json", **self.csrf()).status_code, 400)
        with self.assertRaises(IntegrityError), transaction.atomic():
            get_user_model().objects.create_user(username="FRONTIERPLAYER", password=PASSWORD)

    def test_unregistered_legacy_players_and_teams_are_not_public(self):
        Player.objects.create(username="legacy",display_name="Legacy",region="NA",rating=2200)
        Team.objects.create(username="legacyteam",display_name="Legacy Team",tag="OLD",region="NA")
        self.assertEqual(self.client.get("/api/v1/rankings/").json()["total"], 0)
        self.assertEqual(self.client.get("/api/v1/teams/rankings/").json()["total"], 0)
        self.assertEqual(self.client.get("/api/v1/players/legacy/").status_code, 404)
        self.signup()
        self.assertEqual(self.client.get("/api/v1/rankings/").json()["players"][0]["rank"], 1)

    def test_player_cannot_enter_developer_login_or_api(self):
        self.signup()
        self.assertEqual(self.client.get("/api/v1/dev/dashboard/").status_code, 403)
        self.assertEqual(self.client.post("/api/v1/auth/dev-login/", {"username":"frontierplayer","password":PASSWORD}, format="json", **self.csrf()).status_code, 400)
        self.assertEqual(self.client.post("/api/v1/dev/players/", {}, format="json", **self.csrf()).status_code, 403)

    def test_developer_login_provisioning_and_remove_restore_are_authorized(self):
        self.developer()
        response = self.client.post("/api/v1/auth/dev-login/", {"username":"developer","password":PASSWORD}, format="json", **self.csrf())
        self.assertTrue(response.json()["user"]["is_developer"])
        body={"username":"provisioned","display_name":"Provisioned","region":"EU","password":PASSWORD,"password_confirm":PASSWORD}
        created = self.client.post("/api/v1/dev/players/", body, format="json", **self.csrf())
        self.assertEqual(created.status_code, 201)
        player_id=created.json()["id"]
        self.assertEqual(self.client.delete(f"/api/v1/dev/players/{player_id}/", **self.csrf()).status_code, 200)
        self.assertEqual(self.client.get("/api/v1/rankings/").json()["total"], 0)
        self.assertEqual(self.client.patch(f"/api/v1/dev/players/{player_id}/", {"is_active":True}, format="json", **self.csrf()).status_code, 200)
        self.assertEqual(self.client.get("/api/v1/rankings/").json()["total"], 1)
        self.assertFalse(get_user_model().objects.get(username="provisioned").is_staff)

    def test_team_registration_requires_registered_owner_and_roster_without_email(self):
        self.signup("captainplayer")
        other=APIClient(enforce_csrf_checks=True)
        self.signup("otherplayer", other)
        body={"request_key":str(uuid.uuid4()),"team_name":"New Crew","tag":"CREW","region":"NA","captain_username":"captainplayer","members":[{"username":"captainplayer","display_name":"Captain"},{"username":"unregistered","display_name":"Unknown"}]}
        self.assertEqual(self.client.post("/api/v1/teams/register/", body, format="json", **self.csrf()).status_code,400)
        body["members"][1]["username"]="otherplayer"
        created=self.client.post("/api/v1/teams/register/",body,format="json",**self.csrf())
        self.assertEqual(created.status_code,201)
        registration_id=created.json()["id"]
        self.assertFalse(hasattr(TeamRegistration.objects.get(pk=registration_id),"contact_email"))
        self.assertEqual(other.get(f"/api/v1/teams/registrations/{registration_id}/").status_code,404)
        other.logout()
        self.assertEqual(other.post("/api/v1/teams/register/",body,format="json").status_code,403)
        developer=APIClient(enforce_csrf_checks=True)
        self.developer()
        developer.post("/api/v1/auth/dev-login/",{"username":"developer","password":PASSWORD},format="json",**self.csrf(developer))
        reviewed=developer.post(f"/api/v1/dev/registrations/{registration_id}/review/",{"decision":"APPROVED","note":"Verified"},format="json",**self.csrf(developer))
        self.assertEqual(reviewed.status_code,200)
        teams=self.client.get("/api/v1/teams/rankings/").json()
        self.assertEqual(teams["total"],1)
        team_id=teams["teams"][0]["id"]
        self.assertEqual(developer.delete(f"/api/v1/dev/teams/{team_id}/",**self.csrf(developer)).status_code,200)
        self.assertEqual(self.client.get("/api/v1/teams/rankings/").json()["total"],0)

    def test_create_dev_command_has_no_public_signup_or_default_password(self):
        with patch("sys.stdin",io.StringIO(PASSWORD+"\n")):
            call_command("create_dev",username="consoledev",password_stdin=True,stdout=io.StringIO())
        user=get_user_model().objects.get(username="consoledev")
        self.assertTrue(user.is_staff)
        self.assertTrue(user.has_perm("accounts.access_dev_console"))
        self.assertTrue(user.has_perm("teams.approve_teamregistration"))
        self.assertTrue(user.check_password(PASSWORD))
