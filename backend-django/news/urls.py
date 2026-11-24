from django.urls import path
from . import views

urlpatterns = [path("", views.articles), path("<slug:slug>/", views.article)]
