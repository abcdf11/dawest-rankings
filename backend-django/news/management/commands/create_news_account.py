import getpass
import sys

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import UsernameAlias
from rankings.models import Player

GROUP = "DaWest News"


def news_group():
    group, _ = Group.objects.get_or_create(name=GROUP)
    group.permissions.add(Permission.objects.get(codename="publish_article", content_type__app_label="news"))
    return group


class Command(BaseCommand):
    help = "Create a news account that can post articles at /news, or give an existing account that role (--grant)."

    def add_arguments(self, parser):
        parser.add_argument("--username")
        parser.add_argument("--grant", action="store_true", help="Give an EXISTING account the news role instead of creating one.")
        parser.add_argument("--revoke", action="store_true", help="Take the news role away from an existing account.")
        parser.add_argument("--password-stdin", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        User = get_user_model()
        username = (options["username"] or input("News account username: ")).strip().lower()
        if options["grant"] or options["revoke"]:
            user = User.objects.filter(username__iexact=username).first()
            if not user:
                raise CommandError("No account with that username.")
            group = news_group()
            if options["revoke"]:
                user.groups.remove(group)
                self.stdout.write(self.style.SUCCESS(f"{user.username} can no longer post news."))
            else:
                user.groups.add(group)
                self.stdout.write(self.style.SUCCESS(f"{user.username} can now post news at /news."))
            return
        if not username or len(username) > 30 or not username.replace("_", "").isalnum():
            raise CommandError("Use up to 30 letters, digits, or underscores.")
        if User.objects.filter(username__iexact=username).exists() or UsernameAlias.objects.filter(username__iexact=username).exists() or Player.objects.filter(username__iexact=username).exists():
            raise CommandError("That username is taken or reserved. Use --grant to give an existing account the news role.")
        password = sys.stdin.readline().rstrip("\r\n") if options["password_stdin"] else getpass.getpass("Password: ")
        if not options["password_stdin"] and password != getpass.getpass("Repeat password: "):
            raise CommandError("Passwords do not match.")
        user = User(username=username)
        try:
            validate_password(password, user)
        except ValidationError as exc:
            raise CommandError(" ".join(exc.messages))
        user.set_password(password)
        user.save()
        user.groups.add(news_group())
        self.stdout.write(self.style.SUCCESS(f"News account {username} created. Sign in at /login, then post at /news."))
