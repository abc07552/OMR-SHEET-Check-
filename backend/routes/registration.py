"""Public opt-in signup creates a NEW isolated tenant, never existing-school access."""

from __future__ import annotations

import secrets
import smtplib
import ssl
from datetime import timedelta
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from .. import models as m
from ..google_provider import google_ready
from ..security import (
    COOKIE,
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
from .auth import ip, throttle

router = APIRouter(prefix="/api/auth")
SIGNUP_MESSAGE = "If this address can be registered, a single-use verification email will arrive. Use the password you chose to confirm it. Existing users should sign in or recover their password."


def setup_complete(db):
    return bool(db.scalar(select(func.count()).select_from(m.User).where(m.User.super_admin.is_(True))))


def signup_allowed(request, db):
    if not request.app.state.settings.public_signup or not setup_complete(db):
        raise HTTPException(
            403,
            "Public signup is disabled. Complete server administrator setup or ask the hosting operator to enable PUBLIC_SIGNUP_ENABLED.",
        )


def create_school_account(db, *, email, name, school_name, password_hash, has_password=True, verified=False):
    if verified:
        db.execute(delete(m.PendingSignup).where(m.PendingSignup.email == email))
    school = m.School(id=m.uid(), name=school_name, code="SCH", teacher=name)
    user = m.User(
        id=m.uid(),
        email=email,
        name=name,
        password_hash=password_hash,
        has_password=has_password,
        email_verified_at=m.now() if verified else None,
        super_admin=False,
    )
    db.add_all([school, user])
    db.flush()
    db.add(m.Membership(user_id=user.id, school_id=school.id, role="admin", class_ids=[], permissions={}))
    persist_workspace(db, school.id, blank_workspace(school, name), user.id)
    audit(db, school.id, user.id, "Registered a new isolated institution")
    return user


@router.get("/options")
def auth_options(request: Request, db: Session = Depends(db_session)):
    settings = request.app.state.settings
    bootstrapped = setup_complete(db)
    smtp = bool(settings.smtp_host and settings.smtp_from and settings.public_url)
    return {
        "signupEnabled": settings.public_signup and bootstrapped,
        "passwordSignupEnabled": settings.public_signup and bootstrapped and (not settings.production or smtp),
        "emailVerificationRequired": settings.production,
        "googleEnabled": google_ready(settings) and bootstrapped,
        "googleConfigured": google_ready(settings),
        "driveEnabled": google_ready(settings),
        "emailConfigured": smtp,
    }


class Signup(BaseModel):
    email: EmailStr = Field(max_length=200)
    name: str = Field(min_length=1, max_length=120)
    schoolName: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("name", "schoolName")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("Enter a name, not only whitespace.")
        return value.strip()


@router.post("/signup", status_code=201)
def signup(data: Signup, request: Request, response: Response, db: Session = Depends(db_session)):
    signup_allowed(request, db)
    settings = request.app.state.settings
    if settings.production and not (settings.smtp_host and settings.smtp_from and settings.public_url):
        raise HTTPException(
            503,
            "Verified email signup needs the server's SMTP delivery configuration. Use configured Google signup or contact the hosting operator.",
        )
    email = str(data.email).lower()
    throttle(db, f"signup-ip:{ip(request)}", 10)
    throttle(db, f"signup-email:{email}", 3)
    if db.scalar(select(m.User.id).where(m.User.email == email)):
        response.status_code = 202
        return {"requiresVerification": True, "message": SIGNUP_MESSAGE}
    if not settings.production:
        user = create_school_account(
            db, email=email, name=data.name, school_name=data.schoolName, password_hash=hash_password(data.password)
        )
        issue_session(db, response, user, settings)
        db.commit()
        return {
            "user": user_info(db, user),
            "requiresVerification": False,
            "message": "Development signup: email delivery was not required. Use test data only.",
        }
    db.execute(delete(m.PendingSignup).where(m.PendingSignup.expires_at < m.now()))
    existing = db.scalar(select(m.PendingSignup).where(m.PendingSignup.email == email))
    if existing and not verify_password(data.password, existing.password_hash):
        response.status_code = 202
        return {"requiresVerification": True, "message": SIGNUP_MESSAGE}
    token = secrets.token_urlsafe(40)
    if existing:
        # Only knowledge of the chosen app password can rotate/resend a pending link.
        # Never replace another pending signup's password or identity fields.
        existing.token_hash = digest(token)
        existing.expires_at = m.now() + timedelta(minutes=30)
    else:
        db.add(
            m.PendingSignup(
                token_hash=digest(token),
                email=email,
                name=data.name,
                school_name=data.schoolName,
                password_hash=hash_password(data.password),
                expires_at=m.now() + timedelta(minutes=30),
            )
        )
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = settings.smtp_from, email, "Confirm your OMR school account"
    message.set_content(
        f"Confirm the signup within 30 minutes:\n{settings.public_url.rstrip('/')}#/verify-email?token={token}\n\nEnter the app password you chose during signup. If you did not request this account, ignore this email. No account is activated by opening the link alone."
    )
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException):
        db.rollback()
        raise HTTPException(
            503,
            "The verification email could not be delivered. No account was created; retry or contact the hosting operator.",
        ) from None
    db.commit()
    response.status_code = 202
    return {"requiresVerification": True, "message": SIGNUP_MESSAGE}


