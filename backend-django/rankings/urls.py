from django.urls import path
from . import views
from accounts.appearance import serve_image
urlpatterns = [path("rankings/", views.rankings), path("players/<slug:username>/", views.player_detail), path("simulate/", views.simulate), path("matches/<int:match_id>/complete/", views.complete), path("health/", views.health)]
urlpatterns += [path("players/<slug:username>/media/<slug:kind>/<slug:version>/", serve_image)]
