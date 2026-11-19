"""Synthetic Google HTTP service + real RSA signatures and official verifier.

These are integration/regression tests, NOT a claim of live Google consent or
physical Android acceptance. No real OAuth secret, account, network or Drive.
"""

from __future__ import annotations

import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from google.auth import crypt, jwt
from sqlalchemy import select

from backend import models as m
from backend.google_provider import (
    CERT_URL,
    DRIVE_SCOPE,
    EXCHANGE_URL,
    GoogleError,
    GoogleProvider,
    decrypted_json,
    encrypted_json,
    pkce,
)
from backend.security import COOKIE, digest, verify_password
from backend.tests.conftest import PASSWORD, get_workspace, login_as, new_member, save_workspace


@pytest.fixture(scope="module")
def signing_material():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Synthetic Google QA only")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(timezone.utc) - timedelta(days=1))
        .not_valid_after(datetime.now(timezone.utc) + timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    signer = crypt.RSASigner.from_string(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()),
        key_id="synthetic-key",
    )
    return signer, cert.public_bytes(serialization.Encoding.PEM).decode()


class SyntheticGoogle:
    def __init__(self, app, signing_material):
        self.app, self.signer = app, signing_material[0]
        self.certificate = signing_material[1]
        self.codes, self.files, self.requests = {}, {}, []
        self.uploads, self.generated, self.refreshes = 0, 0, 0
        self.lose_upload_response = self.corrupt_download = self.revoke_fail = self.deny_token = False

    def token(self, claims):
        return jwt.encode(self.signer, claims).decode()

    def request(self, request):
        self.requests.append((request.method, request.url.path))
        path = request.url.path
        if str(request.url) == CERT_URL:
            return httpx.Response(200, json={"synthetic-key": self.certificate})
        if str(request.url) == EXCHANGE_URL:
            data = dict(parse_qs(request.content.decode()))
            assert data["client_secret"] == ["synthetic-not-a-real-secret"]
            if self.deny_token:
                return httpx.Response(400, json={"error": "invalid_grant", "error_description": "MUST NOT BE EXPOSED"})
            if data["grant_type"] == ["refresh_token"]:
                assert data["refresh_token"] == ["synthetic-refresh-secret"]
                self.refreshes += 1
                return httpx.Response(
                    200, json={"access_token": "synthetic-refreshed-access", "expires_in": 3600, "token_type": "Bearer"}
                )
            value = self.codes.pop(data["code"][0])
            assert pkce(data["code_verifier"][0]) == value["challenge"]
            assert data["redirect_uri"] == ["https://testserver/api/oauth/google/callback"]
            return httpx.Response(200, json=value["tokens"])
        if path.endswith("/revoke"):
            return httpx.Response(503 if self.revoke_fail else 200, json={})
        assert request.headers.get("authorization", "").startswith("Bearer synthetic-")
        if path.endswith("/generateIds"):
            self.generated += 1
            return httpx.Response(200, json={"ids": ["synthetic-drive-id-" + str(self.generated)]})
        if path == "/upload/drive/v3/files":
            message = BytesParser(policy=policy.default).parsebytes(
                b"Content-Type: "
                + request.headers["content-type"].encode()
                + b"\r\nMIME-Version: 1.0\r\n\r\n"
                + request.content
            )
            parts = list(message.iter_parts())
            metadata, raw = json.loads(parts[0].get_payload(decode=True)), parts[1].get_payload(decode=True)
            fid = metadata["id"]
            if fid in self.files:
                return httpx.Response(409, json={})
            assert metadata["parents"] == ["appDataFolder"]
            assert b"synthetic-refresh-secret" not in raw and b"Learner" not in raw
            self.uploads += 1
            meta = dict(metadata, size=str(len(raw)), trashed=False)
            self.files[fid] = (meta, raw)
            if self.lose_upload_response:
                self.lose_upload_response = False
                return httpx.Response(503, json={})
            return httpx.Response(200, json={k: meta[k] for k in ("id", "size", "appProperties")})
        if path.startswith("/drive/v3/files/"):
            fid = path.rsplit("/", 1)[1]
            if fid not in self.files:
                return httpx.Response(404, json={})
            metadata, raw = self.files[fid]
            if request.url.params.get("alt") == "media":
                return httpx.Response(200, content=raw + b"tampered" if self.corrupt_download else raw)
            return httpx.Response(200, json={k: metadata[k] for k in ("id", "size", "appProperties", "trashed")})
        raise AssertionError("Unexpected synthetic Google URL: " + str(request.url))

    def authorize(
        self,
        client,
        intent,
        *,
        subject="synthetic-subject",
        email="google@school.edu",
        claims=None,
        tokens=None,
        **values,
    ):
        response = client.post("/api/oauth/google/start", json={"intent": intent, **values})
        assert response.status_code == 200, response.text
        flow = response.json()
        params = parse_qs(urlsplit(flow["authorizationUrl"]).query)
        issued = {
            "iss": "https://accounts.google.com",
            "aud": self.app.state.settings.google_client_id,
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,
            "sub": subject,
            "email": email,
            "email_verified": True,
            "name": "Google Educator",
            "nonce": params["nonce"][0],
            **(claims or {}),
        }
        token_response = {
            "id_token": self.token(issued),
            "access_token": "synthetic-access-secret",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid email profile" + (" " + DRIVE_SCOPE if intent == "drive" else ""),
        }
        if intent == "drive":
            token_response["refresh_token"] = "synthetic-refresh-secret"
        token_response.update(tokens or {})
        code = secrets.token_urlsafe(30)
        self.codes[code] = {"challenge": params["code_challenge"][0], "tokens": token_response}
        return {"flowId": flow["flowId"], "state": params["state"][0], "code": code, "params": params}

    def callback(self, client, flow):
        response = client.get(
            "/api/oauth/google/callback", params={"state": flow["state"], "code": flow["code"]}, follow_redirects=False
        )
        assert response.status_code == 303, response.text
        assert response.headers["referrer-policy"] == "no-referrer"
        location = response.headers["location"]
        parsed = urlsplit(location)
        params = parse_qs(urlsplit(parsed.fragment).query if parsed.fragment else parsed.query)
        return response, {k: v[0] for k, v in params.items()}

    def finish(self, client, flow, native_verifier=None):
        _, params = self.callback(client, flow)
        assert "ticket" in params, params
        return client.post(
            "/api/oauth/google/complete",
            json={
                "flowId": flow["flowId"],
                "ticket": params["ticket"],
                **({"nativeVerifier": native_verifier} if native_verifier else {}),
            },
        )


