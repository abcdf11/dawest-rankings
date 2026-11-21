# DAWEST

A black-and-white competitive rankings platform with real player accounts, registered teams, an independent developer console, and persistent database storage. React 19 / TypeScript / Vite, Django 5.2 / DRF, Node / Socket.io, PostgreSQL, and Redis.

The site shows official player/faction rankings, profiles, and recorded results. The community tier list and what-if simulator UI have been removed, including their navigation, share-link builder, and promotional cards. Older `#list=` links open the official rankings. Public page copy uses functional labels instead of slogans. The player avatar sits above the banner overlays, so custom banners cannot shade or cover the image.

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

Players can customize their own picture and banner through **Customize profile** on `/profile`. PNG, JPG, static WebP, and GIF uploads are supported, with a live preview and remove/restore-default controls. The server center-crops and resizes pictures to **256 × 256** and banners to **1280 × 240**. Animated GIF frames, frame durations, transparency, and loop settings are preserved; static images become optimized WebP files. Reduced-motion visitors receive a still first-frame image.

Each image is limited to **8 MB**, **16 megapixels per source frame**, and **120 GIF frames**, with an additional total decoding budget. Images are validated by their contents and re-encoded without EXIF metadata. The authenticated session determines the owner; the upload endpoint cannot target another player. Both selected images are processed before the database transaction, so a failed upload does not partially replace the existing profile.

Processed images and animation posters are stored in the existing database in a separate `ProfileMedia` table. Player rows contain only version identifiers, keeping leaderboard queries lightweight. Only the latest picture and banner are retained per player. This works on Render Free without a persistent disk, a Shell session, or another storage account. The existing Render startup script applies the new migration automatically. Images survive service restarts as long as the database is retained. Public image URLs are versioned and support ETag caching; image updates refresh the leaderboard cache revisions and team roster pictures.

Player signup and login open the player's own profile at `/players/<username>`, unless an explicit return destination such as team registration was requested. `/profile` opens the current player's page or sends an anonymous visitor to login. Developer accounts keep their `/dev` destination. Leaderboard names, podium cards, team roster members, and the account menu link to profiles.

The osu!-inspired profile layout keeps the monochrome DaWest theme, with a cover, avatar, region and team details, global/regional ranks, an interactive rating/rank graph, career statistics, filtered recent matches, rating activity, and milestones derived from recorded results. Empty accounts show their registration point and an empty match record. Public profile URLs work directly and after refresh on the native Render deployment.

Authentication uses Django sessions with an HttpOnly session cookie. Login, signup, and logout require CSRF protection, including anonymous login requests. The frontend first initializes the session/CSRF cookie, then submits credentials with the CSRF header. Session IDs rotate at login. Passwords and session credentials are not stored in localStorage or included in audit details.

Public signup cannot assign staff roles. The developer login checks staff permissions, and every developer API action verifies them again on the server. Account/login attempts and registrations are throttled. Deactivating a player revokes tracked sessions and removes them from public rankings. Private registration receipts enforce ownership.

## Events

The **Events** navigation tab opens `/events`, available on desktop and mobile. Published events can be searched and filtered by upcoming/live/past status or solo/faction format. `/events/<uuid>` displays the description, region, location, schedule, optional registration link, and verified linked match results. Times use the visitor's browser timezone. Public pages refresh their data every minute; drafts return 404.

Developers manage events at **`/dev` → Events** (or `/dev#events`). They can create drafts, edit details and schedules, publish/unpublish, and mark events live, completed, or cancelled. Scheduled events automatically become live at their start time and completed at their end time; manual completed/cancelled states take priority. An event without an end time remains live until a developer completes it. Registration links accept HTTP(S) only. These are external links; this feature does not add a separate participant signup system.

Select an event in the **Event** field of a solo or faction match in Django Admin to associate its results. The association remains editable after verification while scores and rating fields stay locked. Only completed, processed matches appear in event results, and player/faction names link to their profiles. Formats must match the linked matches; events with existing matches cannot change format through the developer UI.

