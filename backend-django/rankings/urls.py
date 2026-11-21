from django.urls import path
from . import views
from . import events
from accounts.appearance import serve_image
urlpatterns = [path("rankings/", views.rankings), path("players/<slug:username>/", views.player_detail), path("simulate/", views.simulate), path("matches/<int:match_id>/complete/", views.complete), path("health/", views.health)]
urlpatterns += [path("players/<slug:username>/media/<slug:kind>/<slug:version>/", serve_image)]
urlpatterns += [path("events/", events.listing), path("events/<uuid:event_id>/", events.detail)]
from . import pickems
urlpatterns += [path("events/<uuid:event_id>/pickems/", pickems.board), path("events/<uuid:event_id>/pickems/<int:matchup_id>/pick/", pickems.pick)]
from . import entries
urlpatterns += [path("events/<uuid:event_id>/entries/", entries.public_entries), path("events/<uuid:event_id>/entries/<slug:team_slug>/", entries.withdraw)]
from . import audio
urlpatterns += [path("players/<slug:username>/audio/<slug:version>/", audio.serve_player_audio)]
urlpatterns += [path("roblox/", views.roblox_players), path("roblox/<int:user_id>/", views.roblox_player)]