@pytest.fixture
def google(app, client, school, signing_material):
    app.state.settings.public_url = "https://testserver"
    app.state.settings.google_client_id = "synthetic-client.apps.googleusercontent.com"
    app.state.settings.google_client_secret = "synthetic-not-a-real-secret"
    client.base_url = "https://testserver"
    client.headers["Origin"] = "https://testserver"
    synthetic = SyntheticGoogle(app, signing_material)
    app.state.google = GoogleProvider(app.state.settings, httpx.MockTransport(synthetic.request))
    return synthetic


def linked(client, google, **values):
    flow = google.authorize(client, "link", currentPassword=PASSWORD, **values)
    response = google.finish(client, flow)
    assert response.status_code == 200, response.text
    return response.json()["user"]


def connected(client, google, school):
    flow = google.authorize(client, "drive", schoolId=school)
    response = google.finish(client, flow)
    assert response.status_code == 200, response.text
    return client.get(f"/api/schools/{school}/drive").json()


def test_google_disabled_and_first_admin_cannot_be_bypassed(app, client):
    assert client.post("/api/oauth/google/start", json={"intent": "login"}).status_code == 503
    app.state.settings.public_signup = True
    assert (
        client.post(
            "/api/auth/signup",
            json={"name": "New", "schoolName": "School", "email": "new@school.edu", "password": PASSWORD},
        ).status_code
        == 403
    )
    app.state.settings.google_client_id, app.state.settings.google_client_secret = "synthetic", "synthetic"
    app.state.settings.public_url = "https://testserver"
    assert client.post("/api/oauth/google/start", json={"intent": "signup", "schoolName": "New"}).status_code == 403
    assert not client.get("/api/auth/options").json()["signupEnabled"]


