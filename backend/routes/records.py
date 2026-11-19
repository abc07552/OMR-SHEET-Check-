from __future__ import annotations

import csv
import io
import json
import secrets
import zipfile
from datetime import timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from openpyxl import load_workbook
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models as m
from ..schemas import Student, Workspace
from ..scoring import analytics, evaluate
from ..security import (
    allowed_exam,
    allowed_student,
    audit,
    canonical,
    current_user,
    db_session,
    fingerprint,
    membership,
)
from ..workspaces import advance_revision, load_workspace, persist_workspace
from .auth import throttle

router = APIRouter(prefix="/api")


@router.get("/schools/{school_id}/students")
def students(
    school_id: str,
    q: str = Query(default="", max_length=120),
    class_id: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    member = membership(db, user, school_id, "staff")
    conditions = [m.Student.school_id == school_id, m.Student.deleted_at.is_(None)]
    if member.role == "teacher":
        conditions.append(m.Student.class_id.in_(member.class_ids))
    if class_id:
        conditions.append(m.Student.class_id == class_id)
    if q:
        conditions.append((m.Student.name.ilike(f"%{q}%", escape="\\")) | (m.Student.roll.ilike(f"%{q}%", escape="\\")))
    count = db.scalar(select(func.count()).select_from(m.Student).where(*conditions))
    rows = db.scalars(
        select(m.Student).where(*conditions).order_by(m.Student.name, m.Student.id).offset(offset).limit(limit)
    )
    return {"students": [s.payload for s in rows], "total": count, "offset": offset, "limit": limit}


@router.get("/schools/{school_id}/students/{student_id}")
def student(school_id: str, student_id: str, user: m.User = Depends(current_user), db: Session = Depends(db_session)):
    mem = membership(db, user, school_id)
    row = allowed_student(db, school_id, mem, student_id)
    records = db.scalars(
        select(m.ResultRecord).where(
            m.ResultRecord.school_id == school_id,
            m.ResultRecord.student_ref == student_id,
            m.ResultRecord.deleted_at.is_(None),
        )
    )
    history = []
    for r in records:
        e = db.get(m.Examination, (school_id, r.exam_id))
        if not e or e.deleted_at or (mem.role == "student" and (not e.results_published or r.needs_review)):
            continue
        if mem.role == "teacher":
            try:
                allowed_exam(db, school_id, mem, e.id)
            except HTTPException:
                continue
        history.append(
            {
                "result": r.payload,
                "exam": {"id": e.id, "title": e.title, "subject": e.subject, "date": e.date},
                "evaluation": evaluate(r.payload, e.payload),
            }
        )
    return {"student": row.payload, "history": history}


@router.get("/schools/{school_id}/exams/{exam_id}/analytics")
def exam_analytics(
    school_id: str, exam_id: str, user: m.User = Depends(current_user), db: Session = Depends(db_session)
):
    mem = membership(db, user, school_id, "staff", "reports")
    e = allowed_exam(db, school_id, mem, exam_id)
    w = load_workspace(db, school_id, mem)
    return analytics([r for r in w["results"] if r["examId"] == exam_id], e.payload)


@router.get("/schools/{school_id}/results/{result_id}/history")
def evaluation_history(
    school_id: str, result_id: str, user: m.User = Depends(current_user), db: Session = Depends(db_session)
):
    mem = membership(db, user, school_id)
    r = db.get(m.ResultRecord, (school_id, result_id))
    if not r or r.deleted_at:
        raise HTTPException(404, "Result not found.")
    if mem.role == "student":
        allowed_student(db, school_id, mem, r.student_ref or "")
        e = db.get(m.Examination, (school_id, r.exam_id))
        if not e or not e.results_published or r.needs_review:
            raise HTTPException(403, "This result has not been published.")
        # Historical pre-publication results and keys are staff-only.
        return {"evaluations": [{"keyVersion": e.key_version, "outcome": evaluate(r.payload, e.payload)}]}
    allowed_exam(db, school_id, mem, r.exam_id)
    if mem.role == "teacher":
        allowed_student(db, school_id, mem, r.student_ref or "")
    rows = db.scalars(
        select(m.Evaluation)
        .where(m.Evaluation.school_id == school_id, m.Evaluation.result_id == result_id)
        .order_by(m.Evaluation.created_at.desc())
        .limit(100)
    )
    return {
        "evaluations": [
            {
                "id": row.id,
                "keyVersion": row.key_version,
                "ruleVersion": row.rule_version,
                "createdAt": row.created_at.isoformat() + "Z",
                "outcome": row.outcome,
            }
            for row in rows
        ]
    }


@router.get("/schools/{school_id}/dashboard")
def dashboard(school_id: str, user: m.User = Depends(current_user), db: Session = Depends(db_session)):
    mem = membership(db, user, school_id, "staff")
    w = load_workspace(db, school_id, mem)
    exams = {e["id"]: e for e in w["exams"]}
    evaluations = [evaluate(r, exams[r["examId"]]) for r in w["results"]]
    scored = [g for g in evaluations if not g["needsReview"]]
    scores = [g["percentage"] for g in scored]
    import statistics

    uploads = db.scalar(
        select(func.count())
        .select_from(m.StoredObject)
        .where(
            m.StoredObject.school_id == school_id,
            *([m.StoredObject.user_id == user.id] if mem.role == "teacher" else []),
        )
    )
    metrics = {
        "students": len(w["students"]),
        "classes": len(w["classes"]),
        "examinations": len(w["exams"]),
        "subjects": len({e["subject"] for e in w["exams"]}),
        "submitted": len(w["results"]),
        "evaluated": len(scored),
        "review": len(evaluations) - len(scored),
        "average": statistics.fmean(scores) if scores else 0,
        "median": statistics.median(scores) if scores else 0,
        "standardDeviation": statistics.pstdev(scores) if scores else 0,
        "highest": max(scores, default=0),
        "lowest": min(scores, default=0),
        "passRate": sum(g["status"] == "Passed" for g in scored) / len(scored) * 100 if scored else 0,
        "publishedExaminations": sum(e.get("resultsPublished", False) for e in w["exams"]),
        "originalImages": uploads,
    }
    return {"metrics": metrics, "generatedAt": m.now().isoformat() + "Z", "source": "authorized database records"}


@router.get("/schools/{school_id}/portal")
def portal(school_id: str, user: m.User = Depends(current_user), db: Session = Depends(db_session)):
    mem = membership(db, user, school_id)
    if mem.role != "student" or not mem.student_id:
        raise HTTPException(403, "This is the private student portal.")
    s = allowed_student(db, school_id, mem, mem.student_id)
    school = db.get(m.School, school_id)
    rows = db.scalars(
        select(m.ResultRecord).where(
            m.ResultRecord.school_id == school_id,
            m.ResultRecord.student_ref == s.id,
            m.ResultRecord.deleted_at.is_(None),
        )
    )
    history = []
    for r in rows:
        e = db.get(m.Examination, (school_id, r.exam_id))
        if not e or e.deleted_at or not e.results_published or r.needs_review:
            continue
        all_results = [
            row.payload
            for row in db.scalars(
                select(m.ResultRecord).where(
                    m.ResultRecord.school_id == school_id,
                    m.ResultRecord.exam_id == e.id,
                    m.ResultRecord.deleted_at.is_(None),
                )
            )
        ]
        summary = analytics(all_results, e.payload)
        personal = next((x for x in summary["rankings"] if x["id"] == r.id), {})
        history.append(
            {
                "id": r.id,
                "examId": e.id,
                "title": e.title,
                "subject": e.subject,
                "date": e.date,
                "evaluation": evaluate(r.payload, e.payload),
                "rank": personal.get("rank"),
                "percentile": personal.get("percentile"),
                "cohort": summary["evaluated"],
            }
        )
    history.sort(key=lambda h: h["date"])
    return {
        "student": s.payload,
        "school": {"name": school.name, "code": school.code, "address": school.address},
        "results": history,
        "user": {"name": user.name, "email": user.email},
    }


class ProfileInput(BaseModel):
    phone: str = Field(default="", max_length=40)
    guardian: str = Field(default="", max_length=120)


@router.patch("/schools/{school_id}/portal/profile")
def portal_profile(
    school_id: str, data: ProfileInput, user: m.User = Depends(current_user), db: Session = Depends(db_session)
):
    mem = membership(db, user, school_id)
    if mem.role != "student":
        raise HTTPException(403, "This endpoint is for a student's own profile.")
    s = allowed_student(db, school_id, mem, mem.student_id or "")
    school = db.get(m.School, school_id)
    advance_revision(db, school_id, school.revision)
    s.payload = {**s.payload, **data.model_dump()}
    audit(db, school_id, user.id, "Student updated own contact profile")
    db.commit()
    return {"student": s.payload}


@router.get("/schools/{school_id}/settings")
def read_settings(school_id: str, user: m.User = Depends(current_user), db: Session = Depends(db_session)):
    membership(db, user, school_id, "admin")
    school = db.get(m.School, school_id)
    return {"settings": school.settings, "revision": school.revision}


class InstitutionSettings(BaseModel):
    academicSession: str = Field(default="", max_length=40)
    contactEmail: str = Field(default="", max_length=200)
    contactPhone: str = Field(default="", max_length=40)
    notifications: bool = True
    defaultNegativeMarks: float = Field(default=0, ge=0, le=100)
    defaultPassPercentage: float = Field(default=40, ge=1, le=100)
    theme: str = Field(default="dark", pattern="^(dark|light|system)$")
    revision: int = Field(ge=1)


@router.put("/schools/{school_id}/settings")
def save_settings(
    school_id: str, data: InstitutionSettings, user: m.User = Depends(current_user), db: Session = Depends(db_session)
):
    membership(db, user, school_id, "admin")
    revision = advance_revision(db, school_id, data.revision)
    school = db.get(m.School, school_id)
    school.settings = data.model_dump(exclude={"revision"})
    audit(db, school_id, user.id, "Updated institution settings", revision=revision)
    db.commit()
    return {"settings": school.settings, "revision": revision}


@router.post("/schools/{school_id}/imports/students/inspect")
def inspect_import(
    school_id: str,
    file: UploadFile = File(...),
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    membership(db, user, school_id, "staff")
    throttle(db, f"import:{user.id}", 12)
    content = file.file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Student imports must be smaller than 10 MB.")
    try:
        if (file.filename or "").lower().endswith(".xlsx"):
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if sum(f.file_size for f in archive.infolist()) > 40 * 1024 * 1024 or len(archive.infolist()) > 2000:
                    raise ValueError("The workbook is too large after decompression.")
                if any("vbaProject" in name for name in archive.namelist()):
                    raise ValueError("Macros are not supported.")
            book = load_workbook(io.BytesIO(content), read_only=True, data_only=False)
            sheet = book.active
            if sheet.max_row and sheet.max_row > 20001:
                raise ValueError("Use at most 20,000 rows per import.")
            rows = []
            for i, cells in enumerate(sheet.iter_rows(max_col=40, values_only=True)):
                if i > 20000:
                    raise ValueError("Use at most 20,000 rows per import.")
                rows.append([str(c if c is not None else "")[:500] for c in cells])
            book.close()
        elif (file.filename or "").lower().endswith(".csv"):
            text = content.decode("utf-8-sig")
            try:
                dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t")
            except csv.Error:
                dialect = csv.excel
            rows = []
            for i, cells in enumerate(csv.reader(io.StringIO(text), dialect)):
                if i > 20000 or len(cells) > 40:
                    raise ValueError("Use at most 20,000 rows and 40 columns.")
                rows.append([str(c)[:500] for c in cells])
        else:
            raise ValueError("Use UTF-8 CSV or a modern .xlsx workbook.")
        if len(rows) < 2:
            raise ValueError("The file needs a header and at least one student row.")
        headers = rows.pop(0)
        while headers and not headers[-1].strip():
            headers.pop()
        if (
            not headers
            or len(set(h.strip().casefold() for h in headers)) != len(headers)
            or any(not h.strip() for h in headers)
        ):
            raise ValueError("Column headers must be non-empty and unique.")
        rows = [r[: len(headers)] for r in rows if any(c.strip() for c in r)]
    except (ValueError, UnicodeDecodeError, zipfile.BadZipFile, KeyError, OSError) as exc:
        raise HTTPException(400, f"Could not read student file: {exc}") from exc
    identifier = secrets.token_urlsafe(24)
    # Raw import data is private, temporary, bounded, and never accepted back from the browser as trusted rows.
    payload = {
        "user": user.id,
        "school": school_id,
        "expires": (m.now() + timedelta(minutes=30)).isoformat(),
        "headers": headers,
        "rows": rows,
    }
    db.add(m.SystemState(key=f"import:{identifier}", value=canonical(payload)))
    db.commit()
    return {"uploadId": identifier, "headers": headers, "sample": rows[:5], "rowCount": len(rows)}


def import_plan(db, identifier, user, school_id):
    if len(identifier) > 60:
        raise HTTPException(404, "Import preview not found.")
    row = db.get(m.SystemState, f"import:{identifier}")
    plan = json.loads(row.value) if row else None
    if not plan or plan["user"] != user.id or plan["school"] != school_id or plan["expires"] < m.now().isoformat():
        raise HTTPException(404, "Import preview expired or is not owned by this account.")
    return row, plan


class ImportMapping(BaseModel):
    uploadId: str = Field(max_length=60)
    mapping: dict[str, str]
    classId: str | None = Field(default=None, max_length=120)
    section: str = Field(default="", max_length=120)


@router.post("/schools/{school_id}/imports/students/preview")
def preview_import(
    school_id: str, data: ImportMapping, user: m.User = Depends(current_user), db: Session = Depends(db_session)
):
    mem = membership(db, user, school_id, "staff")
    row, plan = import_plan(db, data.uploadId, user, school_id)
    if not all(data.mapping.get(x) in plan["headers"] for x in ("name", "roll")):
        raise HTTPException(400, "Map the required name and roll columns.")
    classes = db.scalars(select(m.Classroom).where(m.Classroom.school_id == school_id)).all()
    class_lookup = {c.name.casefold(): c.id for c in classes}
    class_names = {c.id: c.name for c in classes}
    if data.classId and data.classId not in class_names:
        raise HTTPException(400, "Default class does not belong to this school.")
    existing = set(
        db.scalars(select(m.Student.roll_key).where(m.Student.school_id == school_id, m.Student.deleted_at.is_(None)))
    )
    valid, issues = [], []
    for i, raw in enumerate(plan["rows"], 2):
        values = {
            k: (
                raw[plan["headers"].index(v)].strip()
                if v in plan["headers"] and len(raw) > plan["headers"].index(v)
                else ""
            )
            for k, v in data.mapping.items()
            if k in ("name", "roll", "section", "email", "phone", "guardian", "batch")
        }
        section = values.get("section") or data.section or class_names.get(data.classId, "")
        class_id = class_lookup.get(section.casefold()) or data.classId
        try:
            if not class_id or (mem.role == "teacher" and class_id not in mem.class_ids):
                raise ValueError("Choose a class assigned to your account.")
            if values.get("roll", "").casefold() in existing:
                raise ValueError("Duplicate roll number in this file or the existing student register.")
            if any(v.startswith(("=", "+", "-", "@", "\t", "\r")) for v in values.values()):
                raise ValueError("Formula-like values are not allowed in an import.")
            student = Student.model_validate(
                {
                    **values,
                    "section": section,
                    "classId": class_id,
                    "schoolId": school_id,
                    "id": m.uid(),
                    "registeredAt": m.now().isoformat() + "Z",
                }
            )
            valid.append(student.model_dump(mode="json", exclude_none=True))
            existing.add(student.roll.strip().casefold())
        except (ValidationError, ValueError) as exc:
            issues.append({"row": i, "roll": values.get("roll", ""), "error": str(exc)[:500]})
    revision = db.get(m.School, school_id).revision
    plan.update(
        {
            "valid": valid,
            "issues": issues,
            "revision": revision,
            "previewHash": fingerprint({"valid": valid, "revision": revision}),
        }
    )
    row.value = canonical(plan)
    db.commit()
    return {
        "uploadId": data.uploadId,
        "students": valid[:100],
        "validCount": len(valid),
        "issues": issues,
        "previewHash": plan["previewHash"],
        "revision": revision,
    }


class ImportConfirm(BaseModel):
    uploadId: str = Field(max_length=60)
    previewHash: str = Field(min_length=64, max_length=64)
    confirmed: bool
    operationId: str = Field(min_length=8, max_length=120)


@router.post("/schools/{school_id}/imports/students/confirm")
def confirm_import(
    school_id: str, data: ImportConfirm, user: m.User = Depends(current_user), db: Session = Depends(db_session)
):
    mem = membership(db, user, school_id, "staff")
    previous = db.get(m.Operation, (school_id, data.operationId))
    request_hash = fingerprint(data.model_dump())
    if previous:
        if previous.user_id != user.id or previous.request_hash != request_hash:
            raise HTTPException(409, "Operation ID already used for another request.")
        return dict(previous.response, replayed=True)
    row, plan = import_plan(db, data.uploadId, user, school_id)
    if not data.confirmed or "valid" not in plan or data.previewHash != plan["previewHash"]:
        raise HTTPException(400, "Preview the mapped rows and explicitly confirm before importing.")
    if mem.role == "teacher" and any(s.get("classId") not in mem.class_ids for s in plan["valid"]):
        raise HTTPException(403, "Your class assignments changed. Preview the import again.")
    revision = advance_revision(db, school_id, plan["revision"])
    workspace = load_workspace(db, school_id)
    workspace["students"].extend(plan["valid"])
    persist_workspace(
        db,
        school_id,
        Workspace.model_validate(workspace).model_dump(mode="json", by_alias=True, exclude_none=True),
        user.id,
    )
    response = {"imported": len(plan["valid"]), "skipped": len(plan["issues"]), "revision": revision}
    db.add(
        m.Operation(
            school_id=school_id, id=data.operationId, user_id=user.id, request_hash=request_hash, response=response
        )
    )
    db.delete(row)
    audit(db, school_id, user.id, "Confirmed transactional student import", **response)
    db.commit()
    return response
