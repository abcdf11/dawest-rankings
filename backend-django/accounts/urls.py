from django.urls import path
from . import views

urlpatterns = [path("session/", views.session), path("signup/", views.signup), path("login/", views.player_login), path("dev-login/", views.developer_login), path("logout/", views.signout), path("roster-players/", views.roster_players)]