class VerifySignup(BaseModel):
    token: str = Field(min_length=30, max_length=128)
    password: str = Field(min_length=12, max_length=128)


@router.post("/signup/verify")
def verify_signup(data: VerifySignup, request: Request, response: Response, db: Session = Depends(db_session)):
    signup_allowed(request, db)
    throttle(db, f"verify-signup:{ip(request)}", 12)
    pending = db.scalar(
        select(m.PendingSignup).where(m.PendingSignup.token_hash == digest(data.token)).with_for_update()
    )
    if not pending or pending.expires_at <= m.now() or not verify_password(data.password, pending.password_hash):
        raise HTTPException(400, "This verification link/password is invalid, expired or already used.")
    # Atomic deletion is the SQLite and PostgreSQL single-use claim.
    claimed = db.execute(delete(m.PendingSignup).where(m.PendingSignup.token_hash == pending.token_hash))
    if claimed.rowcount != 1:
        raise HTTPException(409, "This verification link was already used.")
    user = create_school_account(
        db,
        email=pending.email,
        name=pending.name,
        school_name=pending.school_name,
        password_hash=pending.password_hash,
        verified=True,
    )
    issue_session(db, response, user, request.app.state.settings)
    db.commit()
    return {"user": user_info(db, user)}


@router.get("/account")
def account(request: Request, user=Depends(current_user), db: Session = Depends(db_session)):
    identity = db.scalar(select(m.GoogleIdentity).where(m.GoogleIdentity.user_id == user.id))
    session = db.get(m.Session, digest(request.cookies.get(COOKIE, "")))
    return {
        "hasPassword": user.has_password,
        "emailVerified": bool(user.email_verified_at),
        "googleLinked": bool(identity),
        "googleEmail": identity.email if identity else None,
        "recentGoogleLogin": bool(
            session
            and session.auth_method == "google"
            and session.created_at
            and session.created_at > m.now() - timedelta(minutes=5)
        ),
        "googleEnabled": google_ready(request.app.state.settings),
    }


class FirstPassword(BaseModel):
    password: str = Field(min_length=12, max_length=128)


@router.post("/password/set")
def first_password(
    data: FirstPassword,
    request: Request,
    response: Response,
    user=Depends(current_user),
    db: Session = Depends(db_session),
):
    throttle(db, f"set-password:{user.id}", 6)
    session = db.get(m.Session, digest(request.cookies.get(COOKIE, "")))
    if user.has_password:
        raise HTTPException(409, "Use Change password and your current password instead.")
    if (
        not session
        or session.auth_method != "google"
        or not session.created_at
        or session.created_at <= m.now() - timedelta(minutes=5)
    ):
        raise HTTPException(403, "Verify with Google again before setting your first app password.")
    changed = db.execute(
        update(m.User)
        .where(m.User.id == user.id, m.User.has_password.is_(False))
        .values(password_hash=hash_password(data.password), has_password=True)
    )
    if changed.rowcount != 1:
        raise HTTPException(409, "An app password was already set. Sign in with it or use recovery.")
    db.execute(delete(m.Session).where(m.Session.user_id == user.id))
    db.execute(delete(m.PasswordReset).where(m.PasswordReset.user_id == user.id))
    issue_session(db, response, user, request.app.state.settings)
    audit(db, None, user.id, "Set app password after recent verified Google sign-in; prior sessions revoked")
    db.commit()
    return {"user": user_info(db, user)}
