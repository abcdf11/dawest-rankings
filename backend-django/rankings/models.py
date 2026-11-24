from django.core.validators import MaxValueValidator, MinValueValidator
from django.core.exceptions import ValidationError
from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Lower
from django.utils import timezone
import uuid

class Player(models.Model):
    class Region(models.TextChoices):
        NA = "NA", "North America"
        EU = "EU", "Europe"
        ASIA = "ASIA", "Asia"
        SA = "SA", "South America"
        OCE = "OCE", "Oceania"
    class Tier(models.TextChoices):
        LEGEND = "LEGEND", "Legend"
        OUTLAW = "OUTLAW", "Outlaw"
        GUNSLINGER = "GUNSLINGER", "Gunslinger"
        DEPUTY = "DEPUTY", "Deputy"
        ROOKIE = "ROOKIE", "Rookie"
    user = models.OneToOneField(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="player_profile")
    registered_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    is_restricted = models.BooleanField(default=False, db_index=True)
    restriction_reason = models.CharField(max_length=500, blank=True)
    username = models.SlugField(max_length=40, unique=True)
    display_name = models.CharField(max_length=64)
    region = models.CharField(max_length=4, choices=Region.choices)
    tier = models.CharField(max_length=12, choices=Tier.choices, default=Tier.GUNSLINGER)
    avatar_url = models.URLField(blank=True)
    avatar_version = models.CharField(max_length=64, blank=True)
    banner_version = models.CharField(max_length=64, blank=True)
    audio_version = models.CharField(max_length=64, blank=True)
    audio_title = models.CharField(max_length=80, blank=True)
    accent_color = models.CharField(max_length=7, default="#EAB308")
    rating = models.FloatField(default=1500, validators=[MinValueValidator(0)])
    previous_rating = models.FloatField(default=1500)
    peak_rating = models.FloatField(default=1500)
    rank = models.PositiveIntegerField(default=1, db_index=True)
    previous_rank = models.PositiveIntegerField(default=1)
    regional_rank = models.PositiveIntegerField(default=1)
    wins = models.PositiveIntegerField(default=0)
    losses = models.PositiveIntegerField(default=0)
    current_streak = models.IntegerField(default=0)
    kd_ratio = models.FloatField(default=1)
    rounds_won = models.PositiveIntegerField(default=0)
    rounds_lost = models.PositiveIntegerField(default=0)
    # Linked Roblox account (in-game verification code, accounts/roblox.py). One Roblox account per player.
    roblox_user_id = models.BigIntegerField(null=True, blank=True, unique=True)
    roblox_username = models.CharField(max_length=40, blank=True)
    roblox_display_name = models.CharField(max_length=64, blank=True)
    roblox_linked_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    class Meta:
        ordering = ["rank", "username"]
        indexes = [models.Index(fields=["region", "-rating"]), models.Index(fields=["tier", "-rating"])]
        constraints = [models.CheckConstraint(condition=Q(rating__gte=0), name="rating_nonnegative"), models.UniqueConstraint(Lower("username"), name="username_case_insensitive")]
    def __str__(self):
        return self.display_name

    @property
    def profile_avatar_url(self):
        return f"/api/v1/players/{self.username}/media/avatar/{self.avatar_version}/" if self.avatar_version else self.avatar_url

    @property
    def profile_banner_url(self):
        return f"/api/v1/players/{self.username}/media/banner/{self.banner_version}/" if self.banner_version else ""

    @property
    def profile_audio_url(self):
        return f"/api/v1/players/{self.username}/audio/{self.audio_version}/" if self.audio_version else ""


class AudioTrack(models.Model):
    """Shared columns for a stored theme track (players and factions)."""
    version = models.CharField(max_length=64)
    content_type = models.CharField(max_length=32)
    data = models.BinaryField()
    byte_size = models.PositiveIntegerField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class PlayerAudio(AudioTrack):
    player = models.OneToOneField(Player, on_delete=models.CASCADE, related_name="audio")


class ProfileMedia(models.Model):
    class Kind(models.TextChoices):
        AVATAR = "avatar", "Profile picture"
        BANNER = "banner", "Profile banner"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="profile_media")
    kind = models.CharField(max_length=8, choices=Kind.choices)
    version = models.CharField(max_length=64)
    content_type = models.CharField(max_length=32)
    data = models.BinaryField(editable=False)
    poster = models.BinaryField(default=b"", editable=False)
    byte_size = models.PositiveIntegerField()
    poster_size = models.PositiveIntegerField(default=0)
    width = models.PositiveSmallIntegerField()
    height = models.PositiveSmallIntegerField()
    frames = models.PositiveSmallIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["player", "kind"], name="one_profile_image_per_kind")]