def test_scope_separation_state_nonce_pkce_and_secret_storage(client, google, app, school):
    flow = google.authorize(client, "login")
    params = flow["params"]
    assert params["scope"] == ["openid email profile"] and params["code_challenge_method"] == ["S256"]
    assert params["access_type"] == ["online"] and DRIVE_SCOPE not in str(params)
    assert "client_secret" not in params
    cookie = client.cookies.get("omr_google_flow")
    with app.state.sessions() as db:
        row = db.get(m.GoogleOAuthFlow, flow["flowId"])
        assert row.state_hash == digest(flow["state"]) and flow["state"] not in str(row.__dict__)
        assert row.nonce_hash == digest(params["nonce"][0])
        assert cookie.split(".")[1] not in row.browser_hash
        assert pkce(decrypted_json(app.state.store, row.verifier_encrypted)["verifier"]) == params["code_challenge"][0]
    for values in (
        {"clientMode": "android", "appId": "evil.app", "nativeChallenge": "A" * 43},
        {"clientMode": "web", "appId": "com.markly.omrpro"},
        {"intent": "evil"},
    ):
        assert client.post("/api/oauth/google/start", json={"intent": "login", **values}).status_code in (400, 422)
    assert (
        client.post(
            "/api/oauth/google/start", json={"intent": "login"}, headers={"Origin": "https://other.example"}
        ).status_code
        == 403
    )


def test_web_response_requires_same_browser_and_one_use(client, google, app):
    linked(client, google)
    flow = google.authorize(client, "login")
    with TestClient(app, base_url="https://testserver", headers={"X-Markly-Request": "1"}) as thief:
        assert (
            thief.get("/api/oauth/google/callback", params={"state": flow["state"], "code": flow["code"]}).status_code
            == 400
        )
        _, result = google.callback(client, flow)
        body = {"flowId": flow["flowId"], "ticket": result["ticket"]}
        assert thief.post("/api/oauth/google/complete", json=body).status_code == 400
        response = client.post("/api/oauth/google/complete", json=body)
        assert response.status_code == 200, response.text
        assert client.post("/api/oauth/google/complete", json=body).status_code == 400
        assert (
            client.get("/api/oauth/google/callback", params={"state": flow["state"], "code": flow["code"]}).status_code
            == 400
        )
    with app.state.sessions() as db:
        row = db.get(m.GoogleOAuthFlow, flow["flowId"])
        assert (
            row.status == "consumed"
            and row.result_encrypted is None
            and row.ticket_hash is None
            and not row.verifier_encrypted
        )


def test_login_never_links_existing_account_by_email(client, google, app):
    old = client.get("/api/auth/me").json()["user"]
    flow = google.authorize(client, "login", email=old["email"])
    response = google.finish(client, flow)
    assert response.status_code == 409 and response.json()["code"] == "link_required"
    assert client.get("/api/auth/me").json()["user"]["id"] == old["id"]
    with app.state.sessions() as db:
        assert db.scalar(select(m.GoogleIdentity)) is None
    assert (
        client.post("/api/oauth/google/start", json={"intent": "link", "currentPassword": "incorrect"}).status_code
        == 403
    )
    user = linked(client, google, email=old["email"])
    assert user["id"] == old["id"]
    client.post("/api/auth/logout")
    response = google.finish(client, google.authorize(client, "login", email=old["email"]))
    assert response.status_code == 200 and response.json()["user"]["memberships"] == old["memberships"]


@pytest.mark.parametrize(
    "claims",
    [
        {"aud": "other-client"},
        {"iss": "https://evil.example"},
        {"exp": 1},
        {"iat": int(time.time()) + 3600},
        {"nonce": "wrong-nonce"},
        {"email_verified": False},
        {"email_verified": "true"},
        {"azp": "wrong-client"},
        {"email": "invalid-address"},
        {"sub": ""},
    ],
)
def test_official_google_verifier_rejects_bad_claims(client, google, app, claims):
    flow = google.authorize(client, "login", claims=claims)
    _, params = google.callback(client, flow)
    assert params["error"] == "invalid_google_identity"
    with app.state.sessions() as db:
        assert db.get(m.GoogleOAuthFlow, flow["flowId"]).status == "failed"
        assert db.scalar(select(m.GoogleIdentity)) is None


