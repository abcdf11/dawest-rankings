from django.urls import path
from . import developer
from .admin_commands import commands, ratings
from rankings.events import manage_list, manage_detail

urlpatterns = [path("dashboard/", developer.dashboard), path("registrations/<uuid:registration_id>/review/", developer.review), path("players/", developer.add_player), path("players/<int:player_id>/", developer.manage_player), path("teams/", developer.add_team), path("teams/<int:team_id>/", developer.manage_team)]
urlpatterns += [path("ratings/", ratings), path("commands/", commands)]
urlpatterns += [path("events/", manage_list), path("events/<uuid:event_id>/", manage_detail)]
