from flask import Flask, jsonify, request
from flask_cors import CORS
from celery_worker import celery, run_automation, run_oci_login
import os, glob
from datetime import datetime
import oci_session

app = Flask(__name__)
CORS(app)

GRAFANA_BASE_URL = os.getenv("GRAFANA_BASE_URL", "https://monitoring.ilcs.co.id").rstrip("/")
GRAFANA_USER     = os.getenv("GRAFANA_USER", "icscompute")
GRAFANA_PASS     = os.getenv("GRAFANA_PASS", "icsW4tch!")

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

@app.route("/api/ping")
def ping():
    return jsonify({"status": "ok"})


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
    data   = request.json or {}
    cid    = data.get("customer")
    aid    = data.get("automation")
    args   = data.get("args", {})

    if cid not in REGISTRY:
        return jsonify({"error": "Customer not found"}), 404
    auto = next((a for a in REGISTRY[cid]["automations"] if a["id"] == aid), None)
    if not auto:
        return jsonify({"error": "Automation not found"}), 404
    if auto.get("requires_oci_login") and not oci_session.cookies_exist():
        return jsonify({"error": "Belum login OCI. Gunakan tombol Login OCI terlebih dahulu.", "need_login": True}), 400

    task = run_automation.delay(cid, aid, args)
    return jsonify({"task_id": task.id, "status": "queued", "queued_at": datetime.utcnow().isoformat()})


@app.route("/api/run_with_credentials", methods=["POST"])
def trigger_run_with_credentials():
    """Run automation dengan inline OCI login — untuk OCI Backup."""
    data = request.json or {}
    cid    = data.get("customer")
    aid    = data.get("automation")
    args   = data.get("args", {})
    
    tenancy  = data.get("tenancy", "")
    username = data.get("username", "")
    password = data.get("password", "")
    
    if cid not in REGISTRY:
        return jsonify({"error": "Customer not found"}), 404
    auto = next((a for a in REGISTRY[cid]["automations"] if a["id"] == aid), None)
    if not auto:
        return jsonify({"error": "Automation not found"}), 404
    
    # Inject credentials ke args
    args["_tenancy"]  = tenancy
    args["_username"] = username
    args["_password"] = password
    
    from celery_worker import run_automation_with_login
    task = run_automation_with_login.delay(cid, aid, args)
    return jsonify({"task_id": task.id, "status": "queued", "queued_at": datetime.utcnow().isoformat()})


@app.route("/api/oci/login_state/<task_id>")
def oci_login_state(task_id):
    """Poll state OCI login untuk OTP flow."""
    import redis, json
    r = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
    raw = r.get(f"oci_login_state:{task_id}")
    if not raw:
        return jsonify({"state": "unknown"})
    return jsonify(json.loads(raw.decode()))


@app.route("/api/oci/otp", methods=["POST"])
def submit_otp():
    """Frontend submit OTP untuk task yang sedang berjalan."""
    import redis
    data = request.json or {}
    task_id = data.get("task_id")
    otp     = data.get("otp", "")
    
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
    path = f"/app/shared/logs/{cid}_{aid}.log"
    if not os.path.exists(path):
        return jsonify({"logs": []})
    with open(path) as f:
        lines = f.readlines()
    return jsonify({"logs": lines[-300:]})


@app.route("/api/history")
def get_history():
    history = []
    for p in sorted(glob.glob("/app/shared/logs/*.log"), reverse=True):
        name = os.path.basename(p).replace(".log", "")
        if name.startswith("_"):
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
    results = {}
    for folder in ["reports", "screenshots"]:
        files = []
        for f in glob.glob(f"/app/shared/{folder}/{cid}_*"):
            stat = os.stat(f)
            files.append({
                "name": os.path.basename(f),
                "size_kb": round(stat.st_size / 1024, 1),
                "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                "download": f"/api/download/{folder}/{os.path.basename(f)}",
            })
        results[folder] = sorted(files, key=lambda x: x["created"], reverse=True)
    return jsonify(results)


