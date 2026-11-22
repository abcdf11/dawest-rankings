import io
from datetime import timedelta

from PIL import Image
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import CompetitionEvent, EventInterest, EventLogo, EventNotification, Player


class EventInterestTests(TestCase):
    def setUp(self):
        cache.clear()
        self.now = timezone.now()
        User = get_user_model()
        self.admin = User.objects.create(username="eventdev", is_staff=True)
        self.admin.user_permissions.add(Permission.objects.get(codename="access_dev_console"))
        self.dev = APIClient()
        self.dev.force_authenticate(self.admin)
        self.event = CompetitionEvent.objects.create(title="Winter Cup", starts_at=self.now + timedelta(days=1), is_published=True)
        self.user = User.objects.create(username="fan")
        self.other = User.objects.create(username="otherfan")
        for user in (self.user, self.other):
            Player.objects.create(user=user, username=user.username, display_name=user.username, registered_at=self.now)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.base = f"/api/v1/events/{self.event.pk}/"
        self.manage = f"/api/v1/dev/events/{self.event.pk}/"

    def follow(self, client=None):
        return (client or self.client).post(self.base + "interested/")

    def inbox(self, client=None):
        return (client or self.client).get("/api/v1/event-notifications/").json()

    def test_interest_is_idempotent_private_per_account_and_survives_new_session(self):
        for _ in range(2):
            self.assertEqual(self.follow().json(), {"interested_count": 1, "is_interested": True})
        self.assertEqual(EventInterest.objects.count(), 1)
        public = APIClient().get(self.base).json()
        self.assertEqual(public["interested_count"], 1)
        self.assertFalse(public["is_interested"])
        fresh = APIClient()
        fresh.force_authenticate(self.user)
        self.assertTrue(fresh.get(self.base).json()["is_interested"])
        self.assertTrue(fresh.get("/api/v1/events/").json()["events"][0]["is_interested"])
        self.assertNotIn("user", public)
        self.assertEqual(fresh.delete(self.base + "interested/").json()["interested_count"], 0)
        self.assertEqual(fresh.delete(self.base + "interested/").status_code, 200)

    def test_only_active_registered_players_can_follow_public_active_events(self):
        self.assertEqual(self.follow(APIClient()).status_code, 403)
        self.assertEqual(self.follow(self.dev).status_code, 404)
        for field, value in (("is_published", False), ("status", "CANCELLED"), ("status", "COMPLETED")):
            CompetitionEvent.objects.filter(pk=self.event.pk).update(is_published=True, status="UPCOMING")
            CompetitionEvent.objects.filter(pk=self.event.pk).update(**{field: value})
            self.assertEqual(self.follow().status_code, 404 if field == "is_published" else 409)
        CompetitionEvent.objects.filter(pk=self.event.pk).update(status="UPCOMING")
        Player.objects.filter(user=self.user).update(is_active=False)
        self.assertEqual(self.follow().status_code, 404)

    def test_updates_notify_followers_once_and_unsubscribe_stops_future_notices(self):
        self.follow()
        self.assertEqual(self.dev.patch(self.manage, {"location": "Arena"}, format="json").status_code, 200)
        self.assertEqual(self.inbox()["unread_count"], 1)
        # A save with the same values is not another event change.
        self.dev.patch(self.manage, {"location": "Arena"}, format="json")
        self.assertEqual(self.inbox()["unread_count"], 1)
        self.dev.patch(self.manage, {"starts_at": (self.now + timedelta(days=2)).isoformat()}, format="json")
        self.assertIn("schedule", self.inbox()["notifications"][0]["message"])
        self.client.delete(self.base + "interested/")
        self.dev.patch(self.manage, {"status": "CANCELLED"}, format="json")
        self.assertEqual(self.inbox()["unread_count"], 2)
        other = APIClient()
        other.force_authenticate(self.other)
        self.assertEqual(self.inbox(other)["unread_count"], 0)

    def test_cancellation_and_start_notices_are_durable_and_deduplicated(self):
        self.follow()
        CompetitionEvent.objects.filter(pk=self.event.pk).update(starts_at=self.now - timedelta(minutes=1))
        first = self.inbox()
        self.assertEqual(first["unread_count"], 1)
        self.assertIn("is live", first["notifications"][0]["message"])
        self.assertEqual(self.inbox()["unread_count"], 1)
        self.dev.patch(self.manage, {"status": "CANCELLED"}, format="json")
        self.assertIn("cancelled", self.inbox()["notifications"][0]["message"])
        self.assertEqual(EventNotification.objects.count(), 2)
        # Leaving an ended or cancelled event is still allowed.
        self.assertEqual(self.client.delete(self.base + "interested/").status_code, 200)

    def test_drafts_and_ineligible_accounts_do_not_leak_in_feed_or_interest_count(self):
        self.follow()
        Player.objects.filter(user=self.user).update(is_active=False)
        self.assertEqual(APIClient().get(self.base).json()["interested_count"], 0)
        self.dev.patch(self.manage, {"location": "Arena"}, format="json")
        self.assertFalse(EventNotification.objects.exists())
        Player.objects.filter(user=self.user).update(is_active=True)
        self.dev.patch(self.manage, {"location": "Second arena"}, format="json")
        self.assertEqual(self.inbox()["unread_count"], 1)
        self.dev.delete(self.manage)
        self.assertEqual(self.inbox()["notifications"], [])

    def test_read_actions_cannot_touch_another_users_notifications(self):
        self.follow()
        self.dev.patch(self.manage, {"description": "New rules"}, format="json")
        own = EventNotification.objects.get()
        foreign = EventNotification.objects.create(event=self.event, user=self.other, key="private", message="Other user")
        response = self.client.post("/api/v1/event-notifications/read/", {"ids": [own.pk, foreign.pk]}, format="json")
        self.assertEqual(response.status_code, 200)
        own.refresh_from_db()
        foreign.refresh_from_db()
        self.assertIsNotNone(own.read_at)
        self.assertIsNone(foreign.read_at)
        self.assertEqual(self.inbox()["unread_count"], 0)
        self.assertEqual(APIClient().get("/api/v1/event-notifications/").status_code, 403)
        self.assertEqual(APIClient().post("/api/v1/event-notifications/read/", {"all": True}, format="json").status_code, 403)

    def test_start_notification_is_kept_when_player_returns_after_the_event_ends(self):
        self.follow()
        CompetitionEvent.objects.filter(pk=self.event.pk).update(starts_at=self.now - timedelta(hours=2), ends_at=self.now - timedelta(hours=1))
        notice = self.inbox()
        self.assertEqual(notice["unread_count"], 1)
        self.assertIn("has started", notice["notifications"][0]["message"])
        self.assertNotIn("is live", notice["notifications"][0]["message"])

    def test_interest_and_notification_writes_require_session_csrf(self):
        browser = APIClient(enforce_csrf_checks=True)
        browser.force_login(self.user)
        self.assertEqual(browser.post(self.base + "interested/").status_code, 403)
        browser.get("/api/v1/auth/session/")
        token = browser.cookies["csrftoken"].value
        self.assertEqual(browser.post(self.base + "interested/", HTTP_X_CSRFTOKEN=token).status_code, 200)
        self.assertEqual(browser.post("/api/v1/event-notifications/read/", {"all": True}, format="json").status_code, 403)


