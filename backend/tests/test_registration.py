"""Verified password signup, isolation, no first-admin bypass, additive migration."""

from __future__ import annotations

import re
import ssl
from datetime import timedelta

import pytest
from sqlalchemy import func, inspect, select, text

from backend import models as m
from backend.config import Settings
from backend.db import engine_for, migrate, sessions_for
from backend.security import digest, verify_password
from backend.tests.conftest import PASSWORD, login_as

SIGNUP = {
    "name": "New administrator",
    "schoolName": "New independent school",
    "email": "new@school.edu",
    "password": PASSWORD,
}


class SyntheticSMTP:
    messages = []
    fail = False

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def starttls(self, context):
        assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname

    def login(self, *args):
        pass

    def send_message(self, message):
        if self.fail:
            raise OSError("SYNTHETIC SMTP outage, secret MUST NOT LEAK")
        self.messages.append(message)


@pytest.fixture
def smtp(app, client, school, monkeypatch):
    import backend.routes.registration as registration

    SyntheticSMTP.messages, SyntheticSMTP.fail = [], False
    monkeypatch.setattr(registration.smtplib, "SMTP", SyntheticSMTP)
    app.state.settings.public_signup = True
    app.state.settings.environment = "production"
    app.state.settings.public_url = "https://testserver"
    app.state.settings.smtp_host, app.state.settings.smtp_from = "synthetic-smtp", "no-reply@school.edu"
    client.base_url = "https://testserver"
    return SyntheticSMTP


def token_from(smtp):
    return re.search(r"verify-email\?token=([A-Za-z0-9_-]+)", smtp.messages[-1].get_content()).group(1)


def test_signup_disabled_by_default_and_development_signup_is_not_super_admin(client, school, app):
    assert client.post("/api/auth/signup", json=SIGNUP).status_code == 403
    app.state.settings.public_signup = True
    response = client.post("/api/auth/signup", json=SIGNUP)
    assert response.status_code == 201, response.text
    user = response.json()["user"]
    assert not user["owner"] and user["role"] == "USER" and len(user["memberships"]) == 1
    sid = user["memberships"][0]["schoolId"]
    assert sid != school and user["memberships"][0]["role"] == "admin"
    assert client.get(f"/api/schools/{school}/workspace").status_code == 403
    assert client.get(f"/api/schools/{sid}/workspace").status_code == 200
    assert client.post("/api/schools", json={"name": "Not permitted"}).status_code == 403
    assert client.get("/api/system/health").status_code == 403
    assert (
        client.post(
            "/api/setup",
            json={
                "name": "Not permitted",
                "email": "other@school.edu",
                "password": PASSWORD,
                "school": {"name": "Other"},
            },
        ).status_code
        == 409
    )
    login_as(client, SIGNUP["email"])
    assert client.get("/api/auth/account").json()["hasPassword"]
    assert client.post("/api/auth/signup", json=SIGNUP).status_code == 202
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(m.User).where(m.User.email == SIGNUP["email"])) == 1


def test_production_signup_waits_for_both_email_proof_and_chosen_password(client, smtp, app, school):
    before = client.get("/api/auth/me").json()["user"]
    response = client.post("/api/auth/signup", json=SIGNUP)
    assert response.status_code == 202 and response.json()["requiresVerification"] and "token" not in response.text
    token = token_from(smtp)
    assert client.get("/api/auth/me").json()["user"] == before
    with app.state.sessions() as db:
        assert db.scalar(select(m.User.id).where(m.User.email == SIGNUP["email"])) is None
        row = db.get(m.PendingSignup, digest(token))
        assert row and row.password_hash != PASSWORD and verify_password(PASSWORD, row.password_hash)
    # Merely opening the link or stealing it does not activate an attacker-chosen password.
    assert client.get("/api/auth/signup/verify", params={"token": token}).status_code in (404, 405)
    assert (
        client.post("/api/auth/signup/verify", json={"token": token, "password": "wrong-but-long-enough"}).status_code
        == 400
    )
    body = {"token": token, "password": PASSWORD}
    response = client.post("/api/auth/signup/verify", json=body)
    assert response.status_code == 200, response.text
    user = response.json()["user"]
    assert not user["owner"] and user["memberships"][0]["schoolId"] != school
    assert client.post("/api/auth/signup/verify", json=body).status_code == 400
    assert client.get(f"/api/schools/{school}/workspace").status_code == 403
    with app.state.sessions() as db:
        assert db.get(m.PendingSignup, digest(token)) is None
        assert db.get(m.User, user["id"]).email_verified_at


