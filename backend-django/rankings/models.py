from django.core.validators import MaxValueValidator, MinValueValidator
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
