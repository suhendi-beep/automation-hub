def test_ping_is_public(client):
    assert client.get("/api/ping").status_code == 200


def test_protected_endpoint_requires_token(client):
    assert client.get("/api/tasks").status_code == 401


def test_login_returns_token_and_authorizes(client):
    response = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    body = response.get_json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["token"]

    headers = {"Authorization": f"Bearer {body['token']}"}
    assert client.get("/api/tasks", headers=headers).status_code == 200


def test_wrong_password_rejected(client):
    response = client.post("/api/auth/login", json={"username": "admin", "password": "wrong-pass"})
    assert response.status_code == 401


def test_invalid_token_rejected(client):
    assert client.get("/api/tasks", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_password_is_hashed_at_rest(client):
    token = client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin"}
    ).get_json()["token"]
    users = client.get("/api/auth/users", headers={"Authorization": f"Bearer {token}"}).get_json()
    assert "admin" in [u["username"] for u in users]
    assert all("password" not in u for u in users)

    import app as app_module
    stored = app_module._read_json(app_module.USERS_FILE, [])
    admin = next(u for u in stored if u["username"] == "admin")
    assert admin["password"].startswith(("pbkdf2:", "scrypt:"))