def test_google_cancel_expiry_and_revoked_bound_session(client, google, app):
    flow = google.authorize(client, "login")
    response = client.get(
        "/api/oauth/google/callback", params={"state": flow["state"], "error": "access_denied"}, follow_redirects=False
    )
    assert response.status_code == 303 and "consent_cancelled" in response.headers["location"]
    flow = google.authorize(client, "link", currentPassword=PASSWORD)
    stolen_flow_cookie = client.cookies.get("omr_google_flow")
    client.post("/api/auth/logout")
    assert (
        client.get("/api/oauth/google/callback", params={"state": flow["state"], "code": flow["code"]}).status_code
        == 400
    )
    # Even possession of the old flow cookie cannot revive its revoked app session.
    client.cookies.set("omr_google_flow", stolen_flow_cookie, domain="testserver.local", path="/api/oauth/google")
    _, result = google.callback(client, flow)
    assert result["error"] == "session_changed"
    login_as(client, "admin@school.edu")
    flow = google.authorize(client, "login")
    with app.state.sessions() as db:
        db.get(m.GoogleOAuthFlow, flow["flowId"]).expires_at = m.now() - timedelta(seconds=1)
        db.commit()
    assert (
        client.get("/api/oauth/google/callback", params={"state": flow["state"], "code": flow["code"]}).status_code
        == 400
    )


def test_native_external_browser_ticket_requires_device_proof_and_app_session(client, google, app, school):
    verifier = secrets.token_urlsafe(32)
    user = linked(client, google)
    flow = google.authorize(
        client, "login", clientMode="android", appId="com.markly.omrpro.debug", nativeChallenge=pkce(verifier)
    )
    # Google's external browser does not share the WebView's cookies.
    with TestClient(app, base_url="https://testserver", headers={"X-Markly-Request": "1"}) as browser:
        redirect, params = google.callback(browser, flow)
        assert redirect.headers["location"].startswith("com.markly.omrpro.debug://oauth/callback?")
        assert "synthetic-access" not in redirect.headers["location"]
        body = {"flowId": flow["flowId"], "ticket": params["ticket"]}
        assert browser.post("/api/oauth/google/complete", json=body).status_code == 400
        assert browser.post("/api/oauth/google/complete", json=dict(body, nativeVerifier="A" * 43)).status_code == 400
    response = client.post("/api/oauth/google/complete", json=dict(body, nativeVerifier=verifier))
    assert response.status_code == 200 and response.json()["user"]["id"] == user["id"]
    flow = google.authorize(
        client,
        "drive",
        schoolId=school,
        clientMode="android",
        appId="com.markly.omrpro",
        nativeChallenge=pkce(verifier),
    )
    _, params = google.callback(client, flow)
    client.post("/api/auth/logout")
    response = client.post(
        "/api/oauth/google/complete",
        json={"flowId": flow["flowId"], "ticket": params["ticket"], "nativeVerifier": verifier},
    )
    assert response.status_code == 401 and response.json()["code"] == "session_changed"


