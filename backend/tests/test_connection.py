"""Public native pairing metadata must not expose data or bypass real accounts."""

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.tests.conftest import PASSWORD


@pytest.fixture
def frontend_client(client, tmp_path):
    # This is an explicit synthetic HTML availability fixture, not a built React app.
    (tmp_path / "index.html").write_text("<!doctype html><title>synthetic client availability fixture</title>")
    application = create_app(replace(client.app.state.settings, static_dir=tmp_path))
    with TestClient(application, headers={"X-Markly-Request": "1"}) as frontend:
        yield frontend


def test_connection_info_is_public_bounded_and_does_not_claim_missing_client_is_ready(client):
    response = client.get("/api/connection-info", headers={"Origin": "https://localhost"})
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "service": "markly-api",
        "backend": "fastapi",
        "connectionVersion": 1,
        "apiVersion": 3,
        "authentication": "http-only-cookie",
        "deploymentMode": "development",
        "database": client.app.state.engine.dialect.name,
        "clientReady": False,
    }
    assert "no-store" in response.headers["cache-control"]
    assert "access-control-allow-origin" not in response.headers
    assert len(response.content) < 2048
    assert "password" not in response.text.lower() and "token" not in response.text.lower()


def test_connection_info_reports_real_served_client_and_database(frontend_client, tmp_path):
    response = frontend_client.get("/api/connection-info")
    assert response.status_code == 200 and response.json()["clientReady"] is True
    assert "synthetic client availability fixture" in frontend_client.get("/").text
    (tmp_path / "index.html").unlink()
    assert frontend_client.get("/api/connection-info").json()["clientReady"] is False


def test_connection_info_does_not_create_an_account_or_authorize_workspaces(client):
    assert client.get("/api/setup/status").json()["needsSetup"] is True
    assert client.get("/api/connection-info").status_code == 200
    assert client.get("/api/setup/status").json()["needsSetup"] is True
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/schools/private/workspace").status_code == 401


def test_real_fastapi_setup_login_and_team_work_after_discovery(frontend_client):
    client = frontend_client
    assert client.get("/api/connection-info").json()["clientReady"] is True
    created = client.post(
        "/api/setup",
        json={
            "email": "owner@connected-school.edu",
            "password": PASSWORD,
            "name": "School Owner",
            "school": {"name": "Connected School", "code": "CON"},
        },
    )
    assert created.status_code == 201
    user = created.json()["user"]
    school = user["memberships"][0]["schoolId"]
    assert user["owner"] is True
    assert client.get(f"/api/schools/{school}/users").status_code == 200
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get(f"/api/schools/{school}/users").status_code == 401
    signed_in = client.post("/api/auth/login", json={"email": "owner@connected-school.edu", "password": PASSWORD})
    assert signed_in.status_code == 200
    assert client.get(f"/api/schools/{school}/users").json()["users"][0]["email"] == "owner@connected-school.edu"


def test_connection_metadata_does_not_relax_cookie_origin_protection(client):
    assert client.get("/api/connection-info").status_code == 200
    response = client.post(
        "/api/auth/login",
        headers={"Origin": "https://localhost"},
        json={"email": "no@school.edu", "password": PASSWORD},
    )
    assert response.status_code == 403


def test_client_created_after_startup_is_not_falsely_reported_as_mounted(client, tmp_path):
    missing = tmp_path / "not-mounted"
    application = create_app(replace(client.app.state.settings, static_dir=missing))
    with TestClient(application) as api:
        missing.mkdir()
        (missing / "index.html").write_text("<!doctype html><title>not served until restart</title>")
        assert api.get("/api/connection-info").json()["clientReady"] is False
        assert api.get("/").status_code == 404


def test_connection_discovery_fails_closed_if_database_is_unreachable(client, monkeypatch):
    from sqlalchemy.exc import OperationalError

    def disconnected():
        raise OperationalError("SELECT 1", {}, Exception("synthetic unavailable QA database"))

    monkeypatch.setattr(client.app.state.engine, "connect", disconnected)
    response = client.get("/api/connection-info")
    assert response.status_code == 503
    assert "clientReady" not in response.json()
    assert "no-store" in response.headers["cache-control"]
