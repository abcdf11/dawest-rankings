from django.urls import path
from . import views
from . import events
from accounts.appearance import serve_image
urlpatterns = [path("rankings/", views.rankings), path("players/<slug:username>/", views.player_detail), path("simulate/", views.simulate), path("matches/<int:match_id>/complete/", views.complete), path("health/", views.health)]
urlpatterns += [path("players/<slug:username>/media/<slug:kind>/<slug:version>/", serve_image)]
urlpatterns += [path("events/", events.listing), path("events/<uuid:event_id>/", events.detail)]
urlpatterns += [path("events/<uuid:event_id>/logo/<slug:version>/", events.logo)]
from . import event_interest
urlpatterns += [path("events/<uuid:event_id>/interested/", event_interest.interested),
                path("event-notifications/", event_interest.inbox), path("event-notifications/read/", event_interest.mark_read)]
from . import pickems
urlpatterns += [path("events/<uuid:event_id>/pickems/", pickems.board), path("events/<uuid:event_id>/pickems/<int:matchup_id>/pick/", pickems.pick)]
from . import entries
urlpatterns += [path("events/<uuid:event_id>/entries/", entries.public_entries), path("events/<uuid:event_id>/entries/<slug:team_slug>/", entries.withdraw)]
from . import audio
urlpatterns += [path("players/<slug:username>/audio/<slug:version>/", audio.serve_player_audio)]
urlpatterns += [path("roblox/", views.roblox_players), path("roblox/<int:user_id>/", views.roblox_player)]
from . import koh
urlpatterns += [path("game/koh/rounds/", koh.report_round), path("koh/rounds/", koh.recent_rounds)]
from teams import roblox_link
urlpatterns += [path("game/factions/link/", roblox_link.game_link), path("roblox/factions/", roblox_link.roblox_factions)]
