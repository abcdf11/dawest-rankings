import io
from unittest.mock import patch

from PIL import Image, ImageDraw
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from rankings.models import Player, ProfileMedia, RankingState
from rankings.profile_images import MAX_UPLOAD_BYTES


def png(size=(300, 100), color=(240, 120, 30)):
    image = Image.new("RGB", size, color)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return SimpleUploadedFile("picture.png", output.getvalue(), content_type="image/png")


def gif(count=3):
    colors = [(240, 40, 40), (30, 220, 50), (40, 70, 240)]
    images = [Image.new("RGB", (96, 48), colors[i % 3]) for i in range(count)]
    output = io.BytesIO()
    images[0].save(output, format="GIF", save_all=True, append_images=images[1:], duration=[80, 140, 220] if count == 3 else 80, loop=3, disposal=2)
    return SimpleUploadedFile("banner.gif", output.getvalue(), content_type="image/gif")


@override_settings(USE_REDIS=False)
class AppearanceTests(TestCase):
    endpoint = "/api/v1/auth/profile/appearance/"

    def setUp(self):
        cache.clear()
        self.owner = get_user_model().objects.create(username="imageowner", password="!")
        self.other = get_user_model().objects.create(username="otherplayer", password="!")
        self.player = Player.objects.create(user=self.owner, username="imageowner", display_name="Image Owner", region="NA", registered_at=timezone.now())
        self.other_player = Player.objects.create(user=self.other, username="otherplayer", display_name="Other Player", region="EU", registered_at=timezone.now())
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def upload(self, **files):
        response = self.client.post(self.endpoint, files, format="multipart")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_static_image_is_center_cropped_and_resized_and_stored_in_database(self):
        image = Image.new("RGB", (300, 100), (255, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle((100, 0, 199, 99), fill=(0, 255, 0))
        draw.rectangle((200, 0, 299, 99), fill=(0, 0, 255))
        output = io.BytesIO()
        image.save(output, format="PNG")
        result = self.upload(avatar=SimpleUploadedFile("wide.png", output.getvalue(), content_type="image/png"))
        media = ProfileMedia.objects.get(player=self.player, kind="avatar")
        fitted = Image.open(io.BytesIO(bytes(media.data)))
        self.assertEqual(fitted.size, (256, 256))
        self.assertEqual(fitted.format, "WEBP")
        self.assertGreater(fitted.convert("RGB").getpixel((128, 128))[1], 240)
        self.assertIn("/players/imageowner/media/avatar/", result["avatar_url"])
        self.other_player.refresh_from_db()
        self.assertEqual(self.other_player.avatar_version, "")
        detail = self.client.get("/api/v1/players/imageowner/").json()
        ladder = self.client.get("/api/v1/rankings/").json()
        self.assertEqual(detail["avatar_url"], result["avatar_url"])
        self.assertEqual(ladder["players"][0]["avatar_url"], result["avatar_url"])
        self.assertEqual(detail["rating"], 1500)

    def test_gif_frames_duration_loop_and_still_poster_survive_resizing(self):
        result = self.upload(avatar=gif(), banner=gif())
        for kind, expected in (("avatar", (256, 256)), ("banner", (1280, 240))):
            media = ProfileMedia.objects.get(player=self.player, kind=kind)
            animated = Image.open(io.BytesIO(bytes(media.data)))
            self.assertEqual(animated.size, expected)
            self.assertEqual(animated.n_frames, 3)
            self.assertEqual(animated.info["loop"], 3)
            durations = []
            colors = []
            for index in range(animated.n_frames):
                animated.seek(index)
                durations.append(animated.info["duration"])
                colors.append(animated.convert("RGB").getpixel((expected[0] // 2, expected[1] // 2)))
            self.assertEqual(durations, [80, 140, 220])
            self.assertNotEqual(colors[0], colors[1])
            poster = self.client.get(result[f"{kind}_url"] + "?still=1")
            self.assertEqual(poster.status_code, 200)
            self.assertEqual(poster["Content-Type"], "image/webp")
            self.assertEqual(Image.open(io.BytesIO(poster.content)).size, expected)

    def test_gif_transparency_is_preserved(self):
        frames = []
        for color in (1, 2):
            frame = Image.new("P", (64, 64), 0)
            frame.putpalette([0, 0, 0, 255, 0, 0, 0, 255, 0] + [0] * (768 - 9))
            ImageDraw.Draw(frame).rectangle((16, 16, 47, 47), fill=color)
            frames.append(frame)
        output = io.BytesIO()
        frames[0].save(output, format="GIF", save_all=True, append_images=frames[1:], duration=100, loop=0, transparency=0, disposal=2)
        self.upload(avatar=SimpleUploadedFile("transparent.gif", output.getvalue(), content_type="image/gif"))
        media = ProfileMedia.objects.get(player=self.player)
        image = Image.open(io.BytesIO(bytes(media.data)))
        self.assertEqual(image.n_frames, 2)
        for index in range(2):
            image.seek(index)
            rgba = image.convert("RGBA")
            self.assertEqual(rgba.getpixel((0, 0))[3], 0)
            self.assertEqual(rgba.getpixel((128, 128))[3], 255)

    def test_exif_orientation_is_applied_and_private_metadata_is_removed(self):
        image = Image.new("RGB", (80, 40), (255, 0, 0))
        ImageDraw.Draw(image).rectangle((40, 0, 79, 39), fill=(0, 0, 255))
        exif = Image.Exif()
        exif[274] = 6
        exif[270] = "private metadata"
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=100, exif=exif)
        self.upload(avatar=SimpleUploadedFile("rotated.jpg", output.getvalue(), content_type="image/jpeg"))
        media = ProfileMedia.objects.get(player=self.player)
        fitted = Image.open(io.BytesIO(bytes(media.data)))
        self.assertGreater(fitted.convert("RGB").getpixel((128, 32))[0], 200)
        self.assertGreater(fitted.convert("RGB").getpixel((128, 224))[2], 200)
        self.assertFalse(fitted.getexif())

    def test_public_images_support_image_accept_headers_head_and_conditional_cache(self):
        url = self.upload(avatar=png())["avatar_url"]
        anonymous = APIClient()
        response = anonymous.get(url, HTTP_ACCEPT="image/webp")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertIn("immutable", response["Cache-Control"])
        self.assertEqual(anonymous.head(url).content, b"")
        self.assertEqual(int(anonymous.head(url)["Content-Length"]), len(response.content))
        self.assertEqual(anonymous.get(url, HTTP_IF_NONE_MATCH=response["ETag"]).status_code, 304)
        self.assertEqual(anonymous.get(url, HTTP_IF_NONE_MATCH="W/" + response["ETag"]).status_code, 304)

    def test_replacement_and_removal_do_not_accumulate_old_files(self):
        first = self.upload(avatar=png(), banner=gif())
        second = self.upload(avatar=png(color=(0, 0, 255)))
        self.assertNotEqual(first["avatar_url"], second["avatar_url"])
        self.assertEqual(ProfileMedia.objects.filter(player=self.player).count(), 2)
        self.assertEqual(self.client.get(first["avatar_url"]).status_code, 404)
        removed = self.upload(remove_avatar="true", remove_banner="true")
        self.assertEqual(removed, {"avatar_url": "", "banner_url": ""})
        self.assertFalse(ProfileMedia.objects.exists())
        self.assertEqual(self.client.get(first["banner_url"]).status_code, 404)

    def test_anonymous_upload_and_missing_csrf_are_denied(self):
        anonymous = APIClient(enforce_csrf_checks=True)
        self.assertEqual(anonymous.post(self.endpoint, {"avatar": png()}, format="multipart").status_code, 403)
        anonymous.force_login(self.owner)
        self.assertEqual(anonymous.post(self.endpoint, {"avatar": png()}, format="multipart").status_code, 403)
        anonymous.get("/api/v1/auth/session/")
        response = anonymous.post(self.endpoint, {"avatar": png()}, format="multipart", HTTP_X_CSRFTOKEN=anonymous.cookies["csrftoken"].value)
        self.assertEqual(response.status_code, 200)

    def test_players_can_only_change_their_own_images(self):
        self.client.force_authenticate(self.other)
        response = self.client.post(self.endpoint, {"avatar": png(), "player_id": self.player.pk}, format="multipart")
        self.assertEqual(response.status_code, 400)
        result = self.upload(avatar=png())
        self.assertIn("/players/otherplayer/", result["avatar_url"])
        self.player.refresh_from_db()
        self.assertEqual(self.player.avatar_version, "")
        self.assertFalse(ProfileMedia.objects.filter(player=self.player).exists())

    def test_unregistered_and_disabled_players_cannot_publish_images(self):
        url = self.upload(avatar=png())["avatar_url"]
        self.player.is_active = False
        self.player.save(update_fields=["is_active"])
        self.assertEqual(self.client.post(self.endpoint, {"avatar": png()}, format="multipart").status_code, 404)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_invalid_image_leaves_both_existing_images_unchanged(self):
        first = self.upload(avatar=png())
        old_revision = RankingState.objects.get(pk=1).revision
        response = self.client.post(self.endpoint, {"avatar": png(color=(0, 0, 255)), "banner": SimpleUploadedFile("fake.gif", b"<svg onload='bad'></svg>", content_type="image/gif")}, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.player.refresh_from_db()
        self.assertEqual(self.player.profile_avatar_url, first["avatar_url"])
        self.assertEqual(RankingState.objects.get(pk=1).revision, old_revision)

    def test_upload_size_and_animation_length_are_bounded(self):
        oversized = SimpleUploadedFile("big.png", b"x" * (MAX_UPLOAD_BYTES + 1), content_type="image/png")
        self.assertEqual(self.client.post(self.endpoint, {"avatar": oversized}, format="multipart").status_code, 400)
        self.assertEqual(self.client.post(self.endpoint, {"banner": gif(121)}, format="multipart").status_code, 400)
        self.assertFalse(ProfileMedia.objects.exists())

    def test_pixel_budget_is_checked_before_large_resizing(self):
        with patch("rankings.profile_images.MAX_SOURCE_PIXELS", 100):
            self.assertEqual(self.client.post(self.endpoint, {"avatar": png()}, format="multipart").status_code, 400)
        self.assertFalse(ProfileMedia.objects.exists())
