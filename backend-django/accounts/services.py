from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rankings.eligibility import competitive_players, registered_players, registered_teams
from rankings.engine import _after_commit
from rankings.models import Player, RankingEvent, RankingState, RatingHistory
from teams.models import TeamRatingHistory
from .models import AuditEntry, UsernameAlias

User = get_user_model()


def is_developer(user):
    return bool(user and user.is_authenticated and user.is_active and user.is_staff and user.has_perm("accounts.access_dev_console"))


def roblox_payload(player):
    if not player.roblox_user_id:
        return None
    return {"user_id": player.roblox_user_id, "username": player.roblox_username, "display_name": player.roblox_display_name, "linked_at": player.roblox_linked_at.isoformat() if player.roblox_linked_at else None}


def user_payload(user):
    player = getattr(user, "player_profile", None)
    return {"id": user.pk, "username": user.username, "is_developer": is_developer(user), "player": {"id": player.pk, "username": player.username, "display_name": player.display_name, "region": player.region, "rating": player.rating, "rank": player.rank, "is_active": player.is_active, "is_restricted": player.is_restricted, "restriction_reason": player.restriction_reason, "roblox": roblox_payload(player)} if player else None, "roblox_link_available": bool(settings.DAWEST_GAME_API_KEY.strip()), "can_post_news": user.is_active and user.has_perm("news.publish_article")}


def lock_ladders():
    for pk in (2, 1):
        RankingState.objects.get_or_create(pk=pk)
    return [RankingState.objects.select_for_update().get(pk=pk) for pk in (2, 1)]


def refresh_ladders(actor, action, target_type, target_id="", details=None, request_key=None):
    """Called inside the transaction holding both ladder locks; never stores secrets."""
    audit = AuditEntry.objects.create(**({"id": request_key} if request_key else {}), actor=actor, action=action, target_type=target_type, target_id=str(target_id), details=details or {})
    for pk, kind, qs in ((1, "players", competitive_players()), (2, "teams", registered_teams())):
        rows = list(qs.select_for_update().order_by("-rating", "username"))
        regions = {}
        for rank, row in enumerate(rows, 1):
            row.previous_rank = row.rank if row.registered_at else rank
            row.rank = rank
            regions[row.region] = regions.get(row.region, 0) + 1
            row.regional_rank = regions[row.region]
        if rows:
            rows[0].__class__.objects.bulk_update(rows, ["rank", "previous_rank", "regional_rank"])
        state = RankingState.objects.get(pk=pk)
        state.revision += 1
        state.save()
        RankingEvent.objects.create(payload={"reason": "moderation", "operation_id": str(audit.pk), "kind": kind, "revision": state.revision, "updated_at": timezone.now().isoformat(), "players": [{"id": row.pk, "rating": row.rating, "rank": row.rank} for row in rows]})
    transaction.on_commit(_after_commit)


class SignupInput(serializers.Serializer):
    username = serializers.RegexField(r"^[a-zA-Z0-9_]{3,30}$", max_length=30)
    display_name = serializers.CharField(min_length=2, max_length=64)
    region = serializers.ChoiceField(choices=Player.Region.choices)
    password = serializers.CharField(write_only=True, trim_whitespace=False, max_length=128)
    password_confirm = serializers.CharField(write_only=True, trim_whitespace=False, max_length=128)

    def validate_username(self, value):
        return value.lower()

    def validate(self, data):
        if data["password"] != data.pop("password_confirm"):
            raise serializers.ValidationError({"password_confirm": "Passwords do not match."})
        try:
            validate_password(data["password"], User(username=data["username"]))
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})
        return data


@transaction.atomic
def create_player_account(data, actor=None):
    lock_ladders()
    if User.objects.filter(username__iexact=data["username"]).exists() or Player.objects.filter(username__iexact=data["username"]).exists() or UsernameAlias.objects.filter(username__iexact=data["username"]).exists():
        raise ValidationError({"username": "This username is already registered or reserved."})
    user = User.objects.create_user(username=data["username"], password=data["password"], is_staff=False, is_superuser=False)
    player = Player.objects.create(user=user, username=user.username, display_name=data["display_name"], region=data["region"], registered_at=timezone.now(), accent_color="#dddddd")
    refresh_ladders(actor or user, "player.created", "player", player.pk, {"username": player.username})
    player.refresh_from_db()
    RatingHistory.objects.create(player=player, rating=player.rating, rank=player.rank, event_label="Account registration")
    return user
