import glob
import json
import logging
import logging.handlers
import os
import re
import secrets
import tempfile
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import requests
from flask import Flask, g, jsonify, request, send_from_directory
from flask_cors import CORS
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

from celery_worker import SCHEDULE_META, celery, run_automation, run_oci_login
import oci_session
import oci_dbm

# ── Paths ────────────────────────────────────────────────────
SHARED_DIR = os.getenv("SHARED_DIR", "/app/shared")


def _shared(*parts):
    return os.path.join(SHARED_DIR, *parts)


os.makedirs(_shared("logs"), exist_ok=True)

app = Flask(__name__)

# ── Logging ──────────────────────────────────────────────────
log = logging.getLogger("automation_hub")
if not log.handlers:
    log.setLevel(logging.INFO)
    _formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    _stream = logging.StreamHandler()
    _stream.setFormatter(_formatter)
    _file = logging.handlers.RotatingFileHandler(
        _shared("logs", "app.log"), maxBytes=5 * 1024 * 1024, backupCount=3
    )
    _file.setFormatter(_formatter)
    log.addHandler(_stream)
    log.addHandler(_file)

# ── CORS ─────────────────────────────────────────────────────
# Same-origin in production (nginx proxies /api). Only enable CORS for
# explicitly whitelisted origins, e.g. CORS_ORIGINS=http://localhost:5173
_cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
if _cors_origins:
    CORS(app, origins=_cors_origins)

# ── Config ───────────────────────────────────────────────────
GRAFANA_BASE_URL = (
    os.getenv("GRAFANA_URL") or os.getenv("GRAFANA_BASE_URL")
    or "https://monitoring.ilcs.co.id"
).rstrip("/")
GRAFANA_USER = os.getenv("GRAFANA_USER", "")
GRAFANA_PASS = os.getenv("GRAFANA_PASS", "")

# Alert bersumber dari Prometheus/Alertmanager data source ini tidak muncul di
# endpoint Alertmanager bawaan Grafana, jadi harus diambil per data source.
GRAFANA_PROM_DATASOURCES = [
    ("OCI-ILCS", "bdy31xghxyh34d"),
    ("OCI-HO",   "deyx07ukt7nk0e"),
    ("GCP",      "eey4rwzgb9ibke"),
    ("Huawei",   "eey51w20ssn40e"),
]

# Throttle repeated Grafana failure logs (the frontend polls every 30s).
_grafana_last_error = None
_grafana_last_log_at = 0.0


def _log_grafana_failure(msg):
    global _grafana_last_error, _grafana_last_log_at
    now = time.time()
    if msg != _grafana_last_error or now - _grafana_last_log_at >= 300:
        log.warning("Grafana: %s", msg)
        _grafana_last_error = msg
        _grafana_last_log_at = now



def _load_or_create_secret():
    key = (os.getenv("SECRET_KEY") or "").strip()
    if key:
        return key
    path = _shared("logs", ".secret_key")
    try:
        with open(path, "r", encoding="utf-8") as f:
            key = f.read().strip()
        if key:
            return key
    except OSError:
        pass
    key = secrets.token_urlsafe(48)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(key)
    log.warning("SECRET_KEY not set — generated %s (mode 0600)", path)
    return key


SECRET_KEY = _load_or_create_secret()
_serializer = URLSafeTimedSerializer(SECRET_KEY, salt="automation-hub-auth")
TOKEN_MAX_AGE = int(os.getenv("AUTH_TOKEN_MAX_AGE", str(12 * 3600)))

LOGIN_MAX_ATTEMPTS = int(os.getenv("LOGIN_MAX_ATTEMPTS", "5"))
LOGIN_WINDOW_SECONDS = int(os.getenv("LOGIN_WINDOW_SECONDS", "300"))
_login_attempts = defaultdict(list)
_login_lock = threading.Lock()

REGISTRY = {
    "pelindo": {
        "id": "pelindo", "name": "Pelindo", "platform": "OCI", "status": "active",
        "automations": [
            {
                "id": "grafana_capture",
                "name": "Weekly Capture Grafana HO",
                "description": "Screenshot semua dashboard Grafana HO dan generate PPTX",
                "schedule": "Weekly", "output_type": "pptx",
                "requires_oci_login": False,
                "requires_oci_credentials": False,
                "args": [
                    {"key": "start_date", "label": "Start Date", "type": "date"},
                    {"key": "start_time", "label": "Start Time", "type": "time", "default": "00:00"},
                    {"key": "end_date",   "label": "End Date",   "type": "date"},
                    {"key": "end_time",   "label": "End Time",   "type": "time", "default": "23:59"},
                ],
            },
            {
                "id": "oci_ilcs_backup",
                "name": "Weekly Backup Report OCI ILCS",
                "description": "Screenshot halaman backup OCI semua resource ILCS → Word report",
                "schedule": "Weekly", "output_type": "docx",
                "requires_oci_login": True,
                "requires_oci_credentials": True,
                "args": [],
            },
            {
                "id": "oci_pelindo_backup",
                "name": "Weekly Backup Report OCI Pelindo",
                "description": "Screenshot halaman backup OCI semua resource Pelindo → Word report",
                "schedule": "Weekly", "output_type": "docx",
                "requires_oci_login": True,
                "requires_oci_credentials": True,
                "args": [],
            },
            {
                "id": "daily_ilcs_status",
                "name": "Daily Backup Status ILCS",
                "description": "Cek status backup harian via OCI CLI — volume + database ILCS & Pelindo",
                "schedule": "Daily", "output_type": "report",
                "requires_oci_login": False,
                "requires_oci_credentials": False,
                "args": [],
            },
        ],
    },
}