Events use the `CompetitionEvent` table with optional match foreign keys, so existing results are retained. Creation and updates require developer permissions and session CSRF protection and are recorded in the audit log. Unpublishing hides an event without deleting its match associations. The existing Render startup script applies both event migrations automatically; no new environment variables are needed.

### Pick'ems

In **`/dev` → Event maker**, choose **Pick'ems** on an event to add matchups (two options, optional label, 1–100 points, lock time defaulting to the event start). Developers can lock a matchup early, set or clear its winner, and delete it (removing its picks). Options cannot change once players have picked.

**Faction events take team registrations.** On a published faction event's page, a faction leader can register (or withdraw) their faction until the event starts; restricted accounts cannot register. In the Pick'ems window, developers see the registered teams, can add any registered team from the Teams list (even after registration closes), and can remove one unless it is in a matchup. Faction-event matchups are built by choosing Team A and Team B from the registered teams; solo events keep free-text options. An event with registered teams or pick'ems cannot change format. Entries live in `EventEntry`.

On a published event's page, signed-in registered players pick one option per matchup and can change it until it locks. Pick distributions stay hidden until lock. Setting a winner scores correct picks and updates the event's standings (points, then correct picks; ties share a rank). Matchups live in `PickemMatchup` and picks in `PickemPick`; creation, updates, results, and deletions are audited. The migration applies automatically on startup.

## Admin Elo controls and moderation terminal

Sign in through `/dev/login`, open `/dev`, and select **Elo controls** to add or subtract player or faction Elo. Choose a ladder and target, enter a signed amount, and give a reason. Player adjustments affect solo Elo; faction adjustments affect team Elo. Each adjustment updates previous/peak rating, tier, global/regional ranks, rating history, audit records, and cache revisions without creating match wins or losses. Amounts support two decimal places and must produce an Elo between 0 and 1,000,000.

The **Terminal** tab supports these commands:

```text
help
status username
ban username Abusive behavior
unban username Appeal approved
restrict username Competitive review pending
unrestrict username Review complete
elo player username +25 Verified rating correction
elo faction faction-slug +50 Verified faction correction
```

Bans disable login, revoke tracked sessions, and hide the player from public profiles and solo rankings. Restrictions keep login and profile access, show an unranked notice, exclude the player from solo rankings/simulations, and block new faction registrations, joins, leader management, and ranked match participation. Existing memberships/history remain stored; a faction cannot record a new match with a banned/restricted roster member. Unban restores login without clearing a separate restriction; use `unrestrict` to restore competitive participation. Restriction reasons are visible only to the player and developer accounts.

The terminal accepts only the documented commands and never executes OS shell commands. Both endpoints require developer permission and session CSRF protection. Staff accounts cannot be targeted. Mutations require a reason, run under the existing ladder locks, and use a UUID request key so a retried Elo submission applies once. Reasons and before/after Elo values are retained in the audit database. The new restriction columns are applied automatically by the existing Render startup migration step; no new environment variables are required.

## Factions and leader dashboard

Approved teams are factions: they keep their existing team ratings, registration, owner, and roster. Register a faction through `/register`; developer approval creates its public faction profile. The approved registration receipt and team leaderboard names open the faction page.

- `/factions` lists public factions, supports search, and shows the signed-in player's own factions and pending join requests.
- `/faction` redirects to the player's current faction, their sole owned faction, or the directory. Anonymous visitors go to login with a return destination.
- `/factions/<team-slug>` displays the banner, logo, leader, roster, power rating, rank, and recent verified matches. Player names open their individual profiles.
- `/factions/<team-slug>/manage` is the leader dashboard. Only the existing team owner can access requests, accept or decline applicants, remove non-leader members, and customize faction images. The request inbox refreshes every 30 seconds and after actions.
- `/teams/<team-slug>` redirects to the public faction profile.

