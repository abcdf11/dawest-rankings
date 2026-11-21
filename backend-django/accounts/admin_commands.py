"""Allowlisted admin operations. Command text never reaches an OS shell."""
import hashlib
import json
import shlex
from decimal import Decimal

from django.contrib.sessions.models import Session
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.response import Response

from rankings.engine import tier_for_rating
from rankings.models import Player, RatingHistory
from teams.models import Team, TeamRatingHistory
from .developer import DeveloperOnly, player_row
from .models import AccountSession, AuditEntry
from .services import lock_ladders, refresh_ladders

HELP = ["ban <username> <reason>", "unban <username> <reason>",
        "restrict <username> <reason>", "unrestrict <username> <reason>",
        "elo player <username> <amount> <reason>", "elo faction <slug> <amount> <reason>",
        "status <username>", "help"]


class OperationConflict(APIException):
    status_code = 409
    default_detail = "This request key was already used for another operation."


class RatingInput(serializers.Serializer):
    request_key = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=["player", "faction"])
    target_id = serializers.IntegerField(min_value=1)
    amount = serializers.DecimalField(max_digits=8, decimal_places=2, min_value=Decimal("-100000"), max_value=Decimal("100000"))
    reason = serializers.CharField(min_length=3, max_length=500)

    def validate_amount(self, value):
        if not value:
            raise serializers.ValidationError("Enter an Elo change greater or less than zero.")
        return value


class CommandInput(serializers.Serializer):
    request_key = serializers.UUIDField()
    command = serializers.CharField(min_length=1, max_length=1000)


def registered_target(kind, **lookup):
    if kind == "player":
        return get_object_or_404(Player.objects.select_for_update().select_related("user"), user__isnull=False, registered_at__isnull=False, **lookup)
    return get_object_or_404(Team.objects.select_for_update(), owner__isnull=False, registered_at__isnull=False, **lookup)


def fingerprint(actor, operation):
    return hashlib.sha256(json.dumps({"actor": actor.pk, **operation}, sort_keys=True, default=str).encode()).hexdigest()


def replay(actor, key, digest):
    existing = AuditEntry.objects.filter(pk=key).first()
    if existing:
        if existing.actor_id != actor.pk or existing.details.get("request_hash") != digest:
            raise OperationConflict()
        return existing.details["result"]


def adjust_rating(actor, values):
    # Caller holds both ladder locks, matching registration and moderation.
    kind, key = values["kind"], values["request_key"]
    digest = fingerprint(actor, {name: str(value) for name, value in values.items() if name != "request_key"})
    previous = replay(actor, key, digest)
    if previous:
        return previous
    target = registered_target(kind, pk=values["target_id"])
    if kind == "player" and target.user.is_staff:
        raise PermissionDenied("Staff accounts must be managed through Django Admin.")
    before = target.rating
    after = Decimal(str(before)) + values["amount"]
    if not Decimal("0") <= after <= Decimal("1000000"):
        raise ValidationError({"amount": "The resulting Elo must be between 0 and 1,000,000."})
    target.previous_rating, target.rating = before, float(after)
    target.peak_rating = max(target.peak_rating, target.rating)
    target.tier = tier_for_rating(target.rating)
    target.save(update_fields=["previous_rating", "rating", "peak_rating", "tier", "updated_at"])
    result = {"operation_id": str(key), "message": f"{target.display_name}: Elo {before:g} → {target.rating:g} ({float(values['amount']):+g}).",
              "kind": kind, "target_id": target.pk, "before": before, "after": target.rating}
    details = {"reason": values["reason"], "before": before, "after": target.rating,
               "delta": float(values["amount"]), "username": target.username, "request_hash": digest, "result": result}
    refresh_ladders(actor, f"{kind}.elo.adjusted", kind, target.pk, details, request_key=key)
    target.refresh_from_db()
    label = "Admin Elo adjustment"
    if kind == "player":
        RatingHistory.objects.create(player=target, rating=target.rating, rank=target.rank, event_label=label)
    else:
        TeamRatingHistory.objects.create(team=target, rating=target.rating, rank=target.rank, event_label=label)
    return result