# ══════════════════════════════════════════════════════════════
# JSON storage helpers — atomic writes + process lock
# ══════════════════════════════════════════════════════════════
_FILE_LOCK = threading.RLock()


def _read_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        log.warning("Cannot read %s: %s", path, e)
        return default


def _write_json(path, data):
    """Write JSON atomically: temp file in the same dir + os.replace()."""
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def _now():
    return datetime.now()


# ══════════════════════════════════════════════════════════════
# Authentication
# ══════════════════════════════════════════════════════════════
USERS_FILE = _shared("logs", "users.json")
ACTIVITY_FILE = _shared("logs", "activity_log.json")


def _hash_password(password):
    return generate_password_hash(password)


def _is_hashed(value):
    return value.startswith(("pbkdf2:", "scrypt:", "argon2:"))


def _verify_password(stored, password):
    if _is_hashed(stored):
        return check_password_hash(stored, password)
    return secrets.compare_digest(stored, password)


def _default_users():
    username = os.getenv("AUTH_USERNAME", "admin")
    return [{
        "username": username,
        "password": _hash_password(os.getenv("AUTH_PASSWORD", "admin")),
        "display": username.upper(),
        "role": "admin",
    }]


def _save_users(users):
    _write_json(USERS_FILE, users)


def _load_users():
    """Load users, migrating legacy plaintext passwords to hashes."""
    raw = _read_json(USERS_FILE, None)
    if not raw:
        users = _default_users()
        _save_users(users)
        return users

    migrated = False
    for user in raw:
        pw = user.get("password", "")
        if pw and not _is_hashed(pw):
            user["password"] = _hash_password(pw)
            migrated = True
    if migrated:
        _save_users(raw)
        log.info("Migrated plaintext user passwords to hashes")
    return raw


def _find_user(username):
    return next((u for u in _load_users() if u.get("username") == username), None)


def _token_version(user):
    import hashlib
    return hashlib.sha256(user.get("password", "").encode("utf-8")).hexdigest()[:16]


def _issue_token(user):
    return _serializer.dumps({
        "u": user["username"],
        "v": _token_version(user),
    })


def _client_ip():
    forwarded = request.headers.get("X-Forwarded-For", "")
    return (forwarded.split(",")[0].strip() or request.remote_addr or "unknown")


def _rate_limited(ip):
    now = time.time()
    with _login_lock:
        attempts = [t for t in _login_attempts[ip] if now - t < LOGIN_WINDOW_SECONDS]
        _login_attempts[ip] = attempts
        return len(attempts) >= LOGIN_MAX_ATTEMPTS


def _record_login_failure(ip):
    with _login_lock:
        _login_attempts[ip].append(time.time())


def _clear_login_failures(ip):
    with _login_lock:
        _login_attempts.pop(ip, None)


PUBLIC_ENDPOINTS = {"/api/ping", "/api/auth/login"}


@app.before_request
def require_auth():
    if not request.path.startswith("/api/"):
        return None
    if request.method == "OPTIONS" or request.path in PUBLIC_ENDPOINTS:
        return None

    header = request.headers.get("Authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if not token:
        token = request.headers.get("X-Auth-Token", "").strip()
    if not token:
        return jsonify({"error": "Authentication required"}), 401

    try:
        payload = _serializer.loads(token, max_age=TOKEN_MAX_AGE)
    except SignatureExpired:
        return jsonify({"error": "Session expired, please log in again"}), 401
    except BadSignature:
        return jsonify({"error": "Invalid session token"}), 401

    user = _find_user(payload.get("u", ""))
    if not user or payload.get("v") != _token_version(user):
        return jsonify({"error": "Session no longer valid"}), 401

    g.user = {
        "username": user["username"],
        "display": user.get("display", user["username"]),
        "role": user.get("role", "engineer"),
    }
    return None


def _admin_only():
    if g.user.get("role") != "admin":
        return jsonify({"error": "Admin access required"}), 403
    return None


# ══════════════════════════════════════════════════════════════
# Core / customer endpoints
# ══════════════════════════════════════════════════════════════
@app.route("/api/ping")
def ping():
    return jsonify({"status": "ok"})


@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "time": _now().isoformat(),
        "storage": os.path.isdir(SHARED_DIR),
    })


