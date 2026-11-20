import getpass
import sys
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Create a developer account with a securely prompted password; no public developer signup."
    def add_arguments(self, parser):
        parser.add_argument("--username")
        parser.add_argument("--password-stdin", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        username = (options["username"] or input("Developer username: ")).strip().lower()
        User = get_user_model()
        if not username or len(username) > 30 or not username.replace("_", "").isalnum():
            raise CommandError("Use up to 30 letters, digits, or underscores.")
        if User.objects.filter(username__iexact=username).exists():
            raise CommandError("That account already exists. Use Django Admin to manage its role.")
        password = sys.stdin.readline().rstrip("\r\n") if options["password_stdin"] else getpass.getpass("Password: ")
        if not options["password_stdin"] and password != getpass.getpass("Repeat password: "):
            raise CommandError("Passwords do not match.")
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
