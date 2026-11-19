from __future__ import annotations

import json
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .. import models as m
from ..schemas import MemberInput, SchoolInput, Workspace, WorkspaceWrite
from ..security import audit, current_user, db_session, fingerprint, hash_password, membership, verify_password
from ..workspaces import advance_revision, authorize_changes, blank_workspace, load_workspace, persist_workspace
from .auth import PasswordChange, throttle

router = APIRouter(prefix="/api")


def backup_info(b):
    return {"id": b.id, "name": b.name, "createdAt": b.created_at.isoformat() + "Z", "automatic": b.automatic}


def snapshot(db, request, school_id, name="Automatic recovery point", automatic=True):
    bid = m.uid()
    key = f"backups/{school_id}/{bid}.json.enc"
    data = json.dumps(load_workspace(db, school_id), separators=(",", ":"), ensure_ascii=False).encode()
    request.app.state.store.put(key, data, encrypt=True)
    row = m.RecoveryPoint(id=bid, school_id=school_id, name=name[:120], key=key, automatic=automatic)
    db.add(row)
    db.flush()
    old = db.scalars(
        select(m.RecoveryPoint)
        .where(m.RecoveryPoint.school_id == school_id, m.RecoveryPoint.automatic.is_(True))
        .order_by(m.RecoveryPoint.created_at.desc())
        .offset(14)
    ).all()
    for backup in old:
        # Objects are retained if this DB transaction rolls back. Garbage collection
        # can safely remove unreferenced objects later; never delete before commit.
        db.delete(backup)
    return row


@router.get("/schools/{school_id}/workspace")
def read_workspace(school_id: str, user: m.User = Depends(current_user), db: Session = Depends(db_session)):
    member = membership(db, user, school_id, "staff")
    school = db.get(m.School, school_id)
    return {"workspace": load_workspace(db, school_id, member), "revision": school.revision, "role": member.role}


