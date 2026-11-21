from datetime import timedelta

import db
import repositories as repo
from models import AlertEscalation


def _create_task(client, headers, **overrides):
    payload = {
        "customer": "pelindo",
        "description": "DB task",
        "date": "2026-11-19",
        "pic": "ADMIN",
    }
    payload.update(overrides)
    response = client.post("/api/tasks", headers=headers, json=payload)
    assert response.status_code == 201, response.get_json()
    return response.get_json()


def test_task_numbers_are_sequential(client, admin_headers):
    first = _create_task(client, admin_headers)
    second = _create_task(client, admin_headers)
    assert first["taskNo"] == "TSK-001"
    assert second["taskNo"] == "TSK-002"


def test_task_numbers_reset_per_date(client, admin_headers):
    first = _create_task(client, admin_headers, date="2026-11-19")
    next_day = _create_task(client, admin_headers, date="2026-11-20")
    same_day = _create_task(client, admin_headers, date="2026-11-19")
    assert first["taskNo"] == "TSK-001"
    assert next_day["taskNo"] == "TSK-001"
    assert same_day["taskNo"] == "TSK-002"


def test_alert_dedup_and_antiflap_guard(client, admin_headers):
    payload = {
        "customer": "OCI-ILCS",
        "description": "[ALERT] CPU-Usage-High → db01:9100",
        "date": "2026-11-19",
        "pic": "",
        "alertKey": "CPU-Usage-High||db01:9100||2026-11-19T01:00:00Z",
    }
    first = client.post("/api/tasks", headers=admin_headers, json=payload)
    assert first.status_code == 201
    original = first.get_json()
    assert original["alertKey"] == payload["alertKey"]

    duplicate = client.post("/api/tasks", headers=admin_headers, json=payload)
    assert duplicate.status_code == 200
    assert duplicate.get_json()["id"] == original["id"]

    flapped = dict(payload, alertKey="CPU-Usage-High||db01:9100||2026-11-19T01:05:00Z")
    repeated = client.post("/api/tasks", headers=admin_headers, json=flapped)
    assert repeated.status_code == 200
    assert repeated.get_json()["id"] == original["id"]


def test_alert_rate_limit(client, admin_headers):
    for index in range(30):
        _create_task(client, admin_headers, description=f"manual {index}")
    rejected = client.post("/api/tasks", headers=admin_headers, json={
        "customer": "pelindo",
        "description": "one too many",
        "date": "2026-11-19",
        "pic": "ADMIN",
    })
    assert rejected.status_code == 429


def test_pic_must_be_an_official_user(client, admin_headers):
    denied = client.post("/api/tasks", headers=admin_headers, json={
        "customer": "pelindo",
        "description": "manual",
        "date": "2026-11-19",
        "pic": "tester",
    })
    assert denied.status_code == 403

    report = _create_task(
        client, admin_headers, pic="tester", generateReport=True
    )
    assert report["generateReport"] is True


def test_task_date_filter(client, admin_headers):
    mine = _create_task(client, admin_headers, date="2026-11-19")
    _create_task(client, admin_headers, date="2026-11-20")

    filtered = client.get("/api/tasks?date=2026-11-19", headers=admin_headers).get_json()
    assert [t["id"] for t in filtered] == [mine["id"]]


def test_delete_request_is_removed_after_approval(client, admin_headers):
    task = _create_task(client, admin_headers)
    assert client.post(
        f"/api/tasks/{task['id']}/request-delete", headers=admin_headers, json={}
    ).get_json()["status"] == "requested"

    approved = client.post(
        f"/api/tasks/{task['id']}/approve-delete",
        headers=admin_headers,
        json={"action": "approve"},
    )
    assert approved.status_code == 200
    assert client.get("/api/tasks/pending-deletes", headers=admin_headers).get_json() == []
    assert all(t["id"] != task["id"] for t in client.get("/api/tasks", headers=admin_headers).get_json())


def test_activity_filter_and_retention(client, admin_headers, monkeypatch):
    monkeypatch.setenv("ACTIVITY_MAX_ROWS", "2")
    for action in ("first", "second", "third"):
        assert client.post("/api/activity", headers=admin_headers, json={
            "action": action,
            "category": "test",
            "detail": "",
        }).status_code == 201

    rows = client.get("/api/activity?from=2026-01-01&to=2099-12-31", headers=admin_headers).get_json()
    assert [r["action"] for r in rows] == ["second", "third"]


def test_escalation_ttl_prunes_old_rows(client, admin_headers):
    with db.session_scope() as session:
        session.add(AlertEscalation(
            alert_key="old-alert",
            escalated_by="tester",
            at=repo.now_jakarta() - timedelta(days=30),
        ))
    repo.set_escalation("current-alert", "tester", ttl_days=7)

    result = client.get("/api/alerts/eskalasi", headers=admin_headers).get_json()
    assert "old-alert" not in result
    assert result["current-alert"]["by"] == "tester"
