import io
import uuid
from PIL import Image
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rankings.models import Player, RankingState
from .models import FactionJoinRequest, FactionMedia, RegistrationMember, Team, TeamMembership, TeamRegistration


class FactionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.leader = self.player("leader")
        self.candidate = self.player("candidate")
        self.other = self.player("otherleader")
        self.team = self.faction("frontier", self.leader, "FT")
        self.other_team = self.faction("rivals", self.other, "RV")
        self.client = APIClient()
        self.client.force_authenticate(self.candidate.user)
        self.root = "/api/v1/factions/frontier/"

    def player(self, name):
        user = get_user_model().objects.create(username=name, password="!")
        return Player.objects.create(user=user, username=name, display_name=name.title(), region="NA", registered_at=timezone.now())

    def faction(self, name, leader, tag):
        team = Team.objects.create(username=name, display_name=name.title(), tag=tag, region="NA", owner=leader.user, registered_at=timezone.now())
        TeamMembership.objects.create(team=team, player=leader, is_captain=True)
        return team

    def join(self, root=None, message="Ready to play."):
        response = self.client.post((root or self.root) + "join/", {"message": message}, format="json")
        self.assertIn(response.status_code, (200, 201), response.content)
        return response.json()

    def review(self, row, decision="ACCEPTED", root=None):
        self.client.force_authenticate(self.leader.user)
        return self.client.post((root or self.root) + f"requests/{row['id']}/review/", {"decision": decision}, format="json")

    def test_public_directory_and_profile_include_only_registered_active_factions(self):
        Team.objects.create(username="legacy", display_name="Legacy", tag="LG", region="NA")
        self.other_team.is_active = False
        self.other_team.save()
        anonymous = APIClient()
        listing = anonymous.get("/api/v1/factions/").json()["factions"]
        self.assertEqual([row["username"] for row in listing], ["frontier"])
        data = anonymous.get(self.root).json()
        self.assertEqual(data["leader"]["username"], "leader")
        self.assertEqual(data["profile_url"], "/factions/frontier")
        self.assertEqual(data["member_count"], 1)
        self.assertNotIn("requests", data)
        self.assertEqual(anonymous.get("/api/v1/factions/rivals/").status_code, 404)

    def test_private_dashboard_requires_the_actual_owner(self):
        row = self.join(message="Private request text.")
        self.assertEqual(self.client.get(self.root + "manage/").status_code, 404)
        self.assertEqual(APIClient().get(self.root + "manage/").status_code, 403)
        self.client.force_authenticate(self.leader.user)
        data = self.client.get(self.root + "manage/").json()
        self.assertEqual(data["requests"][0]["id"], row["id"])
        self.assertEqual(data["requests"][0]["message"], "Private request text.")
        self.assertNotIn("Private request text.", self.client.get(self.root).content.decode())

    def test_acceptance_is_idempotent_and_updates_membership_and_ladder_caches(self):
        row = self.join()
        self.client.get("/api/v1/rankings/")
        response = self.review(row)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.review(row).status_code, 200)
        self.assertEqual(TeamMembership.objects.filter(player=self.candidate).count(), 1)
        self.assertEqual(self.client.get(self.root).json()["member_count"], 2)
        ladder = self.client.get("/api/v1/rankings/").json()["players"]
        self.assertEqual(next(p for p in ladder if p["username"] == "candidate")["team"]["username"], "frontier")
        self.assertGreater(RankingState.objects.get(pk=1).revision, 0)

    def test_another_leader_cannot_review_or_change_images(self):
        row = self.join()
        self.client.force_authenticate(self.other.user)
        self.assertEqual(self.client.post(self.root + f"requests/{row['id']}/review/", {"decision": "ACCEPTED"}).status_code, 404)
        self.assertEqual(self.client.post(self.root + "appearance/", {"avatar": self.image()}, format="multipart").status_code, 404)
        self.assertFalse(FactionMedia.objects.exists())

    def test_accepting_one_faction_cancels_other_pending_requests(self):
        row = self.join()
        other = self.join("/api/v1/factions/rivals/")
        self.assertEqual(self.review(row).status_code, 200)
        self.assertEqual(FactionJoinRequest.objects.get(pk=other["id"]).status, "CANCELLED")
        self.client.force_authenticate(self.other.user)
        self.assertEqual(self.client.post(f"/api/v1/factions/rivals/requests/{other['id']}/review/", {"decision": "ACCEPTED"}).status_code, 409)

    def test_reject_withdraw_and_reapply_do_not_create_membership_or_duplicate_rows(self):
        row = self.join()
        self.assertEqual(self.review(row, "REJECTED").status_code, 200)
        self.client.force_authenticate(self.candidate.user)
        again = self.join()
        self.assertEqual(row["id"], again["id"])
        self.assertEqual(again["status"], "PENDING")
        self.assertEqual(self.client.post(f"/api/v1/factions/requests/{row['id']}/withdraw/").status_code, 200)
        self.assertEqual(self.review(row).status_code, 409)
        self.assertFalse(TeamMembership.objects.filter(player=self.candidate).exists())

    def test_request_owner_is_from_session_and_other_players_cannot_withdraw(self):
        row = self.join()
        self.client.force_authenticate(self.other.user)
        self.assertEqual(self.client.post(f"/api/v1/factions/requests/{row['id']}/withdraw/").status_code, 404)
        self.client.force_authenticate(self.candidate.user)
        self.assertEqual([r["id"] for r in self.client.get("/api/v1/factions/mine/").json()["requests"]], [row["id"]])

    def test_existing_members_cannot_join_another_faction(self):
        self.client.force_authenticate(self.leader.user)
        self.assertEqual(self.client.post("/api/v1/factions/rivals/join/", {}).status_code, 409)
        mine = self.client.get("/api/v1/factions/mine/").json()
        self.assertEqual(mine["membership"]["username"], "frontier")
        self.assertEqual(mine["owned"][0]["username"], "frontier")

    def test_capacity_is_checked_again_at_acceptance(self):
        row = self.join()
        for index in range(9):
            TeamMembership.objects.create(team=self.team, player=self.player(f"full{index}"))
        self.assertEqual(self.review(row).status_code, 409)
        self.assertEqual(FactionJoinRequest.objects.get(pk=row["id"]).status, "PENDING")
        self.assertFalse(TeamMembership.objects.filter(player=self.candidate).exists())
        self.client.force_authenticate(self.candidate.user)
        self.assertEqual(self.client.post(self.root + "join/", {}).status_code, 409)

    def test_pending_team_registration_reservation_blocks_join_and_acceptance(self):
        row = self.join()
        registration = TeamRegistration.objects.create(request_key=uuid.uuid4(), payload_hash="x", team_name="Reserved", tag="RES", region="NA", captain_username="candidate", submitted_by=self.candidate.user)
        RegistrationMember.objects.create(registration=registration, username="candidate", display_name="Candidate", position=0, is_captain=True)
        self.assertEqual(self.review(row).status_code, 409)
        self.client.force_authenticate(self.candidate.user)
        self.assertEqual(self.client.post(self.root + "join/", {}).status_code, 409)

    def test_only_owner_can_remove_others_and_leader_cannot_be_removed(self):
        TeamMembership.objects.create(team=self.team, player=self.candidate)
        self.client.force_authenticate(self.other.user)
        target = self.root + f"members/{self.candidate.pk}/remove/"
        self.assertEqual(self.client.post(target).status_code, 403)
        self.client.force_authenticate(self.leader.user)
        self.assertEqual(self.client.post(self.root + f"members/{self.leader.pk}/remove/").status_code, 409)
        self.assertEqual(self.client.post(target).status_code, 200)
        self.assertFalse(TeamMembership.objects.filter(player=self.candidate).exists())

    def test_non_leader_can_leave_and_inactive_members_are_hidden(self):
        TeamMembership.objects.create(team=self.team, player=self.candidate)
        self.assertEqual(self.client.post(self.root + f"members/{self.candidate.pk}/remove/").status_code, 200)
        TeamMembership.objects.create(team=self.team, player=self.candidate)
        self.candidate.is_active = False
        self.candidate.save()
        self.assertEqual(self.client.get(self.root).json()["member_count"], 1)
        self.assertEqual(len(self.client.get(self.root).json()["roster"]), 1)

    def image(self, animated=False):
        output = io.BytesIO()
        first = Image.new("RGB", (320, 90), "red")
        if animated:
            first.save(output, format="GIF", save_all=True, append_images=[Image.new("RGB", (320, 90), "blue")], duration=[80, 140], loop=0)
        else:
            first.save(output, format="PNG")
        return SimpleUploadedFile("image.gif" if animated else "image.png", output.getvalue())

    def test_leader_images_are_fitted_animated_and_persist_in_database(self):
        self.client.force_authenticate(self.leader.user)
        result = self.client.post(self.root + "appearance/", {"avatar": self.image(), "banner": self.image(True)}, format="multipart")
        self.assertEqual(result.status_code, 200, result.content)
        urls = result.json()
        for kind, size in (("logo", (256, 256)), ("banner", (1280, 240))):
            media = FactionMedia.objects.get(team=self.team, kind=kind)
            image = Image.open(io.BytesIO(bytes(media.data)))
            self.assertEqual(image.size, size)
            if kind == "banner":
                self.assertEqual(image.n_frames, 2)
                image.seek(1)
                self.assertEqual(image.info["duration"], 140)
        anonymous = APIClient()
        response = anonymous.get(urls["banner_url"], HTTP_ACCEPT="image/avif,image/webp,image/*,*/*;q=0.8")
        self.assertEqual(response["Content-Type"], "image/gif")
        self.assertEqual(anonymous.get(urls["banner_url"] + "?still=1")["Content-Type"], "image/webp")
        self.assertEqual(anonymous.get(urls["avatar_url"], HTTP_IF_NONE_MATCH=anonymous.get(urls["avatar_url"])["ETag"]).status_code, 304)
        self.assertEqual(anonymous.get(self.root).json()["avatar_url"], urls["avatar_url"])
        self.assertEqual(anonymous.get("/api/v1/teams/frontier/").json()["avatar_url"], urls["avatar_url"])
        self.assertEqual(anonymous.get("/api/v1/teams/rankings/").json()["teams"][0]["avatar_url"], urls["avatar_url"])
        self.leader.refresh_from_db()
        self.assertEqual(self.leader.avatar_version, "")

    def test_invalid_upload_is_atomic_removal_clears_blobs_and_disabled_teams_are_hidden(self):
        self.client.force_authenticate(self.leader.user)
        original = self.client.post(self.root + "appearance/", {"avatar": self.image()}, format="multipart").json()
        bad = self.client.post(self.root + "appearance/", {"avatar": self.image(True), "banner": SimpleUploadedFile("bad.gif", b"bad")}, format="multipart")
        self.assertEqual(bad.status_code, 400)
        self.team.refresh_from_db()
        self.assertEqual(self.team.profile_avatar_url, original["avatar_url"])
        self.team.is_active = False
        self.team.save()
        self.assertEqual(self.client.get(original["avatar_url"]).status_code, 404)
        self.assertEqual(self.client.post(self.root + "join/", {}).status_code, 404)
        self.team.is_active = True
        self.team.save()
        result = self.client.post(self.root + "appearance/", {"remove_avatar": "true"}, format="multipart")
        self.assertEqual(result.json()["avatar_url"], "")
        self.assertFalse(FactionMedia.objects.exists())

    def test_mutations_require_session_and_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.post(self.root + "join/", {}).status_code, 403)
        client.force_login(self.candidate.user)
        self.assertEqual(client.post(self.root + "join/", {}).status_code, 403)
        client.get("/api/v1/auth/session/")
        response = client.post(self.root + "join/", {}, HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)
        self.assertEqual(response.status_code, 201)