Registered players can request membership with an optional message, withdraw pending requests, and leave a faction as a non-leader. Each player can belong to one faction; each roster contains at most 10 members. Acceptance rechecks eligibility, membership, pending team-registration reservations, and capacity under the existing ladder transaction locks. It adds the membership, cancels other pending faction requests, records the decision, and invalidates both leaderboard revisions. Repeated decisions do not create duplicate memberships. Private request messages are available only to the applicant and faction owner.

Faction logos and banners support the same PNG/JPG/WebP/GIF validation and automatic fitting as player images: **256 × 256 logos**, **1280 × 240 banners**, **8 MB per file**, and up to **120 GIF frames**. Animation and reduced-motion posters are preserved. Images live in a separate `FactionMedia` database table; requests live in `FactionJoinRequest`. Player images remain independent. The Render startup script applies the new migration automatically without a Shell session or additional storage configuration.

### Player and faction theme audio

Players choose **Theme audio** on their own profile (`/profile`) to upload a track for `/players/<username>`; the account comes from the signed-in session. On `/factions/<team-slug>/manage`, the faction owner can likewise upload a **Theme audio** track (MP3, M4A/AAC, OGG, WAV, FLAC, or WebM, up to **8 MB**) with an optional title, replace it, retitle it, or remove it. Files are identified by their contents, not their names. The track plays on loop when someone opens the public player or faction profile. Browsers block sound until a visitor interacts with the page, so if autoplay is blocked the track starts on the visitor's first click or key press. Visitors can pause it or turn autoplay off; that choice is remembered in their browser.

Audio is stored in the `PlayerAudio` and `FactionAudio` database tables (one track per profile), served at versioned `/api/v1/players/<username>/audio/<version>/` and `/api/v1/factions/<slug>/audio/<version>/` URLs with byte-range support for seeking, and uploads/removals are audited. The Render startup script applies the migration automatically.

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
6. On the **free web service plan**, create your first developer through **Environment**. Add `DAWEST_BOOTSTRAP_DEV_USERNAME=owner` and set `DAWEST_BOOTSTRAP_DEV_PASSWORD` to your own strong password. Choose **Save and deploy**. The startup script creates the account after migrations. Sign in through `/dev/login`, then remove **both** bootstrap variables and save/deploy again. The account remains in PostgreSQL. Restarts preserve the existing password and disabled status; an existing player account is never promoted through this setup. Passwords are read directly from the environment, validated, and hashed; they are not printed or passed as command arguments. The bootstrap variables are removed from the environment inherited by Gunicorn workers.

   On a plan with **Shell**, you can instead run `python backend-django/manage.py create_dev --username owner` and enter the password at its hidden prompt. Free Render web services do not provide Shell access.

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
| POST | `/api/v1/auth/profile/audio/` | Upload (`audio`, `title`), retitle, or remove (`remove`) the signed-in player's theme track |
| GET / HEAD | `/api/v1/players/<username>/audio/<version>/` | Public player theme audio with Range support |
| POST | `/api/v1/auth/profile/appearance/` | Upload/remove the signed-in player's picture and banner using multipart form data |
| GET / HEAD | `/api/v1/players/<username>/media/<kind>/<version>/` | Public fitted image; `?still=1` selects an animation poster |
| GET | `/api/v1/factions/` | Public faction directory; optional `search` query |
| GET | `/api/v1/events/` | Published event schedules and statuses; optional `search` query |
| GET | `/api/v1/events/<uuid>/` | Published event details and verified linked results |
| GET / POST | `/api/v1/dev/events/` | Developer event list and draft/published event creation |
| PATCH / DELETE | `/api/v1/dev/events/<uuid>/` | Developer event editing; DELETE unpublishes without deleting results |
| GET | `/api/v1/events/<uuid>/pickems/` | Pick'em matchups, the viewer's picks, and standings |
| POST | `/api/v1/events/<uuid>/pickems/<id>/pick/` | Signed-in player picks `A` or `B` before lock |
| GET / POST | `/api/v1/events/<uuid>/entries/` | Registered teams; a faction leader registers their own faction |
| DELETE | `/api/v1/events/<uuid>/entries/<team-slug>/` | Leader withdraws before the event starts |
| GET / POST | `/api/v1/dev/events/<uuid>/entries/` | Developer view of entrants/available teams; add a team |
| DELETE | `/api/v1/dev/events/<uuid>/entries/<team-slug>/` | Developer removes a team not used in a matchup |
| GET / POST | `/api/v1/dev/events/<uuid>/pickems/` | Developer pick'em list and matchup creation |
| PATCH / DELETE | `/api/v1/dev/events/<uuid>/pickems/<id>/` | Edit, lock, resolve, or delete a matchup |
| GET | `/api/v1/factions/mine/` | Signed-in player's owned factions, membership, and requests |
| GET | `/api/v1/factions/<slug>/` | Public faction profile, roster, leader, and matches |
| GET | `/api/v1/factions/<slug>/manage/` | Owner-only dashboard and private member requests |
| POST | `/api/v1/factions/<slug>/join/` | Request to join as the signed-in registered player |
| POST | `/api/v1/factions/<slug>/requests/<uuid>/review/` | Owner-only acceptance or rejection |
| POST | `/api/v1/factions/requests/<uuid>/withdraw/` | Withdraw the applicant's own pending request |
| POST | `/api/v1/factions/<slug>/members/<player-id>/remove/` | Owner removes a member, or a non-leader leaves |
| POST | `/api/v1/factions/<slug>/appearance/` | Owner uploads/removes logo (`avatar`) and banner using multipart form data |
| GET / HEAD | `/api/v1/factions/<slug>/media/<kind>/<version>/` | Public fitted logo/banner; `?still=1` selects a still poster |
| POST | `/api/v1/factions/<slug>/audio/` | Owner uploads (`audio`, `title`), retitles, or removes (`remove`) the theme track using multipart form data |
| GET / HEAD | `/api/v1/factions/<slug>/audio/<version>/` | Public theme audio with Range support |
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
| POST | `/api/v1/dev/ratings/` | Add/subtract player or faction Elo with a reason and UUID request key |
| POST | `/api/v1/dev/commands/` | Allowlisted admin terminal commands: moderation, Elo, status, help |
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

