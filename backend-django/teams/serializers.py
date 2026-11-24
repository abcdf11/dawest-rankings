from rest_framework import serializers
from rankings.serializers import PlayerSerializer, SimulationInput
from .models import Team, TeamMatch, TeamRatingHistory


def form_for_team(team, matches):
    form = []
    for match in matches:
        is_a = match.team_a_id == team.pk
        own, other = (match.score_a, match.score_b) if is_a else (match.score_b, match.score_a)
        opponent = match.team_b if is_a else match.team_a
        won = own > other
        form.append({"id": match.pk, "opponent": opponent.display_name, "opponent_username": opponent.username, "result": "W" if won else "L", "score": f"{own}–{other}", "event": match.event_name, "played_at": match.played_at, "delta": round(match.rating_delta * (1 if won else -1), 2)})
    return form


class TeamSerializer(PlayerSerializer):
    kind = serializers.CharField(default="teams", read_only=True)
    is_verified = serializers.BooleanField(read_only=True)
    roster = serializers.SerializerMethodField()

    class Meta(PlayerSerializer.Meta):
        model = Team
        fields = [f for f in PlayerSerializer.Meta.fields if f != "team"] + ["kind", "tag", "roster", "is_verified"]

    def get_last_five(self, obj):
        return form_for_team(obj, self.context.get("forms", {}).get(obj.pk, [])[:5])

    def get_roster(self, obj):
        return PlayerSerializer(obj.roster.all(), many=True).data


class TeamHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = TeamRatingHistory
        fields = ["recorded_at", "rating", "rank", "event_label"]


class TeamSimulationInput(SimulationInput):
    player_a_id = None
    player_b_id = None
    team_a_id = serializers.IntegerField(min_value=1)
    team_b_id = serializers.IntegerField(min_value=1)
    match_type = serializers.ChoiceField(choices=TeamMatch.Type.choices, default="RANKED_TEAM")

    def validate(self, data):
        if data["team_a_id"] == data["team_b_id"]:
            raise serializers.ValidationError("Choose two different teams.")
        if data["score_a"] == data["score_b"]:
            raise serializers.ValidationError("A completed match cannot be tied.")
        return data
