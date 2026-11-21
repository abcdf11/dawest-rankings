from django.contrib import admin
from django.urls import include, path, re_path
from .frontend import frontend
urlpatterns = [path("admin/", admin.site.urls), path("api/v1/auth/", include("accounts.urls")), path("api/v1/dev/", include("accounts.dev_urls")), path("api/v1/teams/", include("teams.urls")), path("api/v1/", include("rankings.urls"))]
urlpatterns += [path("api/v1/factions/", include("teams.faction_urls"))]
urlpatterns += [re_path(r"^(?:signup|login|register|profile|players/[A-Za-z0-9_-]+|faction|factions(?:/[A-Za-z0-9_-]+(?:/manage)?)?|teams/[A-Za-z0-9_-]+|events(?:/[A-Fa-f0-9-]+)?|dev(?:/login)?)?/?$", frontend)]
