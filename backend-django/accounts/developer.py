from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rankings.models import Player
from teams.models import Team, TeamRegistration
from teams.registration import RegistrationInput, public_receipt, review_registration, submit_registration
from .models import AuditEntry
from .models import AccountSession
from django.contrib.sessions.models import Session
from .services import SignupInput, create_player_account, is_developer, lock_ladders, refresh_ladders


class DeveloperOnly(BasePermission):
    message = "Developer access is required."
    def has_permission(self, request, view):
        return is_developer(request.user)


def player_row(player):
    return {"id": player.pk, "username": player.username, "display_name": player.display_name, "region": player.region, "rating": player.rating, "rank": player.rank, "is_active": player.is_active and player.user.is_active}


def team_row(team):
    return {"id": team.pk, "username": team.username, "display_name": team.display_name, "tag": team.tag, "region": team.region, "rating": team.rating, "is_active": team.is_active, "roster": [{"id": p.pk, "username": p.username, "display_name": p.display_name} for p in team.roster.all()]}


@api_view(["GET"])
@permission_classes([DeveloperOnly])
def dashboard(request):
    players = Player.objects.filter(user__isnull=False, registered_at__isnull=False).select_related("user").order_by("username")
    teams = Team.objects.filter(registered_at__isnull=False).prefetch_related("roster").order_by("display_name")
    applications = TeamRegistration.objects.select_related("submitted_by", "team").prefetch_related("members").order_by("-created_at")
    return Response({"stats": {"players": players.count(), "teams": teams.count(), "pending": applications.filter(status="PENDING").count()}, "players": [player_row(p) for p in players[:500]], "teams": [team_row(t) for t in teams[:500]], "registrations": [{**public_receipt(r), "captain_username": r.captain_username, "contact_discord": r.contact_discord, "description": r.description, "members": [{"username": m.username, "display_name": m.display_name, "is_captain": m.is_captain} for m in r.members.all()]} for r in applications[:100]], "audit": [{"id": str(a.pk), "actor": a.actor.username if a.actor else "Deleted account", "action": a.action, "target_type": a.target_type, "target_id": a.target_id, "created_at": a.created_at.isoformat()} for a in AuditEntry.objects.select_related("actor")[:50]]})


class ReviewInput(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["APPROVED", "REJECTED"])
    note = serializers.CharField(max_length=500, allow_blank=True, default="")


@api_view(["POST"])
@permission_classes([DeveloperOnly])
@transaction.atomic
def review(request, registration_id):
    get_object_or_404(TeamRegistration, pk=registration_id)
    data = ReviewInput(data=request.data)
    data.is_valid(raise_exception=True)
    result = review_registration(registration_id, request.user, data.validated_data["decision"] == "APPROVED", data.validated_data["note"])
    AuditEntry.objects.create(actor=request.user, action=f"registration.{result.status.lower()}", target_type="registration", target_id=str(result.pk))
    return Response(public_receipt(result))


@api_view(["POST"])
@permission_classes([DeveloperOnly])
def add_player(request):
    serializer = SignupInput(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = create_player_account(serializer.validated_data, actor=request.user)
    return Response(player_row(user.player_profile), status=201)


class PlayerUpdate(serializers.Serializer):
    display_name = serializers.CharField(min_length=2, max_length=64, required=False)
    region = serializers.ChoiceField(choices=Player.Region.choices, required=False)
    is_active = serializers.BooleanField(required=False)


@api_view(["PATCH", "DELETE"])
@permission_classes([DeveloperOnly])
@transaction.atomic
def manage_player(request, player_id):
    lock_ladders()
    player = get_object_or_404(Player.objects.select_for_update().select_related("user"), pk=player_id, user__isnull=False, registered_at__isnull=False)
    if player.user.is_staff:
        return Response({"detail": "Staff accounts must be managed through Django Admin."}, status=403)
    serializer = PlayerUpdate(data={"is_active": False} if request.method == "DELETE" else request.data)
    serializer.is_valid(raise_exception=True)
    for key, value in serializer.validated_data.items():
        setattr(player, key, value)
    if "is_active" in serializer.validated_data:
        player.user.is_active = player.is_active
        player.user.save(update_fields=["is_active"])
        if not player.is_active:
            keys = list(AccountSession.objects.filter(user=player.user).values_list("session_key", flat=True))
            Session.objects.filter(session_key__in=keys).delete()
            AccountSession.objects.filter(user=player.user).delete()
    player.save()
    refresh_ladders(request.user, "player.updated" if player.is_active else "player.removed", "player", player.pk, {"username": player.username, "is_active": player.is_active})
    return Response(player_row(player))


@api_view(["POST"])
@permission_classes([DeveloperOnly])
@transaction.atomic
def add_team(request):
    serializer = RegistrationInput(data=request.data, context={"request": request, "developer": True})
    serializer.is_valid(raise_exception=True)
    captain = get_object_or_404(Player.objects.select_related("user"), username=serializer.validated_data["captain_username"], user__isnull=False)
    application, _created = submit_registration(serializer.validated_data, captain.user)
    result = review_registration(application.pk, request.user, True, "Created through the developer console.")
    AuditEntry.objects.create(actor=request.user, action="team.created", target_type="team", target_id=str(result.team_id))
    return Response(team_row(result.team), status=201)


class TeamUpdate(serializers.Serializer):
    is_active = serializers.BooleanField()


@api_view(["PATCH", "DELETE"])
@permission_classes([DeveloperOnly])
@transaction.atomic
def manage_team(request, team_id):
    lock_ladders()
    team = get_object_or_404(Team.objects.select_for_update().prefetch_related("roster"), pk=team_id, registered_at__isnull=False)
    data = TeamUpdate(data={"is_active": False} if request.method == "DELETE" else request.data)
    data.is_valid(raise_exception=True)
    team.is_active = data.validated_data["is_active"]
    team.save(update_fields=["is_active"])
    refresh_ladders(request.user, "team.restored" if team.is_active else "team.removed", "team", team.pk, {"team_name": team.display_name})
    return Response(team_row(team))
