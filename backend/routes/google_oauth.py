"""Authorization Code + PKCE + nonce, bound web cookies / native proof-key handoff.

Google credentials/tokens remain on the server. No email-only account linking,
WebView Google login, open redirect, native bearer URL or bootstrap bypass.
"""

from __future__ import annotations

import hmac
import secrets
import time
from datetime import timedelta
from typing import Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from .. import models as m
from ..google_provider import (
    DRIVE_SCOPE,
    NATIVE_APP_IDS,
    OAUTH_COOKIE,
    GoogleError,
    decrypted_json,
    encrypted_json,
    google_origin,
    google_ready,
    pkce,
)
from ..security import (
    COOKIE,
    audit,
    current_user,
    db_session,
    digest,
    hash_password,
    issue_session,
    membership,
    user_info,
    verify_password,
)
from .auth import ip, throttle
from .registration import create_school_account, setup_complete, signup_allowed

router = APIRouter(prefix="/api/oauth/google")


class StartGoogle(BaseModel):
    intent: Literal["login", "signup", "link", "reauth", "drive"]
    clientMode: Literal["web", "android"] = "web"
    appId: str | None = Field(default=None, max_length=80)
    nativeChallenge: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{43}$")
    schoolId: str | None = Field(default=None, max_length=120)
    schoolName: str = Field(default="", max_length=120)
    currentPassword: str = Field(default="", max_length=128)


def bound_user(request, db, flow, require_cookie=False):
    session = db.get(m.Session, flow.session_hash) if flow.session_hash else None
    user = db.get(m.User, flow.user_id) if flow.user_id else None
    if not session or session.expires_at <= m.now() or not user or not user.active or session.user_id != user.id:
        raise GoogleError("session_changed", 401)
    if require_cookie and not hmac.compare_digest(digest(request.cookies.get(COOKIE, "")), flow.session_hash):
        raise GoogleError("session_changed", 401)
    if flow.intent == "drive":
        membership(db, user, flow.school_id, "admin")
    return user


@router.post("/start")
def start(data: StartGoogle, request: Request, response: Response, db: Session = Depends(db_session)):
    settings, store = request.app.state.settings, request.app.state.store
    if not google_ready(settings):
        raise HTTPException(
            503,
            "Google sign-in is not configured. The hosting operator must set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and a canonical HTTPS PUBLIC_APP_URL.",
        )
    if not setup_complete(db):
        raise HTTPException(403, "Complete the protected first-administrator setup before enabling Google accounts.")
    if request.headers.get("origin") and request.headers["origin"] != google_origin(settings):
        raise HTTPException(
            400, "Open the app at its canonical HTTPS PUBLIC_APP_URL before starting Google authorization."
        )
    throttle(db, f"google-start:{ip(request)}", 120)
    if data.clientMode == "android":
        if data.appId not in NATIVE_APP_IDS or not data.nativeChallenge:
            raise HTTPException(400, "The native return app and proof-key challenge are required.")
    elif data.appId is not None or data.nativeChallenge is not None:
        raise HTTPException(400, "Native return parameters are not accepted for browser login.")
    user = None
    if data.intent in ("link", "reauth", "drive"):
        user = current_user(request, db)
        if data.intent == "link" and (
            not user.has_password or not verify_password(data.currentPassword, user.password_hash)
        ):
            raise HTTPException(403, "Confirm your current app password before linking a Google sign-in.")
        if data.intent == "reauth" and not db.scalar(
            select(m.GoogleIdentity).where(m.GoogleIdentity.user_id == user.id)
        ):
            raise HTTPException(409, "Link a Google identity before using Google reauthentication.")
        if data.intent == "drive":
            membership(db, user, data.schoolId or "", "admin")
    if data.intent == "signup":
        signup_allowed(request, db)
        if not data.schoolName.strip():
            raise HTTPException(400, "Enter the name of your new institution before continuing with Google.")
    state, nonce, verifier, browser = (secrets.token_urlsafe(40) for _ in range(4))
    flow = m.GoogleOAuthFlow(
        id=m.uid(),
        state_hash=digest(state),
        browser_hash=digest(browser) if data.clientMode == "web" else None,
        nonce_hash=digest(nonce),
        verifier_encrypted=encrypted_json(store, {"verifier": verifier}),
        intent=data.intent,
        client_mode=data.clientMode,
        app_id=data.appId,
        native_challenge=data.nativeChallenge,
        user_id=user.id if user else None,
        session_hash=digest(request.cookies.get(COOKIE, "")) if user else None,
        school_id=data.schoolId if data.intent == "drive" else None,
        extra={"schoolName": data.schoolName.strip()},
        expires_at=m.now() + timedelta(minutes=10),
        status="pending",
    )
    db.execute(delete(m.GoogleOAuthFlow).where(m.GoogleOAuthFlow.expires_at < m.now()))
    db.add(flow)
    db.commit()
    if data.clientMode == "web":
        response.set_cookie(
            OAUTH_COOKIE,
            flow.id + "." + browser,
            max_age=600,
            httponly=True,
            secure=True,
            samesite="lax",
            path="/api/oauth/google",
        )
    return {
        "flowId": flow.id,
        "authorizationUrl": request.app.state.google.authorization_url(state, nonce, verifier, data.intent == "drive"),
    }


