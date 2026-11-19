def _create_task(client, headers, description="Test task"):
    response = client.post("/api/tasks", headers=headers, json={
        "customer": "pelindo",
        "description": description,
        "date": "2026-11-19",
        "pic": "tester",
    })
    assert response.status_code == 201
    return response.get_json()


def test_task_crud(client, admin_headers):
    task = _create_task(client, admin_headers)
    assert task["taskNo"].startswith("TSK-")

    listed = client.get("/api/tasks", headers=admin_headers).get_json()
    assert any(t["id"] == task["id"] for t in listed)

    updated = client.put(f"/api/tasks/{task['id']}", headers=admin_headers, json={"status": "Done"})
    assert updated.status_code == 200
    assert updated.get_json()["status"] == "Done"

    assert client.delete(f"/api/tasks/{task['id']}", headers=admin_headers).status_code == 200
    remaining = client.get("/api/tasks", headers=admin_headers).get_json()
    assert all(t["id"] != task["id"] for t in remaining)


def test_engineer_delete_requires_request(client, admin_headers):
    client.post("/api/auth/users", headers=admin_headers, json={
        "username": "engineer1",
        "password": "engineer123",
        "display": "Engineer One",
        "role": "engineer",
    })
    token = client.post(
        "/api/auth/login", json={"username": "engineer1", "password": "engineer123"}
    ).get_json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    task = _create_task(client, headers, "Engineer task")

    assert client.delete(f"/api/tasks/{task['id']}", headers=headers).status_code == 403

    requested = client.post(f"/api/tasks/{task['id']}/request-delete", headers=headers, json={})
    assert requested.status_code == 200
    assert requested.get_json()["status"] == "requested"

    pending = client.get("/api/tasks/pending-deletes", headers=admin_headers).get_json()
    assert any(r["task_id"] == task["id"] for r in pending)

    approved = client.post(
        f"/api/tasks/{task['id']}/approve-delete",
        headers=admin_headers,
        json={"action": "approve"},
    )
    assert approved.status_code == 200
