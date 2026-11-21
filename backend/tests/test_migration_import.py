import json

import pytest

import db
import db_import
import repositories as repo
from models import ActivityLog, DailyTask, TaskCounter, User


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


@pytest.fixture()
def legacy_src(tmp_path):
    src = tmp_path / "shared"
    (src / "logs").mkdir(parents=True)
    return src


def test_dry_run_rolls_back_and_rerun_is_idempotent(legacy_src):
    _write(legacy_src / "logs" / "users.json", [{
        "username": "legacy",
        "password": "Plaintext123!",
        "display": "Legacy User",
        "role": "engineer",
        "features": ["engineer-activity"],
        "createdAt": "2026-01-01T00:00:00Z",
    }])

    dry = db_import.run_import(str(legacy_src), dry_run=True)
    assert dry["tables"]["users"]["inserted"] == 1
    assert repo.get_user("legacy") is None

    real = db_import.run_import(str(legacy_src))
    assert real["tables"]["users"]["inserted"] == 1
    user = repo.get_user("legacy")
    assert user["password"].startswith(("pbkdf2:", "scrypt:"))
    assert user["features"] == ["engineer-activity"]
    assert user["createdAt"] == "2026-01-01T07:00:00+07:00"

    again = db_import.run_import(str(legacy_src))
    assert again["tables"]["users"]["inserted"] == 0
    assert again["tables"]["users"]["skipped"] == 1


def test_duplicate_task_numbers_are_preserved(legacy_src):
    _write(legacy_src / "daily_tasks.json", [
        {
            "id": "task-a",
            "taskNo": "TSK-005",
            "description": "first",
            "date": "2026-11-19",
            "generateReport": True,
            "createdAt": "2026-11-19T01:00:00Z",
        },
        {
            "id": "task-b",
            "taskNo": "TSK-005",
            "description": "second",
            "date": "not-a-date",
        },
    ])

    result = db_import.run_import(str(legacy_src), only=["tasks"])
    assert result["tables"]["tasks"]["inserted"] == 2
    assert result["task_counter"] == 0

    with db.session_scope() as session:
        rows = {row.id: row for row in session.query(DailyTask).all()}
        assert rows["task-a"].created_at is not None
        assert rows["task-b"].task_date is None
        assert rows["task-a"].task_no == "TSK-005"
        assert rows["task-b"].task_no == "TSK-005"
        assert session.get(TaskCounter, "task_no_lock").value == 0


def test_reviewed_request_imports_without_pruning(legacy_src):
    _write(legacy_src / "logs" / "requests.json", [{
        "id": "request-a",
        "type": "password",
        "username": "legacy",
        "display": "Legacy",
        "password_hash": "pbkdf2:test",
        "status": "approved",
        "requested_at": "2026-11-21T21:13:24.705667",
        "reviewed_at": "2026-11-21T21:13:43.209338",
        "reviewed_by": "admin",
    }])

    result = db_import.run_import(str(legacy_src), only=["requests"])
    assert result["tables"]["requests"]["inserted"] == 1
    assert result["tables"]["requests"]["pruned"] == 0
    assert len(repo.list_requests(status="all")) == 1


def test_orphan_delete_request_is_skipped(legacy_src):
    _write(legacy_src / "logs" / "delete_requests.json", [{
        "task_id": "missing-task",
        "task_no": "TSK-999",
        "requested_by": "tester",
        "requested_at": "2026-11-19T01:00:00Z",
    }])

    result = db_import.run_import(str(legacy_src), only=["delete_requests"])
    assert result["tables"]["delete_requests"]["invalid"] == 1
    assert result["tables"]["delete_requests"]["inserted"] == 0


def test_mixed_timestamps_are_stored_as_jakarta(legacy_src):
    _write(legacy_src / "logs" / "activity_log.json", [{
        "id": "activity-a",
        "ts": "2026-11-19T01:00:00Z",
        "date": "2026-11-19",
        "username": "legacy",
        "action": "utc",
    }, {
        "id": "activity-b",
        "ts": "2026-11-19T08:00:00",
        "date": "2026-11-19",
        "username": "legacy",
        "action": "local",
    }])

    db_import.run_import(str(legacy_src), only=["activity"])
    with db.session_scope() as session:
        rows = {row.id: row for row in session.query(ActivityLog).all()}
        assert repo.iso_jakarta(rows["activity-a"].ts) == "2026-11-19T08:00:00+07:00"
        assert repo.iso_jakarta(rows["activity-b"].ts) == "2026-11-19T08:00:00+07:00"


def test_count_mismatch_aborts_import(legacy_src, monkeypatch):
    def insert_without_stats(session, src, stats):
        session.add(User(
            username="sneaky",
            password_hash="pbkdf2:test",
            display="Sneaky",
            role="engineer",
            features=[],
        ))
        return []

    monkeypatch.setattr(db_import, "_import_users", insert_without_stats)
    with pytest.raises(db_import.ImportCountMismatch):
        db_import.run_import(str(legacy_src), only=["users"])
    assert repo.get_user("sneaky") is None