def browser_matches(request, flow):
    cookie = request.cookies.get(OAUTH_COOKIE, "")
    prefix, separator, proof = cookie.partition(".")
    return bool(
        separator and prefix == flow.id and flow.browser_hash and hmac.compare_digest(digest(proof), flow.browser_hash)
    )


def return_url(settings, flow, **params):
    query = urlencode({"flow": flow.id, **params})
    if flow.client_mode == "android" and flow.app_id in NATIVE_APP_IDS:
        return f"{flow.app_id}://oauth/callback?{query}"
    return google_origin(settings) + "/#/oauth/return?" + query


@router.get("/callback")
def callback(
    request: Request,
    state: str = Query(min_length=30, max_length=128),
    code: str | None = Query(default=None, max_length=4096),
    error: str | None = Query(default=None, max_length=100),
    db: Session = Depends(db_session),
):
    throttle(db, f"google-callback:{ip(request)}", 240)
    flow = db.scalar(select(m.GoogleOAuthFlow).where(m.GoogleOAuthFlow.state_hash == digest(state)))
    if not flow or flow.status != "pending" or flow.expires_at <= m.now():
        raise HTTPException(400, "This Google sign-in request is invalid, expired or already used. Start again.")
    if flow.client_mode == "web" and not browser_matches(request, flow):
        raise HTTPException(400, "Google sign-in belongs to a different browser or tab. Start again here.")
    claimed = db.execute(
        update(m.GoogleOAuthFlow)
        .where(m.GoogleOAuthFlow.id == flow.id, m.GoogleOAuthFlow.status == "pending")
        .values(status="exchanging")
    )
    if claimed.rowcount != 1:
        raise HTTPException(409, "This Google authorization response was already used.")
    db.commit()
    try:
        if error or not code:
            raise GoogleError("consent_cancelled", 400)
        if flow.user_id:
            bound_user(request, db, flow)
        tokens = request.app.state.google.exchange(
            code, decrypted_json(request.app.state.store, flow.verifier_encrypted)["verifier"]
        )
        identity = request.app.state.google.identity(tokens.get("id_token"), flow.nonce_hash)
        ticket = secrets.token_urlsafe(40)
        flow.result_encrypted = encrypted_json(
            request.app.state.store, {"identity": identity, "tokens": tokens if flow.intent == "drive" else {}}
        )
        flow.ticket_hash, flow.status = digest(ticket), "complete"
        flow.expires_at = m.now() + timedelta(minutes=2)
        flow.verifier_encrypted = ""
        db.commit()
        return RedirectResponse(return_url(request.app.state.settings, flow, ticket=ticket), status_code=303)
    except GoogleError as exc:
        flow.status, flow.verifier_encrypted, flow.result_encrypted = "failed", "", None
        db.commit()
        return RedirectResponse(return_url(request.app.state.settings, flow, error=exc.code), status_code=303)
    except HTTPException:
        flow.status, flow.verifier_encrypted = "failed", ""
        db.commit()
        return RedirectResponse(return_url(request.app.state.settings, flow, error="session_changed"), status_code=303)