@router.put("/schools/{school_id}/workspace")
def write_workspace(
    school_id: str,
    data: WorkspaceWrite,
    request: Request,
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    member = membership(db, user, school_id, "staff")
    incoming = data.workspace.model_dump(mode="json", by_alias=True, exclude_none=True)
    if data.workspace.activeSchoolId != school_id:
        raise HTTPException(403, "This workspace belongs to another school.")
    request_hash = fingerprint({"workspace": incoming, "revision": data.revision})
    if data.operationId:
        previous = db.get(m.Operation, (school_id, data.operationId))
        if previous:
            if previous.user_id != user.id or previous.request_hash != request_hash:
                raise HTTPException(409, "This operation ID was already used for different data or by another user.")
            return dict(previous.response, replayed=True)
    revision = advance_revision(db, school_id, data.revision)
    old = load_workspace(db, school_id)
    merged = authorize_changes(old, incoming, member)
    if incoming.get("institutionSettings", old.get("institutionSettings")) != old.get("institutionSettings"):
        raise HTTPException(
            400, "Change institution preferences through the validated settings endpoint, not workspace JSON."
        )
    last = db.scalar(
        select(m.RecoveryPoint)
        .where(m.RecoveryPoint.school_id == school_id, m.RecoveryPoint.automatic.is_(True))
        .order_by(m.RecoveryPoint.created_at.desc())
        .limit(1)
    )
    if not last or last.created_at < m.now() - timedelta(hours=24):
        snapshot(db, request, school_id)
    persist_workspace(db, school_id, merged, user.id)
    response = {"revision": revision, "savedAt": m.now().isoformat() + "Z"}
    if data.operationId:
        db.add(
            m.Operation(
                school_id=school_id, id=data.operationId, user_id=user.id, request_hash=request_hash, response=response
            )
        )
    audit(db, school_id, user.id, "Saved workspace", revision=revision, operationId=data.operationId)
    db.commit()
    return response


@router.post("/schools", status_code=201)
def add_school(data: SchoolInput, user: m.User = Depends(current_user), db: Session = Depends(db_session)):
    if not user.super_admin:
        raise HTTPException(403, "Only a super administrator can create institutions.")
    school = m.School(id=m.uid(), name=data.name, code=data.code, address=data.address, teacher=user.name)
    db.add(school)
    db.flush()
    persist_workspace(db, school.id, blank_workspace(school, user.name), user.id)
    db.add(m.Membership(user_id=user.id, school_id=school.id, role="admin", class_ids=[], permissions={}))
    audit(db, school.id, user.id, "Created institution")
    db.commit()
    return {"school": {"id": school.id, "name": school.name, "code": school.code, "address": school.address}}


def valid_assignments(db, school_id, role, class_ids, student_id):
    classes = {
        c.id
        for c in db.scalars(select(m.Classroom).where(m.Classroom.school_id == school_id))
        if not c.payload.get("archived")
    }
    if set(class_ids) - classes:
        raise HTTPException(400, "One or more assigned classes do not belong to this school.")
    if role == "student":
        student = db.get(m.Student, (school_id, student_id or ""))
        if not student or student.deleted_at:
            raise HTTPException(400, "Link the student account to an active student in this school.")
        other = db.scalar(
            select(m.Membership).where(m.Membership.school_id == school_id, m.Membership.student_id == student_id)
        )
        if other:
            raise HTTPException(409, "This student already has a linked account.")


@router.get("/schools/{school_id}/users")
def list_members(school_id: str, user: m.User = Depends(current_user), db: Session = Depends(db_session)):
    membership(db, user, school_id, "admin")
    rows = db.execute(
        select(m.User, m.Membership).join(m.Membership).where(m.Membership.school_id == school_id).order_by(m.User.name)
    ).all()
    return {
        "users": [
            {
                "id": u.id,
                "name": u.name,
                "email": u.email,
                "role": mem.role,
                "active": u.active and not mem.permissions.get("suspended", False),
                "classIds": mem.class_ids,
                "studentId": mem.student_id,
                "permissions": mem.permissions,
                "superAdmin": u.super_admin,
            }
            for u, mem in rows
        ]
    }


@router.post("/schools/{school_id}/users", status_code=201)
def add_member(
    school_id: str, data: MemberInput, user: m.User = Depends(current_user), db: Session = Depends(db_session)
):
    membership(db, user, school_id, "admin")
    throttle(db, f"add-member:{user.id}", 30)
    valid_assignments(db, school_id, data.role, data.classIds, data.studentId)
    target = db.scalar(select(m.User).where(m.User.email == str(data.email).lower()))
    existing = target is not None
    if target and db.get(m.Membership, (target.id, school_id)):
        raise HTTPException(409, "This account is already a member of this school.")
    if not target:
        target = m.User(
            id=m.uid(),
            name=data.name,
            email=str(data.email).lower(),
            password_hash=hash_password(data.password),
            super_admin=False,
        )
        db.add(target)
        db.flush()
    if target.super_admin and not user.super_admin:
        raise HTTPException(403, "Only a super administrator can manage another super administrator's membership.")
    permissions = {k: v for k, v in data.permissions.items() if k in ("createExams", "scan", "reports")}
    db.add(
        m.Membership(
            user_id=target.id,
            school_id=school_id,
            role=data.role,
            class_ids=data.classIds if data.role == "teacher" else [],
            student_id=data.studentId if data.role == "student" else None,
            permissions=permissions,
        )
    )
    audit(db, school_id, user.id, f"Added {data.role} membership", targetId=target.id, classIds=data.classIds)
    db.commit()
    return {"id": target.id, "existing": existing}


class MemberPatch(BaseModel):
    role: str | None = Field(default=None, pattern="^(admin|teacher|student)$")
    classIds: list[str] | None = Field(default=None, max_length=500)
    studentId: str | None = Field(default=None, max_length=120)
    permissions: dict[str, bool] | None = None
    suspended: bool | None = None


@router.patch("/schools/{school_id}/users/{target_id}")
def patch_member(
    school_id: str,
    target_id: str,
    data: MemberPatch,
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    membership(db, user, school_id, "admin")
    target = db.get(m.User, target_id)
    mem = db.get(m.Membership, (target_id, school_id))
    if not target or not mem:
        raise HTTPException(404, "Membership not found.")
    if target_id == user.id or (target.super_admin and not user.super_admin):
        raise HTTPException(403, "You cannot change your own access or another super administrator's access.")
    if mem.role == "admin" and (data.role not in (None, "admin") or data.suspended):
        if (
            db.scalar(
                select(func.count())
                .select_from(m.Membership)
                .where(m.Membership.school_id == school_id, m.Membership.role == "admin")
            )
            <= 1
        ):
            raise HTTPException(400, "Retain at least one active administrator.")
    role = data.role or mem.role
    classes = data.classIds if data.classIds is not None else mem.class_ids
    student_id = data.studentId or mem.student_id
    if role == "student" and student_id == mem.student_id:
        student = db.get(m.Student, (school_id, student_id or ""))
        if not student or student.deleted_at:
            raise HTTPException(400, "Student link is invalid.")
    else:
        valid_assignments(db, school_id, role, classes, student_id)
    if role == "teacher":
        valid_assignments(db, school_id, role, classes, None)
    mem.role, mem.class_ids, mem.student_id = (
        role,
        classes if role == "teacher" else [],
        student_id if role == "student" else None,
    )
    permissions = dict(mem.permissions)
    if data.permissions is not None:
        permissions.update({k: v for k, v in data.permissions.items() if k in ("createExams", "scan", "reports")})
    if data.suspended is not None:
        permissions["suspended"] = data.suspended
    mem.permissions = permissions
    audit(
        db,
        school_id,
        user.id,
        "Updated member role, assignments or suspension",
        targetId=target_id,
        **data.model_dump(exclude_none=True),
    )
    db.commit()
    return {"ok": True}


@router.delete("/schools/{school_id}/users/{target_id}")
def remove_member(
    school_id: str, target_id: str, user: m.User = Depends(current_user), db: Session = Depends(db_session)
):
    membership(db, user, school_id, "admin")
    target = db.get(m.User, target_id)
    mem = db.get(m.Membership, (target_id, school_id))
    if not mem:
        raise HTTPException(404, "Membership not found.")
    if target_id == user.id or (target.super_admin and not user.super_admin):
        raise HTTPException(403, "You cannot remove your own access or another super administrator's access.")
    if (
        mem.role == "admin"
        and db.scalar(
            select(func.count())
            .select_from(m.Membership)
            .where(m.Membership.school_id == school_id, m.Membership.role == "admin")
        )
        <= 1
    ):
        raise HTTPException(400, "Retain at least one administrator.")
    db.delete(mem)
    audit(db, school_id, user.id, "Removed school membership", targetId=target_id)
    db.commit()
    return {"ok": True}


@router.post("/schools/{school_id}/users/{target_id}/password")
def reset_member_password(
    school_id: str,
    target_id: str,
    data: PasswordChange,
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    membership(db, user, school_id, "admin")
    throttle(db, f"admin-reset:{user.id}", 6)
    if not verify_password(data.currentPassword, user.password_hash):
        raise HTTPException(403, "Your administrator password is incorrect.")
    target = db.get(m.User, target_id)
    if not db.get(m.Membership, (target_id, school_id)):
        raise HTTPException(404, "Member not found.")
    count = db.scalar(select(func.count()).select_from(m.Membership).where(m.Membership.user_id == target_id))
    if target.super_admin or count != 1:
        raise HTTPException(
            403,
            "Multi-school accounts and super administrators must use their own recovery flow or trusted-server recovery.",
        )
    target.password_hash = hash_password(data.password)
    db.execute(delete(m.Session).where(m.Session.user_id == target_id))
    db.execute(delete(m.PasswordReset).where(m.PasswordReset.user_id == target_id))
    audit(db, school_id, user.id, "Reset a member password; sessions revoked", targetId=target_id)
    db.commit()
    return {"ok": True}


@router.get("/schools/{school_id}/audit")
def events(
    school_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    membership(db, user, school_id, "admin")
    rows = db.execute(
        select(m.Audit, m.User.name)
        .outerjoin(m.User)
        .where(m.Audit.school_id == school_id)
        .order_by(m.Audit.created_at.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    count = db.scalar(select(func.count()).select_from(m.Audit).where(m.Audit.school_id == school_id))
    return {
        "events": [
            {
                "id": a.id,
                "action": a.action,
                "createdAt": a.created_at.isoformat() + "Z",
                "user": name,
                "details": a.details,
            }
            for a, name in rows
        ],
        "total": count,
    }


@router.get("/schools/{school_id}/backups")
def list_backups(school_id: str, user: m.User = Depends(current_user), db: Session = Depends(db_session)):
    membership(db, user, school_id, "admin")
    rows = db.scalars(
        select(m.RecoveryPoint)
        .where(m.RecoveryPoint.school_id == school_id)
        .order_by(m.RecoveryPoint.created_at.desc())
        .limit(200)
    )
    return {"backups": [backup_info(b) for b in rows]}


class BackupName(BaseModel):
    name: str = Field(default="Manual recovery point", max_length=120)


@router.post("/schools/{school_id}/backups", status_code=201)
def add_backup(
    school_id: str,
    data: BackupName,
    request: Request,
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    membership(db, user, school_id, "admin")
    throttle(db, f"backup:{user.id}", 20)
    b = snapshot(db, request, school_id, data.name, False)
    audit(db, school_id, user.id, "Created encrypted recovery point", backupId=b.id)
    db.commit()
    return {"backup": backup_info(b)}


@router.get("/schools/{school_id}/backups/{backup_id}")
def download_backup(
    school_id: str,
    backup_id: str,
    request: Request,
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    membership(db, user, school_id, "admin")
    b = db.get(m.RecoveryPoint, backup_id)
    if not b or b.school_id != school_id:
        raise HTTPException(404, "Recovery point not found.")
    data = request.app.state.store.get(b.key, decrypt=True)
    audit(db, school_id, user.id, "Downloaded recovery point", backupId=b.id)
    db.commit()
    return Response(
        data, media_type="application/json", headers={"Content-Disposition": 'attachment; filename="omr-backup.json"'}
    )


class RestoreInput(BaseModel):
    password: str = Field(max_length=128)
    revision: int | None = Field(default=None, ge=1)


@router.post("/schools/{school_id}/backups/{backup_id}/restore")
def restore_backup(
    school_id: str,
    backup_id: str,
    data: RestoreInput,
    request: Request,
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    membership(db, user, school_id, "admin")
    throttle(db, f"restore:{user.id}", 6)
    if not verify_password(data.password, user.password_hash):
        raise HTTPException(403, "Your current password is required to restore a recovery point.")
    if data.revision is None:
        raise HTTPException(400, "Reload before restoring and send the current workspace revision.")
    revision = advance_revision(db, school_id, data.revision)
    b = db.get(m.RecoveryPoint, backup_id)
    if not b or b.school_id != school_id:
        raise HTTPException(404, "Recovery point not found.")
    workspace = Workspace.model_validate_json(request.app.state.store.get(b.key, decrypt=True))
    if workspace.activeSchoolId != school_id:
        raise HTTPException(403, "Recovery point belongs to another institution.")
    snapshot(db, request, school_id, "Before restore", False)
    restored = workspace.model_dump(mode="json", by_alias=True, exclude_none=True)
    if "institutionSettings" in restored:
        from .records import InstitutionSettings

        preferences = InstitutionSettings.model_validate(dict(restored["institutionSettings"], revision=revision))
        db.get(m.School, school_id).settings = preferences.model_dump(exclude={"revision"})
    persist_workspace(db, school_id, restored, user.id)
    audit(db, school_id, user.id, "Restored encrypted recovery point", backupId=backup_id, revision=revision)
    db.commit()
    return {"ok": True, "revision": revision}
