import getpass
import os
import sys
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Create a developer account using a hidden prompt or one-time startup environment variables."
    def add_arguments(self, parser):
        parser.add_argument("--username")
        source = parser.add_mutually_exclusive_group()
        source.add_argument("--password-stdin", action="store_true")
        source.add_argument("--from-env", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        from_env = options["from_env"]
        if from_env:
            if options["username"]:
                raise CommandError("Use DAWEST_BOOTSTRAP_DEV_USERNAME with --from-env.")
            username = os.environ.get("DAWEST_BOOTSTRAP_DEV_USERNAME", "")
            password = os.environ.get("DAWEST_BOOTSTRAP_DEV_PASSWORD", "")
            if not username and not password:
                return
            if not username.strip() or not password:
                raise CommandError("Set both DAWEST_BOOTSTRAP_DEV_USERNAME and DAWEST_BOOTSTRAP_DEV_PASSWORD, or remove both.")
        else:
            username = options["username"] or input("Developer username: ")
        username = username.strip().lower()
        User = get_user_model()
        if not username or len(username) > 30 or not username.replace("_", "").isalnum():
            raise CommandError("Use up to 30 letters, digits, or underscores.")
        existing = User.objects.filter(username__iexact=username).first()
        if existing:
            if from_env and existing.is_staff and (not existing.is_active or existing.has_perm("accounts.access_dev_console")):
                self.stdout.write("Developer account already exists; startup setup skipped. Credentials and account status were preserved.")
                return
            raise CommandError("That username is already registered. Choose an unused developer username.")
        if not from_env:
            password = sys.stdin.readline().rstrip("\r\n") if options["password_stdin"] else getpass.getpass("Password: ")
            if not options["password_stdin"] and password != getpass.getpass("Repeat password: "):
                raise CommandError("Passwords do not match.")
        if len(password) > 128:
            raise CommandError("Use a password of at most 128 characters.")
        user = User(username=username, is_staff=True)
        try:
            validate_password(password, user)
        except ValidationError as exc:
            raise CommandError(" ".join(exc.messages))
        user.set_password(password)
        user.save()
        group, _ = Group.objects.get_or_create(name="DaWest Developers")
        group.permissions.add(*Permission.objects.filter(codename__in=["access_dev_console", "approve_teamregistration", "view_teamregistration", "change_teamregistration", "view_team", "add_team", "change_team", "view_player", "add_player", "change_player", "view_auditentry"]))
        user.groups.add(group)
        self.stdout.write(self.style.SUCCESS(f"Developer {username} created. Sign in at /dev/login."))
