"""Google-only OAuth/Drive transport and official Google ID-token verification.

No arbitrary URLs, browser tokens, permissive TLS, redirects or unbounded reads.
The optional HTTPX transport is dependency injection for synthetic provider tests.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import threading
import time
from types import SimpleNamespace
from urllib.parse import urlencode, urlsplit

import httpx
from cryptography.fernet import InvalidToken
from google.auth import exceptions as google_errors
from google.oauth2 import id_token
from pydantic import EmailStr, TypeAdapter

from .security import digest

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
EXCHANGE_URL = "https://oauth2.googleapis.com/token"
CERT_URL = "https://www.googleapis.com/oauth2/v1/certs"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
DRIVE_URL = "https://www.googleapis.com/drive/v3"
UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata"
OAUTH_COOKIE = "omr_google_flow"
NATIVE_APP_IDS = {"com.markly.omrpro", "com.markly.omrpro.debug"}
MAX_DRIVE_BACKUP = 40 * 1024 * 1024


class GoogleError(Exception):
    def __init__(self, code="provider_unavailable", status=502):
        self.code, self.status = code, status
        super().__init__(code)


def pkce(verifier: str):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).decode().rstrip("=")


def google_origin(settings):
    try:
        url = urlsplit(settings.public_url)
        if (
            url.scheme != "https"
            or not url.hostname
            or url.username
            or url.password
            or url.path not in ("", "/")
            or url.query
            or url.fragment
            or "@" in settings.public_url
            or any(ord(c) <= 32 for c in settings.public_url)
        ):
            return ""
        return settings.public_url.rstrip("/")
    except ValueError:
        return ""


def google_ready(settings):
    return bool(settings.google_client_id and settings.google_client_secret and google_origin(settings))


def encrypted_json(store, value):
    return store.cipher.encrypt(json.dumps(value, separators=(",", ":")).encode()).decode()


def decrypted_json(store, value):
    try:
        result = json.loads(store.cipher.decrypt(value.encode()))
        if not isinstance(result, dict):
            raise ValueError()
        return result
    except (InvalidToken, ValueError, TypeError, AttributeError):
        raise GoogleError("server_encryption_key_unavailable", 409) from None


class GoogleProvider:
    def __init__(self, settings, transport=None):
        self.settings, self.transport = settings, transport
        self._certs = None
        self._certs_until = 0.0
        self._certs_lock = threading.Lock()

    def request(self, method, url, *, limit=256 * 1024, **kwargs):
        # All callers construct endpoints from fixed constants and validated Drive IDs.
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or parsed.netloc not in {"oauth2.googleapis.com", "www.googleapis.com"}
            or parsed.username
            or parsed.password
            or parsed.fragment
        ):
            raise GoogleError("invalid_provider_endpoint")
        try:
            with httpx.Client(
                transport=self.transport, timeout=httpx.Timeout(30, connect=8), follow_redirects=False, trust_env=False
            ) as client:
                with client.stream(method, url, **kwargs) as response:
                    content = bytearray()
                    deadline = time.monotonic() + 35
                    for chunk in response.iter_bytes():
                        if len(content) + len(chunk) > limit or time.monotonic() > deadline:
                            raise GoogleError("provider_response_too_large")
                        content.extend(chunk)
                    return response.status_code, dict(response.headers), bytes(content)
        except httpx.HTTPError as exc:
            raise GoogleError("provider_unavailable") from exc

    def json_request(self, method, url, **kwargs):
        status, _, raw = self.request(method, url, **kwargs)
        if status not in (200, 201):
            if status in (401, 403) or (status == 400 and url == EXCHANGE_URL):
                raise GoogleError("google_access_denied", 409)
            if status == 409:
                raise GoogleError("drive_file_exists", 409)
            if status == 404:
                raise GoogleError("drive_file_missing", 404)
            raise GoogleError("provider_unavailable")
        try:
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, UnicodeError) as exc:
            raise GoogleError("invalid_provider_response") from exc

    def authorization_url(self, state, nonce, verifier, drive=False):
        return (
            AUTH_URL
            + "?"
            + urlencode(
                {
                    "client_id": self.settings.google_client_id,
                    "redirect_uri": google_origin(self.settings) + "/api/oauth/google/callback",
                    "response_type": "code",
                    "scope": "openid email profile" + (" " + DRIVE_SCOPE if drive else ""),
                    "state": state,
                    "nonce": nonce,
                    "code_challenge": pkce(verifier),
                    "code_challenge_method": "S256",
                    "access_type": "offline" if drive else "online",
                    "prompt": "consent select_account" if drive else "select_account",
                }
            )
        )

    def exchange(self, code, verifier):
        return self.json_request(
            "POST",
            EXCHANGE_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": verifier,
                "client_id": self.settings.google_client_id,
                "client_secret": self.settings.google_client_secret,
                "redirect_uri": google_origin(self.settings) + "/api/oauth/google/callback",
            },
        )

    def _cert_request(self, url, method="GET", **_kwargs):
        if url != CERT_URL or method != "GET":
            raise GoogleError("invalid_provider_endpoint")
        with self._certs_lock:
            if self._certs is None or time.monotonic() >= self._certs_until:
                status, _, data = self.request("GET", CERT_URL)
                if status != 200:
                    raise GoogleError()
                self._certs, self._certs_until = data, time.monotonic() + 900
            return SimpleNamespace(status=200, data=self._certs)

    def identity(self, token, nonce_hash):
        if not isinstance(token, str) or len(token) > 32768:
            raise GoogleError("invalid_google_identity", 400)
        try:
            claims = id_token.verify_oauth2_token(
                token, self._cert_request, self.settings.google_client_id, clock_skew_in_seconds=30
            )
            subject, email, nonce = claims.get("sub"), claims.get("email"), claims.get("nonce")
            if (
                not isinstance(subject, str)
                or not 1 <= len(subject) <= 255
                or claims.get("email_verified") is not True
                or not isinstance(nonce, str)
                or not hmac.compare_digest(digest(nonce), nonce_hash)
                or claims.get("azp", self.settings.google_client_id) != self.settings.google_client_id
            ):
                raise ValueError()
            email = str(TypeAdapter(EmailStr).validate_python(email)).lower()
            if len(email) > 200:
                raise ValueError()
            name = claims.get("name")
            return {
                "sub": subject,
                "email": email,
                "name": name[:120] if isinstance(name, str) and name.strip() else email.split("@")[0],
            }
        except (ValueError, TypeError, google_errors.GoogleAuthError, json.JSONDecodeError) as exc:
            raise GoogleError("invalid_google_identity", 400) from exc

    def refresh(self, refresh_token):
        return self.json_request(
            "POST",
            EXCHANGE_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": self.settings.google_client_id,
                "client_secret": self.settings.google_client_secret,
            },
        )

    def revoke(self, token):
        status, _, _ = self.request("POST", REVOKE_URL, data={"token": token})
        return status == 200

    @staticmethod
    def drive_id(value):
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,200}", value):
            raise GoogleError("invalid_provider_response")
        return value

    def generate_file_id(self, access):
        response = self.json_request(
            "GET",
            DRIVE_URL + "/files/generateIds",
            headers={"Authorization": "Bearer " + access},
            params={"count": 1, "space": "appDataFolder", "type": "files"},
        )
        ids = response.get("ids")
        return self.drive_id(ids[0] if isinstance(ids, list) and ids else None)

    def file_metadata(self, access, file_id):
        return self.json_request(
            "GET",
            DRIVE_URL + "/files/" + self.drive_id(file_id),
            headers={"Authorization": "Bearer " + access},
            params={"fields": "id,size,appProperties,trashed"},
        )

    def upload(self, access, file_id, metadata, content):
        # A preallocated ID is persisted BEFORE upload, so ambiguous retries cannot duplicate/overwrite a file.
        boundary = "omr_google_drive_backup_boundary"
        body = (
            f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode()
            + json.dumps(dict(metadata, id=self.drive_id(file_id), parents=["appDataFolder"])).encode()
            + f"\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n".encode()
            + content
            + f"\r\n--{boundary}--\r\n".encode()
        )
        return self.json_request(
            "POST",
            UPLOAD_URL,
            params={"uploadType": "multipart", "fields": "id,size,appProperties"},
            headers={"Authorization": "Bearer " + access, "Content-Type": "multipart/related; boundary=" + boundary},
            content=body,
        )

    def download(self, access, file_id):
        status, _, raw = self.request(
            "GET",
            DRIVE_URL + "/files/" + self.drive_id(file_id),
            params={"alt": "media"},
            headers={"Authorization": "Bearer " + access},
            limit=MAX_DRIVE_BACKUP,
        )
        if status != 200:
            raise GoogleError("drive_file_missing" if status == 404 else "google_access_denied", 409)
        return raw
