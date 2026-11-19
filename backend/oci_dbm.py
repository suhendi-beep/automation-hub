"""Top SQL dari OCI Database Management (AWR) — read-only via OCI CLI.

Container ini tidak punya paket `oci` di system Python, jadi semua panggilan
memakai OCI CLI (/root/bin/oci) dengan argumen list (tanpa shell).
"""

import json
import logging
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

log = logging.getLogger(__name__)

OCI_BIN = "/root/bin/oci"
PROFILE = "PELINDO-SIN"
CACHE_TTL = 600

OCID_RE = re.compile(r"^ocid1\.database\.oc1\.([a-z0-9-]+)\.[a-z0-9]+$")
SQL_ID_RE = re.compile(r"^[0-9a-z]{13}$")
AWR_DB_ID_RE = re.compile(r"^\d+$")

ROW_RE = re.compile(
    r"^\s*([0-9a-z]{13})\s+"
    r"([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+"
    r"([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+\.\d+)\s+([\d,]+)\s+"
)
ASH_ROW_RE = re.compile(r"^\s*([0-9a-z]{13})\s+(\d+)\s+(\d+)\s*$")
ASH_STATS_RE = re.compile(r"^\s*(\d+)\s+([\d.]+)\s+(.+?)\s*$")
ASH_ROWSRC_RE = re.compile(r"^\s*([\d.]+)\s+(.*?)\s+([\d.]+)\s*$")
ASH_PDB_RE = re.compile(r"^\s{10,}(\S+)\s*$")


class OciError(Exception):
    def __init__(self, code, message, status=502):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def derive_region(ocid):
    m = OCID_RE.match(ocid or "")
    if not m:
        raise OciError("invalid_ocid", "OCID database tidak valid.", 400)
    return m.group(1)


def _run_oci(region, args, timeout=60):
    cmd = [OCI_BIN, "--profile", PROFILE, "--region", region, *args]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        raise OciError("cli_missing", "OCI CLI tidak ditemukan di server.", 503)
    except subprocess.TimeoutExpired:
        raise OciError("timeout", "Panggilan OCI melebihi batas waktu.", 504)

    if p.returncode != 0:
        raw = (p.stderr or p.stdout or "").strip()
        err = {}
        try:
            err = json.loads(raw)
        except Exception:
            pass
        code = err.get("code") or ""
        try:
            status = int(err.get("status") or 0)
        except (TypeError, ValueError):
            status = 0
        if not code:
            # CLI menulis "ServiceError:\n{...json...}" sehingga parse JSON gagal.
            m = re.search(r'"code"\s*:\s*"([^"]+)"', raw)
            code = m.group(1) if m else ""
            m = re.search(r'"status"\s*:\s*(\d+)', raw)
            status = int(m.group(1)) if m else 0
        message = err.get("message") or raw[-400:] or "OCI CLI gagal."
        if not err:
            m = re.search(r'"message"\s*:\s*"([^"]+)"', raw)
            if m:
                message = m.group(1)
        if code == "NotAuthorizedOrNotFound" or status == 404:
            raise OciError(
                "not_managed",
                "Database ini belum terdaftar/aktif di OCI Database Management, "
                "sehingga data AWR tidak tersedia.",
                404,
            )
        if code in ("NotAuthenticated", "NotAuthorized") or status == 401:
            raise OciError("cli_auth", "Kredensial OCI ditolak server.", 502)
        raise OciError("cli_error", str(message)[-400:], 502)

    try:
        return json.loads(p.stdout or "{}")
    except Exception:
        raise OciError("parse_error", "Respons OCI tidak bisa dibaca.", 502)


def list_awr_dbs(ocid, region):
    d = _run_oci(region, [
        "database-management", "managed-database", "list-awr-dbs",
        "--managed-database-id", ocid,
        "--output", "json",
    ])
    items = (d.get("data") or {}).get("items") or []
    if not items:
        raise OciError("awr_disabled", "AWR belum tersedia untuk database ini.", 409)
    for item in items:
        if item.get("container-id") == 0:
            return item
    return items[0]


def fetch_awr_report(ocid, region, awr_db_id, begin, end):
    if not AWR_DB_ID_RE.match(str(awr_db_id or "")):
        raise OciError("parse_error", "ID AWR database tidak valid.", 502)
    d = _run_oci(region, [
        "database-management", "managed-database", "get-awr-db-report",
        "--managed-database-id", ocid,
        "--awr-db-id", str(awr_db_id),
        "--begin-sn-id-greater-than-or-equal-to", str(begin),
        "--end-sn-id-less-than-or-equal-to", str(end),
        "--report-type", "AWR",
        "--report-format", "TEXT",
        "--output", "json",
    ], timeout=90)
    content = (d.get("data") or {}).get("content")
    if not content:
        raise OciError("parse_error", "Laporan AWR kosong.", 502)
    return content


