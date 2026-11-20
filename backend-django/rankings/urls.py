from django.urls import path
from . import views
urlpatterns = [path("rankings/", views.rankings), path("players/<slug:username>/", views.player_detail), path("simulate/", views.simulate), path("matches/<int:match_id>/complete/", views.complete), path("health/", views.health)]
