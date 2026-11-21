from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import AuditEntry
from rankings.models import Player
from .models import FactionAudio, Team, TeamMembership

MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + bytes(range(256)) * 4


class FactionAudioTests(TestCase):
    def setUp(self):
        cache.clear()
        self.leader = self.player("leader")
        self.member = self.player("member")
        self.team = Team.objects.create(username="frontier", display_name="Frontier", tag="FT", region="NA", owner=self.leader.user, registered_at=timezone.now())
        TeamMembership.objects.create(team=self.team, player=self.leader, is_captain=True)
        self.owner = APIClient()
        self.owner.force_authenticate(self.leader.user)
        self.url = "/api/v1/factions/frontier/audio/"

    def player(self, name):
        user = get_user_model().objects.create(username=name, password="!")
        return Player.objects.create(user=user, username=name, display_name=name.title(), region="NA", registered_at=timezone.now())

    def upload(self, client=None, data=MP3, name="theme.mp3", **extra):
        return (client or self.owner).post(self.url, {"audio": SimpleUploadedFile(name, data, content_type="audio/mpeg"), **extra}, format="multipart")

    def test_owner_uploads_track_shown_on_public_profile_and_served_with_ranges(self):
        response = self.upload(title="  War Drums ")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["audio_title"], "War Drums")
        profile = APIClient().get("/api/v1/factions/frontier/").json()
        self.assertEqual(profile["audio_url"], body["audio_url"])
        served = APIClient().get(body["audio_url"])
        self.assertEqual((served.status_code, served["Content-Type"], served.content), (200, "audio/mpeg", MP3))
        self.assertEqual(served["Accept-Ranges"], "bytes")
        part = APIClient().get(body["audio_url"], HTTP_RANGE="bytes=10-19")
        self.assertEqual((part.status_code, part["Content-Range"], part.content), (206, f"bytes 10-19/{len(MP3)}", MP3[10:20]))
        tail = APIClient().get(body["audio_url"], HTTP_RANGE="bytes=-5")
        self.assertEqual(tail.content, MP3[-5:])
        self.assertEqual(APIClient().get(body["audio_url"], HTTP_RANGE=f"bytes={len(MP3)}-").status_code, 416)
        self.assertTrue(AuditEntry.objects.filter(action="faction.audio.updated").exists())

    def test_only_owner_can_upload_and_files_are_validated_by_content(self):
        member = APIClient()
        member.force_authenticate(self.member.user)
        self.assertEqual(self.upload(member).status_code, 404)
        self.assertEqual(self.upload(APIClient()).status_code, 403)
        self.assertEqual(self.upload(data=b"<html>" + b"x" * 200, name="fake.mp3").status_code, 400)
        self.assertEqual(self.upload(data=b"ID3" + b"\x00" * (8 * 1024 * 1024)).status_code, 400)
        self.assertEqual(self.owner.post(self.url, {"title": "No track"}, format="multipart").status_code, 400)
        self.assertFalse(FactionAudio.objects.exists())

    def test_replace_retitle_and_remove(self):
        first = self.upload().json()["audio_url"]
        ogg = b"OggS" + b"\x00" * 200
        second = self.upload(data=ogg, name="theme.ogg").json()["audio_url"]
        self.assertNotEqual(first, second)
        self.assertEqual(FactionAudio.objects.count(), 1)
        self.assertEqual(APIClient().get(first).status_code, 404)
        self.assertEqual(APIClient().get(second)["Content-Type"], "audio/ogg")
        retitled = self.owner.post(self.url, {"title": "Anthem"}, format="multipart").json()
        self.assertEqual((retitled["audio_url"], retitled["audio_title"]), (second, "Anthem"))
        removed = self.owner.post(self.url, {"remove": "true"}, format="multipart").json()
        self.assertEqual(removed, {"audio_url": "", "audio_title": ""})
        self.assertFalse(FactionAudio.objects.exists())
        self.assertEqual(APIClient().get(second).status_code, 404)
