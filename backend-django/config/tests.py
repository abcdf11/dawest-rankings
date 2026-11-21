from pathlib import Path
from tempfile import TemporaryDirectory
import os
import runpy
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings


class FrontendDeploymentTests(SimpleTestCase):
    def test_react_routes_serve_html_and_keep_api_and_asset_404s(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text('<html><div id="root">DAWEST</div></html>', encoding="utf-8")
            (root / "assets").mkdir()
            (root / "assets" / "app-test.js").write_text('console.log("DAWEST");', encoding="utf-8")
            with override_settings(FRONTEND_DIST=root, WHITENOISE_ROOT=root, DEBUG=False):
                for path in ("/", "/login", "/signup", "/register", "/profile", "/players/registered_player", "/players/registered_player/", "/dev", "/dev/login", "/dev/login/"):
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, 200, path)
                    self.assertIn(b'DAWEST', b"".join(response.streaming_content))
                    self.assertIn("no-store", response.headers["Cache-Control"])
                asset = self.client.get("/assets/app-test.js")
                self.assertEqual(asset.status_code, 200)
                self.assertIn(b'console.log', b"".join(asset.streaming_content))
                self.assertEqual(self.client.get("/api/v1/missing/").status_code, 404)
                self.assertEqual(self.client.get("/assets/missing.js").status_code, 404)
                self.assertEqual(self.client.post("/signup").status_code, 405)

    def test_missing_build_does_not_return_a_successful_empty_page(self):
        with TemporaryDirectory() as directory, override_settings(FRONTEND_DIST=Path(directory), WHITENOISE_ROOT=None):
            self.assertEqual(self.client.get("/signup").status_code, 404)


class RenderSettingsTests(SimpleTestCase):
    def settings(self, values):
        with patch.dict(os.environ, {"DJANGO_SECRET_KEY": "test-only-production-config-key", **values}, clear=True):
            return runpy.run_path(str(Path(__file__).with_name("settings.py")))

    def test_render_database_url_and_hostname_work_without_a_redis_service(self):
        values = self.settings({
            "DATABASE_URL": "postgresql://sample:pass%2Bword@db.internal:5432/dawest",
            "RENDER_EXTERNAL_HOSTNAME": "dawest-example.onrender.com",
        })
        database = values["DATABASES"]["default"]
        self.assertEqual(database["ENGINE"], "django.db.backends.postgresql")
        self.assertEqual(database["PASSWORD"], "pass+word")
        self.assertEqual(database["HOST"], "db.internal")
        self.assertEqual(database["NAME"], "dawest")
        self.assertIn("dawest-example.onrender.com", values["ALLOWED_HOSTS"])
        self.assertFalse(values["USE_REDIS"])

    def test_explicit_local_database_and_docker_redis_settings_are_preserved(self):
        values = self.settings({
            "USE_SQLITE": "1", "SQLITE_PATH": "isolated.sqlite3",
            "DATABASE_URL": "postgresql://sample:sample@db.internal/dawest",
            "USE_REDIS": "1", "REDIS_URL": "redis://redis:6379/0",
        })
        self.assertEqual(values["DATABASES"]["default"]["ENGINE"], "django.db.backends.sqlite3")
        self.assertEqual(values["DATABASES"]["default"]["NAME"], "isolated.sqlite3")
        self.assertTrue(values["USE_REDIS"])