class CompetitionEvent(models.Model):
    class Format(models.TextChoices):
        SOLO = "SOLO", "Solo 1v1"
        FACTION = "FACTION", "Faction"

    class Status(models.TextChoices):
        UPCOMING = "UPCOMING", "Upcoming"
        LIVE = "LIVE", "Live"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True, max_length=3000)
    format = models.CharField(max_length=8, choices=Format.choices, default=Format.SOLO)
    region = models.CharField(max_length=6, choices=[("GLOBAL", "Global"), *Player.Region.choices], default="GLOBAL")
    location = models.CharField(max_length=120, default="Online")
    starts_at = models.DateTimeField(db_index=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.UPCOMING)
    registration_url = models.URLField(blank=True, max_length=500)
    logo_version = models.CharField(max_length=64, blank=True)
    is_published = models.BooleanField(default=False, db_index=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["starts_at", "title"]
        constraints = [models.CheckConstraint(condition=Q(ends_at__isnull=True) | Q(ends_at__gt=F("starts_at")), name="event_end_after_start")]

    def __str__(self):
        return self.title

    @property
    def logo_url(self):
        return f"/api/v1/events/{self.pk}/logo/{self.logo_version}/" if self.logo_version else ""

    def current_status(self, now=None):
        now = now or timezone.now()
        if self.status in {self.Status.CANCELLED, self.Status.COMPLETED}:
            return self.status
        if self.ends_at and self.ends_at <= now:
            return self.Status.COMPLETED
        if self.status == self.Status.LIVE or self.starts_at <= now:
            return self.Status.LIVE
        return self.Status.UPCOMING

    def clean(self):
        super().clean()
        if self.format == "SOLO" and self.faction_matches.exists() or self.format == "FACTION" and self.solo_matches.exists():
            raise ValidationError({"format": "The event format must match its linked matches."})


class EventLogo(models.Model):
    event = models.OneToOneField(CompetitionEvent, on_delete=models.CASCADE, related_name="logo")
    version = models.CharField(max_length=64)
    content_type = models.CharField(max_length=32)
    data = models.BinaryField(editable=False)
    poster = models.BinaryField(default=b"", editable=False)
    byte_size = models.PositiveIntegerField()
    poster_size = models.PositiveIntegerField(default=0)
    frames = models.PositiveSmallIntegerField(default=1)


class EventInterest(models.Model):
    event = models.ForeignKey(CompetitionEvent, on_delete=models.CASCADE, related_name="interests")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="event_interests")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["event", "user"], name="one_interest_per_event")]


class EventNotification(models.Model):
    event = models.ForeignKey(CompetitionEvent, on_delete=models.CASCADE, related_name="notifications")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="event_notifications")
    key = models.CharField(max_length=100)
    message = models.CharField(max_length=300)
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["event", "user", "key"], name="one_event_notification_per_key")]
        indexes = [models.Index(fields=["user", "read_at", "-created_at"], name="event_notice_inbox")]


class EventEntry(models.Model):
    """A registered team (faction) taking part in a faction event."""
    event = models.ForeignKey(CompetitionEvent, on_delete=models.CASCADE, related_name="entries")
    team = models.ForeignKey("teams.Team", on_delete=models.CASCADE, related_name="event_entries")
    registered_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [models.UniqueConstraint(fields=["event", "team"], name="one_entry_per_team")]


class PickemMatchup(models.Model):
    """A pick'em question on an event: players predict A or B before it locks."""
    class Side(models.TextChoices):
        A = "A", "Option A"
        B = "B", "Option B"

    event = models.ForeignKey(CompetitionEvent, on_delete=models.CASCADE, related_name="pickems")
    label = models.CharField(max_length=80, blank=True)
    option_a = models.CharField(max_length=80)
    option_b = models.CharField(max_length=80)
    # Set for faction events; option_a/option_b keep the team names as shown when created.
    team_a = models.ForeignKey("teams.Team", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    team_b = models.ForeignKey("teams.Team", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    points =models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(100)])
    locks_at = models.DateTimeField()
    winner = models.CharField(max_length=1, choices=Side.choices, blank=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "locks_at", "id"]
        constraints = [models.CheckConstraint(condition=Q(points__gte=1) & Q(points__lte=100), name="pickem_points_range")]

    def __str__(self):
        return f"{self.option_a} vs {self.option_b}"

    def is_locked(self, now=None):
        now = now or timezone.now()
        return bool(self.winner) or self.locks_at <= now or self.event.current_status(now) == CompetitionEvent.Status.CANCELLED


class PickemPick(models.Model):
    matchup = models.ForeignKey(PickemMatchup, on_delete=models.CASCADE, related_name="picks")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="pickem_picks")
    choice = models.CharField(max_length=1, choices=PickemMatchup.Side.choices)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["matchup", "user"], name="one_pick_per_matchup")]


