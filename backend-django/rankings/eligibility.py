from .models import Player


def registered_players():
    return Player.objects.filter(user__isnull=False, user__is_active=True, registered_at__isnull=False, is_active=True)


def competitive_players():
    return registered_players().filter(is_restricted=False)


def require_unrestricted(user):
    from rest_framework.exceptions import PermissionDenied
    if Player.objects.filter(user=user, is_restricted=True).exists():
        raise PermissionDenied("This account is restricted from ranked play and faction management.")


def registered_teams():
    from teams.models import Team
    return Team.objects.filter(owner__isnull=False, owner__is_active=True, registered_at__isnull=False, is_active=True)