@app.route("/api/config")
def app_config():
    return jsonify({
        "version": "2.1.0",
        "grafana_base_url": GRAFANA_BASE_URL,
        "grafana_configured": bool(GRAFANA_USER and GRAFANA_PASS),
        "shared_dir": SHARED_DIR,
    })


@app.route("/api/customers")
def get_customers():
    return jsonify([
        {"id": cid, "name": c["name"], "platform": c["platform"],
         "status": c["status"], "automation_count": len(c["automations"])}
        for cid, c in REGISTRY.items()
    ])


@app.route("/api/customers/<cid>")
def get_customer(cid):
    c = REGISTRY.get(cid)
    return jsonify(c) if c else (jsonify({"error": "Not found"}), 404)


@app.route("/api/run", methods=["POST"])
def trigger_run():
    data = request.json or {}
    cid = data.get("customer")
    aid = data.get("automation")
    args = data.get("args", {})

    if cid not in REGISTRY:
        return jsonify({"error": "Customer not found"}), 404
    auto = next((a for a in REGISTRY[cid]["automations"] if a["id"] == aid), None)
    if not auto:
        return jsonify({"error": "Automation not found"}), 404
    if auto.get("requires_oci_login") and not oci_session.cookies_exist():
        if auto.get("requires_oci_credentials"):
            return jsonify({"error": "Kredensial OCI diperlukan untuk menjalankan automation ini.",
                            "need_credentials": True}), 400
        return jsonify({"error": "Belum login OCI. Gunakan tombol Login OCI terlebih dahulu.", "need_login": True}), 400

    task = run_automation.delay(cid, aid, args)
    return jsonify({"task_id": task.id, "status": "queued", "queued_at": _now().isoformat()})


@app.route("/api/run_with_credentials", methods=["POST"])
def trigger_run_with_credentials():
    """Run automation dengan inline OCI login — untuk OCI Backup."""
    data = request.json or {}
    cid = data.get("customer")
    aid = data.get("automation")
    args = data.get("args", {})

    if cid not in REGISTRY:
        return jsonify({"error": "Customer not found"}), 404
    auto = next((a for a in REGISTRY[cid]["automations"] if a["id"] == aid), None)
    if not auto:
        return jsonify({"error": "Automation not found"}), 404

    args["_tenancy"] = data.get("tenancy", "")
    args["_username"] = data.get("username", "")
    args["_password"] = data.get("password", "")

    from celery_worker import run_automation_with_login
    task = run_automation_with_login.delay(cid, aid, args)
    return jsonify({"task_id": task.id, "status": "queued", "queued_at": _now().isoformat()})


@app.route("/api/oci/login_state/<task_id>")
def oci_login_state(task_id):
    import redis
    r = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
    raw = r.get(f"oci_login_state:{task_id}")
    if not raw:
        return jsonify({"state": "unknown"})
    return jsonify(json.loads(raw.decode()))


@app.route("/api/oci/otp", methods=["POST"])
def submit_otp():
    import redis
    data = request.json or {}
    task_id = data.get("task_id")
    otp = data.get("otp", "")

    if not task_id or not otp:
        return jsonify({"error": "task_id dan otp required"}), 400

    r = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
    r.setex(f"oci_login_otp:{task_id}", 300, otp)
    return jsonify({"status": "ok"})


@app.route("/api/status/<task_id>")
def task_status(task_id):
    r = celery.AsyncResult(task_id)
    return jsonify({"task_id": task_id, "status": r.status, "result": r.result if r.ready() else None})


@app.route("/api/logs/<cid>/<aid>")
def get_logs(cid, aid):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", cid) or not re.fullmatch(r"[A-Za-z0-9_-]+", aid):
        return jsonify({"error": "Invalid name"}), 400
    path = _shared("logs", f"{cid}_{aid}.log")
    if not os.path.exists(path):
        return jsonify({"logs": []})
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    return jsonify({"logs": lines[-300:]})


@app.route("/api/history")
def get_history():
    history = []
    for p in sorted(glob.glob(_shared("logs", "*.log")), reverse=True):
        name = os.path.basename(p).replace(".log", "")
        if name.startswith("_") or name == "app":
            continue
        parts = name.split("_", 1)
        if len(parts) != 2:
            continue
        stat = os.stat(p)
        history.append({
            "customer": parts[0], "automation": parts[1],
            "last_run": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "size_kb": round(stat.st_size / 1024, 1),
        })
    return jsonify(history)


@app.route("/api/files/<cid>")
def list_files(cid):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", cid):
        return jsonify({"error": "Invalid customer id"}), 400
    results = {}
    for folder in ["reports", "screenshots"]:
        files = []
        for f in glob.glob(_shared(folder, f"{cid}_*")):
            stat = os.stat(f)
            files.append({
                "name": os.path.basename(f),
                "size_kb": round(stat.st_size / 1024, 1),
                "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                "download": f"/api/download/{folder}/{os.path.basename(f)}",
                "folder": folder,
            })
        results[folder] = sorted(files, key=lambda x: x["created"], reverse=True)
    return jsonify(results)


