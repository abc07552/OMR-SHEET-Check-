from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DBSession

from . import models as m

HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
DUMMY_HASH = HASHER.hash(secrets.token_urlsafe(32))
COOKIE = "omr_session"


def digest(value: str | bytes):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def fingerprint(value):
    return digest(canonical(value))


def hash_password(password):
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        raise HTTPException(400, "Passwords must contain 12–128 characters.")
    return HASHER.hash(password)


def verify_password(password, stored):
    if not isinstance(password, str) or len(password) > 128:
        return False
    try:
        if stored.startswith("legacy$"):
            salt, saved = stored[7:].split(":", 1)
            actual = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64)
            return hmac.compare_digest(actual.hex(), saved)
        return HASHER.verify(stored, password)
    except (VerificationError, InvalidHashError, ValueError, TypeError):
        return False


def db_session(request: Request):
    with request.app.state.sessions() as db:
        try:
            yield db
        except BaseException:
            db.rollback()
            raise


def current_user(request: Request, db: DBSession = Depends(db_session)):
    token = request.cookies.get(COOKIE, "")
    if not token or len(token) > 128:
        raise HTTPException(401, "Sign in to continue.")
    row = db.get(m.Session, digest(token))
    user = db.get(m.User, row.user_id) if row and row.expires_at > m.now() else None
    if not user or not user.active:
        raise HTTPException(401, "Your session has expired or your account was suspended. Sign in again.")
    return user


def issue_session(db, response: Response, user, settings):
    token = secrets.token_urlsafe(32)
    db.execute(delete(m.Session).where(m.Session.expires_at < m.now()))
    db.add(m.Session(token_hash=digest(token), user_id=user.id, expires_at=m.now() + timedelta(hours=24)))
    response.set_cookie(
        COOKIE,
        token,
        max_age=86400,
        httponly=True,
        secure=settings.production,
        samesite="none" if settings.web_origin and settings.production else "strict",
        path="/",
    )


def membership(db, user, school_id, role=None, permission=None):
    member = db.get(m.Membership, (user.id, school_id))
    if not member or member.permissions.get("suspended", False):
        raise HTTPException(403, "You do not have access to this school.")
    if role == "admin" and member.role != "admin":
        raise HTTPException(403, "Only a school administrator can do that.")
    if role == "staff" and member.role == "student":
        raise HTTPException(403, "This resource is restricted to school staff.")
    if permission and member.role == "teacher" and not member.permissions.get(permission, False):
        raise HTTPException(403, f"Your account does not have {permission} permission.")
    return member


def user_info(db, user):
    rows = db.execute(
        select(m.Membership, m.School).join(m.School).where(m.Membership.user_id == user.id).order_by(m.School.name)
    ).all()
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "owner": user.super_admin,
        "role": "SUPER_ADMIN" if user.super_admin else "USER",
        "memberships": [
            {
                "schoolId": s.id,
                "name": s.name,
                "code": s.code,
                "role": mem.role,
                "classIds": mem.class_ids,
                "studentId": mem.student_id,
                "permissions": mem.permissions,
            }
            for mem, s in rows
            if not mem.permissions.get("suspended", False)
        ],
    }


def audit(db, school_id, user_id, action, **details):
    db.add(m.Audit(school_id=school_id, user_id=user_id, action=action, details=details))


def allowed_student(db, school_id, member, student_id):
    student = db.get(m.Student, (school_id, student_id))
    if not student or student.deleted_at:
        raise HTTPException(404, "Student not found.")
    if member.role == "student" and member.student_id != student_id:
        raise HTTPException(403, "You can view only your own student record.")
    if member.role == "teacher" and student.class_id not in member.class_ids:
        raise HTTPException(403, "This student is outside your assigned classes.")
    return student


def allowed_exam(db, school_id, member, exam_id, permission=None):
    exam = db.get(m.Examination, (school_id, exam_id))
    if not exam or exam.deleted_at:
        raise HTTPException(404, "Examination not found.")
    if member.role == "teacher" and (not set(exam.class_ids).intersection(member.class_ids)):
        raise HTTPException(403, "This examination is outside your assigned classes.")
    if permission and member.role == "teacher" and not member.permissions.get(permission, False):
        raise HTTPException(403, f"Your account does not have {permission} permission.")
    if member.role == "student":
        raise HTTPException(403, "Use your private student portal.")
    return exam
