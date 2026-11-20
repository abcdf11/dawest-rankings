# DAWEST

A black-and-white competitive rankings platform with real player accounts, registered teams, an independent developer console, and persistent database storage. React 19 / TypeScript / Vite, Django 5.2 / DRF, Node / Socket.io, PostgreSQL, and Redis.

## Run locally

Requires Node 22+ and Python 3.11+ (Python 3.12 is used in Docker). From the project directory, in PowerShell:

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend-django/requirements.txt
npm run dev
```

`npm run dev` starts Django, applies database migrations, then starts Vite. It reuses existing local servers when they are already running. React, CSS, and Django development code reload automatically.

- Rankings: **http://127.0.0.1:5173/**
- Player signup: **http://127.0.0.1:5173/signup**
- Player login: **http://127.0.0.1:5173/login**
- Team registration: **http://127.0.0.1:5173/register**
- Developer login: **http://127.0.0.1:5173/dev/login**
- Developer console: **http://127.0.0.1:5173/dev**
- Django Admin: **http://127.0.0.1:8000/admin/**

Separate server commands are `npm run dev:frontend` and `npm run dev:api`. If filesystem events fail in a synced folder, set `VITE_USE_POLLING=1` in `frontend/.env.local` and restart Vite.

## Create your developer account

With migrations applied, run this in another terminal from the project directory:

```powershell
npm run create:dev -- --username owner
```

Enter your chosen password at the hidden prompt. Sign in at **/dev/login**. There is no public developer signup or built-in developer password. Existing Django superusers can also use the console. Developers are staff accounts with the `accounts.access_dev_console` permission. The management command assigns a developer group with review permissions.

The console supports:

- Reviewing, approving, and rejecting team registrations with a public review note.
- Creating ordinary player accounts with an initial password.
- Creating approved teams from already registered players.
- Removing and restoring players and teams on the public leaderboard.
- Viewing the audit trail of account and moderation actions.

Removing a player deactivates their account and revokes their tracked login sessions. Restoring it requires the player to sign in again. Removing a team hides it from the ladder; match history and roster data are retained. Staff account roles are managed through Django Admin.

## Accounts, teams, and database rules

All public rankings read the Django database. Only active players linked to registered user accounts appear; teams require an active owner, registration timestamp, and active team record. Legacy demo records are preserved in storage and excluded from the live ladders. Static JSON fixtures are used only by tests, never as the public data source.

Player signup creates a Django user, a linked solo profile, an initial 1,500 rating, rating history, and audit records. Passwords use Django's password hashers and validators. Username uniqueness is case insensitive. User accounts, Django sessions, tracked account sessions, players, teams, memberships, registrations, reviews, rating histories, and audit entries are stored persistently.

Team registration requires a signed-in registered captain and 2 to 10 registered roster members. It never creates accounts for unregistered names. The captain comes from the authenticated session. Registration has no email field or email database column; Discord is optional. Status receipts are available to the submitting account and developers.

Developer approval atomically creates the team and memberships, assigns initial team rating and ranks, records the review, updates cache revisions, and emits refresh events. Team match results and solo match results use independent Elo ladders. Each player belongs to one current team, and a team has at most one captain.

The local database is **backend-django/db.sqlite3**, preserved across restarts. `SQLITE_PATH` can select a different SQLite file for isolated development/testing. Docker uses PostgreSQL with a persistent volume. No database reset is performed during startup or migrations.

## Authentication and permissions

Authentication uses Django sessions with an HttpOnly session cookie. Login, signup, and logout require CSRF protection, including anonymous login requests. The frontend first initializes the session/CSRF cookie, then submits credentials with the CSRF header. Session IDs rotate at login. Passwords and session credentials are not stored in localStorage or included in audit details.

Public signup cannot assign staff roles. The developer login checks staff permissions, and every developer API action verifies them again on the server. Account/login attempts and registrations are throttled. Deactivating a player revokes tracked sessions and removes them from public rankings. Private registration receipts enforce ownership.

## Deploy on Render with your existing Python service

The native Python deployment can serve both React and Django at one public URL. This fixes a deployment where `/api/v1/auth/session/` works but `/`, `/signup`, or `/dev/login` return Django's "Not Found" page.

1. In Render, create **New > Postgres**, named `dawest-db`, in the **same region as the existing web service**. Wait until it is available, then copy its **Internal Database URL** from the database's **Connect** menu. Choose a paid database for long-term use; free Render databases expire after 30 days.
2. Open the existing web service's **Environment** page. Keep the generated `DJANGO_SECRET_KEY` already configured and add:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | The database's Internal Database URL, entered only in Render |
   | `DJANGO_DEBUG` | `0` |
   | `COOKIE_SECURE` | `1` |
   | `TRUST_PROXY_HEADERS` | `1` |
   | `USE_REDIS` | `0` until a Redis instance and realtime gateway are configured |

   Keep `VITE_API_URL` and `VITE_SOCKET_URL` unset. The app uses its own origin for login and API calls. Render's assigned hostname is automatically added to Django's allowed hosts. A custom domain must also be included in `DJANGO_ALLOWED_HOSTS`.
3. Under **Settings > Build & Deploy**, select **Python 3**, leave **Root Directory** blank, and use:

   **Build Command**

   ```sh
   bash scripts/render-build.sh
   ```

   **Start Command**

   ```sh
   bash scripts/render-start.sh
   ```

4. Save and redeploy the latest commit. The build installs Python dependencies, builds React, and collects Django static files. Startup applies migrations and launches Gunicorn on Render's `PORT`. React pages and assets are served by Django and WhiteNoise.
5. Set **Health Check Path** to `/api/v1/health/`, then confirm that both `/` and `/api/v1/health/` respond successfully. The health endpoint checks the database, so a 500 there means database connectivity or migrations need attention.
6. To create a developer, open the web service's **Shell** and run `python backend-django/manage.py create_dev --username owner`. Enter your own password and sign in through `/dev/login`.

This configuration keeps player/team accounts in PostgreSQL across service restarts. Without Redis, the ladder refreshes by polling. The complete Node / Redis realtime stack is available through the Blueprint below. No SQLite fallback or default developer credentials are used on Render.

## Deploy the complete stack with a Render Blueprint

The repository includes `render.yaml`, a production Blueprint for the complete stack. It uses paid compute plans in Singapore. Review Render's displayed cost before applying the Blueprint. No Render resources have been created from this workspace.

| Resource | Purpose |
| --- | --- |
| `dawest` | Public Nginx service serving React and forwarding API and Socket.io requests |
| `dawest-api` | Private Django service for accounts, teams, rankings, and admin |
| `dawest-realtime` | Private Node / Socket.io gateway |
| `dawest-relay` | Background worker retrying committed ranking events |
| `dawest-db` | Persistent PostgreSQL 16 database |
| `dawest-cache` | Redis-compatible Render Key Value instance |

1. Create a GitHub repository and push the **contents of `dawest-rankings`** into its root. `render.yaml`, `package.json`, `package-lock.json`, `infra/`, `frontend/`, `backend-django/`, and `realtime-node/` must be included. Local `.env` files, `.venv`, `node_modules`, and SQLite files are ignored.
2. Sign in at <https://dashboard.render.com>, choose **New > Blueprint**, connect that repository, and select its branch. Use `render.yaml` as the Blueprint path.
3. Review the six resources and their paid plans, then apply the Blueprint. Render generates the Django secret and connects the internal database, cache, and services. The API's pre-deploy command applies database migrations automatically.
4. Wait for deployment to complete, then open the public URL shown for **`dawest`**. The generated hostname can include a suffix; use the URL Render actually displays.
5. Open **`dawest-api` > Shell** and run:

   ```sh
   python manage.py create_dev --username owner
   ```

   Choose your password at the hidden prompts. Sign in through your public site's `/dev/login` page.
6. Create player accounts through `/signup`, submit teams through `/register`, and approve them through `/dev`.

React, login requests, APIs, admin, and WebSockets all use the same HTTPS origin. Leave `VITE_API_URL` and `VITE_SOCKET_URL` unset for this Blueprint. The proxy preserves the public hostname and HTTPS scheme so session cookies and CSRF checks work. The frontend Docker build excludes local `.env` files.

Render uses a **new PostgreSQL database**. Existing local SQLite accounts and registrations are not automatically transferred. Do not set `USE_SQLITE=1` on Render: the ordinary service filesystem is ephemeral. Free Render PostgreSQL databases expire after 30 days, so this Blueprint selects a paid database.

For a custom domain, add it to the public **`dawest`** service and follow Render's DNS instructions. Add that hostname to `DJANGO_ALLOWED_HOSTS` in `render.yaml`, then push and sync the Blueprint. You can also replace `.onrender.com` with your exact assigned Render hostname after the first deployment. Keep the public proxy and Django's `TRUST_PROXY_HEADERS=1` together; that setting is for a trusted private proxy.

For verification, check your public `/api/v1/health/` and `/gateway/health`, register a player, refresh to confirm the session persists, and approve a team. The first endpoint checks the API; the second checks the gateway's Redis subscription. Changes pushed to the connected branch trigger new deployments.

References: [Render Django guide](https://render.com/docs/deploy-django), [Blueprint configuration](https://render.com/docs/blueprint-spec), [private networking](https://render.com/docs/private-network), and [free service limitations](https://render.com/docs/free).

The Blueprint schema and HTTPS authentication behavior can be checked locally; the actual Render deployment and Docker images still require verification on Render because Docker is unavailable in this workspace.

## Docker stack

Requires Docker Engine and Compose v2:

1. Copy `.env.example` to `.env` and replace the database password and Django secret with your own generated values.
2. Run `docker compose up --build -d`.
3. Create a developer with `docker compose exec backend python manage.py create_dev --username owner`.
4. Open **http://localhost:8080** and create player accounts through **/signup**.

PostgreSQL 16 and Redis 7 stay on the internal Compose network. Nginx routes API, static files, admin, and Socket.io through the same origin. The migration service runs before the API. The outbox relay retries committed ranking events after Redis failures.

For public HTTPS deployment, configure the real `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, and `SOCKET_ALLOWED_ORIGINS`; enable secure cookies using `COOKIE_SECURE=1`; and configure TLS redirects/HSTS at your edge proxy. Configure database backups and operational monitoring for your host.

