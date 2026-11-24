import uuid

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from rankings.models import Player
from .models import Team, TeamMembership, TeamRegistration


class FactionLifecycleTests(TestCase):
    def setUp(self):
        cache.clear()
        self.leader = self.player("leader")
        self.member = self.player("member")
        self.team = Team.objects.create(username="frontier", display_name="Frontier", tag="FT", region="NA", owner=self.leader.user, registered_at=timezone.now())
        TeamMembership.objects.create(team=self.team, player=self.leader, is_captain=True)
        TeamMembership.objects.create(team=self.team, player=self.member)
        self.client = APIClient()
        self.client.force_authenticate(self.member.user)

    def player(self, name):
        user = get_user_model().objects.create(username=name, password="!")
        return Player.objects.create(user=user, username=name, display_name=name.title(), region="NA", registered_at=timezone.now())

    def test_member_can_leave(self):
        res = self.client.post(f"/api/v1/factions/frontier/members/{self.member.pk}/remove/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(TeamMembership.objects.filter(player=self.member).exists())

    def test_leader_cannot_leave(self):
        leader = APIClient()
        leader.force_authenticate(self.leader.user)
        self.assertEqual(leader.post(f"/api/v1/factions/frontier/members/{self.leader.pk}/remove/").status_code, 409)

    def test_removed_faction_is_hidden_from_profiles(self):
        self.assertEqual(APIClient().get("/api/v1/players/member/").json()["team"]["tag"], "FT")
        Team.objects.filter(pk=self.team.pk).update(is_active=False)  # developer console "remove"
        self.assertIsNone(APIClient().get("/api/v1/players/member/").json()["team"])

    def test_member_of_removed_faction_can_join_another(self):
        Team.objects.filter(pk=self.team.pk).update(is_active=False)
        other_leader = self.player("otherleader")
        other = Team.objects.create(username="rivals", display_name="Rivals", tag="RV", region="NA", owner=other_leader.user, registered_at=timezone.now())
        TeamMembership.objects.create(team=other, player=other_leader, is_captain=True)
        res = self.client.post("/api/v1/factions/rivals/join/", {"message": "hi"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        boss = APIClient()
        boss.force_authenticate(other_leader.user)
        review = boss.post(f"/api/v1/factions/rivals/requests/{res.json()['id']}/review/", {"decision": "ACCEPTED"}, format="json")
        self.assertEqual(review.status_code, 200, review.content)
        self.assertEqual(TeamMembership.objects.get(player=self.member).team, other)

    def test_mine_reports_a_pending_registration(self):
        loner = self.player("loner")
        client = APIClient()
        client.force_authenticate(loner.user)
        self.assertFalse(client.get("/api/v1/factions/mine/").json()["pending_registration"])
        TeamRegistration.objects.create(team_name="Loners", tag="LN", region="NA", submitted_by=loner.user, captain_username="loner", request_key=uuid.uuid4(), payload_hash="h1")
        self.assertTrue(client.get("/api/v1/factions/mine/").json()["pending_registration"])
