"""Durable-worker races: real CV with deliberately delayed execution, not fake answers."""

import copy
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event, Lock

import pytest
from sqlalchemy import select

from backend import models as m
from backend.routes import scans
from backend.tests.conftest import get_workspace, login_as, new_member
from backend.tests.test_omr import png, sheet_image
from backend.tests.test_scans import make_batch, upload


@pytest.fixture
def delayed_first_scan(monkeypatch):
    entered, release, mutex = Event(), Event(), Lock()
    original, calls = scans.scan_image, 0

    def delayed(*args, **kwargs):
        nonlocal calls
        with mutex:
            calls += 1
            first = calls == 1
        if first:
            entered.set()
            if not release.wait(20):
                raise RuntimeError("QA did not release the delayed real scan.")
        return original(*args, **kwargs)

    monkeypatch.setattr(scans, "scan_image", delayed)
    with ThreadPoolExecutor(max_workers=1) as pool:
        try:
            yield pool, entered, release
        finally:
            release.set()


def queue_page(client, populated, image=None):
    school, exam = populated["school"], populated["exam"]
    if image is None:
        image = png(sheet_image(populated["workspace"]["workspace"]["exams"][0], [["A"]] * 5, qr=False))
    batch = make_batch(client, school, exam)
    response = upload(client, school, batch, image)
    assert response.status_code == 201, response.text
    return school, batch, response.json()["jobId"]


def test_expired_worker_cannot_overwrite_a_newer_applied_scan(client, app, populated, delayed_first_scan):
    school, batch, identifier = queue_page(client, populated)
    pool, entered, release = delayed_first_scan
    first = pool.submit(scans.process_one, app)
    assert entered.wait(10), "The first worker did not begin real image processing."
    with app.state.sessions() as db:
        job = db.get(m.ScanJob, identifier)
        assert job.status == "processing" and job.attempt == 1
        job.claimed_at = m.now() - timedelta(minutes=16)
        db.commit()
    assert scans.process_one(app)  # A separate worker reclaims the expired lease.
    body = {
        "studentId": "student-1",
        "identityVerified": True,
        "replacePage": True,
        "revision": get_workspace(client, school)["revision"],
        "operationId": str(uuid.uuid4()),
    }
    response = client.post(f"/api/schools/{school}/batches/{batch}/jobs/{identifier}/apply", json=body)
    assert response.status_code == 200, response.text
    with app.state.sessions() as db:
        newer_output = copy.deepcopy(db.get(m.ScanJob, identifier).output)
    release.set()
    assert first.result(timeout=15)
    with app.state.sessions() as db:
        job = db.get(m.ScanJob, identifier)
        assert job.status == "applied", "A stale worker overwrote a newer application."
        assert job.output == newer_output
        assert job.attempt == 2 and job.claimed_at is None
        completions = db.scalars(
            select(m.Audit).where(m.Audit.school_id == school, m.Audit.action == "Completed batch image scan")
        ).all()
        assert len(completions) == 1, "An expired worker must not emit a misleading completion event."


@pytest.mark.parametrize("patch", [{"suspended": True}, {"permissions": {"scan": False}}, {"classIds": []}])
def test_worker_rechecks_authorization_before_committing_pixels(client, app, populated, delayed_first_scan, patch):
    school = populated["school"]
    email = "queue-teacher@school.edu"
    teacher = new_member(client, school, email, classIds=["class-a"], permissions={"scan": True})
    login_as(client, email)
    school, _, identifier = queue_page(client, populated)
    pool, entered, release = delayed_first_scan
    first = pool.submit(scans.process_one, app)
    assert entered.wait(10)
    login_as(client, "admin@school.edu")
    response = client.patch(f"/api/schools/{school}/users/{teacher}", json=patch)
    assert response.status_code == 200, response.text
    release.set()
    assert first.result(timeout=15)
    with app.state.sessions() as db:
        job = db.get(m.ScanJob, identifier)
        assert job.status == "error" and job.error_category == "authorization"
        assert job.output == {} and job.claimed_at is None
        assert not db.scalar(
            select(m.Audit.id).where(m.Audit.school_id == school, m.Audit.action == "Completed batch image scan")
        )


@pytest.mark.parametrize("claimed_at", [None, "expired"])
def test_crash_recovery_is_bounded_and_reports_exhausted_leases(client, app, populated, claimed_at):
    school, batch, identifier = queue_page(client, populated)
    with app.state.sessions() as db:
        job = db.get(m.ScanJob, identifier)
        job.status, job.attempt = "processing", 5
        job.claimed_at = m.now() - timedelta(minutes=16) if claimed_at else None
        db.commit()
    assert not scans.process_one(app)
    detail = client.get(f"/api/schools/{school}/batches/{batch}/jobs/{identifier}").json()
    assert detail["status"] == "error" and detail["category"] == "lease_exhausted"
    assert detail["attempt"] == 5 and not detail["output"]
    assert client.post(f"/api/schools/{school}/batches/{batch}/jobs/{identifier}/retry").status_code == 400


def test_lost_lease_discards_late_engine_error_too(client, app, populated, delayed_first_scan):
    import numpy as np

    from backend.omr import HEIGHT, WIDTH

    # A real blank raster will fail registration, but only after the gate opens.
    school, batch, identifier = queue_page(client, populated, png(np.full((HEIGHT, WIDTH, 3), 255, dtype=np.uint8)))
    pool, entered, release = delayed_first_scan
    first = pool.submit(scans.process_one, app)
    assert entered.wait(10)
    with app.state.sessions() as db:
        job = db.get(m.ScanJob, identifier)
        job.status = "error"
        job.error, job.error_category = "A newer operation owns this result.", "newer-decision"
        job.claimed_at = None
        db.commit()
    release.set()
    assert first.result(timeout=15)
    detail = client.get(f"/api/schools/{school}/batches/{batch}/jobs/{identifier}").json()
    assert detail["status"] == "error" and detail["category"] == "newer-decision"
    assert detail["error"] == "A newer operation owns this result."
