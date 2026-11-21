from django.urls import path
from . import views
from . import events
from accounts.appearance import serve_image
urlpatterns = [path("rankings/", views.rankings), path("players/<slug:username>/", views.player_detail), path("simulate/", views.simulate), path("matches/<int:match_id>/complete/", views.complete), path("health/", views.health)]
urlpatterns += [path("players/<slug:username>/media/<slug:kind>/<slug:version>/", serve_image)]
urlpatterns += [path("events/", events.listing), path("events/<uuid:event_id>/", events.detail)]