def test_signup_failure_expiry_disabled_after_request_and_non_enumeration(client, smtp, app):
    smtp.fail = True
    response = client.post("/api/auth/signup", json=SIGNUP)
    assert response.status_code == 503 and "MUST NOT LEAK" not in response.text
    with app.state.sessions() as db:
        assert db.scalar(select(m.PendingSignup)) is None
    smtp.fail = False
    created = client.post("/api/auth/signup", json=SIGNUP)
    token = token_from(smtp)
    duplicate = client.post("/api/auth/signup", json=dict(SIGNUP, email="admin@school.edu"))
    assert created.status_code == duplicate.status_code == 202 and created.json() == duplicate.json()
    app.state.settings.public_signup = False
    assert client.post("/api/auth/signup/verify", json={"token": token, "password": PASSWORD}).status_code == 403
    app.state.settings.public_signup = True
    with app.state.sessions() as db:
        db.get(m.PendingSignup, digest(token)).expires_at = m.now() - timedelta(seconds=1)
        db.commit()
    assert client.post("/api/auth/signup/verify", json={"token": token, "password": PASSWORD}).status_code == 400


def test_production_signup_requires_delivery_and_valid_fields(client, school, app):
    app.state.settings.environment, app.state.settings.public_signup = "production", True
    assert not client.get("/api/auth/options").json()["passwordSignupEnabled"]
    assert client.post("/api/auth/signup", json=SIGNUP).status_code == 503
    app.state.settings.environment = "development"
    for patch in (
        {"password": "short"},
        {"password": "x" * 129},
        {"name": " "},
        {"schoolName": " "},
        {"email": "invalid"},
    ):
        assert client.post("/api/auth/signup", json=dict(SIGNUP, **patch)).status_code == 422


def test_signup_throttles_persist_across_failure(client, school, app):
    app.state.settings.public_signup = True
    for _ in range(3):
        assert client.post("/api/auth/signup", json=dict(SIGNUP, email="admin@school.edu")).status_code == 202
    assert client.post("/api/auth/signup", json=dict(SIGNUP, email="admin@school.edu")).status_code == 429


def test_additive_google_migration_preserves_existing_users_and_sessions(tmp_path):
    settings = Settings(data_dir=tmp_path, testing=True)
    engine = engine_for(settings)
    try:
        migrate(engine, "407c9088532a")
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users(id,email,name,password_hash,super_admin,active,created_at) VALUES ('old','old@school.edu','Existing','legacy-preserved',true,true,CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                text("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (:token,'old',:expires)"),
                {"token": "a" * 64, "expires": m.now() + timedelta(hours=1)},
            )
        migrate(engine)
        with sessions_for(engine)() as db:
            user, session = db.get(m.User, "old"), db.get(m.Session, "a" * 64)
            assert user.password_hash == "legacy-preserved" and user.has_password and user.email_verified_at is None
            assert session.auth_method == "password" and session.created_at is None
        assert {
            "google_identities",
            "google_oauth_flows",
            "google_drive_connections",
            "google_drive_backups",
            "pending_signups",
        } <= set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_pending_signup_resend_never_replaces_password_or_identity(client, smtp, app):
    assert client.post("/api/auth/signup", json=SIGNUP).status_code == 202
    first = token_from(smtp)
    assert (
        client.post(
            "/api/auth/signup", json=dict(SIGNUP, password="attacker-wrong-password", name="Replaced")
        ).status_code
        == 202
    )
    assert len(smtp.messages) == 1
    assert client.post("/api/auth/signup", json=dict(SIGNUP, name="Do not overwrite original")).status_code == 202
    latest = token_from(smtp)
    assert first != latest
    with app.state.sessions() as db:
        assert db.get(m.PendingSignup, digest(first)) is None
        assert db.get(m.PendingSignup, digest(latest)).name == SIGNUP["name"]
    assert client.post("/api/auth/signup/verify", json={"token": first, "password": PASSWORD}).status_code == 400
    assert client.post("/api/auth/signup/verify", json={"token": latest, "password": PASSWORD}).status_code == 200


def test_google_signup_migration_matches_orm_schema_on_both_engines(app):
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    tables = {
        "pending_signups",
        "google_identities",
        "google_oauth_flows",
        "google_drive_connections",
        "google_drive_backups",
    }
    added = {"users": {"has_password", "email_verified_at"}, "sessions": {"auth_method", "created_at"}}

    def include(obj, name, type_, reflected, compare_to):
        if type_ == "table":
            return name in tables or name in added
        table = getattr(getattr(obj, "table", None), "name", None)
        if table in added:
            return type_ == "column" and name in added[table]
        return table in tables

    with app.state.engine.connect() as connection:
        context = MigrationContext.configure(
            connection, opts={"include_object": include, "compare_type": True, "compare_server_default": True}
        )
        assert compare_metadata(context, m.Base.metadata) == []