def test_google_signup_is_opt_in_isolated_and_password_can_be_set_only_after_recent_google(client, google, app, school):
    assert client.post("/api/oauth/google/start", json={"intent": "signup", "schoolName": "New"}).status_code == 403
    app.state.settings.public_signup = True
    response = google.finish(client, google.authorize(client, "signup", schoolName="New Google Academy"))
    assert response.status_code == 200, response.text
    user = response.json()["user"]
    assert not user["owner"] and user["role"] == "USER" and len(user["memberships"]) == 1
    assert user["memberships"][0]["role"] == "admin" and user["memberships"][0]["schoolId"] != school
    assert client.get(f"/api/schools/{school}/workspace").status_code == 403
    assert client.post("/api/schools", json={"name": "Privilege escalation"}).status_code == 403
    with app.state.sessions() as db:
        account = db.get(m.User, user["id"])
        assert not account.has_password and account.email_verified_at
    prior = client.cookies.get(COOKIE)
    assert client.get("/api/auth/account").json()["recentGoogleLogin"]
    response = client.post("/api/auth/password/set", json={"password": "new-app-passphrase-2026"})
    assert response.status_code == 200, response.text
    assert client.cookies.get(COOKIE) != prior
    assert (
        client.post("/api/auth/password/set", json={"password": "must-not-overwrite-existing-password"}).status_code
        == 409
    )
    with app.state.sessions() as db:
        assert db.get(m.Session, digest(prior)) is None
        assert verify_password("new-app-passphrase-2026", db.get(m.User, user["id"]).password_hash)
    client.cookies.clear()
    assert (
        client.post("/api/auth/login", json={"email": user["email"], "password": "new-app-passphrase-2026"}).status_code
        == 200
    )


def test_expired_first_password_authorization_requires_matching_google_reauthentication(client, google, app):
    app.state.settings.public_signup = True
    response = google.finish(client, google.authorize(client, "signup", schoolName="New Google Academy"))
    assert response.status_code == 200
    with app.state.sessions() as db:
        db.get(m.Session, digest(client.cookies.get(COOKIE))).created_at = m.now() - timedelta(minutes=6)
        db.commit()
    assert client.post("/api/auth/password/set", json={"password": PASSWORD}).status_code == 403
    bad = google.finish(client, google.authorize(client, "reauth", subject="different-google-subject"))
    assert bad.status_code == 403 and bad.json()["code"] == "wrong_google_account"
    response = google.finish(client, google.authorize(client, "reauth"))
    assert response.status_code == 200
    assert client.post("/api/auth/password/set", json={"password": PASSWORD}).status_code == 200


def test_drive_consent_is_separate_from_login_and_credentials_never_leave_server(client, google, app, school):
    result = connected(client, google, school)
    assert result["connected"] and result["mode"] == "manual"
    assert not client.get("/api/auth/account").json()["googleLinked"]
    assert DRIVE_SCOPE in google.authorize(client, "drive", schoolId=school)["params"]["scope"][0]
    with app.state.sessions() as db:
        row = db.scalar(select(m.GoogleDriveConnection))
        assert "synthetic-refresh-secret" not in row.credentials_encrypted
        assert decrypted_json(app.state.store, row.credentials_encrypted)["refresh_token"] == "synthetic-refresh-secret"
    assert "synthetic-access" not in json.dumps(result) and "synthetic-refresh" not in json.dumps(result)


@pytest.mark.parametrize(
    "tokens,code",
    [
        ({"scope": "openid email profile"}, "drive_consent_required"),
        ({"refresh_token": None}, "drive_offline_consent_required"),
    ],
)
def test_missing_drive_offline_consent_does_not_connect(client, google, app, school, tokens, code):
    response = google.finish(client, google.authorize(client, "drive", schoolId=school, tokens=tokens))
    assert response.status_code == 400 and response.json()["code"] == code
    assert not client.get(f"/api/schools/{school}/drive").json()["connected"]


