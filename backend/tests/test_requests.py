def _create_engineer(client, headers, username="engineer1"):
    response = client.post("/api/auth/users", headers=headers, json={
        "username": username,
        "password": "Engineer123!",
        "display": username.title(),
        "role": "engineer",
    })
    assert response.status_code == 201, response.get_json()
    token = client.post("/api/auth/login", json={
        "username": username,
        "password": "Engineer123!",
    }).get_json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_access_request_deduplicates_and_can_be_approved(client, admin_headers):
    headers = _create_engineer(client, admin_headers)

    first = client.post("/api/access-requests", headers=headers, json={"feature": "account-management"})
    second = client.post("/api/access-requests", headers=headers, json={"feature": "account-management"})
    assert first.status_code == 200
    assert second.status_code == 200

    pending = client.get("/api/requests", headers=admin_headers).get_json()
    mine = [r for r in pending if r["username"] == "engineer1"]
    assert len(mine) == 1

    approved = client.post(f"/api/requests/{mine[0]['id']}/approve", headers=admin_headers)
    assert approved.status_code == 200
    assert approved.get_json()["status"] == "approved"

    me = client.get("/api/auth/me", headers=headers).get_json()
    assert "account-management" in me["features"]
    assert client.get("/api/accounts", headers=headers).status_code == 200


def test_request_cannot_be_reviewed_twice(client, admin_headers):
    headers = _create_engineer(client, admin_headers)
    client.post("/api/access-requests", headers=headers, json={"feature": "engineer-activity"})
    request = client.get("/api/requests", headers=admin_headers).get_json()[0]

    assert client.post(f"/api/requests/{request['id']}/approve", headers=admin_headers).status_code == 200
    assert client.post(f"/api/requests/{request['id']}/reject", headers=admin_headers).status_code == 409


def test_rejected_access_does_not_grant_feature(client, admin_headers):
    headers = _create_engineer(client, admin_headers)
    client.post("/api/access-requests", headers=headers, json={"feature": "engineer-activity"})
    request = client.get("/api/requests", headers=admin_headers).get_json()[0]

    rejected = client.post(f"/api/requests/{request['id']}/reject", headers=admin_headers)
    assert rejected.status_code == 200
    assert rejected.get_json()["status"] == "rejected"
    assert client.get("/api/activity", headers=headers).status_code == 200

    me = client.get("/api/auth/me", headers=headers).get_json()
    assert "engineer-activity" not in me["features"]


def test_engineer_with_management_access_cannot_self_approve(client, admin_headers):
    headers = _create_engineer(client, admin_headers)

    client.post("/api/access-requests", headers=headers, json={"feature": "account-management"})
    first = client.get("/api/requests", headers=admin_headers).get_json()[0]
    assert client.post(f"/api/requests/{first['id']}/approve", headers=admin_headers).status_code == 200

    client.post("/api/access-requests", headers=headers, json={"feature": "engineer-activity"})
    second = [
        r for r in client.get("/api/requests", headers=headers).get_json()
        if r["username"] == "engineer1"
    ][0]
    denied = client.post(f"/api/requests/{second['id']}/approve", headers=headers)
    assert denied.status_code == 403


def test_unknown_feature_is_rejected(client, admin_headers):
    headers = _create_engineer(client, admin_headers)
    response = client.post("/api/access-requests", headers=headers, json={"feature": "nope"})
    assert response.status_code == 400
