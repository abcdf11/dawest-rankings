from django.db import transaction
from django.db.models import Count, F, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from accounts.developer import DeveloperOnly
from accounts.models import AuditEntry
from .entries import entry_teams, team_payload
from .models import CompetitionEvent, PickemMatchup, PickemPick, Player

LEADERBOARD_SIZE = 50


class MatchupInput(serializers.ModelSerializer):
    """Faction events pick both sides from the event's registered teams (slugs);
    solo events use free-text options."""
    team_a = serializers.CharField(required=False, write_only=True)
    team_b = serializers.CharField(required=False, write_only=True)

    class Meta:
        model = PickemMatchup
        fields = ["label", "option_a", "option_b", "team_a", "team_b", "points", "locks_at", "winner", "order"]
        extra_kwargs = {"option_a": {"required": False}, "option_b": {"required": False}}

    def validate(self, values):
        event = self.context["event"]
        faction = event.format == CompetitionEvent.Format.FACTION
        if faction:
            # Names come from the selected teams, never free text.
            values.pop("option_a", None)
            values.pop("option_b", None)
            entrants = {team.username: team for team in entry_teams(event)}
            for side in ("a", "b"):
                key = f"team_{side}"
                if key in values:
                    team = entrants.get(values[key])
                    if team is None:
                        raise serializers.ValidationError({key: "Choose a team registered for this event."})
                    values[key], values[f"option_{side}"] = team, team.display_name
            if not self.instance and not ("team_a" in values and "team_b" in values):
                raise serializers.ValidationError({"team_a": "Choose two teams registered for this event."})
        else:
            if "team_a" in values or "team_b" in values:
                raise serializers.ValidationError({"team_a": "Only faction events use registered teams."})
            for key in ("option_a", "option_b"):
                if key in values:
                    values[key] = values[key].strip()
                if not self.instance and not values.get(key):
                    raise serializers.ValidationError({key: "Enter both options."})
        if "label" in values:
            values["label"] = values["label"].strip()
        a = values.get("option_a", getattr(self.instance, "option_a", ""))
        b = values.get("option_b", getattr(self.instance, "option_b", ""))
        if a.lower() == b.lower():
            raise serializers.ValidationError({"option_b": "The two options must be different."})
        if self.instance and self.instance.picks.exists():
            changed = [key for key in ("option_a", "option_b", "team_a", "team_b") if key in values and values[key] != getattr(self.instance, key)]
            if changed:
                raise serializers.ValidationError({changed[0]: "Options cannot change after players have picked."})
        return values


def matchup_payload(matchup, now, my_pick=None, developer=False):
    locked = matchup.is_locked(now)
    result = {"id": matchup.pk, "label": matchup.label, "option_a": matchup.option_a, "option_b": matchup.option_b,
              "team_a": team_payload(matchup.team_a) if matchup.team_a else None,
              "team_b": team_payload(matchup.team_b) if matchup.team_b else None,
              "points": matchup.points, "locks_at": matchup.locks_at, "locked": locked,
              "winner": matchup.winner or None, "my_pick": my_pick}
    # Pick distribution is hidden until lock so it cannot sway open picks.
    if locked or developer:
        result["picks"] = {"A": matchup.pick_a, "B": matchup.pick_b}
    return result


def with_counts(queryset):
    return queryset.select_related("event", "team_a", "team_b").annotate(pick_a=Count("picks", filter=Q(picks__choice="A")), pick_b=Count("picks", filter=Q(picks__choice="B")))


def leaderboard(event):
    correct = Q(choice=F("matchup__winner"))
    rows = (PickemPick.objects.filter(matchup__event=event)
            .values("user_id")
            .annotate(points=Sum("matchup__points", filter=correct, default=0), correct=Count("id", filter=correct),
                      decided=Count("id", filter=~Q(matchup__winner="")), picks=Count("id")))
    players = {p.user_id: p for p in Player.objects.filter(user_id__in=[row["user_id"] for row in rows], is_active=True, user__is_active=True)}
    entries = [{**row, "player": players[row["user_id"]]} for row in rows if row["user_id"] in players]
    entries.sort(key=lambda row: (-row["points"], -row["correct"], row["player"].username.lower()))
    rank, previous = 0, None
    for index, row in enumerate(entries, start=1):
        if (row["points"], row["correct"]) != previous:
            rank, previous = index, (row["points"], row["correct"])
        row["rank"] = rank
    return entries


