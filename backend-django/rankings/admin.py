from django.contrib import admin, messages
from .engine import process_completed_match
from .models import Match, Player, RankingEvent, RatingHistory

@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ["rank", "display_name", "region", "tier", "rating", "wins", "losses"]
    list_filter = ["region", "tier"]
    search_fields = ["username", "display_name"]
    readonly_fields = ["rating", "previous_rating", "peak_rating", "rank", "previous_rank", "regional_rank", "tier", "wins", "losses", "current_streak", "kd_ratio", "rounds_won", "rounds_lost", "updated_at"]

@admin.register(Match)
class MatchAdmin(admin.ModelAdmin):
    list_display = ["id", "player_a", "score_a", "score_b", "player_b", "status", "event_name", "played_at"]
    list_filter = ["status", "match_type"]
    autocomplete_fields = ["player_a", "player_b"]
    readonly_fields = ["rating_delta", "processed_at"]
    actions = ["finalize_results", "broadcast_live"]
    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if obj.status == Match.Status.COMPLETED:
            process_completed_match(obj.pk)
    def get_readonly_fields(self, request, obj=None):
        base = list(self.readonly_fields)
        return base + [f.name for f in Match._meta.fields if f.name not in base and f.name != "id"] if obj and obj.processed_at else base
    def has_delete_permission(self, request, obj=None):
        return super().has_delete_permission(request, obj) and not (obj and obj.processed_at)
    @admin.action(description="Finalize scores and update rankings")
    def finalize_results(self, request, queryset):
        for match in queryset:
            try:
                process_completed_match(match.pk)
            except ValueError as exc:
                self.message_user(request, f"Match {match.pk}: {exc}", level=messages.ERROR)
    @admin.action(description="Broadcast selected live scores")
    def broadcast_live(self, request, queryset):
        from .engine import publish_pending_events
        for match in queryset.filter(status="LIVE").select_related("player_a", "player_b"):
            RankingEvent.objects.create(channel="match:live", payload={"match_id": match.pk, "event": match.event_name, "player_a": match.player_a.display_name, "player_b": match.player_b.display_name, "score_a": match.score_a, "score_b": match.score_b, "status": match.status})
        publish_pending_events()

@admin.register(RatingHistory)
class HistoryAdmin(admin.ModelAdmin):
    list_display = ["player", "rating", "rank", "recorded_at", "event_label"]
    readonly_fields = [f.name for f in RatingHistory._meta.fields]
    def has_add_permission(self, request): return False
    def has_delete_permission(self, request, obj=None): return False

admin.site.site_header = "DaWest Competition Control"
admin.site.site_title = "DaWest Admin"