The earlier private Sites deployment is a static build and does not host Django or a database. Use the Docker stack or a backend-capable server for authenticated production use.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/v1/auth/session/` | Current account and CSRF bootstrap |
| POST | `/api/v1/auth/signup/` | Register a normal player account |
| POST | `/api/v1/auth/login/` | Player login |
| POST | `/api/v1/auth/dev-login/` | Developer login with staff permission check |
| POST | `/api/v1/auth/logout/` | End the current session |
| GET | `/api/v1/auth/roster-players/` | Find registered available roster members |
| GET | `/api/v1/rankings/` | Registered player ladder |
| GET | `/api/v1/players/<username>/` | Registered player profile and history |
| GET | `/api/v1/teams/rankings/` | Registered team ladder |
| GET | `/api/v1/teams/<slug>/` | Registered team profile and roster |
| POST | `/api/v1/teams/register/` | Authenticated captain's team application |
| GET | `/api/v1/teams/registrations/<uuid>/` | Owner/developer registration status |
| GET | `/api/v1/dev/dashboard/` | Developer applications, competitors, and activity |
| POST | `/api/v1/dev/registrations/<uuid>/review/` | Approve/reject an application |
| POST | `/api/v1/dev/players/` | Provision a normal player account |
| PATCH / DELETE | `/api/v1/dev/players/<id>/` | Update, remove, or restore a player |
| POST | `/api/v1/dev/teams/` | Create a team from registered players |
| PATCH / DELETE | `/api/v1/dev/teams/<id>/` | Remove or restore a team |

Existing simulation, match completion, and health routes remain available. Read-only simulation uses the same dynamic Elo formula as verified results. K=32, expected win chance follows standard Elo, margin weight is `1 + 0.35 * ln(1 + round difference)`, and event weights are ranked 1.0, showmatch 1.2, qualifier 1.25, tournament 1.5. Global ranks are recalculated among eligible registered competitors.

## Checks

```powershell
npm test
npm run build
npx playwright install chromium
npm run test:e2e -- --workers=2
$env:USE_SQLITE='1'; $env:USE_REDIS='0'
Set-Location backend-django
..\.venv\Scripts\python.exe manage.py test config accounts rankings teams --noinput
```

Browser presentation tests use isolated API fixtures. Backend tests enforce real session authentication, CSRF, role boundaries, roster ownership, registered-only visibility, unique usernames, and transactional reviews. `tests/integration/auth-flow.mjs` exercises real browser signup, cookie persistence, team registration, developer approval, adding/removing/restoring competitors, and session revocation against an isolated API on port 8001. Set `SQLITE_PATH` to that isolated migrated database and optionally `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; run it with the frontend on 5173. Never point integration fixtures at a production database.

`tests/integration/native-deployment.mjs` checks the production React build served directly by Django, without Vite or API mocks. Build React, migrate an isolated SQLite database, collect static files, and run Django with `DEBUG=0` on localhost port 8002; then run `node tests/integration/native-deployment.mjs`. It verifies same-origin signup/session persistence, leaderboard visibility, registration and developer pages, assets, and genuine API 404s. It creates test accounts only on localhost.

Docker is unavailable in the current workspace, so PostgreSQL locking and actual Redis delivery require deployment-environment integration checks. SQLite, frontend/backend builds, session flows, and browser interactions are verified locally.