class CompleteGoogle(BaseModel):
    flowId: str = Field(min_length=1, max_length=120)
    ticket: str = Field(min_length=30, max_length=128)
    nativeVerifier: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{43,128}$")


def connect_drive(db, request, user, flow, identity, tokens):
    if DRIVE_SCOPE not in str(tokens.get("scope", "")).split():
        raise GoogleError("drive_consent_required", 400)
    refresh, access = tokens.get("refresh_token"), tokens.get("access_token")
    if (
        not isinstance(access, str)
        or not 1 <= len(access) <= 8192
        or not isinstance(tokens.get("token_type", "Bearer"), str)
        or tokens.get("token_type", "Bearer").lower() != "bearer"
    ):
        raise GoogleError("invalid_provider_response")
    old = db.scalars(
        select(m.GoogleDriveConnection).where(
            m.GoogleDriveConnection.user_id == user.id, m.GoogleDriveConnection.school_id == flow.school_id
        )
    ).all()
    connection = next((row for row in old if row.subject == identity["sub"]), None)
    if not refresh and connection and connection.credentials_encrypted:
        refresh = decrypted_json(request.app.state.store, connection.credentials_encrypted).get("refresh_token")
    if not isinstance(refresh, str) or not 1 <= len(refresh) <= 8192:
        raise GoogleError("drive_offline_consent_required", 400)
    for row in old:
        row.active, row.credentials_encrypted = False, None
    db.flush()
    if not connection:
        connection = m.GoogleDriveConnection(
            id=m.uid(), user_id=user.id, school_id=flow.school_id, subject=identity["sub"], email=identity["email"]
        )
        db.add(connection)
    expiry = tokens.get("expires_in", 3600)
    if not isinstance(expiry, (int, float)) or not 0 < expiry <= 86400:
        raise GoogleError("invalid_provider_response")
    connection.active, connection.email, connection.updated_at = True, identity["email"], m.now()
    connection.credentials_encrypted = encrypted_json(
        request.app.state.store,
        {
            "access_token": access,
            "refresh_token": refresh,
            "expires_at": time.time() + expiry,
            "scopes": [DRIVE_SCOPE],
        },
    )
    audit(db, flow.school_id, user.id, "Connected private Google Drive app-data backups")


