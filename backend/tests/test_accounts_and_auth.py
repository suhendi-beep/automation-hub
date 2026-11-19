def test_accounts_crud_requires_admin(client, admin_headers):
    created = client.post("/api/accounts", headers=admin_headers, json={
        "name": "Pelindo Prod",
        "platform": "OCI",
        "tenancy": "ocid1.tenancy.oc1..test",
        "region": "ap-southeast-1",
    })
    assert created.status_code == 201
    account = created.get_json()

    listed = client.get("/api/accounts", headers=admin_headers).get_json()
    assert any(a["id"] == account["id"] for a in listed)

    updated = client.put(
        f"/api/accounts/{account['id']}", headers=admin_headers, json={"region": "ap-southeast-2"}
    )
    assert updated.status_code == 200
    assert updated.get_json()["region"] == "ap-southeast-2"

    assert client.delete(f"/api/accounts/{account['id']}", headers=admin_headers).status_code == 200

    # Engineer cannot write
    client.post("/api/auth/users", headers=admin_headers, json={
        "username": "engineer2",
        "password": "engineer123",
        "role": "engineer",
    })
    token = client.post(
        "/api/auth/login", json={"username": "engineer2", "password": "engineer123"}
    ).get_json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/accounts", headers=headers, json={"name": "Nope"}).status_code == 403


def test_change_password_invalidates_old_token(client, admin_headers):
    client.post("/api/auth/users", headers=admin_headers, json={
        "username": "pwuser",
        "password": "oldpassword",
        "role": "engineer",
    })
    token = client.post(
        "/api/auth/login", json={"username": "pwuser", "password": "oldpassword"}
    ).get_json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    changed = client.post("/api/auth/change-password", headers=headers, json={
        "current_password": "oldpassword",
        "new_password": "newpassword123",
    })
    assert changed.status_code == 200
    new_token = changed.get_json()["token"]

    assert client.get("/api/tasks", headers=headers).status_code == 401
    assert client.get("/api/tasks", headers={"Authorization": f"Bearer {new_token}"}).status_code == 200


def test_schedules_list_and_admin_run(client, admin_headers):
    schedules = client.get("/api/schedules", headers=admin_headers)
    assert schedules.status_code == 200
    names = [s["id"] for s in schedules.get_json()]
    assert "daily-ilcs-status" in names
    assert "weekly-grafana-ho" in names
