# Portal Report (Automation Hub) — Pelindo

Internal operations dashboard for cloud reporting, Grafana alert monitoring, daily tasks, and
engineer activity — built with Flask + Celery + React (Vite).

## Architecture

| Service | Purpose |
|---|---|
| `frontend` | React SPA served by nginx, proxies `/api/` to the backend |
| `backend` | Flask API (gunicorn), PostgreSQL-backed app state |
| `db` | PostgreSQL 16, persistent volume `pgdata` |
| `migrate` | One-shot Alembic migration, runs before the backend starts |
| `worker` | Celery worker executing automation tasks |
| `beat` | Celery beat scheduler for daily/weekly report emails |
| `redis` | Celery broker/result backend (local dev; production uses SSM) |

Application records (users, requests, tasks, activity, accounts, alert escalations) live in
PostgreSQL. Reports, screenshots, cookies, logs, templates, and OCI config remain files under
`shared/` and `oci_config/`.

## Quick start

```bash
cp .env.example .env            # adjust values / SSM prefix and DB_PASSWORD
cp ~/.oci/config ./oci_config/config
cp ~/.oci/oci_api_key.pem ./oci_config/oci_api_key.pem
cp ~/.oci/oci_api_key_pelindo.pem ./oci_config/oci_api_key_pelindo.pem
sed -i 's|/home/suhendi/.oci/|/root/.oci/|g' ./oci_config/config
chmod 600 ./oci_config/*.pem
cp ~/template_grafana.pptx ./shared/template_grafana.pptx
docker compose up --build -d
```

The backend runs `alembic upgrade head` through the one-shot `migrate` service, then seeds a
bootstrap admin only when the `users` table is empty. Open `http://localhost:3000` and sign in.
The bootstrap account is `admin / admin` unless `AUTH_USERNAME` / `AUTH_PASSWORD` are set —
**change the password from Settings immediately**.

## Configuration

Secrets are loaded from AWS SSM (`/portal-report/<KEY>`) at container start, falling back to
environment variables. Important keys:

```
REDIS_URL, SECRET_KEY, GRAFANA_BASE_URL, GRAFANA_USER, GRAFANA_PASS,
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, EMAIL_TO,
AUTH_USERNAME, AUTH_PASSWORD, AUTH_TOKEN_MAX_AGE,
LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, CORS_ORIGINS, ESKALASI_TTL_DAYS,
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD,
DB_POOL_SIZE, DB_POOL_TIMEOUT, ACTIVITY_MAX_ROWS
```

- `DB_PASSWORD` is required by Compose and must be a strong value. The database is not
  published to the host; only the frontend port is exposed. After `pgdata` has been
  initialized, changing `DB_PASSWORD` requires `ALTER USER` inside PostgreSQL as well.
- `DATABASE_URL` takes precedence over the `DB_*` variables (used by tests and CI).

- `EMAIL_TO` is a comma-separated recipient list for scheduled reports.
- Leave `CORS_ORIGINS` empty in production (same-origin via nginx).
- `SECRET_KEY` is generated once into `shared/logs/.secret_key` if not configured.

## Authentication & roles

- Every `/api/*` endpoint except `/api/ping` and `/api/auth/login` requires
  `Authorization: Bearer <token>` (12 h lifetime, signed with `SECRET_KEY`).
- Passwords are hashed with Werkzeug; the JSON importer hashes legacy plaintext entries.
- Sessions expire after 12 hours. Changing a password invalidates old tokens.
- `admin` can manage users, accounts, schedules, and delete tasks.
- `engineer` can create/update tasks but must request deletion, which an admin approves.
- Login attempts are rate-limited per IP.

## Schedules

Celery beat (Asia/Jakarta) runs:

| Schedule | Time | Action |
|---|---|---|
| `daily-ilcs-status` | Daily 07:00 | Check ILCS/Pelindo backup status and email the report |
| `weekly-grafana-ho` | Monday 08:00 | Capture the last 7 days of Grafana HO dashboards and email the PPTX |

Configure them in `BEAT_SCHEDULE` (`backend/celery_worker.py`). The Schedules page shows the
current configuration and lets admins trigger a run immediately.