class Match(models.Model):
    class Type(models.TextChoices):
        RANKED_1V1 = "RANKED_1V1", "Ranked 1v1"
        TOURNAMENT = "TOURNAMENT", "Tournament"
        SHOWMATCH = "SHOWMATCH", "Showmatch"
        QUALIFIER = "QUALIFIER", "Qualifier"
    class Status(models.TextChoices):
        UPCOMING = "UPCOMING", "Upcoming"
        LIVE = "LIVE", "Live"
        COMPLETED = "COMPLETED", "Completed"
    played_at = models.DateTimeField(default=timezone.now, db_index=True)
    event_name = models.CharField(max_length=120, default="Frontier Ranked")
    event = models.ForeignKey(CompetitionEvent, null=True, blank=True, on_delete=models.PROTECT, related_name="solo_matches")
    match_type = models.CharField(max_length=16, choices=Type.choices, default=Type.RANKED_1V1)
    player_a = models.ForeignKey(Player, on_delete=models.PROTECT, related_name="matches_a")
    player_b = models.ForeignKey(Player, on_delete=models.PROTECT, related_name="matches_b")
    score_a = models.PositiveIntegerField(default=0, validators=[MaxValueValidator(100)])
    score_b = models.PositiveIntegerField(default=0, validators=[MaxValueValidator(100)])
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.UPCOMING)
    rating_delta = models.FloatField(default=0)
    match_notes = models.JSONField(default=dict, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True, editable=False)
    class Meta:
        ordering = ["-played_at", "-pk"]
        indexes = [models.Index(fields=["status", "-played_at"])]
        constraints = [models.CheckConstraint(condition=~Q(player_a=F("player_b")), name="distinct_opponents"), models.CheckConstraint(condition=~Q(status="COMPLETED") | ~Q(score_a=F("score_b")), name="completed_no_ties"), models.CheckConstraint(condition=Q(score_a__lte=100, score_b__lte=100), name="scores_max_100")]
    def __str__(self):
        return f"{self.player_a} {self.score_a}–{self.score_b} {self.player_b}"

    def clean(self):
        super().clean()
        if self.event_id and self.event.format != "SOLO":
            raise ValidationError({"event": "Choose a solo event for a player match."})

class RatingHistory(models.Model):
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="rating_history")
    recorded_at = models.DateTimeField(default=timezone.now)
    rating = models.FloatField()
    rank = models.PositiveIntegerField()
    event_label = models.CharField(max_length=120)
    class Meta:
        ordering = ["recorded_at", "pk"]
        indexes = [models.Index(fields=["player", "recorded_at"])]

class RankingState(models.Model):
    """Singleton row serializes ladder writes and versions leaderboard caches."""
    id = models.PositiveSmallIntegerField(primary_key=True, default=1)
    revision = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

class RankingEvent(models.Model):
    """Transactional outbox: retain events until Redis accepts publication."""
    channel = models.CharField(max_length=40, default="rankings:updated")
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)


class KohRound(models.Model):
    """One King of the Hill round reported by a game server; its kills and Elo result."""
    class Mode(models.TextChoices):
        SOLO = "SOLO", "Solo"
        FACTION = "FACTION", "Faction vs faction"

    round_id = models.CharField(max_length=80, unique=True)
    mode = models.CharField(max_length=8, choices=Mode.choices)
    place_id = models.BigIntegerField(null=True, blank=True)
    job_id = models.CharField(max_length=64, blank=True)
    ended_at = models.DateTimeField(default=timezone.now, db_index=True)
    duration_seconds = models.PositiveIntegerField(default=0)
    winner_roblox_user_id = models.BigIntegerField(null=True, blank=True)
    winner_team = models.ForeignKey("teams.Team", null=True, blank=True, on_delete=models.PROTECT, related_name="koh_wins")
    team_match = models.OneToOneField("teams.TeamMatch", null=True, blank=True, on_delete=models.PROTECT, related_name="koh_round")
    rated = models.BooleanField(default=False)
    rating_note = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-ended_at", "-pk"]

    def __str__(self):
        return f"KOH {self.mode} {self.round_id}"


class KohParticipant(models.Model):
    round = models.ForeignKey(KohRound, on_delete=models.CASCADE, related_name="participants")
    roblox_user_id = models.BigIntegerField()
    roblox_username = models.CharField(max_length=40, blank=True)
    player = models.ForeignKey(Player, null=True, blank=True, on_delete=models.PROTECT, related_name="koh_results")
    team = models.ForeignKey("teams.Team", null=True, blank=True, on_delete=models.PROTECT, related_name="koh_results")
    kills = models.PositiveIntegerField(default=0)
    deaths = models.PositiveIntegerField(default=0)
    placement = models.PositiveSmallIntegerField(default=0)
    is_winner = models.BooleanField(default=False)
    rating_before = models.FloatField(null=True, blank=True)
    rating_after = models.FloatField(null=True, blank=True)
    rating_delta = models.FloatField(default=0)

    class Meta:
        ordering = ["placement", "-kills", "pk"]
        constraints = [models.UniqueConstraint(fields=["round", "roblox_user_id"], name="koh_one_row_per_player")]
