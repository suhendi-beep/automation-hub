import os
import pathlib
import shutil
import sys
import tempfile

import pytest

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

_TEST_SHARED = tempfile.mkdtemp(prefix="automation-hub-test-")
os.environ.update({
    "SHARED_DIR": _TEST_SHARED,
    "REDIS_URL": os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
    "SECRET_KEY": "test-secret-key",
    "AUTH_USERNAME": "admin",
    "AUTH_PASSWORD": "admin",
    "GRAFANA_USER": "tester",
    "GRAFANA_PASS": "tester",
    "EMAIL_TO": "",
})

import app as app_module  # noqa: E402  (env must be set before import)


@pytest.fixture(scope="session", autouse=True)
def cleanup_shared():
    yield
    shutil.rmtree(_TEST_SHARED, ignore_errors=True)


@pytest.fixture()
def client():
    app_module.app.config.update(TESTING=True)
    return app_module.app.test_client()


def login(client, username="admin", password="admin"):
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.get_json()
    return response.get_json()["token"]


@pytest.fixture()
def admin_headers(client):
    return {"Authorization": f"Bearer {login(client)}"}
