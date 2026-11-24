import uuid
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Lower
from django.utils import timezone
from rankings.models import AudioTrack, Match, Player


class Team(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="owned_teams")
    registered_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    username = models.SlugField("team slug", max_length=40, unique=True)
    display_name = models.CharField("team name", max_length=64)
    tag = models.CharField(max_length=5, unique=True)
    region = models.CharField(max_length=4, choices=Player.Region.choices)
    tier = models.CharField(max_length=12, choices=Player.Tier.choices, default="GUNSLINGER")
    avatar_url = models.URLField("logo URL", blank=True)
    logo_version = models.CharField(max_length=64, blank=True)
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
    updated_at = models.DateTimeField(auto_now=True)
    # Linked in-game faction (teams/roblox_link.py): the leader gets a short code on the site and
    # enters it in the game's faction menu; one in-game faction per site faction.
    roblox_faction_id = models.CharField(max_length=32, null=True, blank=True, unique=True)
    roblox_faction_name = models.CharField(max_length=64, blank=True)
    roblox_linked_at = models.DateTimeField(null=True, blank=True)
    roblox_link_code = models.CharField(max_length=12, blank=True, db_index=True)
    roblox_link_code_expires = models.DateTimeField(null=True, blank=True)
    roster = models.ManyToManyField(Player, through="TeamMembership", related_name="teams")

    class Meta:
        ordering = ["rank", "username"]
        indexes = [models.Index(fields=["region", "-rating"]), models.Index(fields=["tier", "-rating"])]
        constraints = [models.CheckConstraint(condition=Q(rating__gte=0), name="team_rating_nonnegative"), models.UniqueConstraint(Lower("username"), name="team_slug_case_insensitive"), models.UniqueConstraint(Lower("tag"), name="team_tag_case_insensitive")]

    def __str__(self):
        return self.display_name

    @property
    def profile_avatar_url(self):
        return f"/api/v1/factions/{self.username}/media/logo/{self.logo_version}/" if self.logo_version else self.avatar_url

    @property
    def profile_banner_url(self):
        return f"/api/v1/factions/{self.username}/media/banner/{self.banner_version}/" if self.banner_version else ""

    @property
    def profile_audio_url(self):
        return f"/api/v1/factions/{self.username}/audio/{self.audio_version}/" if self.audio_version else ""


class FactionMedia(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="faction_media")
    kind = models.CharField(max_length=8, choices=[("logo", "Logo"), ("banner", "Banner")])
    version = models.CharField(max_length=64)
    content_type = models.CharField(max_length=32)
    data = models.BinaryField()
    poster = models.BinaryField(default=b"")
    byte_size = models.PositiveIntegerField()
    poster_size = models.PositiveIntegerField(default=0)
    width = models.PositiveSmallIntegerField()
    height = models.PositiveSmallIntegerField()
    frames = models.PositiveSmallIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["team", "kind"], name="one_faction_image_per_kind")]


class FactionAudio(AudioTrack):
    """The faction's theme track, stored in the database like faction images."""
    team = models.OneToOneField(Team, on_delete=models.CASCADE, related_name="audio")


class FactionJoinRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        ACCEPTED = "ACCEPTED", "Accepted"
        REJECTED = "REJECTED", "Rejected"
        CANCELLED = "CANCELLED", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="join_requests")
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="faction_requests")
    message = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["team", "player"], name="one_join_request_per_faction_player")]


class TeamMembership(models.Model):
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="memberships")
    player = models.OneToOneField(Player, on_delete=models.CASCADE, related_name="team_membership")
    is_captain = models.BooleanField(default=False)
    joined_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["team"], condition=Q(is_captain=True), name="one_captain_per_team")]