## Main API endpoints

```
POST /api/auth/login              POST /api/auth/logout
GET  /api/customers               GET  /api/customers/<id>
POST /api/run                     POST /api/run_with_credentials
GET  /api/status/<task_id>        GET  /api/logs/<customer>/<automation>
GET  /api/files/<customer>        GET  /api/download/<folder>/<filename>
GET  /api/grafana/alerts          GET  /api/grafana/dashboards
GET  /api/tasks                   POST /api/tasks
PUT  /api/tasks/<id>              DELETE /api/tasks/<id>          (admin)
POST /api/tasks/<id>/request-delete
POST /api/tasks/<id>/approve-delete                                 (admin)
GET  /api/activity                POST /api/activity
GET  /api/schedules               POST /api/schedules/<id>/run     (admin)
GET  /api/accounts                POST/PUT/DELETE /api/accounts…   (admin)
GET  /api/auth/users              POST/PUT/DELETE /api/auth/users… (admin)
POST /api/auth/change-password
GET  /api/config                  GET  /api/health
```

## Development

```bash
# backend tests (SQLite by default)
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements-dev.txt
pytest backend/tests -q

# optional: run the same tests against PostgreSQL
export TEST_DATABASE_URL=postgresql+psycopg://automation:secret@localhost:5432/automation_hub
pytest backend/tests -q

# frontend dev server (proxies /api to localhost:5000)
cd frontend && npm ci && npm run dev
```

## Security notes

- Backend and Redis are not published to the host; only nginx (port 3000) is exposed.
- TLS is not terminated here. Put this stack behind an HTTPS reverse proxy / load balancer
  before exposing it outside the internal network.
- Rotate `GRAFANA_PASS` and any credentials that were previously stored in source defaults.
- OCI session cookies are stored under `shared/cookies/` with mode `0600`; log out from the
  sidebar when finished.

## Database migration and rollback

### First cutover from JSON storage

```bash
# 1. Stop writers and back up the file volume (JSON files are root-owned)
docker compose stop backend worker beat frontend
sudo cp -a shared shared.pre-pg-$(date +%Y%m%d-%H%M)

# 2. Start PostgreSQL and apply the schema
docker compose up -d db
docker compose run --rm migrate

# 3. Dry-run the legacy JSON import, then run it for real
docker compose run --rm migrate python -m db_import --src /app/shared --dry-run
docker compose run --rm migrate python -m db_import --src /app/shared

# 4. Back up the baseline and start the app
docker compose run --rm migrate sh -c \
  'mkdir -p /app/shared/backups && pg_dump -Fc -U "$DB_USER" -d "$DB_NAME" -f /app/shared/backups/postgres-baseline.dump'
docker compose up -d --build
```

At validation time (2026-11-22): users 9, daily tasks 93, activity 274, requests 1,
delete requests 0, accounts 0, escalations 7, and task counter 93. Treat the dry-run output as
authoritative for the actual files being migrated. The importer ignores the stale
`shared/logs/daily_tasks.json` and is idempotent.

### Backups and restore

```bash
# Backup (inside the db container; write to the shared volume)
mkdir -p shared/backups
docker compose exec db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > shared/backups/postgres-$(date +%Y%m%d-%H%M).dump

# Restore
docker compose stop backend worker beat
docker compose exec -T db sh -c 'pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < shared/backups/postgres-YYYYmmdd-HHMM.dump
docker compose start backend worker beat
```

Back up `shared/` separately for reports, logs, cookies, and templates. After the database is
stable for 24 hours, archive the old JSON files as `*.migrated`; do not delete them immediately.

### Rollback before new writes

Stop the stack and restart the previous images without the `db`/`migrate` services. The JSON
files remain intact under `shared/`. After cutover, rollback means restoring a database dump;
writes made after the cutover will be lost.

## Adding a customer

1. Register the customer in `REGISTRY` (`backend/app.py`).
2. Create `backend/tasks/<customer>/<automation>.py` exposing `run(log_path, args)`.
3. Restart: `docker compose restart backend worker`.
