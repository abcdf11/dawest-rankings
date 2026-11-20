from django.urls import path
from . import views

urlpatterns = [path("register/", views.register), path("registrations/<uuid:registration_id>/", views.registration_status), path("rankings/", views.rankings), path("simulate/", views.simulate), path("matches/<int:match_id>/complete/", views.complete), path("<slug:username>/", views.detail)]