def _is_stop(line):
    s = line.strip()
    if not s:
        return True
    if s.startswith("-> ") or s.startswith("SQL ordered by "):
        return True
    if re.match(r"^[=~-]{5,}$", s):
        return True
    return s.lower().startswith("end of report")


def parse_top_sql(report_text, limit=5):
    lines = report_text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.strip().startswith("SQL ordered by Elapsed Time (Global)"):
            nxt = lines[i + 1].lstrip() if i + 1 < len(lines) else ""
            if nxt.startswith("-> Captured SQL"):
                start = i + 1
                break
    if start is None:
        raise OciError("parse_error", "Section Top SQL tidak ditemukan di laporan AWR.", 502)

    sqls = []
    i = start
    while i < len(lines) and len(sqls) < limit:
        m = ROW_RE.match(lines[i])
        toks = lines[i].split() if m else []
        if not m or len(toks) < 20:
            i += 1
            continue

        text_lines = []
        j = i + 1
        while j < len(lines):
            if ROW_RE.match(lines[j]) or _is_stop(lines[j]):
                break
            text_lines.append(lines[j])
            j += 1

        pdb = toks[-1] if not re.match(r"^[\d,.]+$", toks[-1]) else ""
        sqls.append({
            "sql_id": toks[0],
            "elapsed_s": toks[1],
            "cpu_s": toks[2],
            "execs": toks[8],
            "pdb": pdb,
            "text": "".join(text_lines).strip(),
            "text_full": False,
        })
        i = j

    if not sqls:
        raise OciError("parse_error", "Tidak ada SQL yang bisa dibaca dari laporan AWR.", 502)
    return sqls


def fetch_ash_report(ocid, region, awr_db_id, snapshot_id):
    if not AWR_DB_ID_RE.match(str(awr_db_id or "")):
        raise OciError("parse_error", "ID AWR database tidak valid.", 502)
    d = _run_oci(region, [
        "database-management", "managed-database", "get-awr-db-report",
        "--managed-database-id", ocid,
        "--awr-db-id", str(awr_db_id),
        "--begin-sn-id-greater-than-or-equal-to", str(snapshot_id),
        "--end-sn-id-less-than-or-equal-to", str(snapshot_id),
        "--report-type", "ASH",
        "--report-format", "TEXT",
        "--output", "json",
    ], timeout=60)
    content = (d.get("data") or {}).get("content")
    if not content:
        raise OciError("parse_error", "Laporan ASH kosong.", 502)
    return content


def parse_ash_top_sql(report_text, limit=5):
    """Ambil Top SQL dari section 'Top SQL with Top Events' laporan ASH.

    ASH mengurutkan berdasarkan % activity (setara 'yang paling tinggi' di
    Performance Hub), dan satu snapshot ASH cukup untuk 1 jam terakhir.
    """
    lines = report_text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.startswith("Top SQL with Top Events"):
            start = i + 1
            break
    if start is None:
        raise OciError("parse_error", "Section Top SQL tidak ditemukan di laporan ASH.", 502)

    section_end = len(lines)
    for j in range(start, len(lines)):
        if lines[j].startswith("Top SQL with Top Row Sources") or \
           lines[j].startswith("Top SQL using literals"):
            section_end = j
            break

    sqls = []
    i = start
    while i < section_end and len(sqls) < limit:
        m = ASH_ROW_RE.match(lines[i])
        if not m:
            i += 1
            continue
        sql_id = m.group(1)

        j = i + 1
        while j < section_end and not lines[j].strip():
            j += 1
        stats = ASH_STATS_RE.match(lines[j]) if j < section_end else None
        if not stats:
            i = j + 1
            continue
        sampled, activity_pct, event = stats.group(1), stats.group(2), stats.group(3).strip()

        j += 1
        while j < section_end and not lines[j].strip():
            j += 1
        rs = ASH_ROWSRC_RE.match(lines[j]) if j < section_end else None
        row_source = rs.group(2).strip() if rs else ""

        j += 1
        text_lines = []
        pdb = ""
        while j < section_end:
            s = lines[j]
            if ASH_ROW_RE.match(s):
                break
            pdb_m = ASH_PDB_RE.match(s)
            if pdb_m and text_lines:
                pdb = pdb_m.group(1)
                j += 1
                break
            text_lines.append(s)
            j += 1

        sqls.append({
            "sql_id": sql_id,
            "activity_pct": activity_pct,
            "sampled": sampled,
            "event": event,
            "row_source": row_source,
            "pdb": pdb,
            "text": "".join(text_lines).strip(),
            "text_full": False,
        })
        i = j

    if not sqls:
        raise OciError("parse_error", "Tidak ada SQL yang bisa dibaca dari laporan ASH.", 502)
    return sqls


