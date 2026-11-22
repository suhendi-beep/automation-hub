import glob
import json
import logging
import logging.handlers
import os
import re
import secrets
import socket
import ssl
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import requests
from flask import Flask, g, jsonify, request, send_from_directory
from flask_cors import CORS
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.exc import OperationalError, TimeoutError as SATimeoutError

from celery_worker import SCHEDULE_META, celery, run_automation, run_oci_login
import oci_session
import oci_dbm
import repositories as repo
from db import check_db
from repositories import (
    AccountNotFound,
    DeleteRequestNotFound,
    DuplicateTask,
    DuplicateUser,
    InvalidRequestError,
    LastAdminError,
    RequestAlreadyReviewed,
    RequestNotFound,
    SelfApprovalError,
    TaskNotFound,
    UserNotFound,
)
from security import (
    hash_password as _hash_password,
    password_policy_error as _password_policy_error,
    verify_password as _verify_password,
)

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

# Alert baru ditampilkan di app setelah firing minimal 5 menit, supaya alert
# yang singkat (flapping) tidak langsung jadi spam notifikasi.
GRAFANA_ALERT_MIN_AGE_SECONDS = 300

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
LOGIN_MAX_ATTEMPTS_PER_IP = int(os.getenv("LOGIN_MAX_ATTEMPTS_PER_IP", "30"))
LOGIN_WINDOW_SECONDS = int(os.getenv("LOGIN_WINDOW_SECONDS", "300"))
_login_attempts = defaultdict(list)
_ip_attempts = defaultdict(list)
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
                "hidden": True,  # surfaced in the Daily Report page instead of Automation Jobs
            },
        ],
    },
}


def _now():
    return datetime.now()


# Fitur yang bisa diminta aksesnya oleh engineer (approval oleh admin).
FEATURES = {
    "engineer-activity": "Engineer Activity",
    "account-management": "Management Accounts",
}


def _user_features(user):
    if not user:
        return []
    if user.get("role") == "admin":
        return list(FEATURES.keys())
    return [f for f in (user.get("features") or []) if f in FEATURES]


def _public_request(req):
    return {
        "id":           req.get("id"),
        "type":         req.get("type"),
        "username":     req.get("username"),
        "display":      req.get("display", req.get("username")),
        "feature":      req.get("feature"),
        "status":       req.get("status", "pending"),
        "requested_at": req.get("requested_at"),
        "reviewed_at":  req.get("reviewed_at"),
        "reviewed_by":  req.get("reviewed_by"),
    }


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


def _prune_attempts(attempts, now):
    return [t for t in attempts if now - t < LOGIN_WINDOW_SECONDS]


def _rate_limited(ip, username):
    now = time.time()
    key = (ip, username)
    with _login_lock:
        attempts = _prune_attempts(_login_attempts.get(key, []), now)
        ip_attempts = _prune_attempts(_ip_attempts.get(ip, []), now)
        if attempts:
            _login_attempts[key] = attempts
        else:
            _login_attempts.pop(key, None)
        if ip_attempts:
            _ip_attempts[ip] = ip_attempts
        else:
            _ip_attempts.pop(ip, None)
        return (
            len(attempts) >= LOGIN_MAX_ATTEMPTS
            or len(ip_attempts) >= LOGIN_MAX_ATTEMPTS_PER_IP
        )


def _record_login_failure(ip, username):
    now = time.time()
    with _login_lock:
        _login_attempts[(ip, username)].append(now)
        _ip_attempts[ip].append(now)


def _clear_login_failures(ip, username):
    with _login_lock:
        _login_attempts.pop((ip, username), None)


PUBLIC_ENDPOINTS = {"/api/ping", "/api/auth/login", "/api/auth/forgot-password"}


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

    user = repo.get_user(payload.get("u", ""))
    if not user or payload.get("v") != _token_version(user):
        return jsonify({"error": "Session no longer valid"}), 401

    g.user = {
        "username": user["username"],
        "display": user.get("display", user["username"]),
        "role": user.get("role", "engineer"),
        "features": _user_features(user),
    }
    return None


def _admin_only():
    if g.user.get("role") != "admin":
        return jsonify({"error": "Admin access required"}), 403
    return None


def _admin_or_feature(feature):
    if g.user.get("role") == "admin":
        return None
    if feature in (g.user.get("features") or []):
        return None
    return jsonify({"error": "Access denied. Request access from an admin."}), 403


# ══════════════════════════════════════════════════════════════
# Core / customer endpoints
# ══════════════════════════════════════════════════════════════
@app.errorhandler(OperationalError)
@app.errorhandler(SATimeoutError)
def handle_db_unavailable(exc):
    log.error("Database unavailable: %s", exc)
    return jsonify({"error": "Database unavailable"}), 503


@app.route("/api/ping")
def ping():
    return jsonify({"status": "ok"})


