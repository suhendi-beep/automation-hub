import os
import pathlib
import shutil
import sys
import tempfile

import pytest

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

_TEST_SHARED = tempfile.mkdtemp(prefix="automation-hub-test-")
_TEST_DB = tempfile.mkdtemp(prefix="automation-hub-db-")
_TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    f"sqlite:///{os.path.join(_TEST_DB, 'test.db')}",
)

os.environ.update({
    "SHARED_DIR": _TEST_SHARED,
    "DATABASE_URL": _TEST_DATABASE_URL,
    "REDIS_URL": os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
    "SECRET_KEY": "test-secret-key",
    "AUTH_USERNAME": "admin",
    "AUTH_PASSWORD": "admin",
    "GRAFANA_USER": "tester",
    "GRAFANA_PASS": "tester",
    "EMAIL_TO": "",
})

import app as app_module  # noqa: E402  (env must be set before import)
import db as db_module  # noqa: E402
import repositories as repo  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_data():
    yield
    shutil.rmtree(_TEST_SHARED, ignore_errors=True)
    shutil.rmtree(_TEST_DB, ignore_errors=True)


@pytest.fixture(autouse=True)
def reset_database():
    db_module.Base.metadata.drop_all(bind=db_module.engine)
    db_module.Base.metadata.create_all(bind=db_module.engine)
    repo.ensure_admin("admin", "admin")
    yield


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
