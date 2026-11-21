"""Owner-uploaded faction theme audio, validated by content and served with Range support."""
import hashlib
import re

from django.db import transaction
from django.http import HttpResponse, HttpResponseNotModified
from django.shortcuts import get_object_or_404
from django.utils.http import parse_etags
from django.views.decorators.http import require_safe
from rest_framework import serializers
from rest_framework.decorators import api_view, parser_classes, permission_classes, throttle_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from accounts.models import AuditEntry
from rankings.eligibility import registered_teams
from .factions import own_faction
from .models import FactionAudio

MAX_AUDIO_BYTES = 8 * 1024 * 1024
FORMATS = "MP3, M4A/AAC, OGG, WAV, FLAC, or WebM"


def sniff(head):
    """Identify audio by its leading bytes; the filename and browser type are ignored."""
    if head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return "audio/mpeg"
    if head.startswith(b"OggS"):
        return "audio/ogg"
    if head.startswith(b"RIFF") and head[8:12] == b"WAVE":
        return "audio/wav"
    if head.startswith(b"fLaC"):
        return "audio/flac"
    if head.startswith(b"\x1aE\xdf\xa3"):
        return "audio/webm"
    if head[4:8] == b"ftyp":
        return "audio/mp4"
    return None


class AudioThrottle(UserRateThrottle):
    scope = "faction_audio"
    rate = "20/hour"


class AudioInput(serializers.Serializer):
    audio = serializers.FileField(required=False)
    title = serializers.CharField(required=False, allow_blank=True, max_length=80)
    remove = serializers.BooleanField(default=False)

    def validate_audio(self, upload):
        if upload.size > MAX_AUDIO_BYTES:
            raise serializers.ValidationError("Audio files can be up to 8 MB.")
        if upload.size < 64:
            raise serializers.ValidationError("That audio file is empty or incomplete.")
        upload.seek(0)
        content_type = sniff(upload.read(16))
        if content_type is None:
            raise serializers.ValidationError(f"Upload an audio file: {FORMATS}.")
        upload.content_type_detected = content_type
        return upload

    def validate(self, values):
        if not values.get("audio") and not values.get("remove") and "title" not in values:
            raise serializers.ValidationError("Choose an audio file, change the title, or remove the current track.")
        return values


def audio_payload(team):
    return {"audio_url": team.profile_audio_url, "audio_title": team.audio_title}


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
@throttle_classes([AudioThrottle])
def upload(request, username):
    own_faction(request, username)
    form = AudioInput(data=request.data)
    if set(request.data) - set(form.fields):
        return Response({"detail": "Only the faction audio track and its title can be changed here."}, status=400)
    form.is_valid(raise_exception=True)
    values = form.validated_data
    data = None
    if values.get("audio"):
        values["audio"].seek(0)
        data = values["audio"].read()
    with transaction.atomic():
        team = own_faction(request, username, lock=True)
        fields = ["updated_at"]
        if values.get("remove"):
            FactionAudio.objects.filter(team=team).delete()
            team.audio_version, team.audio_title = "", ""
            fields += ["audio_version", "audio_title"]
        else:
            if data is not None:
                version = hashlib.sha256(data).hexdigest()[:32]
                FactionAudio.objects.update_or_create(team=team, defaults={"version": version,
                    "content_type": values["audio"].content_type_detected, "data": data, "byte_size": len(data)})
                team.audio_version = version
                fields.append("audio_version")
            if "title" in values:
                team.audio_title = values["title"].strip()
                fields.append("audio_title")
            if not team.audio_version:
                return Response({"audio": "Upload an audio file first."}, status=400)
        team.save(update_fields=fields)
        AuditEntry.objects.create(actor=request.user, action="faction.audio.removed" if values.get("remove") else "faction.audio.updated",
                                  target_type="team", target_id=str(team.pk),
                                  details={"bytes": len(data) if data is not None else None, "title": team.audio_title})
    return Response(audio_payload(team))


RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


@require_safe
def serve(request, username, version):
    media = get_object_or_404(FactionAudio.objects.defer("data"), team__in=registered_teams().filter(username__iexact=username), version=version)
    etag = f'"{media.version}"'
    headers = {"ETag": etag, "Cache-Control": "public, max-age=86400, immutable", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes"}
    if etag in [value.removeprefix("W/") for value in parse_etags(request.headers.get("If-None-Match", ""))]:
        return HttpResponseNotModified(headers=headers)
    size = media.byte_size
    start, end, partial = 0, size - 1, False
    match = RANGE.match(request.headers.get("Range", "").strip())
    if match and (match[1] or match[2]):
        if match[1]:
            start, end = int(match[1]), int(match[2]) if match[2] else size - 1
        else:  # suffix range: the last N bytes
            start, end = max(size - int(match[2]), 0), size - 1
        end = min(end, size - 1)
        if start > end:
            return HttpResponse(status=416, headers={**headers, "Content-Range": f"bytes */{size}"})
        partial = True
    body = b"" if request.method == "HEAD" else bytes(FactionAudio.objects.values_list("data", flat=True).get(pk=media.pk))[start:end + 1]
    response = HttpResponse(body, content_type=media.content_type, status=206 if partial else 200, headers=headers)
    response["Content-Length"] = end - start + 1
    if partial:
        response["Content-Range"] = f"bytes {start}-{end}/{size}"
    return response
