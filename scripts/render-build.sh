#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

python -m pip install -r backend-django/requirements.txt
npm ci --include=dev
npm run build --workspace frontend
python backend-django/manage.py collectstatic --noinput