class EventLogoTests(TestCase):
    def setUp(self):
        EventInterestTests.setUp(self)
        self.dev.force_login(self.admin)

    def image(self, color="red"):
        data = io.BytesIO()
        Image.new("RGB", (400, 200), color).save(data, format="PNG")
        return SimpleUploadedFile("logo.png", data.getvalue(), content_type="image/png")

    def test_upload_fit_replace_remove_and_draft_visibility(self):
        response = self.dev.post("/api/v1/dev/events/", {"title": "Logo Cup", "starts_at": self.event.starts_at.isoformat(), "ends_at": "", "logo": self.image()}, format="multipart")
        self.assertEqual(response.status_code, 201, response.content)
        event = response.json()
        url = event["logo_url"]
        self.assertTrue(url)
        self.assertEqual(APIClient().get(url).status_code, 404)
        self.assertEqual(self.client.get(url).status_code, 404)
        image = self.dev.get(url)
        self.assertEqual(image.status_code, 200)
        self.assertEqual(Image.open(io.BytesIO(image.content)).size, (256, 256))
        self.assertEqual(self.dev.head(url)["Content-Length"], str(len(image.content)))
        self.assertEqual(self.dev.get(url, HTTP_IF_NONE_MATCH=image["ETag"]).status_code, 304)
        manage = f"/api/v1/dev/events/{event['id']}/"
        self.dev.patch(manage, {"is_published": True}, format="json")
        self.assertEqual(APIClient().get(url).status_code, 200)
        replacement = self.dev.patch(manage, {"logo": self.image("blue")}, format="multipart")
        self.assertEqual(replacement.status_code, 200)
        self.assertNotEqual(replacement.json()["logo_url"], url)
        self.assertEqual(APIClient().get(url).status_code, 404)
        removed = self.dev.patch(manage, {"remove_logo": True}, format="json")
        self.assertEqual(removed.json()["logo_url"], "")
        self.assertFalse(EventLogo.objects.filter(event_id=event["id"]).exists())

    def test_invalid_or_unauthorized_images_do_not_partially_save_event(self):
        bad = SimpleUploadedFile("fake.png", b"not an image", content_type="image/png")
        response = self.dev.patch(self.manage, {"title": "Unwanted edit", "logo": bad}, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.event.refresh_from_db()
        self.assertEqual(self.event.title, "Winter Cup")
        self.assertEqual(self.client.patch(self.manage, {"logo": self.image()}, format="multipart").status_code, 403)
        self.assertEqual(self.dev.patch(self.manage, {"logo": self.image(), "remove_logo": True}, format="multipart").status_code, 400)

    def test_animated_logo_has_a_reduced_motion_poster(self):
        data = io.BytesIO()
        Image.new("RGB", (40, 20), "red").save(data, format="GIF", save_all=True,
            append_images=[Image.new("RGB", (40, 20), "blue")], duration=100, loop=0)
        upload = SimpleUploadedFile("logo.gif", data.getvalue(), content_type="image/gif")
        response = self.dev.patch(self.manage, {"logo": upload}, format="multipart")
        self.assertEqual(response.status_code, 200)
        url = response.json()["logo_url"]
        animated = APIClient().get(url)
        self.assertEqual(animated["Content-Type"], "image/gif")
        self.assertEqual(Image.open(io.BytesIO(animated.content)).n_frames, 2)
        poster = APIClient().get(url + "?still=1")
        self.assertEqual(poster["Content-Type"], "image/webp")
        self.assertEqual(Image.open(io.BytesIO(poster.content)).size, (256, 256))