@router.post("/complete")
def complete(data: CompleteGoogle, request: Request, response: Response, db: Session = Depends(db_session)):
    throttle(db, f"google-complete:{ip(request)}", 120)
    flow = db.get(m.GoogleOAuthFlow, data.flowId)
    if (
        not flow
        or flow.status != "complete"
        or flow.expires_at <= m.now()
        or not flow.result_encrypted
        or not hmac.compare_digest(flow.ticket_hash or "", digest(data.ticket))
    ):
        raise HTTPException(400, "This Google completion ticket is invalid, expired or already used. Start again.")
    if flow.client_mode == "web":
        valid = data.nativeVerifier is None and browser_matches(request, flow)
    else:
        valid = bool(
            data.nativeVerifier and hmac.compare_digest(pkce(data.nativeVerifier), flow.native_challenge or "")
        )
    if not valid:
        raise HTTPException(400, "This Google response does not belong to this browser or device.")
    try:
        result = decrypted_json(request.app.state.store, flow.result_encrypted)
        identity = result["identity"]
        claimed = db.execute(
            update(m.GoogleOAuthFlow)
            .where(m.GoogleOAuthFlow.id == flow.id, m.GoogleOAuthFlow.status == "complete")
            .values(status="consuming", result_encrypted=None, ticket_hash=None)
        )
        if claimed.rowcount != 1:
            raise HTTPException(409, "This Google response was already used.")
        existing = db.get(m.GoogleIdentity, identity["sub"])
        if flow.intent in ("link", "reauth", "drive"):
            user = bound_user(request, db, flow, require_cookie=True)
            if flow.intent == "link":
                other = db.scalar(select(m.GoogleIdentity).where(m.GoogleIdentity.user_id == user.id))
                if (existing and existing.user_id != user.id) or (other and other.subject != identity["sub"]):
                    raise GoogleError("google_already_linked", 409)
                if not existing:
                    db.add(m.GoogleIdentity(subject=identity["sub"], user_id=user.id, email=identity["email"]))
                audit(db, None, user.id, "Linked Google sign-in after password confirmation")
            elif flow.intent == "reauth":
                if not existing or existing.user_id != user.id:
                    raise GoogleError("wrong_google_account", 403)
                issue_session(db, response, user, request.app.state.settings, method="google")
            else:
                connect_drive(db, request, user, flow, identity, result["tokens"])
        elif flow.intent == "signup":
            signup_allowed(request, db)
            if existing:
                raise GoogleError("account_exists", 409)
            if db.scalar(select(m.User.id).where(m.User.email == identity["email"])):
                raise GoogleError("link_required", 409)
            user = create_school_account(
                db,
                email=identity["email"],
                name=identity["name"],
                school_name=flow.extra["schoolName"],
                password_hash=hash_password(secrets.token_urlsafe(32)),
                has_password=False,
                verified=True,
            )
            db.add(m.GoogleIdentity(subject=identity["sub"], user_id=user.id, email=identity["email"]))
            issue_session(db, response, user, request.app.state.settings, method="google")
        else:
            if not existing:
                reason = (
                    "link_required"
                    if db.scalar(select(m.User.id).where(m.User.email == identity["email"]))
                    else "signup_required"
                )
                raise GoogleError(reason, 409)
            user = db.get(m.User, existing.user_id)
            if not user or not user.active:
                raise GoogleError("account_suspended", 403)
            existing.email = identity["email"]
            issue_session(db, response, user, request.app.state.settings, method="google")
            audit(db, None, user.id, "Signed in with verified Google identity")
        claimed = db.execute(
            update(m.GoogleOAuthFlow)
            .where(m.GoogleOAuthFlow.id == flow.id, m.GoogleOAuthFlow.status == "consuming")
            .values(status="consumed", result_encrypted=None, ticket_hash=None)
        )
        if claimed.rowcount != 1:
            raise HTTPException(409, "This Google response was already used.")
        db.flush()
        db.commit()
        response.delete_cookie(OAUTH_COOKIE, path="/api/oauth/google", secure=True, httponly=True, samesite="lax")
        return {"user": user_info(db, user), "intent": flow.intent, "schoolId": flow.school_id}
    except GoogleError as exc:
        raise HTTPException(
            exc.status,
            {
                "message": "Google authorization could not be completed. " + exc.code.replace("_", " ") + ".",
                "code": exc.code,
            },
        ) from None


class UnlinkGoogle(BaseModel):
    currentPassword: str = Field(min_length=12, max_length=128)


@router.post("/unlink")
def unlink(
    data: UnlinkGoogle,
    request: Request,
    response: Response,
    user=Depends(current_user),
    db: Session = Depends(db_session),
):
    throttle(db, f"google-unlink:{user.id}", 6)
    if not user.has_password or not verify_password(data.currentPassword, user.password_hash):
        raise HTTPException(403, "Set and confirm an app password before removing Google sign-in.")
    db.execute(delete(m.GoogleIdentity).where(m.GoogleIdentity.user_id == user.id))
    db.execute(delete(m.Session).where(m.Session.user_id == user.id))
    issue_session(db, response, user, request.app.state.settings)
    audit(db, None, user.id, "Removed Google sign-in; prior sessions revoked; Drive connection unchanged")
    db.commit()
    return {"user": user_info(db, user)}
