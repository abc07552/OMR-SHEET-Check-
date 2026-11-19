from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .. import models as m
from ..object_store import MAX_UPLOAD, verified_image
from ..omr import ScanError, scan_image
from ..security import allowed_exam, allowed_student, audit, current_user, db_session, fingerprint, membership
from .auth import throttle

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


def save_scan_object(db, request, school_id, user, exam_id, data, media, sha):
    identifier = m.uid()
    key = f"scans/{school_id}/{identifier}.enc"
    request.app.state.store.put(key, data, media, encrypt=True)
    obj = m.StoredObject(
        id=identifier,
        school_id=school_id,
        user_id=user.id,
        key=key,
        sha256=sha,
        media_type=media,
        size=len(data),
        purpose="scan",
        exam_id=exam_id,
    )
    db.add(obj)
    db.flush()
    return obj


@router.post("/schools/{school_id}/exams/{exam_id}/scan")
def scan(
    school_id: str,
    exam_id: str,
    request: Request,
    file: UploadFile = File(...),
    pageIndex: int = Form(default=0, ge=0, le=499),
    ocr: bool = Form(default=True),
    operationId: str = Form(min_length=8, max_length=120),
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    member = membership(db, user, school_id, "staff", "scan")
    exam = allowed_exam(db, school_id, member, exam_id, "scan")
    if not exam.payload["published"]:
        raise HTTPException(400, "Publish a complete answer key before scanning.")
    data = file.file.read(MAX_UPLOAD + 1)
    media, sha = verified_image(data)
    request_hash = fingerprint(
        {"sha": sha, "exam": exam_id, "page": pageIndex, "ocr": ocr, "version": exam.key_version}
    )
    previous = db.get(m.Operation, (school_id, operationId))
    if previous:
        if previous.user_id != user.id or previous.request_hash != request_hash:
            raise HTTPException(409, "This operation ID belongs to a different scan request.")
        return dict(previous.response, replayed=True)
    throttle(db, f"scan:{user.id}", 200)
    try:
        output = scan_image(data, exam.payload, pageIndex, ocr)
    except ScanError as exc:
        raise HTTPException(422, {"message": str(exc), "category": exc.category}) from exc
    obj = save_scan_object(db, request, school_id, user, exam_id, data, media, sha)
    output["objectId"] = obj.id
    db.add(
        m.Operation(school_id=school_id, id=operationId, user_id=user.id, request_hash=request_hash, response=output)
    )
    audit(
        db,
        school_id,
        user.id,
        "Read image with genuine Python OpenCV",
        examId=exam_id,
        objectId=obj.id,
        flagged=len(output["flagged"]),
    )
    db.commit()
    return output


@router.get("/schools/{school_id}/objects/{object_id}")
def original_image(
    school_id: str,
    object_id: str,
    request: Request,
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    mem = membership(db, user, school_id, "staff")
    obj = db.get(m.StoredObject, object_id)
    if not obj or obj.school_id != school_id:
        raise HTTPException(404, "Image not found.")
    if mem.role == "teacher":
        allowed_exam(db, school_id, mem, obj.exam_id or "")
        if obj.user_id != user.id:
            if not obj.student_key:
                raise HTTPException(
                    403, "This unmatched original image is available only to its uploader or an administrator."
                )
            allowed_student(db, school_id, mem, obj.student_key)
    content = request.app.state.store.get(obj.key, decrypt=True)
    return Response(
        content,
        media_type=obj.media_type,
        headers={"Content-Disposition": 'inline; filename="original-sheet"', "Cache-Control": "private, no-store"},
    )


class NewBatch(BaseModel):
    examId: str = Field(min_length=1, max_length=120)
    name: str = Field(default="Scan batch", min_length=1, max_length=120)


@router.post("/schools/{school_id}/batches", status_code=201)
def new_batch(school_id: str, data: NewBatch, user: m.User = Depends(current_user), db: Session = Depends(db_session)):
    mem = membership(db, user, school_id, "staff", "scan")
    exam = allowed_exam(db, school_id, mem, data.examId, "scan")
    if not exam.payload["published"]:
        raise HTTPException(400, "Save a complete answer key before starting a batch.")
    batch = m.ScanBatch(id=m.uid(), school_id=school_id, user_id=user.id, exam_id=data.examId, name=data.name)
    db.add(batch)
    audit(db, school_id, user.id, "Created durable scan batch", batchId=batch.id, examId=data.examId)
    db.commit()
    return {"batch": {"id": batch.id, "name": batch.name, "examId": batch.exam_id}}


def batch_access(db, school_id, batch_id, user):
    mem = membership(db, user, school_id, "staff", "scan")
    batch = db.get(m.ScanBatch, batch_id)
    if not batch or batch.school_id != school_id:
        raise HTTPException(404, "Batch not found.")
    if mem.role != "admin" and batch.user_id != user.id:
        raise HTTPException(403, "You can manage only your own scan batches.")
    allowed_exam(db, school_id, mem, batch.exam_id, "scan")
    return batch


@router.post("/schools/{school_id}/batches/{batch_id}/pages", status_code=201)
def add_page(
    school_id: str,
    batch_id: str,
    request: Request,
    file: UploadFile = File(...),
    operationId: str = Form(min_length=8, max_length=120),
    pageIndex: int = Form(default=0, ge=0, le=499),
    ocr: bool = Form(default=True),
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    batch = batch_access(db, school_id, batch_id, user)
    data = file.file.read(MAX_UPLOAD + 1)
    media, sha = verified_image(data)
    previous = db.scalar(select(m.ScanJob).where(m.ScanJob.operation_id == operationId))
    if previous:
        if (
            previous.batch_id != batch.id
            or previous.sha256 != sha
            or previous.settings != {"pageIndex": pageIndex, "ocr": ocr}
        ):
            raise HTTPException(409, "Operation ID already used for a different page.")
        return {"jobId": previous.id, "replayed": True}
    if db.scalar(select(m.ScanJob.id).where(m.ScanJob.batch_id == batch_id, m.ScanJob.sha256 == sha)):
        raise HTTPException(409, "This exact image is already in the batch. Retry its existing job instead.")
    if db.scalar(select(func.count()).select_from(m.ScanJob).where(m.ScanJob.batch_id == batch_id)) >= 200:
        raise HTTPException(400, "Use at most 200 pages per batch.")
    obj = save_scan_object(db, request, school_id, user, batch.exam_id, data, media, sha)
    job = m.ScanJob(
        id=m.uid(),
        batch_id=batch.id,
        object_id=obj.id,
        operation_id=operationId,
        sha256=sha,
        settings={"pageIndex": pageIndex, "ocr": ocr},
    )
    db.add(job)
    audit(db, school_id, user.id, "Queued image for batch scanning", batchId=batch.id, jobId=job.id)
    db.commit()
    return {"jobId": job.id}


@router.get("/schools/{school_id}/batches")
def list_batches(school_id: str, user: m.User = Depends(current_user), db: Session = Depends(db_session)):
    mem = membership(db, user, school_id, "staff", "scan")
    conditions = [m.ScanBatch.school_id == school_id]
    if mem.role == "teacher":
        conditions.append(m.ScanBatch.user_id == user.id)
    rows = db.scalars(select(m.ScanBatch).where(*conditions).order_by(m.ScanBatch.created_at.desc()).limit(100))
    return {
        "batches": [
            {"id": b.id, "name": b.name, "examId": b.exam_id, "createdAt": b.created_at.isoformat() + "Z"} for b in rows
        ]
    }


@router.get("/schools/{school_id}/batches/{batch_id}")
def batch_status(
    school_id: str,
    batch_id: str,
    include_output: bool = True,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=200),
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    batch = batch_access(db, school_id, batch_id, user)
    rows = db.scalars(
        select(m.ScanJob)
        .where(m.ScanJob.batch_id == batch_id)
        .order_by(m.ScanJob.created_at)
        .offset(offset)
        .limit(limit)
    ).all()
    counts = dict(
        db.execute(
            select(m.ScanJob.status, func.count()).where(m.ScanJob.batch_id == batch_id).group_by(m.ScanJob.status)
        ).all()
    )
    return {
        "batch": {"id": batch.id, "name": batch.name, "examId": batch.exam_id},
        "summary": counts,
        "jobs": [
            {
                "id": j.id,
                "objectId": j.object_id,
                "status": j.status,
                "attempt": j.attempt,
                "error": j.error,
                "category": j.error_category,
                "output": j.output if include_output else {},
            }
            for j in rows
        ],
    }


@router.post("/schools/{school_id}/batches/{batch_id}/jobs/{job_id}/retry")
def retry_job(
    school_id: str, batch_id: str, job_id: str, user: m.User = Depends(current_user), db: Session = Depends(db_session)
):
    batch_access(db, school_id, batch_id, user)
    job = db.get(m.ScanJob, job_id)
    if not job or job.batch_id != batch_id:
        raise HTTPException(404, "Scan job not found.")
    if job.status != "error":
        raise HTTPException(409, "Only failed jobs can be retried.")
    if job.attempt >= 5:
        raise HTTPException(400, "This image has failed five times. Replace it with a clearer image.")
    job.status, job.error, job.error_category, job.claimed_at = "queued", "", "", None
    audit(db, school_id, user.id, "Retried scan job", jobId=job_id)
    db.commit()
    return {"ok": True}


def process_one(app):
    job_id = None
    with app.state.sessions() as db:
        cutoff = m.now() - timedelta(minutes=15)
        db.execute(
            update(m.ScanJob)
            .where(m.ScanJob.status == "processing", m.ScanJob.claimed_at < cutoff)
            .values(status="queued", claimed_at=None)
        )
        job = db.scalar(
            select(m.ScanJob)
            .where(m.ScanJob.status == "queued")
            .order_by(m.ScanJob.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not job:
            db.commit()
            return False
        claim = db.execute(
            update(m.ScanJob)
            .where(m.ScanJob.id == job.id, m.ScanJob.status == "queued")
            .values(status="processing", claimed_at=m.now(), attempt=m.ScanJob.attempt + 1)
        )
        if claim.rowcount != 1:
            db.rollback()
            return True
        job_id, batch, obj = job.id, db.get(m.ScanBatch, job.batch_id), db.get(m.StoredObject, job.object_id)
        settings = dict(job.settings)
        try:
            user = db.get(m.User, batch.user_id)
            if not user or not user.active:
                raise HTTPException(403, "The batch owner's account is suspended.")
            mem = membership(db, user, batch.school_id, "staff", "scan")
            exam = allowed_exam(db, batch.school_id, mem, batch.exam_id, "scan")
            exam_payload = exam.payload
            key = obj.key
            db.commit()
            data = app.state.store.get(key, decrypt=True)
            output = scan_image(data, exam_payload, settings.get("pageIndex", 0), settings.get("ocr", True))
            output["objectId"] = obj.id
            job = db.get(m.ScanJob, job_id)
            job.status, job.output, job.error, job.error_category = "done", output, "", ""
            audit(
                db,
                batch.school_id,
                batch.user_id,
                "Completed batch image scan",
                batchId=batch.id,
                jobId=job_id,
                flagged=len(output["flagged"]),
            )
        except (ScanError, HTTPException) as exc:
            job = db.get(m.ScanJob, job_id)
            job.status = "error"
            job.error = str(exc.detail if isinstance(exc, HTTPException) else exc)[:1000]
            job.error_category = exc.category if isinstance(exc, ScanError) else "authorization"
        except Exception:
            logger.exception("Batch scan failed: %s", job_id)
            db.rollback()
            job = db.get(m.ScanJob, job_id)
            job.status, job.error, job.error_category = (
                "error",
                "The scan engine failed. Retry this page or contact your server operator with the job ID.",
                "engine",
            )
        db.commit()
    return True


async def worker_loop(app):
    while True:
        try:
            processed = await asyncio.to_thread(process_one, app)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Durable scan worker could not claim a job")
            processed = False
        await asyncio.sleep(0.15 if processed else 1)
