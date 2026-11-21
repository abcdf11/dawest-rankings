from django.urls import path
from . import faction_audio, factions

urlpatterns = [
    path("", factions.directory),
    path("mine/", factions.mine),
    path("requests/<uuid:request_id>/withdraw/", factions.withdraw),
    path("<slug:username>/", factions.detail),
    path("<slug:username>/manage/", factions.manage),
    path("<slug:username>/join/", factions.join),
    path("<slug:username>/requests/<uuid:request_id>/review/", factions.review),
    path("<slug:username>/members/<int:player_id>/remove/", factions.remove_member),
    path("<slug:username>/appearance/", factions.appearance),
    path("<slug:username>/media/<slug:kind>/<slug:version>/", factions.image),
    path("<slug:username>/audio/", faction_audio.upload),
    path("<slug:username>/audio/<slug:version>/", faction_audio.serve),
]
