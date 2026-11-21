"""Log in with Roblox: links a member's Roblox account to their DaWest player profile.

Flow (OAuth 2.0 authorization code + PKCE, https://create.roblox.com/docs/cloud/auth/oauth2-overview):
  1. GET  /api/v1/auth/roblox/start/     signed-in member -> redirected to Roblox's consent page
  2. GET  /api/v1/auth/roblox/callback/  Roblox -> here with ?code&state; we swap the code for a token,
                                         read the Roblox user (openid profile) and store it on the Player
  3. POST /api/v1/auth/roblox/unlink/    removes the link
The game reads ratings by Roblox user id from GET /api/v1/roblox/<user_id>/ (rankings.views).

Settings (environment): ROBLOX_OAUTH_CLIENT_ID, ROBLOX_OAUTH_CLIENT_SECRET and optionally
ROBLOX_OAUTH_REDIRECT_URI (defaults to <this site>/api/v1/auth/roblox/callback/; it must match the
redirect URL registered on the OAuth app in the Roblox Creator Dashboard exactly).
"""
import base64
import hashlib
import json
import secrets
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.db import IntegrityError, transaction
from django.http import HttpResponseRedirect
from django.utils import timezone
from django.views.decorators.http import require_GET
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from rankings.models import Player
from .models import AuditEntry

AUTHORIZE_URL = "https://apis.roblox.com/oauth/v1/authorize"
TOKEN_URL = "https://apis.roblox.com/oauth/v1/token"
USERINFO_URL = "https://apis.roblox.com/oauth/v1/userinfo"
SESSION_KEY = "roblox_oauth"


def configured():
    return bool(settings.ROBLOX_OAUTH_CLIENT_ID and settings.ROBLOX_OAUTH_CLIENT_SECRET)


def redirect_uri(request):
    return settings.ROBLOX_OAUTH_REDIRECT_URI or request.build_absolute_uri("/api/v1/auth/roblox/callback/")


def _back(player, outcome):
    """Back to the member's profile with ?roblox=<outcome> for the page to show."""
    path = f"/players/{player.username}" if player else "/profile"
    return HttpResponseRedirect(f"{path}?roblox={outcome}")


def _player(user):
    return getattr(user, "player_profile", None) if user.is_authenticated else None


def _post_form(url, data):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), method="POST", headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read().decode())


def _get_json(url, token):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read().decode())


def roblox_identity(code, verifier):
    """Swap the authorization code for an access token and read the Roblox user. Returns (id, username, display name)."""
    token = _post_form(TOKEN_URL, {"client_id": settings.ROBLOX_OAUTH_CLIENT_ID, "client_secret": settings.ROBLOX_OAUTH_CLIENT_SECRET, "grant_type": "authorization_code", "code": code, "code_verifier": verifier})
    info = _get_json(USERINFO_URL, token["access_token"])
    user_id = int(info["sub"])
    username = str(info.get("preferred_username") or info.get("name") or "")[:40]
    display = str(info.get("nickname") or info.get("name") or username)[:64]
    return user_id, username, display


@require_GET
def start(request):
    player = _player(request.user)
    if player is None:
        return HttpResponseRedirect("/login?next=/profile")
    if not configured():
        return _back(player, "unavailable")
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    request.session[SESSION_KEY] = {"state": state, "verifier": verifier, "player": player.pk}
    params = {"client_id": settings.ROBLOX_OAUTH_CLIENT_ID, "redirect_uri": redirect_uri(request), "scope": "openid profile", "response_type": "code", "state": state, "code_challenge": challenge, "code_challenge_method": "S256"}
    return HttpResponseRedirect(f"{AUTHORIZE_URL}?{urllib.parse.urlencode(params)}")


@require_GET
def callback(request):
    player = _player(request.user)
    pending = request.session.pop(SESSION_KEY, None)
    if player is None:
        return HttpResponseRedirect("/login?next=/profile")
    if request.GET.get("error"):
        return _back(player, "cancelled")
    state = request.GET.get("state", "")
    code = request.GET.get("code", "")
    # the state must be the one we just issued, for this same signed-in player (stops forged links)
    if not (pending and code and secrets.compare_digest(str(pending.get("state", "")), state) and pending.get("player") == player.pk):
        return _back(player, "expired")
    try:
        user_id, username, display = roblox_identity(code, pending["verifier"])
    except (urllib.error.URLError, KeyError, ValueError, TypeError):
        return _back(player, "failed")
    if Player.objects.filter(roblox_user_id=user_id).exclude(pk=player.pk).exists():
        return _back(player, "taken")
    try:
        with transaction.atomic():
            Player.objects.filter(pk=player.pk).update(roblox_user_id=user_id, roblox_username=username, roblox_display_name=display, roblox_linked_at=timezone.now())
            AuditEntry.objects.create(actor=request.user, action="player.roblox_linked", target_type="player", target_id=str(player.pk), details={"roblox_user_id": user_id, "roblox_username": username})
    except IntegrityError:
        return _back(player, "taken")
    return _back(player, "linked")


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def unlink(request):
    player = _player(request.user)
    if player is None:
        return Response({"detail": "Only player accounts can link Roblox."}, status=400)
    old = player.roblox_user_id
    Player.objects.filter(pk=player.pk).update(roblox_user_id=None, roblox_username="", roblox_display_name="", roblox_linked_at=None)
    if old:
        AuditEntry.objects.create(actor=request.user, action="player.roblox_unlinked", target_type="player", target_id=str(player.pk), details={"roblox_user_id": old})
    return Response({"linked": False})
