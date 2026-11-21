import argparse
import json
import os
import sys

from sqlalchemy import delete, func, select

from db import SessionLocal
from models import (
    AccessPasswordRequest,
    ActivityLog,
    AlertEscalation,
    CloudAccount,
    DailyTask,
    TaskCounter,
    TaskDeleteRequest,
    User,
)
from repositories import (
    _activity_max_rows,
    _prune_requests,
    bool_value,
    now_jakarta,
    parse_date,
    parse_ts,
)
from security import hash_if_plaintext


TABLES = ("users", "accounts", "tasks", "delete_requests", "requests", "activity", "escalations")
MODELS = {
    "users": User,
    "accounts": CloudAccount,
    "tasks": DailyTask,
    "delete_requests": TaskDeleteRequest,
    "requests": AccessPasswordRequest,
    "activity": ActivityLog,
    "escalations": AlertEscalation,
}


class ImportCountMismatch(Exception):
    pass


def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return default
    except (OSError, json.JSONDecodeError) as exc:
        raise ImportCountMismatch(f"Cannot read {path}: {exc}") from exc


def _items(value):
    return value if isinstance(value, list) else []


def _task_seq(task_no):
    if not task_no or not str(task_no).startswith("TSK-"):
        return 0
    try:
        return int(str(task_no).split("-", 1)[1])
    except (IndexError, ValueError):
        return 0


def _count(session, model):
    return session.scalar(select(func.count()).select_from(model)) or 0


def _new_table_stats():
    return {
        "input": 0,
        "inserted": 0,
        "skipped": 0,
        "invalid": 0,
        "pruned": 0,
        "before": 0,
        "after": 0,
    }


def run_import(src, dry_run=False, only=None, report=False):
    if not os.path.isdir(src):
        raise ImportCountMismatch(f"Source directory not found: {src}")
    selected = set(only or TABLES)
    session = SessionLocal()
    stats = {name: _new_table_stats() for name in TABLES}
    warnings = []
    try:
        for name, model in MODELS.items():
            stats[name]["before"] = _count(session, model)

        if "users" in selected:
            warnings.extend(_import_users(session, src, stats["users"]))
        if "accounts" in selected:
            warnings.extend(_import_accounts(session, src, stats["accounts"]))
        if "tasks" in selected:
            warnings.extend(_import_tasks(session, src, stats["tasks"]))
            session.flush()
        if "delete_requests" in selected:
            warnings.extend(_import_delete_requests(session, src, stats["delete_requests"]))
        if "requests" in selected:
            warnings.extend(_import_requests(session, src, stats["requests"]))
        if "activity" in selected:
            warnings.extend(_import_activity(session, src, stats["activity"]))
        if "escalations" in selected:
            warnings.extend(_import_escalations(session, src, stats["escalations"]))

        session.flush()
        for name in selected:
            stats[name]["after"] = _count(session, MODELS[name])
            expected = stats[name]["before"] + stats[name]["inserted"] - stats[name]["pruned"]
            if stats[name]["after"] != expected:
                raise ImportCountMismatch(
                    f"{name}: expected {expected} rows, found {stats[name]['after']}"
                )

        counter = session.get(TaskCounter, "task_no_lock")
        summary = {
            "source": src,
            "dry_run": bool(dry_run),
            "tables": stats,
            "task_counter": counter.value if counter else None,
            "warnings": warnings,
        }

        if dry_run:
            session.rollback()
        else:
            session.commit()
        _print_summary(summary)
        if report:
            print(json.dumps(summary, indent=2))
        return summary
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _import_users(session, src, stats):
    warnings = []
    seen = set()
    for index, raw in enumerate(_items(_read_json(os.path.join(src, "logs", "users.json"), []))):
        stats["input"] += 1
        if not isinstance(raw, dict):
            stats["invalid"] += 1
            continue
        username = str(raw.get("username") or "").strip()
        password = raw.get("password")
        if not username or not password:
            stats["invalid"] += 1
            warnings.append(f"users[{index}]: missing username/password")
            continue
        if username in seen or session.get(User, username):
            stats["skipped"] += 1
            continue
        role = raw.get("role") if raw.get("role") in ("admin", "engineer") else "engineer"
        features = raw.get("features") if isinstance(raw.get("features"), list) else []
        session.add(User(
            username=username,
            password_hash=hash_if_plaintext(str(password)),
            display=str(raw.get("display") or username),
            role=role,
            features=features,
            created_at=parse_ts(raw.get("createdAt")),
        ))
        seen.add(username)
        stats["inserted"] += 1
    return warnings


