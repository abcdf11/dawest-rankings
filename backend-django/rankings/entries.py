"""Faction registrations for faction-format events."""
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.developer import DeveloperOnly
from accounts.models import AuditEntry
from .eligibility import registered_teams, require_unrestricted
from .models import CompetitionEvent, EventEntry, PickemMatchup


def team_payload(team):
    return {"slug": team.username, "name": team.display_name, "tag": team.tag,
            "url": f"/factions/{team.username}", "logo_url": team.profile_avatar_url or ""}


def entry_teams(event):
    """Registered entrants that are still eligible public factions."""
    return [entry.team for entry in event.entries.select_related("team").filter(team__in=registered_teams())]


def registration_open(event):
    return event.format == CompetitionEvent.Format.FACTION and event.is_published and event.current_status() == CompetitionEvent.Status.UPCOMING


def in_matchup(event, team):
    return PickemMatchup.objects.filter(event=event).filter(team_a=team).exists() or PickemMatchup.objects.filter(event=event, team_b=team).exists()


def faction_only(event):
    if event.format != CompetitionEvent.Format.FACTION:
        return Response({"detail": "Only faction events take team registrations."}, status=status.HTTP_400_BAD_REQUEST)
    return None


def add_entry(event, team, user, action):
    try:
        with transaction.atomic():
            EventEntry.objects.create(event=event, team=team, registered_by=user)
    except IntegrityError:
        return Response({"detail": f"{team.display_name} is already registered."}, status=status.HTTP_409_CONFLICT)
    AuditEntry.objects.create(actor=user, action=action, target_type="event", target_id=str(event.pk), details={"team": team.username})
    return None


def remove_entry(event, team, user, action):
    entry = EventEntry.objects.filter(event=event, team=team).first()
    if entry is None:
        return Response({"detail": "That team is not registered for this event."}, status=status.HTTP_404_NOT_FOUND)
    if in_matchup(event, team):
        return Response({"detail": "This team is in a pick'em matchup. Delete that matchup first."}, status=status.HTTP_409_CONFLICT)
    entry.delete()
    AuditEntry.objects.create(actor=user, action=action, target_type="event", target_id=str(event.pk), details={"team": team.username})
    return None


@api_view(["GET", "POST"])
@transaction.atomic
def public_entries(request, event_id):
    events = CompetitionEvent.objects.select_for_update() if request.method == "POST" else CompetitionEvent.objects.all()
    event = get_object_or_404(events, pk=event_id, is_published=True)
    if request.method == "POST":
        if not request.user.is_authenticated:
            return Response({"detail": "Sign in to register your faction."}, status=status.HTTP_403_FORBIDDEN)
        if (error := faction_only(event)) or not registration_open(event):
            return error or Response({"detail": "Registration is closed for this event."}, status=status.HTTP_409_CONFLICT)
        require_unrestricted(request.user)
        team = get_object_or_404(registered_teams(), username=request.data.get("team", ""), owner=request.user)
        if error := add_entry(event, team, request.user, "event.team_registered"):
            return error
        return Response(entries_payload(event, request.user), status=201)
    return Response(entries_payload(event, request.user))


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def withdraw(request, event_id, team_slug):
    event = get_object_or_404(CompetitionEvent.objects.select_for_update(), pk=event_id, is_published=True)
    team = get_object_or_404(registered_teams(), username=team_slug, owner=request.user)
    if not registration_open(event):
        return Response({"detail": "Registration is closed; contact a developer to withdraw."}, status=status.HTTP_409_CONFLICT)
    if error := remove_entry(event, team, request.user, "event.team_withdrawn"):
        return error
    return Response(entries_payload(event, request.user))


def entries_payload(event, user):
    teams = entry_teams(event)
    entered = {team.pk for team in teams}
    owned = list(registered_teams().filter(owner=user)) if user.is_authenticated and event.format == "FACTION" else []
    return {"entries": [team_payload(team) for team in teams], "registration_open": registration_open(event),
            "my_teams": [{**team_payload(team), "registered": team.pk in entered} for team in owned]}


@api_view(["GET", "POST"])
@permission_classes([DeveloperOnly])
@transaction.atomic
def manage_entries(request, event_id):
    events = CompetitionEvent.objects.select_for_update() if request.method == "POST" else CompetitionEvent.objects.all()
    event = get_object_or_404(events, pk=event_id)
    if request.method == "POST":
        if error := faction_only(event):
            return error
        team = get_object_or_404(registered_teams(), username=request.data.get("team", ""))
        if error := add_entry(event, team, request.user, "event.team_added"):
            return error
    teams = entry_teams(event)
    entered = {team.pk for team in teams}
    available = [team_payload(team) for team in registered_teams().order_by("display_name") if team.pk not in entered] if event.format == "FACTION" else []
    return Response({"entries": [team_payload(team) for team in teams], "available": available},
                    status=201 if request.method == "POST" else 200)


@api_view(["DELETE"])
@permission_classes([DeveloperOnly])
@transaction.atomic
def manage_entry(request, event_id, team_slug):
    event = get_object_or_404(CompetitionEvent.objects.select_for_update(), pk=event_id)
    team = get_object_or_404(registered_teams().model.objects, username=team_slug)
    if error := remove_entry(event, team, request.user, "event.team_removed"):
        return error
    return Response({"deleted": True})