def test_drive_upload_retry_import_and_cas_restore(client, google, app, populated):
    school = populated["school"]
    connected(client, google, school)
    endpoint = f"/api/schools/{school}/drive"
    operation = {"operationId": "qa-durable-drive-operation"}
    google.lose_upload_response = True
    response = client.post(endpoint + "/backups", json=operation)
    assert response.status_code == 502 and "not confirmed" in response.json()["error"]
    history = client.get(endpoint).json()["backups"]
    assert len(history) == 1 and history[0]["status"] == "failed" and google.uploads == 1
    original_revision = history[0]["revision"]
    body = get_workspace(client, school)
    body["workspace"]["students"][0]["name"] = "Newer live student"
    assert save_workspace(client, school, body).status_code == 200
    response = client.post(endpoint + "/backups", json=operation)
    assert response.status_code == 200, response.text
    backup = response.json()["backup"]
    assert backup["status"] == "uploaded" and backup["revision"] == original_revision
    assert google.uploads == 1 and google.generated == 1
    assert client.post(endpoint + "/backups", json=operation).json()["replayed"]
    downloaded = client.get(endpoint + f"/backups/{backup['id']}/download")
    assert downloaded.status_code == 200 and b"Learner" not in downloaded.content
    archive = json.loads(app.state.store.cipher.decrypt(downloaded.content))
    assert archive["schoolId"] == school and archive["workspace"]["students"][0]["name"] != "Newer live student"
    assert "password_hash" not in str(archive) and "synthetic-refresh" not in str(archive)
    assert "users" not in archive["workspace"] and len(archive["workspace"]["schools"]) == 1
    imported = client.post(endpoint + f"/backups/{backup['id']}/import")
    assert imported.status_code == 200, imported.text
    rid = imported.json()["backup"]["id"]
    assert client.post(endpoint + f"/backups/{backup['id']}/import").json()["backup"]["id"] == rid
    assert get_workspace(client, school)["workspace"]["students"][0]["name"] == "Newer live student"
    restore = f"/api/schools/{school}/backups/{rid}/restore"
    assert client.post(restore, json={"password": "wrong", "revision": original_revision}).status_code == 403
    assert client.post(restore, json={"password": PASSWORD, "revision": original_revision}).status_code == 409
    now_revision = get_workspace(client, school)["revision"]
    response = client.post(restore, json={"password": PASSWORD, "revision": now_revision})
    assert response.status_code == 200, response.text
    assert get_workspace(client, school)["workspace"]["students"][0]["name"] != "Newer live student"
    assert any(
        row["name"] == "Before restore" for row in client.get(f"/api/schools/{school}/backups").json()["backups"]
    )


def test_drive_refresh_tamper_disconnect_and_membership_authorization(client, google, app, populated):
    school = populated["school"]
    linked(client, google)
    connected(client, google, school)
    endpoint = f"/api/schools/{school}/drive"
    with app.state.sessions() as db:
        connection = db.scalar(select(m.GoogleDriveConnection))
        credentials = decrypted_json(app.state.store, connection.credentials_encrypted)
        credentials["expires_at"] = 0
        connection.credentials_encrypted = encrypted_json(app.state.store, credentials)
        db.commit()
    response = client.post(endpoint + "/backups", json={"operationId": "qa-refresh-drive-operation"})
    assert response.status_code == 200, response.text
    bid = response.json()["backup"]["id"]
    assert google.refreshes == 1
    google.corrupt_download = True
    revision = get_workspace(client, school)["revision"]
    assert client.post(endpoint + f"/backups/{bid}/import").status_code == 409
    assert get_workspace(client, school)["revision"] == revision
    teacher = new_member(client, school, "drive-teacher@school.edu", classIds=["class-a"])
    login_as(client, "drive-teacher@school.edu")
    for method, path, body in [
        ("GET", endpoint, None),
        ("POST", endpoint + "/backups", {"operationId": "qa-forbidden-drive-operation"}),
        ("GET", endpoint + f"/backups/{bid}/download", None),
        ("POST", endpoint + f"/backups/{bid}/import", None),
        ("POST", endpoint + "/disconnect", None),
    ]:
        assert client.request(method, path, json=body).status_code == 403
    assert client.post("/api/oauth/google/start", json={"intent": "drive", "schoolId": school}).status_code == 403
    assert teacher
    login_as(client, "admin@school.edu")
    google.revoke_fail = True
    response = client.post(endpoint + "/disconnect")
    assert response.status_code == 200 and not response.json()["revokedAtGoogle"]
    assert client.get("/api/auth/account").json()["googleLinked"]
    assert client.post(endpoint + "/backups", json={"operationId": "qa-disconnected-operation"}).status_code == 409
    with app.state.sessions() as db:
        connection = db.scalar(select(m.GoogleDriveConnection))
        assert not connection.active and connection.credentials_encrypted is None


