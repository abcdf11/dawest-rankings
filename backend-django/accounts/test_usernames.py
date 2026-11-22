import uuid
import io
import os
from unittest.mock import patch
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command, CommandError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from rankings.models import CompetitionEvent, EventEntry, EventInterest, Player, PlayerAudio, ProfileMedia, RatingHistory
from teams.models import RegistrationMember, Team, TeamMembership, TeamRegistration
from teams.registration import review_registration
from .models import AccountSession, AuditEntry, UsernameAlias


@override_settings(USE_REDIS=False, PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class UsernameTests(TestCase):
    def setUp(self):
        cache.clear()
        self.now = timezone.now()
        self.user = get_user_model().objects.create_user(username="oldname", password="Frontier!87956")
        self.player = Player.objects.create(user=self.user, username="oldname", display_name="Original Name",
            region="NA", registered_at=self.now, rating=1734, wins=8, losses=2)
        self.other = get_user_model().objects.create_user(username="othername", password="Frontier!87956")
        self.other_player = Player.objects.create(user=self.other, username="othername", display_name="Other",
            region="EU", registered_at=self.now)
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(self.user)
        AccountSession.objects.create(user=self.user, session_key=self.client.session.session_key)

    def rename(self, username, client=None, **extra):
        client = client or self.client
        client.get("/api/v1/auth/session/")
        return client.post("/api/v1/auth/username/", {"username": username, **extra}, format="json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)

    def test_changes_login_and_profile_username_and_keeps_session_stats_team_and_event_entries(self):
        history = RatingHistory.objects.create(player=self.player, rating=1734, rank=1, event_label="Match win")
        team = Team.objects.create(username="wolves", display_name="Wolves", tag="WLF", region="NA", owner=self.user, registered_at=self.now)
        membership = TeamMembership.objects.create(team=team, player=self.player, is_captain=True)
        event = CompetitionEvent.objects.create(title="Cup", format="FACTION", starts_at=self.now + timedelta(days=1), is_published=True)
        entry = EventEntry.objects.create(event=event, team=team, registered_by=self.user)
        interest = EventInterest.objects.create(event=event, user=self.user)
        # Populate the old cached ladder before the rename.
        self.assertEqual(self.client.get("/api/v1/rankings/").json()["players"][0]["username"], "oldname")
        response = self.rename("New_Name")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["user"]["username"], "new_name")
        self.assertEqual(response.json()["profile_url"], "/players/new_name")
        self.user.refresh_from_db()
        self.player.refresh_from_db()
        self.assertEqual(self.user.username, self.player.username)
        self.assertEqual((self.player.rating, self.player.wins, self.player.losses), (1734, 8, 2))
        self.assertEqual(self.player.display_name, "Original Name")
        self.assertEqual(self.client.get("/api/v1/auth/session/").json()["user"]["username"], "new_name")
        self.assertEqual(self.client.get("/api/v1/rankings/").json()["players"][0]["username"], "new_name")
        self.assertTrue(AccountSession.objects.filter(user=self.user, session_key=self.client.session.session_key).exists())
        self.assertTrue(TeamMembership.objects.filter(pk=membership.pk, player=self.player).exists())
        self.assertTrue(EventEntry.objects.filter(pk=entry.pk, registered_by=self.user).exists())
        self.assertTrue(EventInterest.objects.filter(pk=interest.pk, user=self.user).exists())
        self.assertTrue(RatingHistory.objects.filter(pk=history.pk, player=self.player, rating=1734).exists())
        self.assertEqual(self.client.get("/api/v1/factions/wolves/").json()["leader"]["username"], "new_name")
        login = APIClient()
        self.assertEqual(login.post("/api/v1/auth/login/", {"username": "oldname", "password": "Frontier!87956"}).status_code, 400)
        self.assertEqual(login.post("/api/v1/auth/login/", {"username": "NEW_NAME", "password": "Frontier!87956"}).status_code, 200)
        audit = AuditEntry.objects.get(action="account.username_changed")
        self.assertEqual(audit.details, {"previous_username": "oldname", "username": "new_name"})

    def test_old_profile_media_and_audio_links_still_work_and_respect_visibility(self):
        ProfileMedia.objects.create(player=self.player, kind="avatar", version="picture", content_type="image/webp",
            data=b"picture", byte_size=7, width=256, height=256)
        PlayerAudio.objects.create(player=self.player, version="song", content_type="audio/mpeg", data=b"ID3song", byte_size=7)
        self.player.avatar_version, self.player.audio_version = "picture", "song"
        self.player.save()
        self.assertEqual(self.rename("renamed").status_code, 200)
        public = APIClient()
        for name in ("oldname", "renamed"):
            self.assertEqual(public.get(f"/api/v1/players/{name}/").json()["username"], "renamed")
            self.assertEqual(public.get(f"/api/v1/players/{name}/media/avatar/picture/").content, b"picture")
            self.assertEqual(public.get(f"/api/v1/players/{name}/audio/song/").content, b"ID3song")
        self.player.is_active = False
        self.player.save(update_fields=["is_active"])
        for path in ("", "media/avatar/picture/", "audio/song/"):
            self.assertEqual(public.get(f"/api/v1/players/oldname/{path}").status_code, 404)

    def test_conflicts_and_reserved_old_names_cannot_be_claimed_by_another_account(self):
        for name in ("OTHERNAME", "othername"):
            self.assertEqual(self.rename(name).status_code, 409)
        Player.objects.create(username="legacy_reserved", display_name="Legacy", region="NA")
        self.assertEqual(self.rename("legacy_reserved").status_code, 409)
        self.assertEqual(self.rename("renamed").status_code, 200)
        other = APIClient()
        other.force_login(self.other)
        self.assertEqual(self.rename("OLDNAME", client=other).status_code, 409)
        response = APIClient().post("/api/v1/auth/signup/", {"username": "oldname", "display_name": "Impostor", "region": "NA", "password": "Frontier!87956", "password_confirm": "Frontier!87956"}, format="json")
        self.assertEqual(response.status_code, 400)
        with self.assertRaises(CommandError):
            call_command("create_dev", username="oldname", password_stdin=True)
        self.other.refresh_from_db()
        self.assertEqual(self.other.username, "othername")

    def test_can_return_to_owned_previous_name_and_noop_does_not_create_audit(self):
        self.assertEqual(self.rename("oldname").status_code, 200)
        self.assertFalse(AuditEntry.objects.filter(action="account.username_changed").exists())
        self.assertEqual(self.rename("secondname").status_code, 200)
        self.assertEqual(self.rename("oldname").status_code, 200)
        self.assertEqual(APIClient().get("/api/v1/players/secondname/").json()["username"], "oldname")
        self.assertTrue(UsernameAlias.objects.filter(user=self.user, username="secondname").exists())
        self.assertFalse(UsernameAlias.objects.filter(username="oldname").exists())

    def test_pending_rosters_can_still_be_approved_after_captain_and_member_rename(self):
        registration = TeamRegistration.objects.create(request_key=uuid.uuid4(), payload_hash="snapshot", team_name="New Wolves",
            tag="NWL", region="NA", captain_username="oldname", submitted_by=self.user)
        for position, user in enumerate((self.user, self.other)):
            RegistrationMember.objects.create(registration=registration, username=user.username, display_name=user.username,
                position=position, is_captain=position == 0)
        self.rename("newcaptain")
        other = APIClient()
        other.force_login(self.other)
        self.rename("newmember", client=other)
        registration.refresh_from_db()
        self.assertEqual(registration.captain_username, "newcaptain")
        self.assertEqual(list(registration.members.values_list("username", flat=True)), ["newcaptain", "newmember"])
        admin = get_user_model().objects.create_superuser(username="reviewer", password="Frontier!87956")
        approved = review_registration(registration.pk, admin, True)
        self.assertEqual(approved.team.owner_id, self.user.pk)
        self.assertEqual(set(approved.team.memberships.values_list("player_id", flat=True)), {self.player.pk, self.other_player.pk})
        self.rename("captainagain")
        registration.refresh_from_db()
        self.assertEqual(registration.captain_username, "newcaptain")

    def test_authentication_csrf_validation_and_own_account_scope(self):
        self.assertEqual(APIClient().post("/api/v1/auth/username/", {"username": "stolen"}).status_code, 403)
        self.assertEqual(self.client.post("/api/v1/auth/username/", {"username": "newname"}).status_code, 403)
        for name in ("ab", "contains space", "bad-name", "x" * 31, "", "name/../../other"):
            self.assertEqual(self.rename(name).status_code, 400)
        self.assertEqual(self.rename("newname", user_id=self.other.pk, is_staff=True).status_code, 400)
        malformed = self.client.post("/api/v1/auth/username/", [{"username": "newname"}], format="json",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value)
        self.assertEqual(malformed.status_code, 400)
        self.user.refresh_from_db()
        self.assertEqual(self.user.username, "oldname")
        self.assertFalse(self.user.is_staff)

    def test_developer_can_change_own_login_without_changing_permissions(self):
        dev = get_user_model().objects.create_superuser(username="owner", password="Frontier!87956")
        client = APIClient()
        client.force_login(dev)
        response = self.rename("newowner", client=client)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["profile_url"])
        self.assertTrue(response.json()["user"]["is_developer"])
        dev.refresh_from_db()
        self.assertTrue(dev.is_staff and dev.is_superuser)
        with patch.dict(os.environ, {"DAWEST_BOOTSTRAP_DEV_USERNAME": "owner", "DAWEST_BOOTSTRAP_DEV_PASSWORD": "Changed!Password87956"}):
            call_command("create_dev", from_env=True, stdout=io.StringIO())
        dev.refresh_from_db()
        self.assertEqual(dev.username, "newowner")
        self.assertTrue(dev.check_password("Frontier!87956"))