def leaderboard_row(row):
    player = row["player"]
    return {"rank": row["rank"], "username": player.username, "display_name": player.display_name,
            "url": f"/players/{player.username}", "points": row["points"], "correct": row["correct"],
            "decided": row["decided"], "picks": row["picks"]}


def picker(user):
    player = getattr(user, "player_profile", None) if user.is_authenticated else None
    return player if player and player.is_active and user.is_active else None


@api_view(["GET"])
def board(request, event_id):
    event = get_object_or_404(CompetitionEvent, pk=event_id, is_published=True)
    now = timezone.now()
    matchups = list(with_counts(event.pickems.select_related("event")))
    mine = {}
    if request.user.is_authenticated:
        mine = dict(PickemPick.objects.filter(user=request.user, matchup__event=event).values_list("matchup_id", "choice"))
    entries = leaderboard(event)
    me = next((leaderboard_row(row) for row in entries if row["user_id"] == request.user.pk), None)
    return Response({"matchups": [matchup_payload(m, now, mine.get(m.pk)) for m in matchups],
                     "leaderboard": [leaderboard_row(row) for row in entries[:LEADERBOARD_SIZE]],
                     "me": me, "can_pick": picker(request.user) is not None, "participants": len(entries)})


class PickThrottle(UserRateThrottle):
    rate = "120/min"


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PickThrottle])
def pick(request, event_id, matchup_id):
    if picker(request.user) is None:
        return Response({"detail": "Only registered players can make picks."}, status=status.HTTP_403_FORBIDDEN)
    choice = request.data.get("choice")
    if choice not in {"A", "B"}:
        return Response({"choice": "Choose A or B."}, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        matchup = get_object_or_404(PickemMatchup.objects.select_for_update().select_related("event"),
                                    pk=matchup_id, event_id=event_id, event__is_published=True)
        if matchup.is_locked():
            return Response({"detail": "Picks for this matchup are locked."}, status=status.HTTP_409_CONFLICT)
        PickemPick.objects.update_or_create(matchup=matchup, user=request.user, defaults={"choice": choice})
    return Response({"id": matchup.pk, "my_pick": choice})


@api_view(["GET", "POST"])
@permission_classes([DeveloperOnly])
def manage_list(request, event_id):
    event = get_object_or_404(CompetitionEvent, pk=event_id)
    if request.method == "GET":
        now = timezone.now()
        return Response({"matchups": [matchup_payload(m, now, developer=True) for m in with_counts(event.pickems.select_related("event"))],
                         "leaderboard": [leaderboard_row(row) for row in leaderboard(event)[:LEADERBOARD_SIZE]]})
    data = {key: request.data[key] for key in request.data}
    if not data.get("locks_at"):
        data["locks_at"] = event.starts_at  # picks close when the event starts unless set
    form = MatchupInput(data=data, context={"event": event})
    form.is_valid(raise_exception=True)
    with transaction.atomic():
        matchup = form.save(event=event)
        AuditEntry.objects.create(actor=request.user, action="pickem.created", target_type="event", target_id=str(event.pk),
                                  details={"matchup": matchup.pk, "options": [matchup.option_a, matchup.option_b]})
    return Response(matchup_payload(with_counts(PickemMatchup.objects.select_related("event")).get(pk=matchup.pk), timezone.now(), developer=True), status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([DeveloperOnly])
@transaction.atomic
def manage_detail(request, event_id, matchup_id):
    matchup = get_object_or_404(PickemMatchup.objects.select_for_update().select_related("event"), pk=matchup_id, event_id=event_id)
    if request.method == "DELETE":
        details = {"matchup": matchup.pk, "options": [matchup.option_a, matchup.option_b], "picks": matchup.picks.count()}
        matchup.delete()
        AuditEntry.objects.create(actor=request.user, action="pickem.deleted", target_type="event", target_id=str(event_id), details=details)
        return Response({"deleted": True, "id": details["matchup"]})
    previous_winner = matchup.winner
    form = MatchupInput(matchup, data=request.data, partial=True, context={"event": matchup.event})
    form.is_valid(raise_exception=True)
    matchup = form.save()
    action = "pickem.resolved" if matchup.winner != previous_winner else "pickem.updated"
    AuditEntry.objects.create(actor=request.user, action=action, target_type="event", target_id=str(event_id),
                              details={"matchup": matchup.pk, "winner": matchup.winner, "fields": list(form.validated_data)})
    return Response(matchup_payload(with_counts(PickemMatchup.objects.select_related("event")).get(pk=matchup.pk), timezone.now(), developer=True))
