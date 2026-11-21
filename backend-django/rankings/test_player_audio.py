from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import AuditEntry
from .models import Player, PlayerAudio

MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + bytes(range(256)) * 4
URL = "/api/v1/auth/profile/audio/"


class PlayerAudioTests(TestCase):
    def setUp(self):
        cache.clear()
        self.player = self.make("singer")
        self.other = self.make("listener")
        self.client = APIClient()
        self.client.force_authenticate(self.player.user)

    def make(self, name):
        user = get_user_model().objects.create(username=name, password="!")
        return Player.objects.create(user=user, username=name, display_name=name.title(), region="NA", registered_at=timezone.now())

    def upload(self, client=None, data=MP3, **extra):
        return (client or self.client).post(URL, {"audio": SimpleUploadedFile("t.mp3", data), **extra}, format="multipart")

    def test_player_uploads_own_track_shown_on_profile_with_range_serving(self):
        body = self.upload(title="My Song").json()
        self.assertEqual(body["audio_title"], "My Song")
        profile = APIClient().get("/api/v1/players/singer/").json()
        self.assertEqual((profile["audio_url"], profile["audio_title"]), (body["audio_url"], "My Song"))
        self.assertEqual(APIClient().get(body["audio_url"]).content, MP3)
        part = APIClient().get(body["audio_url"], HTTP_RANGE="bytes=0-3")
        self.assertEqual((part.status_code, part.content), (206, MP3[:4]))
        self.assertEqual(APIClient().get("/api/v1/players/listener/").json()["audio_url"], "")
        self.assertTrue(AuditEntry.objects.filter(action="profile.audio.updated", target_type="player").exists())

    def test_session_decides_owner_and_content_is_validated(self):
        self.assertEqual(self.upload(APIClient()).status_code, 403)
        self.assertEqual(self.upload(data=b"not audio" * 20).status_code, 400)
        self.assertEqual(self.client.post(URL, {"title": "x"}, format="multipart").status_code, 400)
        self.assertEqual(self.client.post(URL, {"audio": SimpleUploadedFile("t.mp3", MP3), "player": "listener"}, format="multipart").status_code, 400)
        self.assertFalse(PlayerAudio.objects.exists())
        self.assertEqual(self.client.post(URL, {"title": "x"}, format="multipart").status_code, 400)
        self.player.refresh_from_db()
        self.assertEqual(self.player.audio_title, "")

    def test_remove_and_hidden_when_player_deactivated(self):
        url = self.upload().json()["audio_url"]
        Player.objects.filter(pk=self.player.pk).update(is_active=False)
        self.assertEqual(APIClient().get(url).status_code, 404)
        Player.objects.filter(pk=self.player.pk).update(is_active=True)
        self.assertEqual(self.client.post(URL, {"remove": "true"}, format="multipart").json(), {"audio_url": "", "audio_title": ""})
        self.assertFalse(PlayerAudio.objects.exists())
