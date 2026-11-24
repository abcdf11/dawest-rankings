from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Article

URL = "/api/v1/news/"


class NewsTests(TestCase):
    def setUp(self):
        cache.clear()
        users = get_user_model().objects
        self.writer = users.create_user(username="newsdesk", password="Frontier!River87956")
        self.writer.user_permissions.add(Permission.objects.get(codename="publish_article"))
        self.reader = users.create_user(username="reader", password="Frontier!River87956")
        self.desk = APIClient()
        self.desk.force_authenticate(self.writer)

    def post(self, **extra):
        body = {"title": "Season Two Opens", "summary": "New maps.", "body": "Line one.\n\nLine two.", "is_published": True, **extra}
        return self.desk.post(URL, body, format="json")

    def test_news_account_publishes_and_everyone_reads(self):
        res = self.post()
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["slug"], "season-two-opens")
        listing = APIClient().get(URL).json()
        self.assertEqual([a["title"] for a in listing["articles"]], ["Season Two Opens"])
        self.assertNotIn("body", listing["articles"][0])
        self.assertFalse(listing["can_post"])
        self.assertEqual(APIClient().get(URL + "season-two-opens/").json()["body"], "Line one.\n\nLine two.")

    def test_drafts_are_hidden_from_readers(self):
        self.post(is_published=False)
        self.assertEqual(APIClient().get(URL).json()["articles"], [])
        self.assertEqual(APIClient().get(URL + "season-two-opens/").status_code, 404)
        self.assertEqual(len(self.desk.get(URL).json()["articles"]), 1)

    def test_only_news_accounts_write(self):
        other = APIClient()
        other.force_authenticate(self.reader)
        body = {"title": "Fake news", "body": "x"}
        self.assertEqual(other.post(URL, body, format="json").status_code, 403)
        self.assertEqual(APIClient().post(URL, body, format="json").status_code, 403)
        self.post()
        self.assertEqual(other.patch(URL + "season-two-opens/", {"title": "Hacked"}, format="json").status_code, 403)
        self.assertEqual(other.delete(URL + "season-two-opens/").status_code, 403)

    def test_edit_publish_and_delete(self):
        self.post(is_published=False)
        res = self.desk.patch(URL + "season-two-opens/", {"title": "Season Two Is Live", "is_published": True}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["slug"], "season-two-is-live")
        self.assertIsNotNone(Article.objects.get().published_at)
        self.assertEqual(self.desk.delete(URL + "season-two-is-live/").status_code, 204)
        self.assertFalse(Article.objects.exists())

    def test_duplicate_titles_get_unique_slugs(self):
        self.post()
        self.assertEqual(self.post().json()["slug"], "season-two-opens-2")

    def test_session_flags_news_accounts(self):
        client = APIClient()
        client.force_login(self.writer)
        self.assertTrue(client.get("/api/v1/auth/session/").json()["user"]["can_post_news"])
        client.force_login(self.reader)
        self.assertFalse(client.get("/api/v1/auth/session/").json()["user"]["can_post_news"])
