from django.contrib.auth import authenticate, get_user_model, login, logout
from django.db import IntegrityError
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rankings.eligibility import registered_players
from .services import SignupInput, create_player_account, is_developer, user_payload
from .models import AccountSession


class AuthThrottle(SimpleRateThrottle):
    scope = "dawest_auth"
    rate = "20/hour"
    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


def session_payload(request):
    return {"authenticated": request.user.is_authenticated, "user": user_payload(request.user) if request.user.is_authenticated else None, "csrf_token": get_token(request)}


@api_view(["GET"])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def session(request):
    return Response(session_payload(request))


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
@csrf_protect
def signup(request):
    if any(key in request.data for key in ("is_staff", "is_superuser", "permissions", "role")):
        return Response({"detail": "Account privileges cannot be assigned during signup."}, status=400)
    serializer = SignupInput(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        user = create_player_account(serializer.validated_data)
    except IntegrityError:
        return Response({"detail": "This username is already registered."}, status=409)
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    request.session.save()
    AccountSession.objects.get_or_create(user=user, session_key=request.session.session_key)
    return Response({"authenticated": True, "user": user_payload(user), "csrf_token": get_token(request)}, status=201)


def _login(request, developer):
    username = str(request.data.get("username", "")).strip()[:150]
    password = request.data.get("password", "")
    if not isinstance(password, str) or not 1 <= len(password) <= 128:
        return Response({"detail": "Invalid username or password."}, status=400)
    account = get_user_model().objects.filter(username__iexact=username).first()
    user = authenticate(request, username=account.username if account else username, password=password)
    if user is None or (developer and not is_developer(user)):
        return Response({"detail": "Invalid developer credentials." if developer else "Invalid username or password."}, status=400)
    login(request, user)
    request.session.save()
    AccountSession.objects.get_or_create(user=user, session_key=request.session.session_key)
    return Response({"authenticated": True, "user": user_payload(user), "csrf_token": get_token(request)})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
@csrf_protect
def player_login(request):
    return _login(request, False)


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
@csrf_protect
def developer_login(request):
    return _login(request, True)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@csrf_protect
def signout(request):
    AccountSession.objects.filter(session_key=request.session.session_key).delete()
    logout(request)
    return Response({"authenticated": False, "user": None, "csrf_token": get_token(request)})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def roster_players(request):
    from django.db.models import Q
    search = request.query_params.get("search", "").strip()[:40]
    rows = registered_players().filter(Q(username__icontains=search) | Q(display_name__icontains=search)).filter(team_membership__isnull=True).order_by("username")[:50]
    return Response({"players": [{"id": p.pk, "username": p.username, "display_name": p.display_name, "region": p.region} for p in rows]})
