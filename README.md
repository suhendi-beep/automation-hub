# Portal Report (Automation Hub) — Pelindo

Internal operations dashboard for cloud reporting, Grafana alert monitoring, daily tasks, and
engineer activity — built with Flask + Celery + React (Vite).

## Architecture

| Service | Purpose |
|---|---|
| `frontend` | React SPA served by nginx, proxies `/api/` to the backend |
| `backend` | Flask API (gunicorn), file-backed storage under `shared/` |
| `worker` | Celery worker executing automation tasks |
| `beat` | Celery beat scheduler for daily/weekly report emails |
| `redis` | Celery broker/result backend (local dev; production uses SSM) |

## Quick start

```bash
cp .env.example .env            # adjust values / SSM prefix
cp ~/.oci/config ./oci_config/config
cp ~/.oci/oci_api_key.pem ./oci_config/oci_api_key.pem
cp ~/.oci/oci_api_key_pelindo.pem ./oci_config/oci_api_key_pelindo.pem
sed -i 's|/home/suhendi/.oci/|/root/.oci/|g' ./oci_config/config
chmod 600 ./oci_config/*.pem
cp ~/template_grafana.pptx ./shared/template_grafana.pptx
docker compose up --build -d
```

Open `http://localhost:3000` and sign in. The bootstrap account is `admin / admin` unless
`AUTH_USERNAME` / `AUTH_PASSWORD` are set — **change the password from Settings immediately**.

## Configuration

Secrets are loaded from AWS SSM (`/portal-report/<KEY>`) at container start, falling back to
environment variables. Important keys:

```
REDIS_URL, SECRET_KEY, GRAFANA_BASE_URL, GRAFANA_USER, GRAFANA_PASS,
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, EMAIL_TO,
AUTH_USERNAME, AUTH_PASSWORD, AUTH_TOKEN_MAX_AGE,
LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, CORS_ORIGINS, ESKALASI_TTL_DAYS
```

- `EMAIL_TO` is a comma-separated recipient list for scheduled reports.
- Leave `CORS_ORIGINS` empty in production (same-origin via nginx).
- `SECRET_KEY` is generated once into `shared/logs/.secret_key` if not configured.

## Authentication & roles

- Every `/api/*` endpoint except `/api/ping` and `/api/auth/login` requires
  `Authorization: Bearer <token>` (12 h lifetime, signed with `SECRET_KEY`).
- Passwords are hashed with Werkzeug; legacy plaintext entries are migrated on load.
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
# backend tests
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements-dev.txt
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

## Adding a customer

1. Register the customer in `REGISTRY` (`backend/app.py`).
2. Create `backend/tasks/<customer>/<automation>.py` exposing `run(log_path, args)`.
3. Restart: `docker compose restart backend worker`.
