"""Positive real-OpenCV jobs, evidence ownership, leases and revision/idempotency regressions."""

import copy
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from sqlalchemy import select

from backend import models as m
from backend.routes.scans import process_one
from backend.tests.conftest import get_workspace, login_as, new_member, save_workspace
from backend.tests.test_omr import png, sheet_image


def make_batch(client, school, exam):
    response = client.post(f"/api/schools/{school}/batches", json={"examId": exam, "name": "Real optical QA"})
    assert response.status_code == 201, response.text
    return response.json()["batch"]["id"]


def upload(client, school, batch, image, operation=None):
    return client.post(
        f"/api/schools/{school}/batches/{batch}/pages",
        files={"file": ("sheet.png", image, "image/png")},
        data={"operationId": operation or str(uuid.uuid4()), "ocr": "false", "pageIndex": "0"},
    )


def test_real_batch_apply_requires_identity_replacement_revision_and_receipt(client, app, populated):
    school, exam = populated["school"], populated["exam"]
    exam_data = populated["workspace"]["workspace"]["exams"][0]
    marks = [["A", "B"], ["B"], ["C"], ["D"], ["E"]]
    image = png(sheet_image(exam_data, marks, qr=False))
    batch = make_batch(client, school, exam)
    operation = str(uuid.uuid4())
    queued = upload(client, school, batch, image, operation)
    assert queued.status_code == 201, queued.text
    job = queued.json()["jobId"]
    assert upload(client, school, batch, image, operation).json()["replayed"]
    assert upload(client, school, batch, image).status_code == 409
    assert client.post(f"/api/schools/{school}/batches/{batch}/jobs/{job}/retry").status_code == 409
    assert process_one(app)
    assert not process_one(app)
    detail = client.get(f"/api/schools/{school}/batches/{batch}/jobs/{job}").json()
    assert detail["status"] == "done" and detail["attempt"] == 1
    assert detail["output"]["detectedOptions"][0] == ["A", "B"]
    assert 0 in detail["output"]["flagged"]
    object_id = detail["objectId"]
    response = client.get(f"/api/schools/{school}/objects/{object_id}")
    assert response.content == image and "no-store" in response.headers["Cache-Control"]
    with app.state.sessions() as db:
        obj = db.get(m.StoredObject, object_id)
        assert app.state.store.get(obj.key) != image  # bytes on disk are encrypted, not disguised originals
    prefix = f"/api/schools/{school}/batches/{batch}/jobs/{job}/apply"
    revision = get_workspace(client, school)["revision"]
    body = {
        "studentId": "student-1",
        "identityVerified": False,
        "replacePage": True,
        "revision": revision,
        "operationId": str(uuid.uuid4()),
    }
    assert client.post(prefix, json=body).status_code == 400
    body["identityVerified"] = True
    body["replacePage"] = False
    assert client.post(prefix, json=body).status_code == 409
    body["replacePage"] = True
    body["revision"] += 10
    assert client.post(prefix, json=body).status_code == 409
    body["revision"] = revision
    applied = client.post(prefix, json=body)
    assert applied.status_code == 200, applied.text
    assert client.post(prefix, json=body).json()["replayed"]
    assert client.post(prefix, json=dict(body, studentId="student-2")).status_code == 409
    saved = get_workspace(client, school)
    assert saved["revision"] == revision + 1
    row = next(r for r in saved["workspace"]["results"] if r["id"] == applied.json()["resultId"])
    assert row["scanIds"] == [object_id] and row["sourceTransforms"][0]["objectId"] == object_id
    assert row["flagged"] == [0] and not row["confirmed"]
    assert row["answerMeta"][0]["status"] == "multiple" and not row["answerMeta"][0]["verified"]
    assert client.get(f"/api/schools/{school}/batches/{batch}").json()["summary"] == {"applied": 1}
    # A scalar edit without updating evidence is rejected, rather than silently ignored in scoring.
    invalid = copy.deepcopy(saved)
    invalid["workspace"]["results"][0]["answers"][0] = "A"
    assert save_workspace(client, school, invalid).status_code == 422
    # A real explicit human correction updates both representations and verification.
    row["answers"][0], row["detectedOptions"][0] = "A", ["A"]
    row["answerMeta"][0].update(selected=["A"], verified=True, status="manual")
    row["flagged"], row["confirmed"] = [], True
    assert save_workspace(client, school, saved).status_code == 200
    history = client.get(f"/api/schools/{school}/results/{row['id']}/history").json()["evaluations"]
    assert len(history) >= 3 and history[0]["outcome"]["correct"] == 5


