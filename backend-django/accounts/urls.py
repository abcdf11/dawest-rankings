from django.urls import path
from . import views
from .appearance import update_appearance
from . import roblox
from .usernames import change_username

urlpatterns = [path("session/", views.session), path("signup/", views.signup), path("login/", views.player_login), path("dev-login/", views.developer_login), path("logout/", views.signout), path("roster-players/", views.roster_players)]
urlpatterns += [path("profile/appearance/", update_appearance)]
urlpatterns += [path("username/", change_username)]
from rankings.audio import upload_player_audio
urlpatterns += [path("profile/audio/", upload_player_audio)]
urlpatterns += [path("roblox/start/", roblox.start), path("roblox/callback/", roblox.callback), path("roblox/unlink/", roblox.unlink)]
