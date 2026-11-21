from django.contrib import admin, messages
from django.db import IntegrityError
from rankings.engine import publish_pending_events
from rankings.models import RankingEvent
from .engine import process_team_match
from .models import Team, TeamMatch, TeamMembership
from .models import RegistrationMember, RegistrationReview, TeamRegistration
from .registration import review_registration
from rest_framework.exceptions import APIException


class MembershipInline(admin.TabularInline):
    model = TeamMembership
    autocomplete_fields = ["player"]
    extra = 1


class RegistrationMemberInline(admin.TabularInline):
    model = RegistrationMember
    extra = 0
    can_delete = False
    readonly_fields = ["username", "display_name", "is_captain", "position"]
    def has_add_permission(self, request, obj=None):
        return False


class ReviewInline(admin.TabularInline):
    model = RegistrationReview
    extra = 0
    can_delete = False
    readonly_fields = ["actor", "decision", "note", "created_at"]
    def has_add_permission(self, request, obj=None):
        return False


@admin.register(TeamRegistration)
class RegistrationAdmin(admin.ModelAdmin):
    list_display = ["reference", "team_name", "tag", "region", "status", "created_at"]
    list_filter = ["status", "region"]
    search_fields = ["team_name", "tag", "captain_username", "submitted_by__username"]
    readonly_fields = [f.name for f in TeamRegistration._meta.fields if f.name != "review_note"]
    inlines = [RegistrationMemberInline, ReviewInline]
    actions = ["approve_registrations", "reject_registrations"]
    def has_add_permission(self, request): return False
    def has_delete_permission(self, request, obj=None): return False
    def has_approve_permission(self, request):
        return request.user.has_perm("teams.approve_teamregistration")
    def formfield_for_dbfield(self, db_field, request, **kwargs):
        if db_field.name == "review_note":
            kwargs["help_text"] = "Public note shown on the registration status page."
        return super().formfield_for_dbfield(db_field, request, **kwargs)

    @admin.action(description="Approve registrations and create teams", permissions=["approve"])
    def approve_registrations(self, request, queryset):
        for registration in queryset:
            try:
                review_registration(registration.pk, request.user, True, registration.review_note)
                self.message_user(request, f"Approved {registration.team_name}.")
            except (APIException, IntegrityError) as exc:
                self.message_user(request, str(exc), level=messages.ERROR)

    @admin.action(description="Reject selected registrations", permissions=["approve"])
    def reject_registrations(self, request, queryset):
        for registration in queryset:
            try:
                review_registration(registration.pk, request.user, False, registration.review_note)
                self.message_user(request, f"Rejected {registration.team_name}.")
            except (APIException, IntegrityError) as exc:
                self.message_user(request, str(exc), level=messages.ERROR)


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ["rank", "display_name", "tag", "region", "rating", "wins", "losses"]
    list_filter = ["region", "tier"]
    search_fields = ["display_name", "username", "tag"]
    inlines = [MembershipInline]
    readonly_fields = ["rating", "previous_rating", "peak_rating", "tier", "rank", "previous_rank", "regional_rank", "wins", "losses", "current_streak", "kd_ratio", "rounds_won", "rounds_lost", "updated_at"]


@admin.register(TeamMatch)
class TeamMatchAdmin(admin.ModelAdmin):
    list_display = ["team_a", "score_a", "score_b", "team_b", "status", "event_name"]
    list_filter = ["status", "match_type"]
    autocomplete_fields = ["team_a", "team_b"]
    readonly_fields = ["rating_delta", "processed_at"]
    actions = ["finalize", "broadcast_live"]

    def get_readonly_fields(self, request, obj=None):
        return [f.name for f in TeamMatch._meta.fields if f.name != "event"] if obj and obj.processed_at else self.readonly_fields

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if obj.status == "COMPLETED":
            process_team_match(obj.pk)

    @admin.action(description="Finalize team scores and update team rankings")
    def finalize(self, request, queryset):
        for match in queryset:
            try:
                process_team_match(match.pk)
            except ValueError as exc:
                self.message_user(request, str(exc), level=messages.ERROR)

    @admin.action(description="Broadcast selected live team matches")
    def broadcast_live(self, request, queryset):
        for match in queryset.filter(status="LIVE").select_related("team_a", "team_b"):
            RankingEvent.objects.create(channel="match:live", payload={"kind": "teams", "match_id": match.pk, "event": match.event_name, "player_a": match.team_a.display_name, "player_b": match.team_b.display_name, "score_a": match.score_a, "score_b": match.score_b, "status": "LIVE"})
        publish_pending_events()
