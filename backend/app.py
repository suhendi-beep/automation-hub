from flask import Flask, jsonify, request
from flask_cors import CORS
from celery_worker import celery, run_automation, run_oci_login
import os, glob
from datetime import datetime
import oci_session

app = Flask(__name__)
CORS(app)

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
                "requires_oci_login": False,
                "requires_oci_credentials": True,
                "args": [],
            },
            {
                "id": "oci_pelindo_backup",
                "name": "Weekly Backup Report OCI Pelindo",
                "description": "Screenshot halaman backup OCI semua resource Pelindo → Word report",
                "schedule": "Weekly", "output_type": "docx",
                "requires_oci_login": False,
                "requires_oci_credentials": True,
                "args": [],
            },
            {
                "id": "daily_ilcs_status",
                "name": "Daily Backup Status ILCS",
                "description": "Cek status backup harian via OCI CLI — volume + database ILCS & Pelindo",
                "schedule": "Daily", "output_type": "report",
                "requires_oci_login": False, "args": [],
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

    # Automation yang butuh credentials inline
    if auto.get("requires_oci_credentials"):
        return jsonify({"need_credentials": True}), 200

    task = run_automation.delay(cid, aid, args)
    return jsonify({"task_id": task.id, "status": "queued", "queued_at": datetime.utcnow().isoformat()})


@app.route("/api/run_with_credentials", methods=["POST"])
def trigger_run_with_credentials():
    """Jalankan automation dengan login OCI inline (tanpa cookies)."""
    data    = request.json or {}
    cid     = data.get("customer")
    aid     = data.get("automation")
    args    = data.get("args", {})
    tenancy  = data.get("tenancy", "")
    username = data.get("username", "")
    password = data.get("password", "")

    if cid not in REGISTRY:
        return jsonify({"error": "Customer not found"}), 404
    auto = next((a for a in REGISTRY[cid]["automations"] if a["id"] == aid), None)
    if not auto:
        return jsonify({"error": "Automation not found"}), 404
    if not username or not password:
        return jsonify({"error": "Username dan password diperlukan"}), 400

    # Pass credentials ke args
    args["_tenancy"]  = tenancy
    args["_username"] = username
    args["_password"] = password

    from celery_worker import run_automation_with_login
    task = run_automation_with_login.delay(cid, aid, args)
    return jsonify({"task_id": task.id, "status": "queued", "queued_at": datetime.utcnow().isoformat()})


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


@app.route("/api/oci/save_cookies", methods=["POST"])
def oci_save_cookies():
    """Simpan cookies dari export EditThisCookie."""
    import json as _json
    data = request.json or {}
    raw  = data.get("cookies", "")
    try:
        cookies = _json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(cookies, list):
            return jsonify({"error": "Format cookies tidak valid, harus array JSON"}), 400
        # Simpan ke file
        import os
        COOKIE_FILE = "/app/shared/cookies/oci_cookies.json"
        os.makedirs(os.path.dirname(COOKIE_FILE), exist_ok=True)
        from datetime import datetime
        _data = {"saved_at": datetime.now().isoformat(), "cookies": cookies}
        with open(COOKIE_FILE, "w") as f:
            _json.dump(_data, f, indent=2)
        return jsonify({"status": "ok", "count": len(cookies)})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/oci/login", methods=["POST"])
def oci_login():
    data = request.json or {}
    u, p = data.get("username", ""), data.get("password", "")
    tenancy = data.get("tenancy", "")
    if not u or not p:
        return jsonify({"error": "Username dan password diperlukan"}), 400
    from celery_worker import run_oci_login_with_otp
    task = run_oci_login_with_otp.delay(tenancy, u, p)
    return jsonify({"task_id": task.id, "status": "queued"})


@app.route("/api/oci/otp", methods=["POST"])
def oci_submit_otp():
    """Terima OTP dari frontend dan simpan ke Redis untuk diambil task."""
    data = request.json or {}
    task_id = data.get("task_id", "")
    otp     = data.get("otp", "")
    if not task_id or not otp:
        return jsonify({"error": "task_id dan otp diperlukan"}), 400
    import redis, os
    REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
    r = redis.from_url(REDIS_URL)
    r.setex(f"oci_login_otp:{task_id}", 120, otp)
    return jsonify({"status": "ok"})


@app.route("/api/oci/login_state/<task_id>")
def oci_login_state(task_id):
    """Cek state login — apakah butuh OTP, sukses, atau error."""
    import redis, json, os
    REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
    r   = redis.from_url(REDIS_URL)
    raw = r.get(f"oci_login_state:{task_id}")
    if raw:
        return jsonify(json.loads(raw))
    # Kalau belum ada state, cek Celery task result
    result = celery.AsyncResult(task_id)
    if result.ready():
        res = result.result or {}
        if isinstance(res, dict) and res.get("status") == "success":
            return jsonify({"state": "success", "cookies": res.get("cookies", 0)})
        return jsonify({"state": "error", "msg": str(res)})
    return jsonify({"state": "pending"})


@app.route("/api/oci/logout", methods=["POST"])
def oci_logout():
    oci_session.delete_cookies()
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
