# DAWEST RANKINGS

A solo 1v1 competitive ladder with a dark frontier visual system, player trajectories, a match simulator, and shareable Top 10/20 lists. React 19 / TypeScript / Vite / Tailwind / Framer Motion / TanStack Query; Django 5.2 / DRF; Node 22 / Express / Socket.io; PostgreSQL 16 and Redis 7.

## Try the interface

Requires Node 22 or newer. From this directory:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The default is a self-contained, explicitly labeled demo with 20 fictional players, 301 processed matches, and actual engine-generated rating histories. Search, tier/region filters, sorting, profiles, chart tooltips, match-form details, the simulator, and the community builder all work without backend services. Lists can be dragged, moved with accessible buttons, and shared in URL hash state. Sharing preserves order; it doesn't write to the official ladder.

The private Sites deployment serves this **static demo**. Sites does not run the Django/PostgreSQL/Redis services. Deploy the stack below on a Docker-capable server for the live official ladder.

## Run all services

Requires Docker Engine with Compose v2.

1. Copy `.env.example` to `.env`. Replace both example secrets with independently generated values. For example, generate a secret with `python -c "import secrets; print(secrets.token_urlsafe(64))"`.
2. Run `docker compose up --build -d`.
3. Run `docker compose exec backend python manage.py seed_dawest` to load the optional fictional demonstration season. The command refuses to overwrite a populated database.
4. Run `docker compose exec backend python manage.py createsuperuser` and choose your own credentials.
5. Open **http://localhost:8080**, and **http://localhost:8080/admin/** for competition control.

PostgreSQL and Redis stay on the private Compose network; only the web server exposes a port. The one-shot migration service finishes before API startup. The event relay retries committed events every two seconds. Database and Redis data persist in named volumes. Nginx routes API, admin, static assets, and Socket.io through the same origin. No default administrator or password is created.

For HTTPS deployment, terminate TLS at your reverse proxy, set your actual `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, and `SOCKET_ALLOWED_ORIGINS`, enable secure cookies (`COOKIE_SECURE=1` in the backend environment), and configure TLS redirects/HSTS at the edge. Keep Redis and PostgreSQL private. Set up database backups, monitoring, and secret management for your hosting environment.

## Run Django without Docker

Use Python 3.12 in deployment (local checks also support Python 3.11). For an isolated local SQLite database with an in-memory cache, in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend-django/requirements.txt
$env:USE_SQLITE='1'
$env:USE_REDIS='0'
$env:DJANGO_DEBUG='1'
Set-Location backend-django
..\.venv\Scripts\python.exe manage.py migrate
..\.venv\Scripts\python.exe manage.py seed_dawest
..\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

SQLite is a convenience for local development and tests. Use PostgreSQL for transaction locking in the live ladder. In another terminal, set `$env:VITE_DATA_MODE='official'` and run `npm run dev` from the project root. Vite proxies `/api` to port 8000 and `/socket.io` to port 3001. The UI polls every minute while the websocket gateway is disconnected and accurately shows its connection state. To run the gateway separately, set `REDIS_URL` to your Redis instance and run `npm run dev --workspace realtime-node`.

For a separately hosted frontend, set the build variables `VITE_DATA_MODE=official`, `VITE_API_URL=https://your-api.example/api/v1`, and `VITE_SOCKET_URL=https://your-gateway.example`. Add that frontend's exact origin to the backend and gateway allowlists. Rebuild after changing Vite variables.

## Rating behavior

This is **dynamic Elo**, not Glicko-2: the model does not claim to track rating deviation or volatility.

```text
expected_A = 1 / (1 + 10 ^ ((rating_B - rating_A) / 400))
margin = 1 + 0.35 * ln(1 + abs(score_A - score_B))
delta_A = round(32 * event_weight * margin * (actual_A - expected_A), 2)
delta_B = -delta_A
```

Ranked 1v1: **1.0×**; showmatch: **1.2×**; qualifier: **1.25×**; tournament: **1.5×**. Transfers are capped at the losing player's available rating, so ratings remain nonnegative and points remain conserved. Scores must be distinct integers from 0 to 100. Ties and self-play are rejected. Sorting breaks rating ties by username, identically in simulations and committed results.

Tiers: **Legend ≥1900**, **Outlaw ≥1700**, **Gunslinger ≥1500**, **Deputy ≥1300**, **Rookie <1300**. Win rate is wins divided by completed matches; round K/D is rounds won divided by rounds lost (denominator floored at 1). Form is newest first. Rank deltas compare the latest verified match.

