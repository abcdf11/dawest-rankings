"""Owner-uploaded faction theme audio (shared logic lives in rankings.audio)."""
from django.db import transaction
from django.views.decorators.http import require_safe
from rest_framework.decorators import api_view, parser_classes, permission_classes, throttle_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated

from rankings.audio import AudioThrottle, apply_upload, audio_response, parse_upload
from rankings.eligibility import registered_teams
from .factions import own_faction
from .models import FactionAudio


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
@throttle_classes([AudioThrottle])
def upload(request, username):
    own_faction(request, username)
    values, error = parse_upload(request)
    if error:
        return error
    with transaction.atomic():
        team = own_faction(request, username, lock=True)
        return apply_upload(request, team, values, FactionAudio, "team", "faction", "team")


@require_safe
def serve(request, username, version):
    return audio_response(request, FactionAudio.objects.filter(team__in=registered_teams().filter(username__iexact=username), version=version))