def test_worker_categorizes_failures_retry_and_reclaims_expired_lease(client, app, populated):
    import numpy as np

    from backend.omr import HEIGHT, WIDTH

    school, exam = populated["school"], populated["exam"]
    batch = make_batch(client, school, exam)
    image = png(np.full((HEIGHT, WIDTH, 3), 255, dtype=np.uint8))
    job = upload(client, school, batch, image).json()["jobId"]
    assert process_one(app)
    detail = client.get(f"/api/schools/{school}/batches/{batch}/jobs/{job}").json()
    assert detail["status"] == "error" and detail["category"] in ("registration", "readability", "layout")
    assert client.post(f"/api/schools/{school}/batches/{batch}/jobs/{job}/retry").status_code == 200
    with app.state.sessions() as db:
        record = db.get(m.ScanJob, job)
        record.status, record.claimed_at = "processing", m.now() - timedelta(minutes=16)
        db.commit()
    assert process_one(app)
    detail = client.get(f"/api/schools/{school}/batches/{batch}/jobs/{job}").json()
    assert detail["status"] == "error" and detail["attempt"] == 2


def test_native_original_upload_idempotency_and_teacher_student_privacy(client, app, populated):
    school, exam = populated["school"], populated["exam"]
    image = png(sheet_image(populated["workspace"]["workspace"]["exams"][0], [["A"]] * 5, qr=False))
    operation = str(uuid.uuid4())
    path = f"/api/schools/{school}/exams/{exam}/objects"
    arguments = {"files": {"file": ("original.png", image, "image/png")}, "data": {"operationId": operation}}
    response = client.post(path, **arguments)
    assert response.status_code == 201, response.text
    identifier = response.json()["objectId"]
    assert client.post(path, **arguments).json()["objectId"] == identifier
    new_member(client, school, "other@school.edu", classIds=["class-a"])
    new_member(client, school, "learner@school.edu", role="student", studentId="student-1")
    batch = make_batch(client, school, exam)
    login_as(client, "other@school.edu")
    assert client.get(f"/api/schools/{school}/objects/{identifier}").status_code == 403
    assert client.get(f"/api/schools/{school}/batches/{batch}").status_code == 403
    body = get_workspace(client, school)
    body["workspace"]["results"][0]["scanIds"] = [identifier]
    assert save_workspace(client, school, body).status_code == 403
    login_as(client, "learner@school.edu")
    assert client.get(f"/api/schools/{school}/objects/{identifier}").status_code == 403
    assert client.get(f"/api/schools/{school}/batches/{batch}").status_code == 403
    assert client.post(path, **arguments).status_code == 403


def test_two_workers_do_not_double_claim_a_real_page(client, app, populated):
    school, exam = populated["school"], populated["exam"]
    batch = make_batch(client, school, exam)
    for index in range(2):
        marks = [["A" if q != index else "B"] for q in range(5)]
        assert (
            upload(
                client,
                school,
                batch,
                png(sheet_image(populated["workspace"]["workspace"]["exams"][0], marks, qr=False)),
            ).status_code
            == 201
        )
    # PostgreSQL SKIP LOCKED is exercised concurrently; SQLite has one supported worker.
    if app.state.engine.dialect.name == "postgresql":
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert all(pool.map(lambda _: process_one(app), range(2)))
    else:
        assert process_one(app) and process_one(app)
    with app.state.sessions() as db:
        jobs = db.scalars(select(m.ScanJob).where(m.ScanJob.batch_id == batch)).all()
        assert len(jobs) == 2 and all(j.status == "done" and j.attempt == 1 for j in jobs)