`process_completed_match()` locks a singleton ladder-state row, then the match and players, inside one database transaction. It updates Elo, peak, tier, global/regional ranks, records, streaks, round K/D, history, and an outbox event together. A processed timestamp prevents duplicate rating transfers. Conflicting re-finalization via the API returns 409. Moderators need both staff status and the `rankings.change_match` permission. Session authentication retains CSRF protection.

Leaderboards use revisioned, 60-second Redis cache keys with commit-time invalidation. The revision in PostgreSQL prevents stale keys from being reused even if Redis invalidation fails. Redis publication happens after commit; an outbox retains failed publications for the relay. Delivery is at least once, and the gateway deduplicates event IDs. Redis Pub/Sub isn't durable client replay: reconnecting clients fetch the latest authoritative ladder. Multiple gateway instances each subscribe and broadcast to their own clients; configure sticky sessions or websocket-only transport if balancing Socket.io polling across instances.

## API

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/v1/rankings/?tier=ALL&region=ALL&search=` | Ranked players, deltas, form, source, revision; up to 500 players per response |
| GET | `/api/v1/players/<username>/` | Profile, latest 20 duels, latest 120 history points |
| POST | `/api/v1/simulate/` | Read-only rating/rank projection |
| POST | `/api/v1/matches/<id>/complete/` | Staff with match-change permission; idempotent completion |
| GET | `/api/v1/health/` | API/database readiness |
| GET | `/gateway/health` | Gateway/Redis subscription readiness through Nginx |
| GET | `/api/recent-results` | Gateway's latest received match updates |

Simulation JSON:

```json
{"player_a_id":1,"player_b_id":2,"score_a":5,"score_b":2,"match_type":"RANKED_1V1"}
```

Completion JSON: `{"score_a":5,"score_b":2}`. Create a match in Django Admin, enter its scores, and select **Completed** to process it on save. The bulk **Finalize scores and update rankings** action also processes results. For live matches, the **Broadcast selected live scores** action sends current scores to the ticker. Completed results are immutable in the admin.

Gateway rooms: `rankings`, `matches`. Redis channels: `rankings:updated`, `match:live`. Client events: `RANKINGS_REFRESH`, `MATCH_LIVE`, `GATEWAY_STATUS`. The gateway validates broker payloads and never accepts client-supplied match results.

## Validation

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Backend tests in PowerShell:

```powershell
$env:USE_SQLITE='1'; $env:USE_REDIS='0'
Set-Location backend-django
..\.venv\Scripts\python.exe manage.py test rankings --noinput
```

Tests cover conservation of points, event/margin weighting, tier boundaries, idempotency, rollback, read-only simulations, cache revisioning, database constraints, API filters and permissions, shared URL validation, gateway event schemas, and desktop/mobile browser workflows.

The current environment passed the TypeScript builds, 11 backend tests using SQLite, 7 JavaScript tests, 8 desktop/mobile Chromium tests, and an additional browser integration test reading the running Django API and requesting a server-side simulation. Docker is unavailable in this workspace, so the Compose services, PostgreSQL locking behavior, and actual Redis/socket delivery haven't been integration-tested here. Before a public production launch, run that integration suite against your deployed PostgreSQL/Redis infrastructure.

The optional `playwright.integration.config.ts` test expects Django at port 8000 and an official-mode Vite server at port 5174. Start that frontend with `VITE_DATA_MODE=official npm exec --workspace frontend -- vite --host 127.0.0.1 --port 5174` (set the environment variable using your shell's syntax), then run `npx playwright test --config playwright.integration.config.ts`.

To regenerate the committed demo snapshot from an existing seed database:

```sh
python manage.py seed_dawest --export ../frontend/src/data/seed.json
```

## Project structure

```text
frontend/src/          React components, hooks, shared simulation and demo data
backend-django/        Django models, migrations, rating engine, API and admin
realtime-node/src/     Express / Socket.io / Redis subscriber and event validation
infra/                Dockerfiles and Nginx reverse proxy
tests/browser/        Playwright desktop/mobile workflows
docker-compose.yml    PostgreSQL, Redis, migrations, core API, relay, gateway, web
```

Visual reference: [VALORANT Global Power Rankings](https://valorantesports.com/vi-VN/gpr/2026/current). DaWest uses its own player identity, UI, and fictional competition data; no VALORANT logos, player data, or artwork are included.
