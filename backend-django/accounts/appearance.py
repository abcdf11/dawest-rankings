from django.db import transaction
from django.http import HttpResponse, HttpResponseNotModified
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.http import parse_etags
from django.views.decorators.http import require_safe
from rest_framework import serializers
from rest_framework.decorators import api_view, parser_classes, permission_classes, throttle_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from rankings.eligibility import registered_players, players_for_username
from rankings.engine import publish_pending_events
from rankings.models import ProfileMedia, RankingEvent
from rankings.profile_images import normalize_image
from .models import AuditEntry
from .services import lock_ladders


class ImageUploadThrottle(UserRateThrottle):
    scope = "profile_images"
    rate = "20/hour"


class AppearanceInput(serializers.Serializer):
    avatar = serializers.FileField(required=False)
    banner = serializers.FileField(required=False)
    remove_avatar = serializers.BooleanField(default=False)
    remove_banner = serializers.BooleanField(default=False)

    def validate(self, values):
        if not any(values.values()):
            raise serializers.ValidationError("Choose an image or remove an existing image first.")
        for kind in ("avatar", "banner"):
            if kind in values and values.get(f"remove_{kind}"):
                raise serializers.ValidationError({kind: "Choose either an upload or removal for this image."})
        return values


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
@throttle_classes([ImageUploadThrottle])
def update_appearance(request):
    # The owner comes only from the authenticated session, never from an ID in
    # the form. Public profiles do not grant edit access to another player.
    get_object_or_404(registered_players(), user=request.user)
    serializer = AppearanceInput(data=request.data)
    unknown = set(request.data) - set(serializer.fields)
    if unknown:
        return Response({"detail": "Only profile images and removal options can be changed here."}, status=400)
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    processed = {kind: normalize_image(values[kind], kind) for kind in ("avatar", "banner") if kind in values}
    with transaction.atomic():
        states = lock_ladders()
        player = get_object_or_404(registered_players().select_for_update(), user=request.user)
        changed = []
        for kind in ("avatar", "banner"):
            if kind in processed:
                image = processed[kind]
                ProfileMedia.objects.update_or_create(player=player, kind=kind, defaults={"version": image.version, "content_type": image.content_type, "data": image.data, "poster": image.poster, "byte_size": len(image.data), "poster_size": len(image.poster), "width": image.width, "height": image.height, "frames": image.frames})
                setattr(player, f"{kind}_version", image.version)
                changed.append(kind)
            elif values.get(f"remove_{kind}"):
                ProfileMedia.objects.filter(player=player, kind=kind).delete()
                setattr(player, f"{kind}_version", "")
                if kind == "avatar":
                    player.avatar_url = ""
                changed.append(kind)
        player.save(update_fields=["avatar_version", "banner_version", "avatar_url", "updated_at"])
        audit = AuditEntry.objects.create(actor=request.user, action="profile.images.updated", target_type="player", target_id=str(player.pk), details={"images": changed})
        for state in states:
            state.revision += 1
            state.save()
            RankingEvent.objects.create(payload={"reason": "moderation", "operation_id": str(audit.pk), "kind": "teams" if state.pk == 2 else "players", "revision": state.revision, "updated_at": timezone.now().isoformat(), "players": []})
        transaction.on_commit(publish_pending_events)
    return Response({"avatar_url": player.profile_avatar_url, "banner_url": player.profile_banner_url})


@require_safe
def serve_image(request, username, kind, version):
    media = get_object_or_404(ProfileMedia.objects.defer("data", "poster"), player__in=players_for_username(username), kind=kind, version=version)
    return media_response(request, media)


def media_response(request, media):
    still = request.GET.get("still") == "1" and media.frames > 1
    etag = f'"{media.version}{"-still" if still else ""}"'
    headers = {"ETag": etag, "Cache-Control": "public, max-age=86400, immutable", "X-Content-Type-Options": "nosniff"}
    if request.headers.get("If-None-Match") == "*" or etag in [value.removeprefix("W/") for value in parse_etags(request.headers.get("If-None-Match", ""))]:
        return HttpResponseNotModified(headers=headers)
    content_type = "image/webp" if still else media.content_type
    data = b"" if request.method == "HEAD" else bytes(media.poster if still else media.data)
    response = HttpResponse(data, content_type=content_type, headers=headers)
    response["Content-Length"] = media.poster_size if still else media.byte_size
    return response
