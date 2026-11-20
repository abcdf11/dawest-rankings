#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f dist/index.html ]; then
    echo 'React build missing. Set Build Command to: bash scripts/render-build.sh' >&2
    exit 1
fi

if [ "${RENDER:-}" = "true" ] && [ "${USE_SQLITE:-0}" != "1" ] && [ -z "${DATABASE_URL:-}" ] && [ -z "${POSTGRES_HOST:-}" ]; then
    echo 'Database missing. Create Render Postgres and set DATABASE_URL to its Internal Database URL.' >&2
    exit 1
fi

python backend-django/manage.py migrate --noinput
exec python -m gunicorn --chdir backend-django config.wsgi:application \
    --bind "0.0.0.0:${PORT:-10000}" \
    --workers "${WEB_CONCURRENCY:-1}" \
    --access-logfile - --error-logfile -
