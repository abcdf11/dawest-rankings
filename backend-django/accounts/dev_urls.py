from django.urls import path
from . import developer

urlpatterns = [path("dashboard/", developer.dashboard), path("registrations/<uuid:registration_id>/review/", developer.review), path("players/", developer.add_player), path("players/<int:player_id>/", developer.manage_player), path("teams/", developer.add_team), path("teams/<int:team_id>/", developer.manage_team)]