def _import_accounts(session, src, stats):
    warnings = []
    seen = set()
    for index, raw in enumerate(_items(_read_json(os.path.join(src, "accounts.json"), []))):
        stats["input"] += 1
        if not isinstance(raw, dict) or not str(raw.get("name") or "").strip():
            stats["invalid"] += 1
            continue
        account_id = str(raw.get("id") or f"legacy-account-{index}")
        if account_id in seen or session.get(CloudAccount, account_id):
            stats["skipped"] += 1
            continue
        seen.add(account_id)
        session.add(CloudAccount(
            id=account_id,
            name=str(raw["name"]).strip(),
            platform=raw.get("platform") or "OCI",
            tenancy=raw.get("tenancy") or "",
            region=raw.get("region") or "",
            notes=raw.get("notes") or "",
            created_at=parse_ts(raw.get("createdAt")) or now_jakarta(),
        ))
        stats["inserted"] += 1
    return warnings


def _import_tasks(session, src, stats):
    warnings = []
    rows = _items(_read_json(os.path.join(src, "daily_tasks.json"), []))
    existing = {}
    for task_date, task_no in session.execute(
        select(DailyTask.task_date, DailyTask.task_no)
    ).all():
        existing.setdefault(task_date, set()).add(task_no)
    seen_ids = set()

    def next_no(task_date):
        used = existing.setdefault(task_date, set())
        highest = max((_task_seq(no) for no in used), default=0)
        seq = highest + 1
        while f"TSK-{seq:03d}" in used:
            seq += 1
        return f"TSK-{seq:03d}"

    for index, raw in enumerate(rows):
        stats["input"] += 1
        if not isinstance(raw, dict):
            stats["invalid"] += 1
            continue
        task_id = str(raw.get("id") or f"legacy-task-{index}")
        if task_id in seen_ids or session.get(DailyTask, task_id):
            stats["skipped"] += 1
            continue
        task_date = parse_date(raw.get("date"))
        task_no = str(raw.get("taskNo") or "").strip()
        if not task_no:
            task_no = next_no(task_date)
            warnings.append(f"tasks[{index}]: missing taskNo assigned {task_no}")
        elif task_no in existing.setdefault(task_date, set()):
            warnings.append(f"tasks[{index}]: duplicate taskNo {task_no} preserved")
        existing.setdefault(task_date, set()).add(task_no)
        session.add(DailyTask(
            id=task_id,
            task_no=task_no,
            alert_key=raw.get("alertKey") or "",
            customer=raw.get("customer") or "",
            description=raw.get("description") or "",
            detail=raw.get("detail") or "",
            task_date=task_date,
            start_time=raw.get("start") or "",
            end_time=raw.get("end") or "",
            pic=raw.get("pic") or "",
            status=raw.get("status") or "",
            generate_report=bool_value(raw.get("generateReport", False)),
            created_at=parse_ts(raw.get("createdAt")),
        ))
        seen_ids.add(task_id)
        stats["inserted"] += 1

    return warnings


def _import_delete_requests(session, src, stats):
    warnings = []
    seen = set()
    rows = _items(_read_json(os.path.join(src, "logs", "delete_requests.json"), []))
    for index, raw in enumerate(rows):
        stats["input"] += 1
        if not isinstance(raw, dict):
            stats["invalid"] += 1
            continue
        task_id = str(raw.get("task_id") or "")
        task = session.get(DailyTask, task_id) if task_id else None
        if not task:
            stats["invalid"] += 1
            warnings.append(f"delete_requests[{index}]: task {task_id or '-'} not found")
            continue
        if task_id in seen or session.get(TaskDeleteRequest, task_id):
            stats["skipped"] += 1
            continue
        seen.add(task_id)
        session.add(TaskDeleteRequest(
            task_id=task_id,
            task_no=raw.get("task_no") or task.task_no,
            task_desc=raw.get("task_desc") or task.description or "",
            requested_by=raw.get("requested_by") or "",
            requested_at=parse_ts(raw.get("requested_at")) or now_jakarta(),
        ))
        stats["inserted"] += 1
    return warnings


