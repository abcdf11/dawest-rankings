from django.contrib import admin
from django.urls import include, path, re_path
from .frontend import frontend
urlpatterns = [path("admin/", admin.site.urls), path("api/v1/auth/", include("accounts.urls")), path("api/v1/dev/", include("accounts.dev_urls")), path("api/v1/teams/", include("teams.urls")), path("api/v1/", include("rankings.urls"))]
urlpatterns += [re_path(r"^(?:signup|login|register|dev(?:/login)?)?/?$", frontend)]
