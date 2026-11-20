import io
import os
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command, CommandError
from django.test import TestCase


class DeveloperBootstrapTests(TestCase):
    password = "River!Frontier793824"

    def bootstrap(self, values):
        output = io.StringIO()
        with patch.dict(os.environ, values, clear=True):
            call_command("create_dev", from_env=True, stdout=output)
        self.assertNotIn(self.password, output.getvalue())
        return output.getvalue()

    def values(self, **overrides):
        return {
            "DAWEST_BOOTSTRAP_DEV_USERNAME": "owner",
            "DAWEST_BOOTSTRAP_DEV_PASSWORD": self.password,
            **overrides,
        }

    def test_absent_variables_do_not_create_accounts(self):
        self.assertEqual(self.bootstrap({}), "")
        self.assertFalse(get_user_model().objects.exists())

    def test_startup_creates_hashed_developer_and_restarts_preserve_password(self):
        output = self.bootstrap(self.values())
        self.assertIn("created", output)
        user = get_user_model().objects.get(username="owner")
        self.assertTrue(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertTrue(user.check_password(self.password))
        self.assertNotEqual(user.password, self.password)
        self.assertTrue(user.has_perm("accounts.access_dev_console"))
        self.assertTrue(user.has_perm("teams.approve_teamregistration"))
        original_hash = user.password

        self.bootstrap(self.values(DAWEST_BOOTSTRAP_DEV_USERNAME="OWNER", DAWEST_BOOTSTRAP_DEV_PASSWORD="Another!StrongRiver8943"))
        self.bootstrap({})
        user.refresh_from_db()
        self.assertEqual(user.password, original_hash)
        self.assertEqual(get_user_model().objects.count(), 1)

    def test_bootstrap_does_not_promote_an_existing_player(self):
        user = get_user_model().objects.create_user(username="owner", password=self.password)
        original_hash = user.password
        with self.assertRaisesMessage(CommandError, "unused developer username"):
            self.bootstrap(self.values())
        user.refresh_from_db()
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertEqual(user.password, original_hash)

    def test_partial_configuration_does_not_create_an_account(self):
        for values in ({"DAWEST_BOOTSTRAP_DEV_USERNAME": "owner"}, {"DAWEST_BOOTSTRAP_DEV_PASSWORD": self.password}):
            with self.assertRaisesMessage(CommandError, "Set both"):
                self.bootstrap(values)
        self.assertFalse(get_user_model().objects.exists())

    def test_weak_password_does_not_create_an_account(self):
        with self.assertRaises(CommandError):
            self.bootstrap(self.values(DAWEST_BOOTSTRAP_DEV_PASSWORD="password"))
        self.assertFalse(get_user_model().objects.exists())

    def test_restart_does_not_reactivate_a_disabled_developer(self):
        self.bootstrap(self.values())
        user = get_user_model().objects.get(username="owner")
        user.is_active = False
        user.save(update_fields=["is_active"])
        original_hash = user.password
        self.bootstrap(self.values())
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertEqual(user.password, original_hash)