@app.route("/api/download/<folder>/<filename>")
def download_file(folder, filename):
    safe_folder = folder if folder in ["reports", "screenshots"] else "reports"
    return send_from_directory(_shared(safe_folder), filename, as_attachment=True)


# ── OCI Session ──────────────────────────────────────────────
@app.route("/api/oci/session")
def oci_status():
    info = oci_session.cookies_info()
    return jsonify({"logged_in": bool(info), **(info or {})})


@app.route("/api/oci/login", methods=["POST"])
def oci_login():
    data = request.json or {}
    u, p = data.get("username", ""), data.get("password", "")
    if not u or not p:
        return jsonify({"error": "Username dan password diperlukan"}), 400
    task = run_oci_login.delay(u, p)
    return jsonify({"task_id": task.id, "status": "queued"})


@app.route("/api/oci/logout", methods=["POST"])
def oci_logout():
    oci_session.delete_cookies()
    return jsonify({"status": "ok"})


@app.route("/api/oci/save_cookies", methods=["POST"])
def oci_save_cookies():
    """Manual OCI session connect — cookies pasted from the EditThisCookie
    Chrome extension (see OciModal)."""
    data = request.json or {}
    raw = data.get("cookies", "")
    try:
        cookies = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(cookies, list):
            raise ValueError("cookies must be a JSON array")
    except (json.JSONDecodeError, ValueError) as e:
        return jsonify({"error": f"Invalid cookies JSON: {e}"}), 400

    count = oci_session.save_cookies_raw(cookies)
    return jsonify({"status": "ok", "count": count})


# ── Grafana Alerts ───────────────────────────────────────────
def _grafana_severity_from_labels(labels):
    sev = (labels.get("severity") or labels.get("Severity") or "").strip()
    if sev:
        return sev.lower()
    name = (labels.get("alertname") or "").lower()
    if "critical" in name or "down" in name:
        return "critical"
    if "warn" in name:
        return "warning"
    return "info"


def _norm_ts(value):
    if not value:
        return value
    return re.sub(r"(\.\d{3})\d*(?=Z|[+-]\d{2}:\d{2}$)", r"\1", value)


