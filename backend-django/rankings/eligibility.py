from .models import Player


def registered_players():
    return Player.objects.filter(user__isnull=False, user__is_active=True, registered_at__isnull=False, is_active=True)


def registered_teams():
    from teams.models import Team
    return Team.objects.filter(owner__isnull=False, owner__is_active=True, registered_at__isnull=False, is_active=True)
