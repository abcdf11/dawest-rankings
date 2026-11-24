from rest_framework import serializers
from .models import Match, Player, RatingHistory

class FormSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    opponent = serializers.CharField()
    opponent_username = serializers.CharField()
    result = serializers.CharField()
    score = serializers.CharField()
    event = serializers.CharField()
    played_at = serializers.DateTimeField()
    delta = serializers.FloatField()

def form_for_player(player: Player, matches: list[Match]) -> list[dict]:
    result = []
    for match in matches:
        is_a = match.player_a_id == player.pk
        own, other = (match.score_a, match.score_b) if is_a else (match.score_b, match.score_a)
        opponent = match.player_b if is_a else match.player_a
        result.append({"id": match.pk, "opponent": opponent.display_name, "opponent_username": opponent.username, "result": "W" if own > other else "L", "score": f"{own}–{other}", "event": match.event_name, "played_at": match.played_at, "delta": round(match.rating_delta * (1 if own > other else -1), 2)})
    return result

class PlayerSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()
    team = serializers.SerializerMethodField()
    rank_delta = serializers.SerializerMethodField()
    win_rate = serializers.SerializerMethodField()
    last_five = serializers.SerializerMethodField()
    class Meta:
        model = Player
        fields = ["id", "username", "display_name", "region", "tier", "avatar_url", "accent_color", "rating", "previous_rating", "peak_rating", "rank", "previous_rank", "regional_rank", "rank_delta", "wins", "losses", "win_rate", "current_streak", "kd_ratio", "updated_at", "last_five", "team"]
    def get_team(self, obj):
        membership = getattr(obj, "team_membership", None)
        if membership is None:
            return None
        team = membership.team
        # a faction removed in the developer console isn't shown
        if not team.is_active:
            return None
        return {"username": team.username, "display_name": team.display_name, "tag": team.tag}
    def get_avatar_url(self, obj):
        return getattr(obj, "profile_avatar_url", obj.avatar_url)
    def get_rank_delta(self, obj):
        return obj.previous_rank - obj.rank
    def get_win_rate(self, obj):
        return round(100 * obj.wins / max(1, obj.wins + obj.losses), 1)
    def get_last_five(self, obj):
        return form_for_player(obj, self.context.get("forms", {}).get(obj.pk, [])[:5])

class RatingHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = RatingHistory
        fields = ["recorded_at", "rating", "rank", "event_label"]

class SimulationInput(serializers.Serializer):
    player_a_id = serializers.IntegerField(min_value=1)
    player_b_id = serializers.IntegerField(min_value=1)
    score_a = serializers.IntegerField(min_value=0, max_value=100)
    score_b = serializers.IntegerField(min_value=0, max_value=100)
    match_type = serializers.ChoiceField(choices=Match.Type.choices, default=Match.Type.RANKED_1V1)
    def validate(self, data):
        if data["player_a_id"] == data["player_b_id"]:
            raise serializers.ValidationError("Choose two different players.")
        if data["score_a"] == data["score_b"]:
            raise serializers.ValidationError("A completed match cannot be tied.")
        return data

class CompleteInput(serializers.Serializer):
    score_a = serializers.IntegerField(min_value=0, max_value=100)
    score_b = serializers.IntegerField(min_value=0, max_value=100)
    def validate(self, data):
        if data["score_a"] == data["score_b"]:
            raise serializers.ValidationError("A completed match cannot be tied.")
        return data