def _alert_key(name, resource, active_at):
    try:
        started = datetime.fromisoformat(_norm_ts(active_at).replace("Z", "+00:00"))
        return (name, resource, int(started.timestamp()) // 60)
    except Exception:
        return (name, resource, active_at)


def _fetch_prometheus_alerts(now):
    if not (GRAFANA_USER and GRAFANA_PASS):
        return []

    def fetch(ds):
        folder, uid = ds
        url = f"{GRAFANA_BASE_URL}/api/datasources/proxy/uid/{uid}/api/v1/alerts"
        try:
            r = requests.get(url, auth=(GRAFANA_USER, GRAFANA_PASS), timeout=8)
            r.raise_for_status()
            data = r.json() or {}
            return folder, (data.get("data") or {}).get("alerts") or []
        except Exception as e:
            log.warning("Grafana datasource alerts %s gagal: %s", folder, e)
            return folder, []

    result = []
    with ThreadPoolExecutor(max_workers=len(GRAFANA_PROM_DATASOURCES)) as ex:
        for folder, items in ex.map(fetch, GRAFANA_PROM_DATASOURCES):
            for item in items:
                state = (item.get("state") or "").lower()
                if state not in ("firing", "pending"):
                    continue
                labels = item.get("labels") or {}
                resource = (
                    labels.get("instance") or labels.get("nodename") or
                    labels.get("hostname") or labels.get("resourceName") or "-"
                )
                active_at = item.get("activeAt")
                duration_min = 0
                if active_at:
                    try:
                        started = datetime.fromisoformat(
                            _norm_ts(active_at).replace("Z", "+00:00"))
                        duration_min = max(0, int((now - started).total_seconds() // 60))
                    except Exception:
                        duration_min = 0
                result.append({
                    "name":         labels.get("alertname", "Unknown Alert"),
                    "folder":       folder,
                    "severity":     _grafana_severity_from_labels(labels),
                    "resource":     resource,
                    "labels":       labels,
                    "annotations":  item.get("annotations") or {},
                    "active_at":    _norm_ts(active_at),
                    "duration_min": duration_min,
                    "state":        state,
                })
    return result


def fetch_grafana_alerts():
    if not GRAFANA_USER or not GRAFANA_PASS:
        raise RuntimeError("Grafana credentials are not configured")

    url = f"{GRAFANA_BASE_URL}/api/alertmanager/grafana/api/v2/alerts"
    resp = requests.get(
        url,
        auth=(GRAFANA_USER, GRAFANA_PASS),
        params={"active": "true", "silenced": "false", "inhibited": "false"},
        timeout=15,
    )
    resp.raise_for_status()
    raw = resp.json()

    now = datetime.now(timezone.utc)
    alerts = []
    seen = set()
    for item in raw:
        labels = item.get("labels", {}) or {}
        annotations = item.get("annotations", {}) or {}
        status = item.get("status", {}) or {}
        state = status.get("state", "active")
        starts_at = item.get("startsAt")

        duration_min = 0
        if starts_at:
            try:
                started = datetime.fromisoformat(starts_at.replace("Z", "+00:00"))
                duration_min = max(0, int((now - started).total_seconds() // 60))
            except Exception:
                duration_min = 0

        resource = (
            labels.get("instance") or labels.get("nodename") or
            labels.get("hostname") or labels.get("resourceName") or "-"
        )

        alerts.append({
            "name":         labels.get("alertname", "Unknown Alert"),
            "folder":       labels.get("grafana_folder") or labels.get("namespace") or labels.get("rulename") or "default",
            "severity":     _grafana_severity_from_labels(labels),
            "resource":     resource,
            "labels":       labels,
            "annotations":  annotations,
            "active_at":    starts_at,
            "duration_min": duration_min,
            "state":        "NoData" if labels.get("alertname", "").lower() == "datasourcenodata" else state,
        })
        seen.add(_alert_key(alerts[-1]["name"], resource, starts_at))

    # Alert dari Prometheus/Alertmanager data source (tidak terlihat oleh
    # endpoint Alertmanager bawaan Grafana di atas).
    for a in _fetch_prometheus_alerts(now):
        key = _alert_key(a["name"], a["resource"], a["active_at"])
        if key in seen:
            continue
        seen.add(key)
        alerts.append(a)
    return alerts


@app.route("/api/grafana/alerts")
def grafana_alerts():
    if not (GRAFANA_USER and GRAFANA_PASS):
        return jsonify({
            "alerts": [], "configured": False,
            "error": "Grafana credentials are not configured (GRAFANA_USER / GRAFANA_PASS)",
        })
    try:
        alerts = fetch_grafana_alerts()
        return jsonify({"alerts": alerts, "configured": True, "fetched_at": _now().isoformat()})
    except requests.exceptions.RequestException as e:
        msg = f"Grafana unreachable: {e}"
        _log_grafana_failure(msg)
        return jsonify({"alerts": [], "configured": True, "error": msg})
    except Exception as e:
        log.exception("Grafana alerts failed")
        return jsonify({"alerts": [], "configured": True, "error": str(e)})


@app.route("/api/oci/dbm/top-sql")
def oci_dbm_top_sql():
    ocid = (request.args.get("ocid") or "").strip()
    refresh = request.args.get("refresh") == "1"
    m = oci_dbm.OCID_RE.match(ocid)
    region = m.group(1) if m else ""
    console_url = (
        f"https://cloud.oracle.com/dbmgmt-ui/perfhub?region={region}&ocid={ocid}"
        if m else ""
    )
    try:
        return jsonify(oci_dbm.get_top_sql(ocid, refresh=refresh))
    except oci_dbm.OciError as e:
        log.warning("DBM top-sql failed (%s): %s", e.code, e.message)
        return jsonify({
            "ok": False, "code": e.code, "error": e.message,
            "ocid": ocid, "region": region, "console_url": console_url,
        }), e.status
    except Exception as e:
        log.exception("DBM top-sql unexpected error")
        return jsonify({
            "ok": False, "code": "internal", "error": str(e),
            "ocid": ocid, "region": region, "console_url": console_url,
        }), 500


@app.route("/api/grafana/dashboards")
def grafana_dashboards():
    if not (GRAFANA_USER and GRAFANA_PASS):
        return jsonify({
            "dashboards": [], "base_url": GRAFANA_BASE_URL, "configured": False,
            "error": "Grafana credentials are not configured (GRAFANA_USER / GRAFANA_PASS)",
        })
    try:
        resp = requests.get(
            f"{GRAFANA_BASE_URL}/api/search",
            auth=(GRAFANA_USER, GRAFANA_PASS),
            params={"type": "dash-db", "limit": 200},
            timeout=15,
        )
        resp.raise_for_status()
        dashboards = [{
            "id": d.get("id"),
            "uid": d.get("uid"),
            "title": d.get("title") or "(untitled)",
            "folder": d.get("folderTitle") or "General",
            "tags": d.get("tags") or [],
            "url": f"{GRAFANA_BASE_URL}/d/{d.get('uid') or d.get('id')}",
        } for d in resp.json()]
        return jsonify({"dashboards": dashboards, "base_url": GRAFANA_BASE_URL, "configured": True})
    except requests.exceptions.RequestException as e:
        msg = f"Grafana unreachable: {e}"
        _log_grafana_failure(msg)
        return jsonify({"dashboards": [], "base_url": GRAFANA_BASE_URL,
                        "configured": True, "error": msg})
    except Exception as e:
        log.exception("Grafana dashboards failed")
        return jsonify({"dashboards": [], "base_url": GRAFANA_BASE_URL,
                        "configured": True, "error": str(e)})


ALERT_ESKALASI_FILE = _shared("logs", "alert_eskalasi.json")
ESKALASI_TTL_DAYS = int(os.getenv("ESKALASI_TTL_DAYS", "7"))


def _load_eskalasi():
    data = _read_json(ALERT_ESKALASI_FILE, {})
    cutoff = (_now() - timedelta(days=ESKALASI_TTL_DAYS)).isoformat()
    pruned = {k: v for k, v in data.items() if (v.get("at") or "") >= cutoff}
    if len(pruned) != len(data):
        _write_json(ALERT_ESKALASI_FILE, pruned)
    return pruned


def _save_eskalasi(data):
    _write_json(ALERT_ESKALASI_FILE, data)


@app.route("/api/alerts/eskalasi", methods=["GET"])
def get_eskalasi():
    return jsonify(_load_eskalasi())


@app.route("/api/alerts/eskalasi", methods=["POST"])
def post_eskalasi():
    data = request.json or {}
    key = data.get("key")
    by = data.get("by", "")
    if not key:
        return jsonify({"error": "key required"}), 400
    with _FILE_LOCK:
        store = _load_eskalasi()
        store[key] = {"by": by, "at": _now().isoformat()}
        _save_eskalasi(store)
    return jsonify({"status": "ok"})


# ══════════════════════════════════════════════════════════════
# Daily tasks
# ══════════════════════════════════════════════════════════════
TASKS_FILE = _shared("daily_tasks.json")
DELETE_REQS_FILE = _shared("logs", "delete_requests.json")


def _load_tasks():
    return _read_json(TASKS_FILE, [])


def _save_tasks(tasks):
    _write_json(TASKS_FILE, tasks)


def _load_delete_reqs():
    return _read_json(DELETE_REQS_FILE, [])


def _save_delete_reqs(reqs):
    _write_json(DELETE_REQS_FILE, reqs)


def _next_task_no(tasks):
    """TSK-001, TSK-002, ... — based on the highest existing numeric suffix."""
    max_n = 0
    for t in tasks:
        no = (t.get("taskNo") or "")
        if no.startswith("TSK-"):
            try:
                max_n = max(max_n, int(no.split("-")[1]))
            except (IndexError, ValueError):
                pass
    return f"TSK-{max_n + 1:03d}"


@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    tasks = _load_tasks()
    date_filter = request.args.get("date")
    if date_filter:
        tasks = [t for t in tasks if (t.get("date") or "").startswith(date_filter)]
    return jsonify(tasks)


@app.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.json or {}
    with _FILE_LOCK:
        tasks = _load_tasks()
        new_task = {
            "id": data.get("id") or str(int(_now().timestamp() * 1000)),
            "taskNo": _next_task_no(tasks),
            "customer": data.get("customer", ""),
            "description": data.get("description", ""),
            "detail": data.get("detail", ""),
            "date": data.get("date", ""),
            "start": data.get("start", ""),
            "end": data.get("end", ""),
            "pic": data.get("pic", ""),
            "status": data.get("status", "Open"),
            "generateReport": data.get("generateReport", False),
            "createdAt": data.get("createdAt", _now().isoformat()),
        }
        tasks.append(new_task)
        _save_tasks(tasks)
    return jsonify(new_task), 201


@app.route("/api/tasks/<task_id>", methods=["PUT"])
def update_task(task_id):
    data = request.json or {}
    with _FILE_LOCK:
        tasks = _load_tasks()
        for task in tasks:
            if task["id"] == task_id:
                task.update(data)
                _save_tasks(tasks)
                return jsonify(task)
    return jsonify({"error": "Task not found"}), 404


@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    denied = _admin_only()
    if denied:
        return denied
    with _FILE_LOCK:
        tasks = _load_tasks()
        tasks = [t for t in tasks if t["id"] != task_id]
        _save_tasks(tasks)
        reqs = [r for r in _load_delete_reqs() if r.get("task_id") != task_id]
        _save_delete_reqs(reqs)
    return jsonify({"status": "ok"})


# ── Task delete-request workflow (non-admin must ask an admin to approve) ──
@app.route("/api/tasks/pending-deletes", methods=["GET"])
def get_pending_deletes():
    return jsonify(_load_delete_reqs())


@app.route("/api/tasks/<task_id>/request-delete", methods=["POST"])
def request_delete_task(task_id):
    data = request.json or {}
    with _FILE_LOCK:
        tasks = _load_tasks()
        task = next((t for t in tasks if t["id"] == task_id), None)
        if not task:
            return jsonify({"error": "Task not found"}), 404

        reqs = _load_delete_reqs()
        if any(r["task_id"] == task_id for r in reqs):
            return jsonify({"status": "already_requested"})

        reqs.append({
            "task_id":      task_id,
            "task_no":      task.get("taskNo", ""),
            "task_desc":    task.get("description", ""),
            "requested_by": g.user.get("display") or data.get("display") or g.user["username"],
            "requested_at": _now().isoformat(),
        })
        _save_delete_reqs(reqs)
    return jsonify({"status": "requested"})


@app.route("/api/tasks/<task_id>/approve-delete", methods=["POST"])
def approve_delete_task(task_id):
    denied = _admin_only()
    if denied:
        return denied
    data = request.json or {}
    action = data.get("action", "approve")

    with _FILE_LOCK:
        reqs = _load_delete_reqs()
        if not any(r["task_id"] == task_id for r in reqs):
            return jsonify({"error": "No pending request for this task"}), 404
        reqs = [r for r in reqs if r["task_id"] != task_id]
        _save_delete_reqs(reqs)

        if action == "approve":
            tasks = _load_tasks()
            tasks = [t for t in tasks if t["id"] != task_id]
            _save_tasks(tasks)

    return jsonify({"status": "approved" if action == "approve" else "rejected"})


# ══════════════════════════════════════════════════════════════
# Users + Activity log
# ══════════════════════════════════════════════════════════════
def _public_user(user):
    return {
        "username": user["username"],
        "display": user.get("display", user["username"]),
        "role": user.get("role", "engineer"),
    }


@app.route("/api/auth/users", methods=["GET"])
def list_users():
    return jsonify([_public_user(u) for u in _load_users()])


@app.route("/api/auth/users", methods=["POST"])
def create_user():
    denied = _admin_only()
    if denied:
        return denied
    data = request.json or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,64}", username):
        return jsonify({"error": "Username must be 3-64 chars (letters, digits, . _ -)"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400
    role = "admin" if data.get("role") == "admin" else "engineer"

    with _FILE_LOCK:
        users = _load_users()
        if any(u["username"] == username for u in users):
            return jsonify({"error": "Username already exists"}), 409
        user = {
            "username": username,
            "password": _hash_password(password),
            "display": (data.get("display") or username).strip(),
            "role": role,
        }
        users.append(user)
        _save_users(users)
    return jsonify(_public_user(user)), 201


@app.route("/api/auth/users/<username>", methods=["PUT"])
def update_user(username):
    denied = _admin_only()
    if denied:
        return denied
    data = request.json or {}

    with _FILE_LOCK:
        users = _load_users()
        user = next((u for u in users if u["username"] == username), None)
        if not user:
            return jsonify({"error": "User not found"}), 404

        new_role = data.get("role", user.get("role", "engineer"))
        admins = [u for u in users if u.get("role") == "admin"]
        if user.get("role") == "admin" and new_role != "admin" and len(admins) <= 1:
            return jsonify({"error": "Cannot demote the last admin"}), 400

        if data.get("password"):
            if len(data["password"]) < 8:
                return jsonify({"error": "Password must be at least 8 characters"}), 400
            user["password"] = _hash_password(data["password"])
        if data.get("display"):
            user["display"] = data["display"].strip()
        if data.get("role") in ("admin", "engineer"):
            user["role"] = data["role"]

        _save_users(users)
    return jsonify(_public_user(user))


@app.route("/api/auth/users/<username>", methods=["DELETE"])
def delete_user(username):
    denied = _admin_only()
    if denied:
        return denied
    if username == g.user["username"]:
        return jsonify({"error": "You cannot delete your own account"}), 400

    with _FILE_LOCK:
        users = _load_users()
        target = next((u for u in users if u["username"] == username), None)
        if not target:
            return jsonify({"error": "User not found"}), 404
        admins = [u for u in users if u.get("role") == "admin"]
        if target.get("role") == "admin" and len(admins) <= 1:
            return jsonify({"error": "Cannot delete the last admin"}), 400
        users = [u for u in users if u["username"] != username]
        _save_users(users)
    return jsonify({"status": "ok"})


@app.route("/api/auth/change-password", methods=["POST"])
def change_password():
    data = request.json or {}
    current = data.get("current_password", "")
    new = data.get("new_password", "")
    if len(new) < 8:
        return jsonify({"error": "New password must be at least 8 characters"}), 400

    with _FILE_LOCK:
        users = _load_users()
        user = next((u for u in users if u["username"] == g.user["username"]), None)
        if not user or not _verify_password(user.get("password", ""), current):
            return jsonify({"error": "Current password is incorrect"}), 400
        user["password"] = _hash_password(new)
        _save_users(users)
    return jsonify({"status": "ok", "token": _issue_token(user)})


@app.route("/api/activity", methods=["GET"])
def get_activity():
    entries = _read_json(ACTIVITY_FILE, [])
    user_filter = request.args.get("user")
    from_filter = request.args.get("from")
    to_filter = request.args.get("to")
    if user_filter:
        entries = [e for e in entries if e.get("username") == user_filter]
    if from_filter:
        entries = [e for e in entries if (e.get("ts") or "")[:10] >= from_filter]
    if to_filter:
        entries = [e for e in entries if (e.get("ts") or "")[:10] <= to_filter]
    return jsonify(entries)


@app.route("/api/activity", methods=["POST"])
def post_activity():
    data = request.json or {}
    username = g.user["username"]
    display = g.user.get("display", username)
    now = _now()
    entry = {
        "id":       f"{now.strftime('%Y%m%d%H%M%S%f')}",
        "ts":       now.isoformat(),
        "date":     now.strftime("%Y-%m-%d"),
        "username": username,
        "display":  display,
        "action":   data.get("action", ""),
        "category": data.get("category", "general"),
        "detail":   data.get("detail", ""),
    }
    with _FILE_LOCK:
        entries = _read_json(ACTIVITY_FILE, [])
        entries.append(entry)
        entries = entries[-5000:]
        _write_json(ACTIVITY_FILE, entries)
    return jsonify(entry), 201


# ══════════════════════════════════════════════════════════════
# Cloud accounts (simple registry, admin-managed)
# ══════════════════════════════════════════════════════════════
ACCOUNTS_FILE = _shared("accounts.json")


@app.route("/api/accounts", methods=["GET"])
def list_accounts():
    return jsonify(_read_json(ACCOUNTS_FILE, []))


@app.route("/api/accounts", methods=["POST"])
def create_account():
    denied = _admin_only()
    if denied:
        return denied
    data = request.json or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Account name is required"}), 400
    with _FILE_LOCK:
        accounts = _read_json(ACCOUNTS_FILE, [])
        account = {
            "id": str(int(_now().timestamp() * 1000)),
            "name": name,
            "platform": data.get("platform", "OCI"),
            "tenancy": data.get("tenancy", ""),
            "region": data.get("region", ""),
            "notes": data.get("notes", ""),
            "createdAt": _now().isoformat(),
        }
        accounts.append(account)
        _write_json(ACCOUNTS_FILE, accounts)
    return jsonify(account), 201


@app.route("/api/accounts/<account_id>", methods=["PUT"])
def update_account(account_id):
    denied = _admin_only()
    if denied:
        return denied
    data = request.json or {}
    with _FILE_LOCK:
        accounts = _read_json(ACCOUNTS_FILE, [])
        account = next((a for a in accounts if a["id"] == account_id), None)
        if not account:
            return jsonify({"error": "Account not found"}), 404
        for field in ("name", "platform", "tenancy", "region", "notes"):
            if field in data:
                account[field] = data[field]
        _write_json(ACCOUNTS_FILE, accounts)
    return jsonify(account)


@app.route("/api/accounts/<account_id>", methods=["DELETE"])
def delete_account(account_id):
    denied = _admin_only()
    if denied:
        return denied
    with _FILE_LOCK:
        accounts = _read_json(ACCOUNTS_FILE, [])
        remaining = [a for a in accounts if a["id"] != account_id]
        if len(remaining) == len(accounts):
            return jsonify({"error": "Account not found"}), 404
        _write_json(ACCOUNTS_FILE, remaining)
    return jsonify({"status": "ok"})


# ══════════════════════════════════════════════════════════════
# Schedules (Celery beat)
# ══════════════════════════════════════════════════════════════
@app.route("/api/schedules")
def list_schedules():
    entries = []
    for name, cfg in (celery.conf.beat_schedule or {}).items():
        meta = SCHEDULE_META.get(name, {})
        last_run = None
        log_name = meta.get("log")
        if log_name and os.path.exists(_shared("logs", log_name)):
            last_run = datetime.fromtimestamp(
                os.stat(_shared("logs", log_name)).st_mtime
            ).isoformat()
        entries.append({
            "id": name,
            "task": cfg.get("task"),
            "label": meta.get("label", name),
            "description": meta.get("description", ""),
            "cron": meta.get("cron", ""),
            "last_run": last_run,
        })
    return jsonify(entries)


@app.route("/api/schedules/<schedule_id>/run", methods=["POST"])
def run_schedule(schedule_id):
    denied = _admin_only()
    if denied:
        return denied
    cfg = (celery.conf.beat_schedule or {}).get(schedule_id)
    if not cfg:
        return jsonify({"error": "Schedule not found"}), 404
    result = celery.send_task(cfg["task"])
    return jsonify({"task_id": result.id, "status": "queued", "queued_at": _now().isoformat()})


# ══════════════════════════════════════════════════════════════
# Auth login (must stay public)
# ══════════════════════════════════════════════════════════════
@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    ip = _client_ip()
    if _rate_limited(ip):
        return jsonify({"ok": False, "error": "Too many attempts. Try again later."}), 429

    data = request.json or {}
    username = data.get("username", "")
    password = data.get("password", "")

    user = next(
        (u for u in _load_users() if u["username"] == username and _verify_password(u.get("password", ""), password)),
        None,
    )
    if not user:
        _record_login_failure(ip)
        return jsonify({"ok": False, "error": "Invalid username or password"}), 401

    _clear_login_failures(ip)
    return jsonify({
        "ok": True,
        "token": _issue_token(user),
        "expires_in": TOKEN_MAX_AGE,
        "user": user["username"],
        "username": user["username"],
        "display": user.get("display", user["username"].upper()),
        "display_name": user.get("display", user["username"].upper()),
        "role": user.get("role", "engineer"),
    })


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    # Tokens are stateless; the client discards them. Kept as an endpoint so
    # the frontend can log the action and future revocation can be added here.
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=os.getenv("FLASK_DEBUG") == "1")