@app.route("/api/health")
def health():
    try:
        database_ok = check_db()
    except (OperationalError, SATimeoutError):
        return jsonify({"status": "error", "database": False}), 503
    return jsonify({
        "status": "ok",
        "time": _now().isoformat(),
        "storage": os.path.isdir(SHARED_DIR),
        "database": database_ok,
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
         "status": c["status"],
         "automation_count": sum(1 for a in c["automations"] if not a.get("hidden"))}
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


def _alert_age_seconds(started_at, now):
    if not started_at:
        return None
    try:
        started = datetime.fromisoformat(_norm_ts(started_at).replace("Z", "+00:00"))
        return (now - started).total_seconds()
    except Exception:
        return None


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
            return folder, uid, (data.get("data") or {}).get("alerts") or []
        except Exception as e:
            log.warning("Grafana datasource alerts %s gagal: %s", folder, e)
            return folder, uid, []

    result = []
    with ThreadPoolExecutor(max_workers=len(GRAFANA_PROM_DATASOURCES)) as ex:
        for folder, ds_uid, items in ex.map(fetch, GRAFANA_PROM_DATASOURCES):
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
                    "datasource_uid": ds_uid,
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

    # Sembunyikan alert yang belum firing cukup lama (default 5 menit).
    return [
        a for a in alerts
        if (age := _alert_age_seconds(a.get("active_at"), now)) is None
        or age >= GRAFANA_ALERT_MIN_AGE_SECONDS
    ]


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


# ── Grafana alert chart (rule query history) ────────────────
GRAPH_RANGES = {"1h": 3600, "6h": 21600, "24h": 86400}
_graph_rule_cache = {}
_graph_data_cache = {}
_graph_lock = threading.Lock()


def _graph_cache_get(store, key, ttl):
    now = time.time()
    with _graph_lock:
        hit = store.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
        if hit:
            store.pop(key, None)
    return None


def _graph_cache_put(store, key, value, max_entries=128):
    now = time.time()
    with _graph_lock:
        store[key] = (now, value)
        if len(store) > max_entries:
            for k in sorted(store, key=lambda x: store[x][0])[: len(store) - max_entries]:
                store.pop(k, None)


def _grafana_alert_rule(uid):
    cached = _graph_cache_get(_graph_rule_cache, uid, 300)
    if cached is not None:
        return cached
    resp = requests.get(
        f"{GRAFANA_BASE_URL}/api/v1/provisioning/alert-rules/{uid}",
        auth=(GRAFANA_USER, GRAFANA_PASS), timeout=12,
    )
    if resp.status_code == 404:
        raise KeyError(uid)
    resp.raise_for_status()
    rule = resp.json() or {}
    _graph_cache_put(_graph_rule_cache, uid, rule)
    return rule


def _rule_source_queries(rule):
    queries = []
    for node in (rule.get("data") or []):
        ds_uid = node.get("datasourceUid")
        if not ds_uid or ds_uid == "__expr__":
            continue
        model = dict(node.get("model") or {})
        ds = model.pop("datasource", {}) or {}
        model.pop("refId", None)
        ref_id = node.get("refId") or f"Q{len(queries) + 1}"
        model["refId"] = ref_id
        model["datasource"] = {"uid": ds_uid, "type": ds.get("type")}
        model.setdefault("intervalMs", 60000)
        model.setdefault("maxDataPoints", 400)
        queries.append(model)
        if len(queries) >= 4:
            break
    return queries


def _series_point_ts(value):
    if isinstance(value, str):
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
        except Exception:
            return None
    try:
        ts = float(value)
    except Exception:
        return None
    return int(ts if ts >= 1e12 else ts * 1000)


def _series_label(field, index):
    labels = field.get("labels") or {}
    name = field.get("name")
    instance = labels.get("instance") or labels.get("hostName")
    resource = labels.get("resourceName")
    if name:
        return f"{name} · {instance}" if instance else str(name)
    if resource and instance:
        return f"{resource} · {instance}"
    return str(instance or f"series {index + 1}")


TARGET_LABEL_KEYS = ("instance", "hostName", "nodename", "hostname", "node",
                     "resourceName", "service")


def _norm_label_value(value):
    return str(value or "").strip().lower().rstrip("/")


def _host_only(value):
    s = _norm_label_value(value)
    if "://" in s:
        s = s.split("://", 1)[1].split("/", 1)[0]
    if re.search(r":\d+$", s):
        s = s.rsplit(":", 1)[0]
    return s


def _series_matches_target(labels, target):
    for key, want in target.items():
        got = labels.get(key)
        if got is None:
            continue
        a, b = _norm_label_value(got), _norm_label_value(want)
        if a == b:
            return True
        if key in ("instance", "hostName", "nodename", "hostname", "node"):
            if "://" in a or "://" in b or "/" in a or "/" in b:
                continue
            ha, hb = _host_only(a), _host_only(b)
            if ha and ha == hb:
                return True
    return False


def _frames_to_series(frames, match, target=None, limit=6):
    series = []
    for frame in frames:
        fields = (frame.get("schema") or {}).get("fields") or []
        columns = (frame.get("data") or {}).get("values") or []
        if not fields or not columns:
            continue
        time_idx = next(
            (i for i, f in enumerate(fields) if f.get("type") == "time"), 0)
        times = columns[time_idx] if time_idx < len(columns) else []
        for idx, field in enumerate(fields):
            if idx == time_idx or field.get("type") == "time" or idx >= len(columns):
                continue
            points = []
            for ts, value in zip(times, columns[idx]):
                if value is None:
                    continue
                try:
                    value = float(value)
                except Exception:
                    continue
                if value != value:
                    continue
                ts_ms = _series_point_ts(ts)
                if ts_ms is not None:
                    points.append([ts_ms, value])
            if points:
                series.append({
                    "name": _series_label(field, idx),
                    "points": points,
                    "labels": field.get("labels") or {},
                })
    if target:
        # Strict scoping: only series that belong to the alert's own target.
        series = [s for s in series if _series_matches_target(s["labels"], target)]
    elif match:
        series.sort(key=lambda s: (0 if match in s["name"] else 1, s["name"]))
    series = series[:limit]
    for item in series:
        item.pop("labels", None)
        pts = item["points"]
        if len(pts) > 400:
            step = max(1, len(pts) // 400)
            sampled = pts[::step]
            if sampled[-1] != pts[-1]:
                sampled.append(pts[-1])
            item["points"] = sampled
    return series


@app.route("/api/grafana/alert-graph")
def grafana_alert_graph():
    rule_uid = (request.args.get("ruleUid") or "").strip()
    range_key = (request.args.get("range") or "6h").strip()
    match = (request.args.get("match") or "").strip()[:200]
    raw_labels = (request.args.get("labels") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9]{6,40}", rule_uid):
        return jsonify({"ok": False, "code": "invalid_rule", "error": "Invalid alert rule UID."}), 400
    if range_key not in GRAPH_RANGES:
        return jsonify({"ok": False, "code": "invalid_range", "error": "Unsupported time range."}), 400
    target = {}
    if raw_labels:
        if len(raw_labels) > 1200:
            return jsonify({"ok": False, "code": "invalid_labels",
                            "error": "Alert target labels are too large."}), 400
        try:
            parsed = json.loads(raw_labels)
        except Exception:
            parsed = None
        if not isinstance(parsed, dict):
            return jsonify({"ok": False, "code": "invalid_labels",
                            "error": "Alert target labels must be a JSON object."}), 400
        for key, value in parsed.items():
            if key in TARGET_LABEL_KEYS and isinstance(value, str) and value.strip():
                target[key] = value.strip()[:300]
    if not (GRAFANA_USER and GRAFANA_PASS):
        return jsonify({"ok": False, "code": "not_configured",
                        "error": "Grafana credentials are not configured."}), 503

    cache_key = (rule_uid, range_key, match, tuple(sorted(target.items())))
    cached = _graph_cache_get(_graph_data_cache, cache_key, 60)
    if cached is not None:
        return jsonify(cached)

    try:
        rule = _grafana_alert_rule(rule_uid)
    except KeyError:
        return jsonify({"ok": False, "code": "rule_missing",
                        "error": "The Grafana alert rule was not found."}), 404
    except requests.exceptions.RequestException as e:
        _log_grafana_failure(f"Grafana rule query failed: {e}")
        return jsonify({"ok": False, "code": "grafana_unavailable",
                        "error": f"Grafana unreachable: {e}"}), 502

    queries = _rule_source_queries(rule)
    if not queries:
        return jsonify({"ok": False, "code": "no_query",
                        "error": "This alert rule has no datasource query to chart."}), 422

    to_ms = int(time.time() * 1000)
    from_ms = to_ms - GRAPH_RANGES[range_key] * 1000
    try:
        resp = requests.post(
            f"{GRAFANA_BASE_URL}/api/ds/query",
            json={"queries": queries, "from": str(from_ms), "to": str(to_ms)},
            auth=(GRAFANA_USER, GRAFANA_PASS), timeout=40,
        )
        resp.raise_for_status()
    except requests.exceptions.RequestException as e:
        _log_grafana_failure(f"Grafana query failed: {e}")
        return jsonify({"ok": False, "code": "query_failed",
                        "error": f"Grafana query failed: {e}"}), 502

    frames = []
    query_errors = []
    for result in ((resp.json() or {}).get("results") or {}).values():
        if result.get("error"):
            query_errors.append(str(result["error"])[:200])
        frames.extend(result.get("frames") or [])

    series = _frames_to_series(frames, match, target=target)
    payload = {
        "ok": True,
        "rule_uid": rule_uid,
        "title": rule.get("title") or "",
        "from": from_ms,
        "to": to_ms,
        "series": series,
        "target": target,
    }
    if not series:
        if target:
            label = next(iter(target))
            payload["warning"] = (
                f"No series in this alert rule matched the alert target "
                f"({label}={target[label]}).")
        else:
            payload["warning"] = (query_errors[0] if query_errors else
                                  "No data points returned for this time range.")
    _graph_cache_put(_graph_data_cache, cache_key, payload)
    return jsonify(payload)


def _prom_query_range(ds_uid, expr, start, end, step, timeout=25):
    resp = requests.get(
        f"{GRAFANA_BASE_URL}/api/datasources/proxy/uid/{ds_uid}/api/v1/query_range",
        params={"query": expr, "start": start, "end": end, "step": step},
        auth=(GRAFANA_USER, GRAFANA_PASS), timeout=timeout,
    )
    resp.raise_for_status()
    return ((resp.json() or {}).get("data") or {}).get("result") or []


@app.route("/api/grafana/alert-metrics")
def grafana_alert_metrics():
    """Utilization history for a Prometheus/Alertmanager alert target."""
    ds_uid = (request.args.get("datasourceUid") or "").strip()
    instance = (request.args.get("instance") or "").strip()[:300]
    range_key = (request.args.get("range") or "6h").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,40}", ds_uid):
        return jsonify({"ok": False, "code": "invalid_datasource",
                        "error": "Invalid datasource UID."}), 400
    if len(instance) < 3 or any(ord(c) < 32 for c in instance):
        return jsonify({"ok": False, "code": "invalid_instance",
                        "error": "Invalid alert instance."}), 400
    if range_key not in GRAPH_RANGES:
        return jsonify({"ok": False, "code": "invalid_range",
                        "error": "Unsupported time range."}), 400
    if not (GRAFANA_USER and GRAFANA_PASS):
        return jsonify({"ok": False, "code": "not_configured",
                        "error": "Grafana credentials are not configured."}), 503

    cache_key = ("metrics", ds_uid, instance, range_key)
    cached = _graph_cache_get(_graph_data_cache, cache_key, 60)
    if cached is not None:
        return jsonify(cached)

    to_s = int(time.time())
    from_s = to_s - GRAPH_RANGES[range_key]
    step = max(60, (to_s - from_s) // 400)
    sel = f"instance={json.dumps(instance)}"
    is_url = "://" in instance
    port = instance.rsplit(":", 1)[-1] if re.search(r":\d+$", instance) else ""

    specs = []
    if is_url:
        specs.append(("Health check", f"probe_success{{{sel}}}"))
    else:
        if port != "9182":
            fs = f'{sel},fstype!~"tmpfs|ramfs|overlay|squashfs|devtmpfs"'
            specs += [
                ("CPU utilization",
                 f"100 - (avg(rate(node_cpu_seconds_total{{{sel},mode=\"idle\"}}[5m])) * 100)"),
                ("Memory utilization",
                 f"100 * (1 - (node_memory_MemAvailable_bytes{{{sel}}}"
                 f" / node_memory_MemTotal_bytes{{{sel}}}))"),
                ("Disk utilization",
                 f"100 - (min(node_filesystem_avail_bytes{{{fs}}}"
                 f" / node_filesystem_size_bytes{{{fs}}}) * 100)"),
            ]
        if port == "9182":
            specs += [
                ("CPU utilization",
                 f"100 * (1 - sum(rate(windows_cpu_time_total{{{sel},mode=\"idle\"}}[5m]))"
                 f" / sum(rate(windows_cpu_time_total{{{sel}}}[5m])))"),
                ("Memory utilization",
                 f"100 * (1 - windows_memory_available_bytes{{{sel}}}"
                 f" / windows_cs_physical_memory_bytes{{{sel}}})"),
                ("Disk utilization",
                 f"100 - (min(windows_logical_disk_free_bytes{{{sel},volume!~\"HarddiskVolume.*\"}}"
                 f" / windows_logical_disk_size_bytes{{{sel}}}) * 100)"),
            ]

    def run(spec):
        name, expr = spec
        try:
            rows = _prom_query_range(ds_uid, expr, from_s, to_s, step)
        except Exception as e:
            return name, [], str(e)[:200]
        for row in rows:
            points = []
            for ts, value in (row.get("values") or []):
                try:
                    value = float(value)
                except Exception:
                    continue
                if value != value:
                    continue
                points.append([int(float(ts) * 1000), value])
            if points:
                return name, points, None
        return name, [], None

    series = []
    errors = []
    with ThreadPoolExecutor(max_workers=max(1, len(specs))) as ex:
        for name, points, err in ex.map(run, specs):
            if err:
                errors.append(err)
            elif points:
                if len(points) > 400:
                    sampling = max(1, len(points) // 400)
                    points = points[::sampling]
                series.append({"name": name, "points": points})

    payload = {
        "ok": True,
        "source": "prometheus",
        "title": f"Utilization · {instance}",
        "instance": instance,
        "from": from_s * 1000,
        "to": to_s * 1000,
        "series": series,
    }
    if not series:
        payload["warning"] = (errors[0] if errors else
                              f"No utilization metrics were found for {instance} "
                              f"in this datasource (last {range_key}).")
    _graph_cache_put(_graph_data_cache, cache_key, payload)
    return jsonify(payload)


# ── Daily backup database catalog ───────────────────────────
@app.route("/api/backup/databases")
def backup_databases():
    """Databases covered by the daily backup check. Alerts whose resource maps
    to one of these DBs should be investigated with Top SQL / Performance Hub."""
    try:
        from tasks.pelindo.daily_ilcs_status import DATABASES_ILCS, DATABASES_PELINDO
    except Exception as e:
        log.exception("Backup database catalog unavailable")
        return jsonify({"databases": [], "error": str(e)}), 500

    def region_of(ocid):
        parts = (ocid or "").split(".")
        return parts[3] if len(parts) > 3 and parts[3] else "ap-singapore-1"

    databases = [
        {"name": name, "ocid": ocid, "region": region_of(ocid), "group": group}
        for group, rows in (("ILCS", DATABASES_ILCS), ("PELINDO", DATABASES_PELINDO))
        for name, ocid in rows
    ]
    return jsonify({"databases": databases})


# ── HealthCheck evidence (blackbox URL) ─────────────────────
_HEALTH_CACHE = {"at": 0.0, "urls": set()}
_HEALTH_LOCK = threading.Lock()
WIB_TZ = timezone(timedelta(hours=7))


def _norm_probe_url(url):
    return (url or "").strip().rstrip("/")


def _extract_http_url(value):
    """Pull a URL out of labels such as '[name] https://host/health'."""
    m = re.search(r"https?://[^\s\"'\]\)]+", str(value or ""), re.I)
    return _norm_probe_url(m.group(0)) if m else ""


def _active_health_urls():
    with _HEALTH_LOCK:
        if _HEALTH_CACHE["urls"] and time.time() - _HEALTH_CACHE["at"] < 60:
            return set(_HEALTH_CACHE["urls"])
    try:
        alerts = fetch_grafana_alerts()
    except Exception:
        with _HEALTH_LOCK:
            if _HEALTH_CACHE["urls"]:
                return set(_HEALTH_CACHE["urls"])
        raise

    urls = set()
    for alert in alerts:
        labels = alert.get("labels") or {}
        for candidate in (alert.get("resource"), labels.get("instance")):
            url = _extract_http_url(candidate)
            if url:
                urls.add(url)
    with _HEALTH_LOCK:
        _HEALTH_CACHE["at"] = time.time()
        _HEALTH_CACHE["urls"] = urls
    return set(urls)


def _iso_ts(ts):
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
    except Exception:
        return None


def _fmt_wib(iso):
    if not iso:
        return "-"
    try:
        return datetime.fromisoformat(iso).astimezone(WIB_TZ).strftime("%d %b %Y %H:%M WIB")
    except Exception:
        return iso


def _probe_http(url):
    out = {
        "url": url, "ok": False, "reachable": False, "status_code": None,
        "latency_ms": None, "final_url": url, "redirects": [],
        "server": None, "content_type": None, "body_snippet": None,
        "tls_verified": None, "error": None, "error_type": None,
    }
    started = time.monotonic()

    def fetch(verify):
        return requests.get(
            url, timeout=(5, 10), allow_redirects=True, stream=True,
            verify=verify,
            headers={"User-Agent": "ILCS-Portal-Evidence/1.0"},
        )

    try:
        try:
            resp = fetch(True)
            out["tls_verified"] = True
        except requests.exceptions.SSLError:
            # Sertifikat internal bisa self-signed. Tetap ambil bukti HTTP-nya,
            # sementara status TLS dilaporkan terpisah oleh _tls_info().
            out["tls_verified"] = False
            resp = fetch(False)
        with resp:
            out["latency_ms"] = int(round((time.monotonic() - started) * 1000))
            out["status_code"] = resp.status_code
            out["reachable"] = True
            out["ok"] = resp.status_code < 400
            out["final_url"] = resp.url
            out["server"] = resp.headers.get("Server")
            out["content_type"] = resp.headers.get("Content-Type")
            out["redirects"] = [
                {
                    "status": h.status_code,
                    "url": h.url,
                    "location": h.headers.get("Location"),
                }
                for h in resp.history
            ]
            try:
                body = resp.raw.read(2048, decode_content=True) or b""
                ctype = (resp.headers.get("Content-Type") or "").lower()
                if body and any(t in ctype for t in ("text/", "json", "html", "xml")):
                    snippet = body.decode(resp.encoding or "utf-8", "replace")
                    snippet = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", snippet,
                                     flags=re.I)
                    snippet = re.sub(r"<[^>]+>", " ", snippet)
                    snippet = re.sub(r"\s+", " ", snippet).strip()
                    out["body_snippet"] = snippet[:240] or None
            except Exception:
                pass
    except requests.exceptions.Timeout as e:
        out["error_type"] = "timeout"
        out["error"] = str(e) or "request timeout"
    except requests.exceptions.SSLError as e:
        out["error_type"] = "tls"
        out["error"] = str(e)
    except requests.exceptions.ConnectionError as e:
        out["error_type"] = "connection"
        out["error"] = str(e)
    except requests.exceptions.RequestException as e:
        out["error_type"] = "http"
        out["error"] = str(e)
    except ValueError as e:
        out["error_type"] = "invalid_url"
        out["error"] = str(e)
    return out


def _tls_info(url):
    parts = urlsplit(url)
    if parts.scheme.lower() != "https" or not parts.hostname:
        return None
    host = parts.hostname
    port = parts.port or 443
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, port), timeout=6) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as tls_sock:
                cert = tls_sock.getpeercert()
        not_after = cert.get("notAfter")
        expires = datetime.fromtimestamp(
            ssl.cert_time_to_seconds(not_after), tz=timezone.utc)
        issuer = {k: v for tup in cert.get("issuer", ()) for k, v in tup}
        return {
            "valid": True,
            "not_after": expires.isoformat(),
            "days_left": (expires - datetime.now(timezone.utc)).days,
            "issuer": issuer.get("commonName") or issuer.get("organizationName") or "-",
        }
    except Exception as e:
        return {"valid": False, "error": f"{type(e).__name__}: {e}"}


