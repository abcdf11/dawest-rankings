import os
from pathlib import Path
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.getenv("DJANGO_DEBUG", "0") == "1"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "local-development-key-do-not-use-in-production")
USE_SQLITE = os.getenv("USE_SQLITE", "0") == "1"
if not DEBUG and not USE_SQLITE and SECRET_KEY.startswith("local-development"):
    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY for production.")
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,backend,testserver").split(",")
INSTALLED_APPS = ["django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes", "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles", "rest_framework", "corsheaders", "rankings"]
MIDDLEWARE = ["django.middleware.security.SecurityMiddleware", "whitenoise.middleware.WhiteNoiseMiddleware", "corsheaders.middleware.CorsMiddleware", "django.contrib.sessions.middleware.SessionMiddleware", "django.middleware.common.CommonMiddleware", "django.middleware.csrf.CsrfViewMiddleware", "django.contrib.auth.middleware.AuthenticationMiddleware", "django.contrib.messages.middleware.MessageMiddleware", "django.middleware.clickjacking.XFrameOptionsMiddleware"]
ROOT_URLCONF = "config.urls"
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "DIRS": [], "APP_DIRS": True, "OPTIONS": {"context_processors": ["django.template.context_processors.request", "django.contrib.auth.context_processors.auth", "django.contrib.messages.context_processors.messages"]}}]
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}} if USE_SQLITE else {"default": {"ENGINE": "django.db.backends.postgresql", "NAME": os.getenv("POSTGRES_DB", "dawest"), "USER": os.getenv("POSTGRES_USER", "dawest"), "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""), "HOST": os.getenv("POSTGRES_HOST", "postgres"), "PORT": os.getenv("POSTGRES_PORT", "5432"), "CONN_MAX_AGE": 60}}
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
USE_REDIS = os.getenv("USE_REDIS", "1") == "1"
CACHES = {"default": {"BACKEND": "django_redis.cache.RedisCache", "LOCATION": REDIS_URL, "KEY_PREFIX": "dawest", "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient", "IGNORE_EXCEPTIONS": True, "SOCKET_CONNECT_TIMEOUT": 2, "SOCKET_TIMEOUT": 2}}} if USE_REDIS else {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
CORS_ALLOWED_ORIGINS = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8080").split(",")
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS
REST_FRAMEWORK = {"DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"], "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"], "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle", "rest_framework.throttling.UserRateThrottle"], "DEFAULT_THROTTLE_RATES": {"anon": "180/min", "user": "600/min"}}
AUTH_PASSWORD_VALIDATORS = [{"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"}, {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"}, {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"}]
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0") == "1"
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