def test_other_school_and_other_admin_cannot_read_drive_tokens_or_archives(client, google, app, school):
    connected(client, google, school)
    endpoint = f"/api/schools/{school}/drive"
    backup = client.post(endpoint + "/backups", json={"operationId": "qa-private-drive-operation"}).json()["backup"]
    new_member(client, school, "other-admin@school.edu", role="admin")
    login_as(client, "other-admin@school.edu")
    assert not client.get(endpoint).json()["connected"]
    assert not client.get(endpoint).json()["backups"]
    assert client.get(endpoint + f"/backups/{backup['id']}/download").status_code == 409
    login_as(client, "admin@school.edu")
    other = client.post("/api/schools", json={"name": "Other academy", "code": "OTHER"}).json()["school"]["id"]
    connected(client, google, other)
    assert client.get(f"/api/schools/{other}/drive/backups/{backup['id']}/download").status_code == 404
    assert client.post(f"/api/schools/{other}/drive/backups/{backup['id']}/import").status_code == 404


def test_unlink_requires_password_preserves_drive_and_revokes_old_sessions(client, google, app, school):
    linked(client, google)
    connected(client, google, school)
    prior = client.cookies.get(COOKIE)
    assert client.post("/api/oauth/google/unlink", json={"currentPassword": "incorrect-password"}).status_code == 403
    assert client.post("/api/oauth/google/unlink", json={"currentPassword": PASSWORD}).status_code == 200
    assert client.get(f"/api/schools/{school}/drive").json()["connected"]
    assert not client.get("/api/auth/account").json()["googleLinked"]
    with app.state.sessions() as db:
        assert db.get(m.Session, digest(prior)) is None


def test_google_transport_is_bounded_fixed_host_no_redirects(app):
    provider = GoogleProvider(
        app.state.settings,
        httpx.MockTransport(lambda request: httpx.Response(302, headers={"location": "http://127.0.0.1/"})),
    )
    with pytest.raises(GoogleError):
        provider.exchange("synthetic-code", "synthetic-verifier")
    for url in (
        "http://www.googleapis.com/",
        "https://evil.example/",
        "https://www.googleapis.com@evil.example/",
        "https://www.googleapis.com:443/",
    ):
        with pytest.raises(GoogleError):
            provider.request("GET", url)
    provider = GoogleProvider(
        app.state.settings, httpx.MockTransport(lambda request: httpx.Response(200, content=b"x" * 1025))
    )
    with pytest.raises(GoogleError, match="too_large"):
        provider.request("GET", CERT_URL, limit=1024)
    for fid in ("../file", "https://evil.example/file", "", "a" * 201):
        with pytest.raises(GoogleError):
            provider.drive_id(fid)


def test_forged_google_signature_cannot_create_a_ticket(client, google):
    flow = google.authorize(client, "login")
    token = google.codes[flow["code"]]["tokens"]["id_token"]
    prefix, signature = token.rsplit(".", 1)
    google.codes[flow["code"]]["tokens"]["id_token"] = (
        prefix + "." + ("B" if signature[0] == "A" else "A") + signature[1:]
    )
    _, result = google.callback(client, flow)
    assert result["error"] == "invalid_google_identity" and "ticket" not in result


def test_expired_completion_and_changed_password_sessions_cannot_authorize_google_link(client, google, app):
    flow = google.authorize(client, "link", currentPassword=PASSWORD)
    _, result = google.callback(client, flow)
    assert (
        client.post(
            "/api/auth/password", json={"currentPassword": PASSWORD, "password": "changed-during-google-link"}
        ).status_code
        == 200
    )
    response = client.post("/api/oauth/google/complete", json={"flowId": flow["flowId"], "ticket": result["ticket"]})
    assert response.status_code == 401
    with app.state.sessions() as db:
        assert db.scalar(select(m.GoogleIdentity)) is None
    client.cookies.clear()
    assert (
        client.post(
            "/api/auth/login", json={"email": "admin@school.edu", "password": "changed-during-google-link"}
        ).status_code
        == 200
    )
    flow = google.authorize(client, "login")
    _, result = google.callback(client, flow)
    with app.state.sessions() as db:
        db.get(m.GoogleOAuthFlow, flow["flowId"]).expires_at = m.now() - timedelta(seconds=1)
        db.commit()
    assert (
        client.post(
            "/api/oauth/google/complete", json={"flowId": flow["flowId"], "ticket": result["ticket"]}
        ).status_code
        == 400
    )