def moderate(actor, key, verb, username, reason):
    if not 3 <= len(reason) <= 500:
        raise ValidationError({"reason": "Include a reason between 3 and 500 characters."})
    digest = fingerprint(actor, {"verb": verb, "username": username.lower(), "reason": reason})
    previous = replay(actor, key, digest)
    if previous:
        return previous
    player = registered_target("player", username__iexact=username)
    if player.user.is_staff or player.user_id == actor.pk:
        raise PermissionDenied("Staff accounts must be managed through Django Admin.")
    if verb in {"ban", "unban"}:
        player.is_active = verb == "unban"
        player.user.is_active = player.is_active
        player.user.save(update_fields=["is_active"])
        player.save(update_fields=["is_active", "updated_at"])
        if verb == "ban":
            keys = list(AccountSession.objects.filter(user=player.user).values_list("session_key", flat=True))
            Session.objects.filter(session_key__in=keys).delete()
            AccountSession.objects.filter(user=player.user).delete()
    else:
        player.is_restricted = verb == "restrict"
        player.restriction_reason = reason if player.is_restricted else ""
        player.save(update_fields=["is_restricted", "restriction_reason", "updated_at"])
    state = "banned" if not player.user.is_active or not player.is_active else "restricted" if player.is_restricted else "active"
    result = {"operation_id": str(key), "message": f"@{player.username}: {state}.", "player": player_row(player)}
    refresh_ladders(actor, f"player.{verb}", "player", player.pk,
        {"reason": reason, "username": player.username, "is_active": player.is_active,
         "is_restricted": player.is_restricted, "request_hash": digest, "result": result}, request_key=key)
    return result


@api_view(["POST"])
@permission_classes([DeveloperOnly])
@transaction.atomic
def ratings(request):
    form = RatingInput(data=request.data)
    form.is_valid(raise_exception=True)
    lock_ladders()
    return Response(adjust_rating(request.user, form.validated_data))


@api_view(["POST"])
@permission_classes([DeveloperOnly])
@transaction.atomic
def commands(request):
    form = CommandInput(data=request.data)
    form.is_valid(raise_exception=True)
    try:
        words = shlex.split(form.validated_data["command"])
    except ValueError:
        raise ValidationError({"command": "Check the quotation marks in your command."}) from None
    if not words:
        raise ValidationError({"command": "Enter a command. Type help to see available commands."})
    verb = words[0].lower()
    if verb == "help" and len(words) == 1:
        return Response({"message": "\n".join(HELP)})
    lock_ladders()
    if verb == "status" and len(words) == 2:
        player = registered_target("player", username__iexact=words[1])
        state = "banned" if not player.is_active or not player.user.is_active else "restricted" if player.is_restricted else "active"
        return Response({"message": f"@{player.username}: {state}; Elo {player.rating:g}.", "player": player_row(player)})
    if verb in {"ban", "unban", "restrict", "unrestrict"} and len(words) >= 3:
        return Response(moderate(request.user, form.validated_data["request_key"], verb, words[1], " ".join(words[2:])))
    if verb == "elo" and len(words) >= 5 and words[1].lower() in {"player", "faction"}:
        kind = words[1].lower()
        target = registered_target(kind, username__iexact=words[2])
        rating_form = RatingInput(data={"request_key": form.validated_data["request_key"], "kind": kind,
            "target_id": target.pk, "amount": words[3], "reason": " ".join(words[4:])})
        rating_form.is_valid(raise_exception=True)
        return Response(adjust_rating(request.user, rating_form.validated_data))
    raise ValidationError({"command": "Unknown command or missing arguments. Type help to see available commands."})
