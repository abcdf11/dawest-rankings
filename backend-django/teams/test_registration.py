import uuid
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.exceptions import PermissionDenied
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from .models import RegistrationReview, Team, TeamMembership, TeamRegistration
from .registration import RegistrationConflict, review_registration
from rankings.models import Player, RankingEvent, RankingState


@override_settings(USE_REDIS=False)
class RegistrationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        for username in ("captainnew", "teammatenew"):
            user = get_user_model().objects.create_user(username=username, password="test-password")
            Player.objects.create(user=user, username=username, display_name=username, region="NA", registered_at=timezone.now())
        self.captain = get_user_model().objects.get(username="captainnew")
        self.client.force_authenticate(self.captain)
        RankingState.objects.all().delete()
        self.body = {"request_key": str(uuid.uuid4()), "team_name": "New Frontier", "tag": "NFR", "region": "NA", "captain_username": "captainnew", "contact_email": "captain@example.com", "members": [{"username": "captainnew", "display_name": "Captain"}, {"username": "teammatenew", "display_name": "Teammate"}]}

    def submit(self, **changes):
        return self.client.post("/api/v1/teams/register/", {**self.body, **changes}, format="json")

    def test_persistence_and_private_receipts(self):
        response = self.submit()
        self.assertEqual(response.status_code, 201)
        data = response.json()
        application = TeamRegistration.objects.get(pk=data["id"])
        self.assertEqual(application.submitted_by, self.captain)
        self.assertEqual(application.members.count(), 2)
        self.assertEqual(application.members.filter(is_captain=True).get().username, "captainnew")
        self.assertEqual(Team.objects.count(), 0)
        self.assertNotIn("contact_email", data)
        receipt = self.client.get(f'/api/v1/teams/registrations/{data["id"]}/').json()
        self.assertEqual(receipt["reference"], application.reference)
        self.assertNotIn("members", receipt)
        self.assertNotIn("contact_email", receipt)

    def test_idempotency_and_conflicting_payloads(self):
        self.assertEqual(self.submit().status_code, 201)
        self.assertEqual(self.submit().status_code, 200)
        self.assertEqual(self.submit(team_name="Changed").status_code, 409)
        self.assertEqual(TeamRegistration.objects.count(), 1)

    def test_duplicate_names_tags_and_pending_rosters(self):
        self.submit()
        for changes in [{"tag": "nfr"}, {"team_name": "new frontier", "tag": "DIFF"}, {"team_name": "Other Crew", "tag": "OTHR"}]:
            self.assertEqual(self.submit(request_key=str(uuid.uuid4()), **changes).status_code, 409)

    def test_invalid_rosters_contacts_and_tags(self):
        cases = [{"members": [self.body["members"][0]]}, {"members": [self.body["members"][0], {"username": "CAPTAINNEW", "display_name": "Duplicate"}]}, {"captain_username": "missing"}, {"tag": "!!!"}]
        for changes in cases:
            with self.subTest(changes=changes):
                self.assertEqual(self.submit(**changes).status_code, 400)
        self.assertEqual(TeamRegistration.objects.count(), 0)

    def test_cannot_claim_an_existing_team_member(self):
        player = Player.objects.get(username="captainnew")
        team = Team.objects.create(username="existing", display_name="Existing", tag="EX", region="NA")
        TeamMembership.objects.create(team=team, player=player)
        self.assertEqual(self.submit().status_code, 409)

    def test_approval_creates_roster_ranks_and_events_once(self):
        receipt = self.submit().json()
        admin = get_user_model().objects.create_superuser(username="reviewer", password="test-password")
        result = review_registration(receipt["id"], admin, True, "Verified")
        self.assertEqual(result.status, "APPROVED")
        self.assertEqual(result.team.roster.count(), 2)
        self.assertEqual(result.team.rating, 1500)
        self.assertEqual(list(Player.objects.order_by("rank").values_list("rank", flat=True)), [1, 2])
        self.assertEqual(RankingEvent.objects.count(), 2)
        self.assertEqual(RankingState.objects.get(pk=1).revision, 1)
        review_registration(receipt["id"], admin, True)
        self.assertEqual(Team.objects.count(), 1)
        self.assertEqual(RegistrationReview.objects.count(), 1)
        with self.assertRaises(RegistrationConflict):
            review_registration(receipt["id"], admin, False)

    def test_review_permissions_and_changed_roster_rollback(self):
        registration_id = self.submit().json()["id"]
        staff = get_user_model().objects.create_user(username="staff", password="test-password", is_staff=True)
        with self.assertRaises(PermissionDenied):
            review_registration(registration_id, staff, True)
        admin = get_user_model().objects.create_superuser(username="admin", password="test-password")
        player = Player.objects.get(username="captainnew")
        team = Team.objects.create(username="other", display_name="Other", tag="OT", region="NA")
        TeamMembership.objects.create(team=team, player=player)
        with self.assertRaises(RegistrationConflict):
            review_registration(registration_id, admin, True)
        self.assertEqual(Team.objects.count(), 1)
        self.assertEqual(Player.objects.count(), 2)
        self.assertEqual(RegistrationReview.objects.count(), 0)
        self.assertEqual(TeamRegistration.objects.get(pk=registration_id).status, "PENDING")

    def test_rejection_releases_name_tag_and_roster(self):
        registration_id = self.submit().json()["id"]
        admin = get_user_model().objects.create_superuser(username="admin", password="test-password")
        review_registration(registration_id, admin, False, "Please verify your roster.")
        self.assertEqual(Team.objects.count(), 0)
        self.assertEqual(Player.objects.count(), 2)
        self.assertEqual(self.submit(request_key=str(uuid.uuid4())).status_code, 201)
