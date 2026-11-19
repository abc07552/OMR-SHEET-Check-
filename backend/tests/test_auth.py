from datetime import timedelta

from sqlalchemy import select

from backend import models as m
from backend.security import COOKIE, digest, verify_password
from backend.tests.conftest import PASSWORD, get_workspace, login_as, new_member


def test_setup_no_default_users_cookie_and_argon2(client, school, app):
    assert client.get("/api/setup/status").json()["needsSetup"] is False
    assert COOKIE in client.cookies
    response = client.get("/api/auth/me")
    assert response.json()["user"]["role"] == "SUPER_ADMIN"
    assert "password" not in response.text
    with app.state.sessions() as db:
        user = db.scalar(select(m.User))
        assert user.password_hash.startswith("$argon2id$")
        assert verify_password(PASSWORD, user.password_hash)
        session = db.scalar(select(m.Session))
        assert session.token_hash == digest(client.cookies.get(COOKIE))
        assert session.token_hash != client.cookies.get(COOKIE)
    assert (
        client.post(
            "/api/setup",
            json={"name": "Other", "email": "other@school.edu", "password": PASSWORD, "school": {"name": "School"}},
        ).status_code
        == 409
    )


def test_auth_csrf_origin_logout_and_missing_cookie(client, school):
    assert client.get(f"/api/schools/{school}/workspace").status_code == 200
    assert client.post("/api/auth/logout", headers={"X-Markly-Request": "0"}).status_code == 403
    assert client.post("/api/auth/logout", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.get(f"/api/schools/{school}/workspace").status_code == 401


def test_expiry_and_password_revocation(client, school, app):
    with app.state.sessions() as db:
        db.scalar(select(m.Session)).expires_at = m.now() - timedelta(seconds=1)
        db.commit()
    assert client.get("/api/auth/me").status_code == 401
    login_as(client, "admin@school.edu")
    token = client.cookies.get(COOKIE)
    assert (
        client.post(
            "/api/auth/password", json={"currentPassword": "not-the-password", "password": "a-brand-new-password"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/auth/password", json={"currentPassword": PASSWORD, "password": "a-brand-new-password"}
        ).status_code
        == 200
    )
    assert client.get("/api/auth/me").status_code == 401
    with app.state.sessions() as db:
        assert db.get(m.Session, digest(token)) is None


def test_login_throttle_and_non_enumerating_recovery(client, school, app):
    for _ in range(12):
        assert (
            client.post(
                "/api/auth/login", json={"email": "absent@school.edu", "password": "incorrect-password"}
            ).status_code
            == 401
        )
    assert (
        client.post(
            "/api/auth/login", json={"email": "absent@school.edu", "password": "incorrect-password"}
        ).status_code
        == 429
    )
    assert (
        client.post("/api/auth/recovery/request", json={"email": "admin@school.edu"}).json()
        == client.post("/api/auth/recovery/request", json={"email": "nobody@school.edu"}).json()
    )
    with app.state.sessions() as db:
        assert db.scalar(select(m.PasswordReset)) is None
        assert db.scalar(select(m.RateBucket)) is not None


def test_single_use_recovery(client, school, app):
    token = "x" * 54
    with app.state.sessions() as db:
        user = db.scalar(select(m.User))
        db.add(m.PasswordReset(token_hash=digest(token), user_id=user.id, expires_at=m.now() + timedelta(minutes=20)))
        db.commit()
    data = {"token": token, "password": "updated-password-2026"}
    assert client.post("/api/auth/recovery/reset", json=data).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/recovery/reset", json=data).status_code == 400


def test_membership_scope_suspension_and_owners(client, populated):
    sid = populated["school"]
    teacher = new_member(client, sid, "teacher@school.edu", classIds=["class-a"])
    assert client.patch(f"/api/schools/{sid}/users/{teacher}", json={"suspended": True}).status_code == 200
    login_as(client, "teacher@school.edu")
    assert client.get(f"/api/schools/{sid}/workspace").status_code == 403
    assert client.get(f"/api/schools/{sid}/users").status_code == 403
    login_as(client, "admin@school.edu")
    owner = client.get("/api/auth/me").json()["user"]["id"]
    assert client.delete(f"/api/schools/{sid}/users/{owner}").status_code == 403
    assert client.patch(f"/api/schools/{sid}/users/{teacher}", json={"suspended": False}).status_code == 200
    login_as(client, "teacher@school.edu")
    assert len(get_workspace(client, sid)["workspace"]["students"]) == 2


def test_logout_is_idempotent_even_after_password_revocation(client, school):
    assert (
        client.post(
            "/api/auth/password", json={"currentPassword": PASSWORD, "password": "revoked-logout-password"}
        ).status_code
        == 200
    )
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/logout").status_code == 200
    assert client.post("/api/auth/logout").status_code == 200
    assert client.post("/api/auth/logout", headers={"X-Markly-Request": "0"}).status_code == 403
    assert client.get("/api/auth/me").status_code == 401