Against the same isolated service, `node tests/integration/profile-images.mjs` checks real authenticated picture and GIF banner uploads, fitted dimensions, browser animation, persistence after reload, and public viewing without edit access. It writes public image URLs to ignored `artifacts/profile-media-smoke.json` for checking them again after a service restart.

`node tests/integration/factions.mjs` runs the real faction workflow on that isolated service: player signup, team registration, developer approval, faction redirects, private leader dashboard, join request and acceptance, leaderboard roster update, and fitted faction logo/GIF banner uploads. It creates a developer fixture only in an SQLite database under `artifacts/` (default `native-render-smoke.sqlite3`). `SQLITE_PATH` must match the test server's database. Only public profile/image URLs are written to ignored `artifacts/faction-smoke.json` for restart verification.

`node tests/integration/admin-tools.mjs` checks real developer login, player/faction Elo controls, restriction/profile visibility, session revocation and login denial after a ban, recovery through unban/unrestrict, rejected unknown commands, and audit entries. Use the same isolated localhost service and database; credentials stay in process memory. Ignored `artifacts/admin-smoke.json` contains only public usernames and expected ratings for restart verification.

`node tests/integration/events.mjs` checks real event creation, editing, publishing/unpublishing, draft privacy, anonymous write denial, timezone serialization, direct public detail reloads, and mobile navigation. It uses the same isolated localhost service/database and keeps credentials in memory. Ignored `artifacts/events-smoke.json` contains public event metadata for a server restart check.

Docker is unavailable in the current workspace, so PostgreSQL locking and actual Redis delivery require deployment-environment integration checks. SQLite, frontend/backend builds, session flows, and browser interactions are verified locally.