def _prom_range(uid, query, start, end, step=60):
    resp = requests.get(
        f"{GRAFANA_BASE_URL}/api/datasources/proxy/uid/{uid}/api/v1/query_range",
        auth=(GRAFANA_USER, GRAFANA_PASS),
        params={"query": query, "start": start, "end": end, "step": step},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json() or {}
    return ((data.get("data") or {}).get("result") or [])


def _series_points(values):
    points = []
    for pair in values or []:
        try:
            points.append((float(pair[0]), str(pair[1])))
        except (TypeError, ValueError, IndexError):
            continue
    points.sort()
    return points


def _probe_history(url, minutes):
    end = int(time.time())
    start = end - minutes * 60
    inst = url.replace("\\", "\\\\").replace('"', '\\"')
    out = {
        "datasource": None, "window_min": minutes, "samples": 0,
        "uptime_pct": None, "current_success": None, "current_since": None,
        "last_ok_at": None, "last_fail_at": None, "down_minutes": None,
        "latency_avg_ms": None, "latency_max_ms": None, "status_codes": [],
        "first_at": None, "last_at": None,
    }

    for folder, uid in GRAFANA_PROM_DATASOURCES:
        try:
            result = _prom_range(
                uid, f'probe_success{{instance="{inst}"}}', start, end)
        except Exception as e:
            log.warning("HealthCheck metrics %s gagal: %s", folder, e)
            continue
        points = _series_points((result[0] if result else {}).get("values"))
        if not points:
            continue

        out["datasource"] = folder
        total = len(points)
        ups = sum(1 for _, value in points if value == "1")
        current = points[-1][1] == "1"
        since_idx = total - 1
        while since_idx > 0 and points[since_idx - 1][1] == points[-1][1]:
            since_idx -= 1
        ok_times = [t for t, value in points if value == "1"]
        fail_times = [t for t, value in points if value != "1"]

        out.update(
            samples=total,
            uptime_pct=round(100.0 * ups / total, 1),
            current_success=current,
            current_since=_iso_ts(points[since_idx][0]),
            last_ok_at=_iso_ts(max(ok_times)) if ok_times else None,
            last_fail_at=_iso_ts(max(fail_times)) if fail_times else None,
            down_minutes=0 if current else max(
                0, int((points[-1][0] - points[since_idx][0]) // 60)),
            first_at=_iso_ts(points[0][0]),
            last_at=_iso_ts(points[-1][0]),
        )

        try:
            lat_res = _prom_range(
                uid, f'probe_duration_seconds{{instance="{inst}"}}', start, end)
            lat_values = [
                float(value)
                for _, value in _series_points(
                    (lat_res[0] if lat_res else {}).get("values"))
                if value not in ("NaN", "+Inf", "-Inf")
            ]
            if lat_values:
                out["latency_avg_ms"] = int(round(1000 * sum(lat_values) / len(lat_values)))
                out["latency_max_ms"] = int(round(1000 * max(lat_values)))
        except Exception:
            pass

        try:
            status_res = _prom_range(
                uid, f'probe_http_status_code{{instance="{inst}"}}', start, end)
            codes = set()
            for series in status_res:
                pts = _series_points(series.get("values"))
                if pts and pts[-1][1] not in ("NaN", "+Inf", "-Inf"):
                    try:
                        codes.add(int(float(pts[-1][1])))
                    except ValueError:
                        pass
            out["status_codes"] = sorted(codes)
        except Exception:
            pass
        break

    return out


def _health_conclusion(probe, tls, prom):
    if probe.get("ok"):
        head = f"URL merespons normal (HTTP {probe.get('status_code')})."
    elif probe.get("reachable"):
        head = (
            f"Server merespons tetapi tidak sehat: HTTP {probe.get('status_code')} "
            f"dalam {probe.get('latency_ms')} ms."
        )
    else:
        head = (
            f"URL gagal dihubungi: {probe.get('error_type') or 'error'} — "
            f"{probe.get('error') or 'tanpa detail'}."
        )

    extra = []
    if prom.get("samples"):
        extra.append(
            f"Blackbox mencatat uptime {prom.get('uptime_pct')}% dalam "
            f"{prom.get('window_min')} menit terakhir."
        )
        if prom.get("current_success") is False and prom.get("down_minutes"):
            extra.append(f"Status down sejak {_fmt_wib(prom.get('current_since'))} "
                         f"(±{prom.get('down_minutes')} menit).")
    if tls and tls.get("valid"):
        extra.append(f"Sertifikat TLS berlaku sampai {_fmt_wib(tls.get('not_after'))}.")
    elif tls and tls.get("valid") is False:
        extra.append(f"Pemeriksaan TLS gagal: {tls.get('error')}.")
    return " ".join([head] + extra)


def _health_report_text(url, minutes, probe, tls, prom, conclusion, generated_at):
    lines = [
        "Laporan Pengecekan Health Check",
        f"URL          : {url}",
        f"Waktu cek    : {generated_at}",
        f"Window       : {minutes} menit terakhir",
        "",
        "PROBE LANGSUNG",
    ]
    if probe.get("status_code") is not None:
        lines.append(
            f"Status       : HTTP {probe['status_code']} "
            f"({probe.get('latency_ms')} ms) — "
            f"{'OK' if probe.get('ok') else 'tidak sehat'}"
        )
    else:
        lines.append(f"Status       : GAGAL ({probe.get('error_type')})")
        lines.append(f"Error        : {probe.get('error')}")
    if probe.get("final_url") and probe.get("final_url") != url:
        lines.append(f"URL akhir    : {probe['final_url']}")
    if probe.get("redirects"):
        lines.append(f"Redirect     : {len(probe['redirects'])} kali")
        for hop in probe["redirects"]:
            lines.append(f"  {hop['status']} {hop['url']}")
    if probe.get("server"):
        lines.append(f"Server       : {probe['server']}")
    if probe.get("tls_verified") is False:
        lines.append("TLS verify   : GAGAL (probe diulang tanpa verifikasi sertifikat)")
    if probe.get("body_snippet"):
        lines.append(f"Cuplikan     : {probe['body_snippet']}")

    lines += ["", "TLS"]
    if tls is None:
        lines.append("Tidak berlaku (URL bukan HTTPS)")
    elif tls.get("valid"):
        lines.append(f"Issuer       : {tls.get('issuer')}")
        lines.append(f"Berlaku s/d  : {_fmt_wib(tls.get('not_after'))} ({tls.get('days_left')} hari)")
    else:
        lines.append(f"Tidak valid  : {tls.get('error')}")

    lines += ["", "BLACKBOX (Grafana)"]
    if prom.get("samples"):
        lines.append(f"Data source  : {prom.get('datasource')}")
        lines.append(
            f"Uptime       : {prom.get('uptime_pct')}% "
            f"({prom.get('samples')} sampel)"
        )
        lines.append(f"Status kini  : {'UP' if prom.get('current_success') else 'DOWN'}")
        lines.append(f"Terakhir OK  : {_fmt_wib(prom.get('last_ok_at'))}")
        lines.append(f"Terakhir fail: {_fmt_wib(prom.get('last_fail_at'))}")
        if prom.get("current_success") is False:
            lines.append(f"Down sejak   : {_fmt_wib(prom.get('current_since'))} "
                         f"(±{prom.get('down_minutes')} menit)")
        if prom.get("latency_avg_ms") is not None:
            lines.append(
                f"Latency      : avg {prom.get('latency_avg_ms')} ms, "
                f"max {prom.get('latency_max_ms')} ms"
            )
        if prom.get("status_codes"):
            lines.append("HTTP codes   : " + ", ".join(map(str, prom["status_codes"])))
    else:
        lines.append("Tidak ada metrik probe_success untuk URL ini di data source Grafana.")

    lines += ["", "KESIMPULAN", conclusion]
    return "\n".join(lines)


@app.route("/api/healthcheck/evidence")
def healthcheck_evidence():
    url = _extract_http_url(request.args.get("url"))
    if not re.match(r"^https?://", url, re.I):
        return jsonify({"ok": False, "error": "Parameter url wajib berupa http(s) URL"}), 400
    try:
        minutes = max(5, min(1440, int(request.args.get("minutes", "60"))))
    except ValueError:
        minutes = 60

    try:
        allowed = _active_health_urls()
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": f"Tidak dapat memverifikasi URL dari alert Grafana: {e}",
        }), 503
    if url not in allowed:
        return jsonify({
            "ok": False,
            "error": "URL ini bukan HealthCheckDown/blackbox yang sedang aktif",
        }), 404

    probe = _probe_http(url)
    tls = _tls_info(url)
    prom = _probe_history(url, minutes)
    conclusion = _health_conclusion(probe, tls, prom)
    generated_at = datetime.now(WIB_TZ).isoformat()

    return jsonify({
        "ok": True,
        "url": url,
        "minutes": minutes,
        "generated_at": generated_at,
        "probe": probe,
        "tls": tls,
        "prom": prom,
        "conclusion": conclusion,
        "report_text": _health_report_text(
            url, minutes, probe, tls, prom, conclusion, generated_at),
    })


@app.route("/api/oci/dbm/top-sql")
def oci_dbm_top_sql():
    ocid = (request.args.get("ocid") or "").strip()
    refresh = request.args.get("refresh") == "1"
    m = oci_dbm.OCID_RE.match(ocid)
    sys_m = oci_dbm.DBSYSTEM_OCID_RE.match(ocid)
    region = (m or sys_m).group(1) if (m or sys_m) else ""
    if m:
        console_url = (
            f"https://cloud.oracle.com/dbmgmt-ui/perfhub?region={region}&ocid={ocid}"
        )
        console_label = "Buka PerfHub di OCI Console"
    elif sys_m:
        console_url = f"https://cloud.oracle.com/db/db-systems?region={region}"
        console_label = "Buka DB Systems di OCI Console"
    else:
        console_url = ""
        console_label = ""
    try:
        data = oci_dbm.get_top_sql(ocid, refresh=refresh)
        data["console_url"] = console_url
        data["console_label"] = console_label
        return jsonify(data)
    except oci_dbm.OciError as e:
        log.warning("DBM top-sql failed (%s): %s", e.code, e.message)
        return jsonify({
            "ok": False, "code": e.code, "error": e.message,
            "ocid": ocid, "region": region,
            "console_url": console_url, "console_label": console_label,
        }), e.status
    except Exception as e:
        log.exception("DBM top-sql unexpected error")
        return jsonify({
            "ok": False, "code": "internal", "error": str(e),
            "ocid": ocid, "region": region,
            "console_url": console_url, "console_label": console_label,
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


ESKALASI_TTL_DAYS = int(os.getenv("ESKALASI_TTL_DAYS", "7"))


@app.route("/api/alerts/eskalasi", methods=["GET"])
def get_eskalasi():
    return jsonify(repo.list_escalations(ESKALASI_TTL_DAYS))


@app.route("/api/alerts/eskalasi", methods=["POST"])
def post_eskalasi():
    data = request.json or {}
    key = data.get("key")
    by = data.get("by", "")
    if not key:
        return jsonify({"error": "key required"}), 400
    repo.set_escalation(key, by, ESKALASI_TTL_DAYS)
    return jsonify({"status": "ok"})


# ══════════════════════════════════════════════════════════════
# Daily tasks
# ══════════════════════════════════════════════════════════════
@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    if request.args.get("page") or request.args.get("page_size"):
        return jsonify(repo.query_tasks(
            date_filter=request.args.get("date"),
            month_filter=request.args.get("month"),
            search=request.args.get("q"),
            status=request.args.get("status"),
            customer=request.args.get("customer"),
            page=request.args.get("page", 1),
            page_size=request.args.get("page_size", 50),
        ))
    return jsonify(repo.list_tasks(
        request.args.get("date"),
        request.args.get("month"),
    ))


@app.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.json or {}
    description = str(data.get("description") or "").strip()
    is_alert = description.startswith("[ALERT]")
    pic = str(data.get("pic") or "").strip()
    generate_report = repo.bool_value(data.get("generateReport", False))
    allowed_pics = {user["display"] for user in repo.list_users()}

    if is_alert:
        if pic and pic not in allowed_pics:
            return jsonify({"error": "PIC tidak diizinkan", "pic": pic}), 403
    elif not generate_report and pic not in allowed_pics:
        return jsonify({"error": "PIC tidak diizinkan", "pic": pic}), 403

    now = repo.now_jakarta()
    recent_count = repo.count_tasks_since(now - timedelta(seconds=60))
    if recent_count >= 30:
        return jsonify({
            "error": "Terlalu banyak task dibuat dalam 60 detik terakhir — ditolak untuk mencegah data spam. Hubungi admin jika ini sengaja.",
            "recent_count": recent_count,
        }), 429

    if is_alert:
        alert_key = str(data.get("alertKey") or "").strip()
        existing = repo.find_open_alert_task(
            alert_key,
            description if not alert_key else "",
        )
        if existing:
            return jsonify(existing), 200
        duplicate = repo.find_recent_duplicate_alert(
            description,
            str(data.get("customer") or "").strip(),
            now - timedelta(seconds=900),
        )
        if duplicate:
            return jsonify(duplicate), 200

    try:
        task = repo.create_task(data)
    except DuplicateTask:
        return jsonify({"error": "Task already exists"}), 409

    if any(data.get(key) for key in ("_by", "_byDisplay", "_action", "_detail")):
        repo.add_activity(
            username=str(data.get("_by") or data.get("pic") or "system").strip() or "system",
            display=str(data.get("_byDisplay") or data.get("pic") or "System").strip() or "System",
            action=data.get("_action") or "Create Task",
            category="task",
            detail=data.get("_detail") or f"[{task.get('customer', '')}] {task.get('description', '')}",
        )
    return jsonify(task), 201


@app.route("/api/tasks/<task_id>", methods=["PUT"])
def update_task(task_id):
    try:
        task = repo.update_task(task_id, request.json or {})
    except TaskNotFound:
        return jsonify({"error": "Task not found"}), 404
    return jsonify(task)


@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    denied = _admin_only()
    if denied:
        return denied
    repo.delete_task(task_id)
    return jsonify({"status": "ok"})


# ── Task delete-request workflow (non-admin must ask an admin to approve) ──
@app.route("/api/tasks/pending-deletes", methods=["GET"])
def get_pending_deletes():
    return jsonify(repo.list_pending_deletes())


@app.route("/api/tasks/<task_id>/request-delete", methods=["POST"])
def request_delete_task(task_id):
    data = request.json or {}
    requested_by = (
        g.user.get("display") or data.get("display") or g.user["username"]
    )
    try:
        status = repo.request_delete(task_id, requested_by)
    except TaskNotFound:
        return jsonify({"error": "Task not found"}), 404
    return jsonify({"status": status})


@app.route("/api/tasks/<task_id>/approve-delete", methods=["POST"])
def approve_delete_task(task_id):
    denied = _admin_only()
    if denied:
        return denied
    data = request.json or {}
    action = data.get("action", "approve")
    try:
        status = repo.resolve_delete(task_id, action)
    except DeleteRequestNotFound:
        return jsonify({"error": "No pending request for this task"}), 404
    return jsonify({"status": status})


# ══════════════════════════════════════════════════════════════
# Users + Activity log
# ══════════════════════════════════════════════════════════════
def _public_user(user):
    return {
        "username": user["username"],
        "display": user.get("display", user["username"]),
        "role": user.get("role", "engineer"),
        "features": _user_features(user),
    }


@app.route("/api/auth/users", methods=["GET"])
def list_users():
    return jsonify([_public_user(u) for u in repo.list_users()])


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

    try:
        user = repo.create_user(
            username,
            _hash_password(password),
            (data.get("display") or username).strip(),
            role,
        )
    except DuplicateUser:
        return jsonify({"error": "Username already exists"}), 409
    return jsonify(_public_user(user)), 201


@app.route("/api/auth/users/<username>", methods=["PUT"])
def update_user(username):
    denied = _admin_only()
    if denied:
        return denied
    data = request.json or {}
    password_hash = None
    if data.get("password"):
        if len(data["password"]) < 8:
            return jsonify({"error": "Password must be at least 8 characters"}), 400
        password_hash = _hash_password(data["password"])
    display = data.get("display") if data.get("display") else None
    role = data.get("role") if data.get("role") in ("admin", "engineer") else None

    try:
        user = repo.update_user(username, password_hash, display, role)
    except UserNotFound:
        return jsonify({"error": "User not found"}), 404
    except LastAdminError:
        return jsonify({"error": "Cannot demote the last admin"}), 400
    return jsonify(_public_user(user))


@app.route("/api/auth/users/<username>", methods=["DELETE"])
def delete_user(username):
    denied = _admin_only()
    if denied:
        return denied
    if username == g.user["username"]:
        return jsonify({"error": "You cannot delete your own account"}), 400

    try:
        repo.delete_user(username)
    except UserNotFound:
        return jsonify({"error": "User not found"}), 404
    except LastAdminError:
        return jsonify({"error": "Cannot delete the last admin"}), 400
    return jsonify({"status": "ok"})


@app.route("/api/auth/me")
def auth_me():
    user = repo.get_user(g.user["username"])
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify(_public_user(user))


@app.route("/api/auth/change-password", methods=["POST"])
def change_password():
    data = request.json or {}
    current = data.get("current_password", "")
    new = data.get("new_password", "")
    err = _password_policy_error(new)
    if err:
        return jsonify({"error": err}), 400

    user = repo.get_user(g.user["username"])
    if not user or not _verify_password(user.get("password", ""), current):
        return jsonify({"error": "Current password is incorrect"}), 400

    # Admin berganti password langsung; engineer harus lewat approval admin.
    if user.get("role") == "admin":
        user = repo.set_password(user["username"], _hash_password(new))
        return jsonify({"status": "ok", "token": _issue_token(user)})

    repo.queue_request({
        "type":          "password",
        "username":      user["username"],
        "display":       user.get("display", user["username"]),
        "password_hash": _hash_password(new),
    })
    return jsonify({
        "status": "pending",
        "message": "Password change request sent. An admin must approve it.",
    })


@app.route("/api/auth/forgot-password", methods=["POST"])
def forgot_password():
    data = request.json or {}
    username = str(data.get("username") or "").strip().lower()
    new = data.get("new_password", "")
    err = _password_policy_error(new)
    if err:
        return jsonify({"error": err}), 400

    user = repo.get_user(username)
    if user:
        repo.queue_request({
            "type":          "password",
            "username":      user["username"],
            "display":       user.get("display", user["username"]),
            "password_hash": _hash_password(new),
        })
    # Jangan bocorkan apakah username terdaftar atau tidak.
    return jsonify({
        "ok": True,
        "message": "Password reset request sent. An admin must approve it.",
    })


@app.route("/api/access-requests", methods=["POST"])
def request_access():
    data = request.json or {}
    feature = data.get("feature") or ""
    if feature not in FEATURES:
        return jsonify({"error": "Unknown feature"}), 400

    user = repo.get_user(g.user["username"])
    if not user:
        return jsonify({"error": "User not found"}), 404
    if feature in _user_features(user):
        return jsonify({"error": "You already have access to this feature"}), 409

    repo.queue_request({
        "type":     "access",
        "username": user["username"],
        "display":  user.get("display", user["username"]),
        "feature":  feature,
    })
    return jsonify({"status": "pending", "message": "Access request sent for admin approval."})


@app.route("/api/requests/mine")
def my_requests():
    return jsonify([
        _public_request(r)
        for r in repo.list_requests(username=g.user["username"])
    ])


@app.route("/api/requests")
def list_requests():
    denied = _admin_or_feature("account-management")
    if denied:
        return denied
    status = request.args.get("status", "pending")
    return jsonify([
        _public_request(r)
        for r in repo.list_requests(status=status)
    ])


@app.route("/api/requests/<request_id>/approve", methods=["POST"])
def approve_request(request_id):
    denied = _admin_or_feature("account-management")
    if denied:
        return denied
    try:
        req = repo.review_request(
            request_id,
            g.user["username"],
            "approve",
            g.user.get("role") == "admin",
            set(FEATURES.keys()),
        )
    except RequestNotFound:
        return jsonify({"error": "Request not found"}), 404
    except RequestAlreadyReviewed:
        return jsonify({"error": "Request already reviewed"}), 409
    except SelfApprovalError:
        return jsonify({"error": "You cannot approve your own request"}), 403
    except UserNotFound:
        return jsonify({"error": "User no longer exists"}), 404
    except InvalidRequestError:
        return jsonify({"error": "Unknown request type"}), 400
    return jsonify(_public_request(req))


@app.route("/api/requests/<request_id>/reject", methods=["POST"])
def reject_request(request_id):
    denied = _admin_or_feature("account-management")
    if denied:
        return denied
    try:
        req = repo.review_request(
            request_id,
            g.user["username"],
            "reject",
            g.user.get("role") == "admin",
            set(FEATURES.keys()),
        )
    except RequestNotFound:
        return jsonify({"error": "Request not found"}), 404
    except RequestAlreadyReviewed:
        return jsonify({"error": "Request already reviewed"}), 409
    return jsonify(_public_request(req))


@app.route("/api/activity", methods=["GET"])
def get_activity():
    return jsonify(repo.list_activity(
        user=request.args.get("user"),
        from_date=request.args.get("from"),
        to_date=request.args.get("to"),
    ))


@app.route("/api/activity", methods=["POST"])
def post_activity():
    data = request.json or {}
    username = g.user["username"]
    entry = repo.add_activity(
        username=username,
        display=g.user.get("display", username),
        action=data.get("action", ""),
        category=data.get("category", "general"),
        detail=data.get("detail", ""),
    )
    return jsonify(entry), 201


# ══════════════════════════════════════════════════════════════
# Cloud accounts (simple registry, admin-managed)
# ══════════════════════════════════════════════════════════════
@app.route("/api/accounts", methods=["GET"])
def list_accounts():
    denied = _admin_or_feature("account-management")
    if denied:
        return denied
    return jsonify(repo.list_accounts())


@app.route("/api/accounts", methods=["POST"])
def create_account():
    denied = _admin_or_feature("account-management")
    if denied:
        return denied
    data = request.json or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Account name is required"}), 400
    data["name"] = name
    return jsonify(repo.create_account(data)), 201


@app.route("/api/accounts/<account_id>", methods=["PUT"])
def update_account(account_id):
    denied = _admin_or_feature("account-management")
    if denied:
        return denied
    try:
        account = repo.update_account(account_id, request.json or {})
    except AccountNotFound:
        return jsonify({"error": "Account not found"}), 404
    return jsonify(account)


@app.route("/api/accounts/<account_id>", methods=["DELETE"])
def delete_account(account_id):
    denied = _admin_or_feature("account-management")
    if denied:
        return denied
    if not repo.delete_account(account_id):
        return jsonify({"error": "Account not found"}), 404
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
    data = request.json or {}
    username = str(data.get("username") or "").strip().lower()
    password = data.get("password", "")
    ip = _client_ip()
    if _rate_limited(ip, username):
        return jsonify({"ok": False, "error": "Too many attempts. Try again later."}), 429

    user = repo.get_user(username)
    if not user or not _verify_password(user.get("password", ""), password):
        _record_login_failure(ip, username)
        return jsonify({"ok": False, "error": "Invalid username or password"}), 401

    _clear_login_failures(ip, username)
    return jsonify({
        "ok": True,
        "token": _issue_token(user),
        "expires_in": TOKEN_MAX_AGE,
        "user": user["username"],
        "username": user["username"],
        "display": user.get("display", user["username"].upper()),
        "display_name": user.get("display", user["username"].upper()),
        "role": user.get("role", "engineer"),
        "features": _user_features(user),
    })


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    # Tokens are stateless; the client discards them. Kept as an endpoint so
    # the frontend can log the action and future revocation can be added here.
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=os.getenv("FLASK_DEBUG") == "1")