class TeamMatch(models.Model):
    class Type(models.TextChoices):
        RANKED_TEAM = "RANKED_TEAM", "Ranked team match"
        TOURNAMENT = "TOURNAMENT", "Tournament"
        SHOWMATCH = "SHOWMATCH", "Showmatch"
        QUALIFIER = "QUALIFIER", "Qualifier"

    played_at = models.DateTimeField(default=timezone.now, db_index=True)
    event_name = models.CharField(max_length=120, default="Frontier Team Circuit")
    event = models.ForeignKey("rankings.CompetitionEvent", null=True, blank=True, on_delete=models.PROTECT, related_name="faction_matches")
    match_type = models.CharField(max_length=16, choices=Type.choices, default=Type.RANKED_TEAM)
    team_a = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="matches_a")
    team_b = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="matches_b")
    score_a = models.PositiveIntegerField(default=0, validators=[MaxValueValidator(100)])
    score_b = models.PositiveIntegerField(default=0, validators=[MaxValueValidator(100)])
    status = models.CharField(max_length=10, choices=Match.Status.choices, default=Match.Status.UPCOMING)
    rating_delta = models.FloatField(default=0)
    processed_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        ordering = ["-played_at", "-pk"]
        indexes = [models.Index(fields=["status", "-played_at"])]
        constraints = [models.CheckConstraint(condition=~Q(team_a=F("team_b")), name="distinct_team_opponents"), models.CheckConstraint(condition=~Q(status="COMPLETED") | ~Q(score_a=F("score_b")), name="completed_team_no_ties"), models.CheckConstraint(condition=Q(score_a__lte=100, score_b__lte=100), name="team_scores_max_100")]

    def __str__(self):
        return f"{self.team_a} {self.score_a}–{self.score_b} {self.team_b}"

    def clean(self):
        super().clean()
        if self.event_id and self.event.format != "FACTION":
            raise ValidationError({"event": "Choose a faction event for a faction match."})


class TeamRatingHistory(models.Model):
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="rating_history")
    recorded_at = models.DateTimeField(default=timezone.now)
    rating = models.FloatField()
    rank = models.PositiveIntegerField()
    event_label = models.CharField(max_length=120)

    class Meta:
        ordering = ["recorded_at", "pk"]
        indexes = [models.Index(fields=["team", "recorded_at"])]


class TeamRegistration(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending review"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request_key = models.UUIDField(unique=True)
    payload_hash = models.CharField(max_length=64, editable=False)
    team_name = models.CharField(max_length=64)
    tag = models.CharField(max_length=5, validators=[RegexValidator(r"^[A-Z0-9]{2,5}$", "Use 2–5 letters or numbers.")])
    region = models.CharField(max_length=4, choices=Player.Region.choices)
    description = models.CharField(max_length=500, blank=True)
    captain_username = models.SlugField(max_length=40)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="team_registrations")
    contact_discord = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    team = models.OneToOneField(Team, null=True, blank=True, on_delete=models.PROTECT, related_name="registration")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="reviewed_team_registrations")
    review_note = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-created_at"]
        permissions = [("approve_teamregistration", "Can approve or reject team registrations")]
        constraints = [
            models.UniqueConstraint(Lower("tag"), condition=Q(status__in=["PENDING", "APPROVED"]), name="active_registration_tag_unique"),
            models.UniqueConstraint(Lower("team_name"), condition=Q(status__in=["PENDING", "APPROVED"]), name="active_registration_name_unique"),
            models.CheckConstraint(condition=~Q(status="APPROVED") | Q(team__isnull=False), name="approved_registration_has_team"),
        ]

    @property
    def reference(self):
        return f"DW-{self.id.hex[:10].upper()}"

    def __str__(self):
        return f"{self.reference} · {self.team_name}"


class RegistrationMember(models.Model):
    registration = models.ForeignKey(TeamRegistration, on_delete=models.CASCADE, related_name="members")
    username = models.SlugField(max_length=40)
    display_name = models.CharField(max_length=64)
    is_captain = models.BooleanField(default=False)
    position = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ["position", "pk"]
        constraints = [models.UniqueConstraint(Lower("username"), "registration", name="registration_member_username_unique"), models.UniqueConstraint(fields=["registration"], condition=Q(is_captain=True), name="one_registration_captain")]


class RegistrationReview(models.Model):
    registration = models.ForeignKey(TeamRegistration, on_delete=models.PROTECT, related_name="reviews")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    decision = models.CharField(max_length=10, choices=TeamRegistration.Status.choices)
    note = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