def test_stale_drive_lease_cannot_overwrite_a_newer_preallocated_file_id(client, google, app, school, monkeypatch):
    connected(client, google, school)
    provider = app.state.google
    original = provider.generate_file_id

    def replace_lease(access):
        allocated = original(access)
        with app.state.sessions() as db:
            row = db.scalar(select(m.GoogleDriveBackup))
            row.lease_token = "replacement-lease"
            row.lease_until = m.now() + timedelta(minutes=3)
            row.file_id = "replacement-file-id"
            db.commit()
        return allocated

    monkeypatch.setattr(provider, "generate_file_id", replace_lease)
    response = client.post(f"/api/schools/{school}/drive/backups", json={"operationId": "qa-stale-lease-operation"})
    assert response.status_code == 409
    assert google.uploads == 0
    with app.state.sessions() as db:
        row = db.scalar(select(m.GoogleDriveBackup))
        assert row.lease_token == "replacement-lease" and row.file_id == "replacement-file-id"


def test_google_access_revocation_is_reported_without_leaking_provider_error(client, google, app, school):
    connected(client, google, school)
    with app.state.sessions() as db:
        connection = db.scalar(select(m.GoogleDriveConnection))
        value = decrypted_json(app.state.store, connection.credentials_encrypted)
        value["expires_at"] = 0
        connection.credentials_encrypted = encrypted_json(app.state.store, value)
        db.commit()
    google.deny_token = True
    response = client.post(f"/api/schools/{school}/drive/backups", json={"operationId": "qa-revoked-token-operation"})
    assert response.status_code == 409 and response.json()["code"] == "google_access_denied"
    assert "MUST NOT BE EXPOSED" not in response.text and "synthetic-refresh" not in response.text


def test_student_cannot_connect_list_upload_or_restore_drive_backups(client, google, populated):
    school = populated["school"]
    new_member(client, school, "drive-student@school.edu", role="student", studentId="student-1")
    login_as(client, "drive-student@school.edu")
    endpoint = f"/api/schools/{school}/drive"
    assert client.get(endpoint).status_code == 403
    assert client.post(endpoint + "/backups", json={"operationId": "qa-student-forbidden-operation"}).status_code == 403
    assert client.post(endpoint + "/disconnect").status_code == 403
    assert client.post(endpoint + "/backups/unknown/import").status_code == 403
    assert client.get(endpoint + "/backups/unknown/download").status_code == 403
    assert client.post("/api/oauth/google/start", json={"intent": "drive", "schoolId": school}).status_code == 403


@pytest.mark.parametrize("tokens", [{"token_type": None}, {"token_type": 42}])
def test_invalid_provider_token_type_is_safe_and_never_connects(client, google, school, tokens):
    result = google.finish(client, google.authorize(client, "drive", schoolId=school, tokens=tokens))
    assert result.status_code == 502 and result.json()["code"] == "invalid_provider_response"
    assert not client.get(f"/api/schools/{school}/drive").json()["connected"]


def test_malformed_refresh_never_overwrites_credentials_or_uploads(client, google, app, school, monkeypatch):
    connected(client, google, school)
    with app.state.sessions() as db:
        row = db.scalar(select(m.GoogleDriveConnection))
        original = decrypted_json(app.state.store, row.credentials_encrypted)
        original["expires_at"] = 0
        row.credentials_encrypted = encrypted_json(app.state.store, original)
        db.commit()
    monkeypatch.setattr(
        app.state.google,
        "refresh",
        lambda token: {"access_token": "synthetic-invalid-type", "expires_in": 3600, "token_type": None},
    )
    result = client.post(f"/api/schools/{school}/drive/backups", json={"operationId": "qa-malformed-refresh-operation"})
    assert result.status_code == 502 and result.json()["code"] == "invalid_provider_response"
    assert google.uploads == 0
    with app.state.sessions() as db:
        assert (
            decrypted_json(app.state.store, db.scalar(select(m.GoogleDriveConnection)).credentials_encrypted)
            == original
        )
