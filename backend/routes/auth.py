from __future__ import annotations

import hmac
import secrets
import smtplib
from datetime import timedelta
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models as m
from ..schemas import Credentials, Setup
from ..security import (
    COOKIE,
    DUMMY_HASH,
    HASHER,
    audit,
    current_user,
    db_session,
    digest,
    hash_password,
    issue_session,
    user_info,
    verify_password,
)
from ..workspaces import blank_workspace, persist_workspace

router = APIRouter(prefix="/api")


def throttle(db, key, limit=12, minutes=10):
    key = digest(key)
    db.execute(delete(m.RateBucket).where(m.RateBucket.expires_at < m.now()))
    row = db.get(m.RateBucket, key)
    if not row:
        try:
            with db.begin_nested():
                row = m.RateBucket(key=key, count=0, expires_at=m.now() + timedelta(minutes=minutes))
                db.add(row)
                db.flush()
        except IntegrityError:
            row = db.get(m.RateBucket, key)
    db.execute(update(m.RateBucket).where(m.RateBucket.key == key).values(count=m.RateBucket.count + 1))
    db.flush()
    db.refresh(row)
    limited = row.count > limit
    db.commit()  # Persist failed attempts; an auth failure must not roll back the throttle.
    if limited:
        raise HTTPException(429, "Too many attempts. Try again in 10 minutes.", headers={"Retry-After": "600"})


def ip(request):
    # Do not trust arbitrary X-Forwarded-For; configure the ASGI server's trusted proxies.
    return request.client.host if request.client else "unknown"


@router.get("/setup/status")
def setup_status(request: Request, db: Session = Depends(db_session)):
    settings = request.app.state.settings
    empty = db.scalar(select(func.count()).select_from(m.User)) == 0
    return {
        "needsSetup": empty,
        "setupAllowed": not settings.production or bool(settings.setup_token),
        "tokenRequired": bool(settings.setup_token),
    }


@router.post("/setup", status_code=201)
def setup(data: Setup, request: Request, response: Response, db: Session = Depends(db_session)):
    settings = request.app.state.settings
    throttle(db, f"setup:{ip(request)}", 8)
    if db.scalar(select(func.count()).select_from(m.User)):
        raise HTTPException(409, "The first administrator is already configured.")
    if settings.production and not settings.setup_token:
        raise HTTPException(403, "Server setup is disabled. Configure SETUP_TOKEN on the server.")
    if settings.setup_token and not hmac.compare_digest(data.setupToken, settings.setup_token):
        raise HTTPException(403, "The server setup token is incorrect.")
    # A unique sentinel makes first-admin setup safe under concurrent requests.
    db.add(m.SystemState(key="setup", value="complete"))
    db.flush()
    school = m.School(
        id=m.uid(), name=data.school.name, code=data.school.code, address=data.school.address, teacher=data.name
    )
    user = m.User(
        id=m.uid(),
        name=data.name.strip(),
        email=str(data.email).lower(),
        password_hash=hash_password(data.password),
        super_admin=True,
    )
    db.add_all([school, user])
    db.flush()
    persist_workspace(db, school.id, blank_workspace(school, user.name), user.id)
    db.add(m.Membership(user_id=user.id, school_id=school.id, role="admin", class_ids=[], permissions={}))
    issue_session(db, response, user, settings)
    audit(db, school.id, user.id, "Created the first institution and super administrator")
    db.commit()
    return {"user": user_info(db, user)}


@router.post("/auth/login")
def login(data: Credentials, request: Request, response: Response, db: Session = Depends(db_session)):
    email = str(data.email).lower()
    throttle(db, f"login-ip:{ip(request)}", 60)
    throttle(db, f"login-email:{email}", 12)
    user = db.scalar(select(m.User).where(m.User.email == email))
    valid = verify_password(data.password, user.password_hash if user else DUMMY_HASH)
    if not user or not valid or not user.active:
        audit(db, None, user.id if user else None, "Failed sign-in", ipHash=digest(ip(request)))
        db.commit()
        raise HTTPException(401, "Email or password is incorrect, or this account is suspended.")
    if user.password_hash.startswith("legacy$") or HASHER.check_needs_rehash(user.password_hash):
        user.password_hash = hash_password(data.password)
    issue_session(db, response, user, request.app.state.settings)
    db.execute(delete(m.RateBucket).where(m.RateBucket.key == digest(f"login-email:{email}")))
    audit(db, None, user.id, "Signed in")
    db.commit()
    return {"user": user_info(db, user)}