def _import_requests(session, src, stats):
    warnings = []
    rows = _items(_read_json(os.path.join(src, "logs", "requests.json"), []))
    seen_ids = set()
    pending_keys = {
        (row.request_type, row.username, row.feature or "")
        for row in session.scalars(
            select(AccessPasswordRequest).where(AccessPasswordRequest.status == "pending")
        ).all()
    }
    for index, raw in enumerate(rows):
        stats["input"] += 1
        if not isinstance(raw, dict):
            stats["invalid"] += 1
            continue
        request_id = str(raw.get("id") or f"legacy-request-{index}")
        request_type = raw.get("type")
        status = raw.get("status") or "pending"
        if request_type not in ("password", "access") or status not in ("pending", "approved", "rejected"):
            stats["invalid"] += 1
            warnings.append(f"requests[{index}]: invalid type/status")
            continue
        if request_id in seen_ids or session.get(AccessPasswordRequest, request_id):
            stats["skipped"] += 1
            continue
        seen_ids.add(request_id)
        feature = raw.get("feature")
        pending_key = (request_type, str(raw.get("username") or ""), feature or "")
        if status == "pending" and pending_key in pending_keys:
            stats["skipped"] += 1
            continue
        requested_at = parse_ts(raw.get("requested_at")) or now_jakarta()
        session.add(AccessPasswordRequest(
            id=request_id,
            request_type=request_type,
            username=str(raw.get("username") or ""),
            display=raw.get("display") or raw.get("username") or "",
            feature=feature,
            password_hash=hash_if_plaintext(raw.get("password_hash")),
            status=status,
            requested_at=requested_at,
            reviewed_at=parse_ts(raw.get("reviewed_at")),
            reviewed_by=raw.get("reviewed_by"),
        ))
        if status == "pending":
            pending_keys.add(pending_key)
        stats["inserted"] += 1

    session.flush()
    before_prune = _count(session, AccessPasswordRequest)
    _prune_requests(session)
    session.flush()
    stats["pruned"] = before_prune - _count(session, AccessPasswordRequest)
    return warnings


def _import_activity(session, src, stats):
    warnings = []
    seen_ids = set()
    candidates = []
    rows = _items(_read_json(os.path.join(src, "logs", "activity_log.json"), []))
    for index, raw in enumerate(rows):
        stats["input"] += 1
        if not isinstance(raw, dict):
            stats["invalid"] += 1
            continue
        activity_id = str(raw.get("id") or f"legacy-activity-{index}")
        ts = parse_ts(raw.get("ts"))
        if not ts:
            stats["invalid"] += 1
            warnings.append(f"activity[{index}]: invalid timestamp")
            continue
        if activity_id in seen_ids or session.get(ActivityLog, activity_id):
            stats["skipped"] += 1
            continue
        seen_ids.add(activity_id)
        candidates.append((ts, activity_id, raw))

    limit = _activity_max_rows()
    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    for ts, activity_id, raw in candidates[:limit]:
        session.add(ActivityLog(
            id=activity_id,
            ts=ts,
            activity_date=parse_date(raw.get("date")) or ts.date(),
            username=raw.get("username") or "",
            display=raw.get("display") or "",
            action=raw.get("action") or "",
            category=raw.get("category") or "general",
            detail=raw.get("detail") or "",
        ))
        stats["inserted"] += 1
    stats["skipped"] += max(0, len(candidates) - limit)

    session.flush()
    before_prune = _count(session, ActivityLog)
    keep_ids = (
        select(ActivityLog.id)
        .order_by(ActivityLog.ts.desc(), ActivityLog.id.desc())
        .offset(limit)
    )
    session.execute(delete(ActivityLog).where(ActivityLog.id.in_(keep_ids)))
    session.flush()
    stats["pruned"] = before_prune - _count(session, ActivityLog)
    return warnings


def _import_escalations(session, src, stats):
    warnings = []
    seen = set()
    raw_data = _read_json(os.path.join(src, "logs", "alert_eskalasi.json"), {})
    if not isinstance(raw_data, dict):
        stats["invalid"] += 1
        return ["alert_eskalasi.json: expected an object"]
    for key, raw in raw_data.items():
        stats["input"] += 1
        if not isinstance(raw, dict):
            stats["invalid"] += 1
            continue
        at = parse_ts(raw.get("at"))
        if not at:
            stats["invalid"] += 1
            warnings.append(f"escalations[{key}]: invalid timestamp")
            continue
        alert_key = str(key)
        if alert_key in seen or session.get(AlertEscalation, alert_key):
            stats["skipped"] += 1
            continue
        seen.add(alert_key)
        session.add(AlertEscalation(
            alert_key=str(key),
            escalated_by=raw.get("by") or "",
            at=at,
        ))
        stats["inserted"] += 1
    return warnings


def _print_summary(summary):
    print(f"Source: {summary['source']}")
    print(f"Dry run: {summary['dry_run']}")
    for name in TABLES:
        stat = summary["tables"][name]
        print(
            f"{name:16} input={stat['input']:4} inserted={stat['inserted']:4} "
            f"skipped={stat['skipped']:4} invalid={stat['invalid']:4} "
            f"pruned={stat['pruned']:4} before={stat['before']:4} after={stat['after']:4}"
        )
    print(f"task_counter: {summary['task_counter']}")
    if summary["warnings"]:
        print(f"warnings: {len(summary['warnings'])}")
        for warning in summary["warnings"][:20]:
            print(f"  - {warning}")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Import legacy JSON data into the database")
    parser.add_argument("--src", default=os.getenv("SHARED_DIR", "/app/shared"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--only", choices=TABLES, action="append")
    parser.add_argument("--report", action="store_true")
    args = parser.parse_args(argv)
    try:
        run_import(args.src, dry_run=args.dry_run, only=args.only, report=args.report)
    except Exception as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