@app.route("/api/download/<folder>/<filename>")
def download_file(folder, filename):
    from flask import send_from_directory
    safe_folder = folder if folder in ["reports", "screenshots"] else "reports"
    return send_from_directory(f"/app/shared/{safe_folder}", filename, as_attachment=True)


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
    Chrome extension (see OciModal in App.jsx)."""
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
# Reads live firing alerts straight from Grafana's built-in Alertmanager
# HTTP API (same credentials used by tasks/pelindo/grafana_capture.py to
# log into the Grafana UI). No extra automation run required — this is a
# direct, read-only REST call.
import json
import requests

ALERT_ESKALASI_FILE = "/app/shared/logs/alert_eskalasi.json"


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


def fetch_grafana_alerts():
    """Fetch currently firing/pending alerts from Grafana's Alertmanager API.

    Endpoint: GET {base}/api/alertmanager/grafana/api/v2/alerts
    Auth: HTTP Basic (same GRAFANA_USER/GRAFANA_PASS as the capture automation).
    Returns a list shaped the way the frontend (AlertPage.jsx, Dashboard.jsx)
    already expects: name, folder, severity, resource, labels, active_at,
    duration_min, state.
    """
    url = f"{GRAFANA_BASE_URL}/api/alertmanager/grafana/api/v2/alerts"
    resp = requests.get(
        url,
        auth=(GRAFANA_USER, GRAFANA_PASS),
        params={"active": "true", "silenced": "false", "inhibited": "false"},
        timeout=15,
    )
    resp.raise_for_status()
    raw = resp.json()

    now = datetime.utcnow()
    alerts = []
    for item in raw:
        labels = item.get("labels", {}) or {}
        annotations = item.get("annotations", {}) or {}
        status = item.get("status", {}) or {}
        state = status.get("state", "active")  # active | suppressed
        starts_at = item.get("startsAt")

        duration_min = 0
        if starts_at:
            try:
                started = datetime.fromisoformat(starts_at.replace("Z", "+00:00")).replace(tzinfo=None)
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
    return alerts


@app.route("/api/grafana/alerts")
def grafana_alerts():
    try:
        alerts = fetch_grafana_alerts()
        return jsonify({"alerts": alerts, "fetched_at": datetime.utcnow().isoformat()})
    except requests.exceptions.RequestException as e:
        return jsonify({"alerts": [], "error": f"Grafana unreachable: {e}"}), 502
    except Exception as e:
        return jsonify({"alerts": [], "error": str(e)}), 500


def _load_eskalasi():
    if not os.path.exists(ALERT_ESKALASI_FILE):
        return {}
    try:
        with open(ALERT_ESKALASI_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def _save_eskalasi(data):
    os.makedirs(os.path.dirname(ALERT_ESKALASI_FILE), exist_ok=True)
    with open(ALERT_ESKALASI_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


@app.route("/api/alerts/eskalasi", methods=["GET"])
def get_eskalasi():
    return jsonify(_load_eskalasi())


@app.route("/api/alerts/eskalasi", methods=["POST"])
def post_eskalasi():
    data = request.json or {}
    key = data.get("key")
    by  = data.get("by", "")
    if not key:
        return jsonify({"error": "key required"}), 400
    store = _load_eskalasi()
    store[key] = {"by": by, "at": datetime.utcnow().isoformat()}
    _save_eskalasi(store)
    return jsonify({"status": "ok"})


# ── Daily Tasks API ──────────────────────────────────────────
TASKS_FILE          = "/app/shared/daily_tasks.json"
DELETE_REQS_FILE    = "/app/shared/logs/delete_requests.json"

def _load_tasks():
    if not os.path.exists(TASKS_FILE):
        return []
    with open(TASKS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def _save_tasks(tasks):
    os.makedirs(os.path.dirname(TASKS_FILE), exist_ok=True)
    with open(TASKS_FILE, "w", encoding="utf-8") as f:
        json.dump(tasks, f, ensure_ascii=False, indent=2)

def _load_delete_reqs():
    if not os.path.exists(DELETE_REQS_FILE):
        return []
    try:
        with open(DELETE_REQS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return []

def _save_delete_reqs(reqs):
    os.makedirs(os.path.dirname(DELETE_REQS_FILE), exist_ok=True)
    with open(DELETE_REQS_FILE, "w", encoding="utf-8") as f:
        json.dump(reqs, f, ensure_ascii=False, indent=2)

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
    tasks = _load_tasks()
    task_id = data.get("id") or str(int(datetime.utcnow().timestamp() * 1000))
    new_task = {
        "id": task_id,
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
        "createdAt": data.get("createdAt", datetime.utcnow().isoformat()),
    }
    tasks.append(new_task)
    _save_tasks(tasks)
    return jsonify(new_task), 201

@app.route("/api/tasks/<task_id>", methods=["PUT"])
def update_task(task_id):
    data = request.json or {}
    tasks = _load_tasks()
    for task in tasks:
        if task["id"] == task_id:
            task.update(data)
            _save_tasks(tasks)
            return jsonify(task)
    return jsonify({"error": "Task not found"}), 404

@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    tasks = _load_tasks()
    tasks = [t for t in tasks if t["id"] != task_id]
    _save_tasks(tasks)
    # Clean up any pending delete-request tied to this task too.
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
        "requested_by": data.get("display") or data.get("username") or "unknown",
        "requested_at": datetime.utcnow().isoformat(),
    })
    _save_delete_reqs(reqs)
    return jsonify({"status": "requested"})

@app.route("/api/tasks/<task_id>/approve-delete", methods=["POST"])
def approve_delete_task(task_id):
    data   = request.json or {}
    action = data.get("action", "approve")  # approve | reject

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


# ── Users + Activity Log ──────────────────────────────────────
# Lightweight file-backed user directory (no DB needed for a handful of
# engineers). Passwords are stored as-is only for this local/internal tool —
# matches the simplicity of the rest of the file-based storage here.
USERS_FILE    = "/app/shared/logs/users.json"
ACTIVITY_FILE = "/app/shared/logs/activity_log.json"

DEFAULT_USERS = [
    {
        "username": os.getenv("AUTH_USERNAME", "admin"),
        "password": os.getenv("AUTH_PASSWORD", "admin"),
        "display":  os.getenv("AUTH_USERNAME", "admin").upper(),
        "role":     "admin",
    },
]

def _load_users():
    if not os.path.exists(USERS_FILE):
        _save_users(DEFAULT_USERS)
        return list(DEFAULT_USERS)
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            users = json.load(f)
        return users if users else list(DEFAULT_USERS)
    except (OSError, json.JSONDecodeError):
        return list(DEFAULT_USERS)

def _save_users(users):
    os.makedirs(os.path.dirname(USERS_FILE), exist_ok=True)
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)

def _load_activity():
    if not os.path.exists(ACTIVITY_FILE):
        return []
    try:
        with open(ACTIVITY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return []

def _save_activity(entries):
    os.makedirs(os.path.dirname(ACTIVITY_FILE), exist_ok=True)
    with open(ACTIVITY_FILE, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)


@app.route("/api/auth/users", methods=["GET"])
def list_users():
    # Never return passwords to the frontend.
    return jsonify([
        {"username": u["username"], "display": u.get("display", u["username"]), "role": u.get("role", "engineer")}
        for u in _load_users()
    ])


@app.route("/api/activity", methods=["GET"])
def get_activity():
    entries = _load_activity()
    user_filter = request.args.get("user")
    from_filter = request.args.get("from")
    to_filter   = request.args.get("to")
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
    username = data.get("username", "unknown")
    now = datetime.utcnow()
    entry = {
        "id":       f"{now.strftime('%Y%m%d%H%M%S%f')}",
        "ts":       now.isoformat() + "Z",
        "date":     now.strftime("%Y-%m-%d"),
        "username": username,
        "display":  data.get("display", username),
        "action":   data.get("action", ""),
        "category": data.get("category", "general"),
        "detail":   data.get("detail", ""),
    }
    entries = _load_activity()
    entries.append(entry)
    # Keep the log from growing forever.
    entries = entries[-5000:]
    _save_activity(entries)
    return jsonify(entry), 201


# ── Authentication ──
@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    data = request.json or {}
    username = data.get('username', '')
    password = data.get('password', '')

    user = next((u for u in _load_users() if u["username"] == username and u["password"] == password), None)
    if user:
        return jsonify({
            'ok': True,
            'user': user["username"],
            'username': user["username"],
            'display': user.get("display", user["username"].upper()),
            'display_name': user.get("display", user["username"].upper()),
            'role': user.get("role", "engineer"),
        })
    return jsonify({'ok': False, 'error': 'Invalid username or password'}), 401

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