@router.get("/auth/me")
def me(user: m.User = Depends(current_user), db: Session = Depends(db_session)):
    return {"user": user_info(db, user)}


@router.post("/auth/logout")
def logout(
    request: Request, response: Response, user: m.User = Depends(current_user), db: Session = Depends(db_session)
):
    db.execute(delete(m.Session).where(m.Session.token_hash == digest(request.cookies.get(COOKIE, ""))))
    audit(db, None, user.id, "Signed out")
    db.commit()
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


class PasswordChange(BaseModel):
    currentPassword: str = Field(max_length=128)
    password: str = Field(min_length=12, max_length=128)


@router.post("/auth/password")
def change_password(data: PasswordChange, user: m.User = Depends(current_user), db: Session = Depends(db_session)):
    throttle(db, f"change-password:{user.id}", 6)
    if not verify_password(data.currentPassword, user.password_hash):
        raise HTTPException(403, "Your current password is incorrect.")
    user.password_hash = hash_password(data.password)
    db.execute(delete(m.Session).where(m.Session.user_id == user.id))
    db.execute(delete(m.PasswordReset).where(m.PasswordReset.user_id == user.id))
    audit(db, None, user.id, "Changed password; all sessions revoked")
    db.commit()
    return {"ok": True}


class RecoveryRequest(BaseModel):
    email: EmailStr


@router.post("/auth/recovery/request")
def recovery_request(data: RecoveryRequest, request: Request, db: Session = Depends(db_session)):
    email = str(data.email).lower()
    throttle(db, f"recovery-ip:{ip(request)}", 10)
    throttle(db, f"recovery-email:{email}", 3)
    settings = request.app.state.settings
    user = db.scalar(select(m.User).where(m.User.email == email, m.User.active.is_(True)))
    if user and settings.smtp_host and settings.smtp_from and settings.public_url:
        token = secrets.token_urlsafe(40)
        db.execute(delete(m.PasswordReset).where(m.PasswordReset.user_id == user.id))
        db.add(m.PasswordReset(token_hash=digest(token), user_id=user.id, expires_at=m.now() + timedelta(minutes=30)))
        message = EmailMessage()
        message["From"], message["To"], message["Subject"] = (
            settings.smtp_from,
            user.email,
            "Reset your OMR workspace password",
        )
        message.set_content(
            f"Use this single-use link within 30 minutes:\n{settings.public_url.rstrip('/')}#/reset?token={token}\nIf you did not request this, ignore this message."
        )
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
                smtp.starttls()
                if settings.smtp_user:
                    smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.send_message(message)
        except (OSError, smtplib.SMTPException):
            db.rollback()
            # Do not expose SMTP internals or whether the account exists.
            audit(db, None, None, "Password recovery delivery failed; server operator attention required")
            db.commit()
        else:
            audit(db, None, user.id, "Requested password recovery")
            db.commit()
    return {
        "ok": True,
        "message": "If this account exists and email delivery is configured, a single-use recovery link will arrive shortly. Otherwise contact your administrator.",
    }


class ResetPassword(BaseModel):
    token: str = Field(min_length=30, max_length=128)
    password: str = Field(min_length=12, max_length=128)


@router.post("/auth/recovery/reset")
def recovery_reset(data: ResetPassword, request: Request, db: Session = Depends(db_session)):
    throttle(db, f"recovery-reset:{ip(request)}", 10)
    row = db.scalar(select(m.PasswordReset).where(m.PasswordReset.token_hash == digest(data.token)).with_for_update())
    if not row or row.used or row.expires_at < m.now():
        raise HTTPException(400, "This recovery link is invalid, expired, or already used.")
    changed = db.execute(
        update(m.PasswordReset)
        .where(m.PasswordReset.token_hash == row.token_hash, m.PasswordReset.used.is_(False))
        .values(used=True)
    )
    if changed.rowcount != 1:
        raise HTTPException(400, "This recovery link was already used.")
    user = db.get(m.User, row.user_id)
    user.password_hash = hash_password(data.password)
    db.execute(delete(m.Session).where(m.Session.user_id == user.id))
    audit(db, None, user.id, "Recovered password; all sessions revoked")
    db.commit()
    return {"ok": True}