def fetch_full_sql(ocid, region, awr_db_id, sql_id, begin, end):
    if not SQL_ID_RE.match(sql_id or ""):
        return None
    try:
        d = _run_oci(region, [
            "database-management", "managed-database", "get-awr-db-sql-report",
            "--managed-database-id", ocid,
            "--awr-db-id", str(awr_db_id),
            "--sql-id", sql_id,
            "--begin-sn-id-greater-than-or-equal-to", str(begin),
            "--end-sn-id-less-than-or-equal-to", str(end),
            "--report-format", "TEXT",
            "--output", "json",
        ], timeout=30)
        content = (d.get("data") or {}).get("content")
        inner = json.loads(content) if isinstance(content, str) else content
        for ds in (inner or {}).get("datasets") or []:
            if ds.get("name") == "SQL Text":
                rows = ds.get("rows") or []
                if rows and rows[0]:
                    return str(rows[0][0])
    except Exception:
        log.warning("AWR SQL report gagal untuk %s", sql_id, exc_info=False)
    return None


_CACHE = {}
_CACHE_LOCK = threading.Lock()


def get_top_sql(ocid, limit=5, refresh=False):
    region = derive_region(ocid)

    if not refresh:
        with _CACHE_LOCK:
            hit = _CACHE.get(ocid)
        if hit and time.time() - hit[0] < CACHE_TTL:
            payload = dict(hit[1])
            payload["cached"] = True
            return payload

    item = list_awr_dbs(ocid, region)
    latest = item.get("latest-snapshot-id")
    if not latest:
        raise OciError("no_snapshots", "Belum ada snapshot AWR untuk database ini.", 409)
    end = int(latest)
    awr_db_id = item.get("awr-db-id")

    source = "ash"
    begin = end
    try:
        report = fetch_ash_report(ocid, region, awr_db_id, end)
        sqls = parse_ash_top_sql(report, limit=limit)
    except OciError as e:
        if e.code == "cli_missing" or e.code == "cli_auth":
            raise
        log.warning("ASH gagal, fallback ke AWR: %s", e.message)
        begin = max(int(item.get("first-snapshot-id") or end), end - 1)
        source = "awr"
        report = fetch_awr_report(ocid, region, awr_db_id, begin, end)
        sqls = parse_top_sql(report, limit=limit)

    sql_ids = [s["sql_id"] for s in sqls]
    # Laporan SQL report dengan begin == end hanya mengembalikan potongan ekor
    # teks; pakai 2 snapshot terakhir untuk mendapat teks penuh.
    sql_begin = max(int(item.get("first-snapshot-id") or end), end - 1)
    if sql_ids:
        with ThreadPoolExecutor(max_workers=min(4, len(sql_ids))) as ex:
            futs = {
                ex.submit(fetch_full_sql, ocid, region, awr_db_id, sid, sql_begin, end): sid
                for sid in sql_ids
            }
            full = {}
            for fut in as_completed(futs):
                sid = futs[fut]
                try:
                    full[sid] = fut.result()
                except Exception:
                    full[sid] = None
        for s in sqls:
            text = full.get(s["sql_id"])
            if text and len(text) >= len(s["text"]):
                s["text"] = text
                s["text_full"] = True

    payload = {
        "ok": True,
        "ocid": ocid,
        "region": region,
        "db_name": item.get("db-name"),
        "db_unique_name": item.get("db-unique-name") or item.get("db-name"),
        "awr_db_id": str(awr_db_id),
        "source": source,
        "snapshots": {
            "begin": begin,
            "end": end,
            "end_time": item.get("time-latest-snapshot-end"),
            "interval_min": item.get("snapshot-interval-in-min"),
        },
        "sql": sqls,
        "cached": False,
    }
    with _CACHE_LOCK:
        _CACHE[ocid] = (time.time(), payload)
    return payload
