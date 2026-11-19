import copy
import io

from openpyxl import load_workbook
from sqlalchemy import func, select

from backend import models as m
from backend.tests.conftest import PASSWORD, get_workspace, login_as, new_member, save_workspace


def test_atomic_revision_idempotency_and_conflict(client, populated, app):
    sid = populated["school"]
    body = get_workspace(client, sid)
    body["workspace"]["exams"][0]["title"] = "Renamed examination"
    first = save_workspace(client, sid, body, "same-operation-123")
    assert first.status_code == 200, first.text
    second = save_workspace(client, sid, body, "same-operation-123")
    assert second.status_code == 200 and second.json()["replayed"]
    assert second.json()["revision"] == first.json()["revision"]
    assert save_workspace(client, sid, body, "another-operation-123").status_code == 409
    body["workspace"]["exams"][0]["title"] = "Different payload"
    assert save_workspace(client, sid, body, "same-operation-123").status_code == 409
    assert get_workspace(client, sid)["workspace"]["exams"][0]["title"] == "Renamed examination"
    with app.state.sessions() as db:
        assert (
            db.scalar(select(func.count()).select_from(m.Operation).where(m.Operation.id == "same-operation-123")) == 1
        )


def test_duplicate_result_roll_and_references_rejected_without_partial_save(client, populated):
    sid = populated["school"]
    body = get_workspace(client, sid)
    original = copy.deepcopy(body)
    body["workspace"]["results"].append(dict(body["workspace"]["results"][0], id="duplicate-result"))
    assert save_workspace(client, sid, body).status_code == 422
    body = copy.deepcopy(original)
    body["workspace"]["students"][1]["roll"] = body["workspace"]["students"][0]["roll"]
    assert save_workspace(client, sid, body).status_code == 422
    body = copy.deepcopy(original)
    body["workspace"]["results"][0]["roll"] = "WRONG"
    assert save_workspace(client, sid, body).status_code == 400
    body = copy.deepcopy(original)
    body["workspace"]["exams"][0]["classIds"] = ["class-other-school"]
    assert save_workspace(client, sid, body).status_code == 400
    assert get_workspace(client, sid) == original


def test_teacher_cannot_read_or_overwrite_other_classes(client, populated):
    sid = populated["school"]
    full = get_workspace(client, sid)["workspace"]
    new_member(
        client,
        sid,
        "teacher@school.edu",
        classIds=["class-a"],
        permissions={"createExams": True, "scan": True, "reports": True},
    )
    login_as(client, "teacher@school.edu")
    data = get_workspace(client, sid)
    assert len(data["workspace"]["students"]) == 2
    assert len(data["workspace"]["exams"]) == 1
    assert client.get(f"/api/schools/{sid}/students/student-3").status_code == 403
    assert client.get(f"/api/schools/{sid}/exams/exam-b/analytics").status_code == 403
    data["workspace"]["students"][0]["name"] = "Authorized edit"
    assert save_workspace(client, sid, data).status_code == 200
    forbidden = get_workspace(client, sid)
    forbidden["workspace"]["students"].append(full["students"][2])
    forbidden["workspace"]["classes"].append(full["classes"][1])
    assert save_workspace(client, sid, forbidden).status_code == 403
    forbidden = get_workspace(client, sid)
    forbidden["workspace"]["school"] = "Unauthorized rename"
    assert save_workspace(client, sid, forbidden).status_code == 403
    login_as(client, "admin@school.edu")
    all_data = get_workspace(client, sid)["workspace"]
    assert len(all_data["students"]) == 4 and len(all_data["results"]) == 4
    assert next(s for s in all_data["students"] if s["id"] == "student-3") == full["students"][2]


def test_teacher_permissions_are_enforced_not_just_ui(client, populated):
    sid = populated["school"]
    new_member(
        client,
        sid,
        "teacher@school.edu",
        classIds=["class-a"],
        permissions={"createExams": False, "scan": False, "reports": False},
    )
    login_as(client, "teacher@school.edu")
    body = get_workspace(client, sid)
    body["workspace"]["exams"][0]["title"] = "Forbidden"
    assert save_workspace(client, sid, body).status_code == 403
    assert client.get(f"/api/schools/{sid}/exams/{populated['exam']}/analytics").status_code == 403
    assert client.post(f"/api/schools/{sid}/batches", json={"examId": populated["exam"]}).status_code == 403


def test_student_privacy_publication_and_reports(client, populated):
    sid, eid = populated["school"], populated["exam"]
    new_member(client, sid, "student@school.edu", role="student", studentId="student-1")
    login_as(client, "student@school.edu")
    assert client.get(f"/api/schools/{sid}/workspace").status_code == 403
    assert client.get(f"/api/schools/{sid}/students").status_code == 403
    assert client.get(f"/api/schools/{sid}/students/student-2").status_code == 403
    assert client.get(f"/api/schools/{sid}/portal").json()["results"] == []
    url = f"/api/schools/{sid}/reports/student?examId={eid}&resultId=result-1&format=pdf"
    assert client.get(url).status_code == 403
    login_as(client, "admin@school.edu")
    body = get_workspace(client, sid)
    next(e for e in body["workspace"]["exams"] if e["id"] == eid)["resultsPublished"] = True
    assert save_workspace(client, sid, body).status_code == 200
    login_as(client, "student@school.edu")
    portal = client.get(f"/api/schools/{sid}/portal")
    assert portal.status_code == 200
    assert len(portal.json()["results"]) == 1
    assert "Learner 2" not in portal.text and "student-2" not in portal.text
    assert portal.json()["results"][0]["rank"] == 1
    pdf = client.get(url)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert client.get(url.replace("result-1", "result-2")).status_code == 403
    assert client.get(f"/api/schools/{sid}/reports/merit?examId={eid}").status_code == 403


def test_key_versions_audit_and_real_reports(client, populated, app):
    sid, eid = populated["school"], populated["exam"]
    with app.state.sessions() as db:
        before = db.scalar(select(func.count()).select_from(m.Evaluation))
    body = get_workspace(client, sid)
    exam = next(e for e in body["workspace"]["exams"] if e["id"] == eid)
    previous_version = exam["keyVersion"]
    exam["answers"][0] = "B"
    assert save_workspace(client, sid, body).status_code == 200
    history = client.get(f"/api/schools/{sid}/results/result-1/history").json()["evaluations"]
    assert len(history) == 2 and history[0]["keyVersion"] == previous_version + 1
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(m.Evaluation)) == before + 2
    for kind in ["merit", "questions", "subjects", "errors", "performance", "student"]:
        url = f"/api/schools/{sid}/reports/{kind}?examId={eid}&resultId=result-1"
        assert client.get(url + "&format=pdf").content.startswith(b"%PDF")
        xlsx = client.get(url + "&format=xlsx")
        assert xlsx.status_code == 200
        book = load_workbook(io.BytesIO(xlsx.content))
        assert book.active.max_row >= 1
        assert client.get(url + "&format=csv").content.startswith(b"\xef\xbb\xbf")
    metrics = client.get(f"/api/schools/{sid}/dashboard").json()["metrics"]
    assert len(metrics) == 15 and metrics["students"] == 4 and metrics["submitted"] == 4


def test_encrypted_backups_restore_and_pre_restore_safety(client, populated, app):
    sid = populated["school"]
    response = client.post(f"/api/schools/{sid}/backups", json={"name": "Before changes"})
    assert response.status_code == 201, response.text
    bid = response.json()["backup"]["id"]
    with app.state.sessions() as db:
        b = db.get(m.RecoveryPoint, bid)
        raw = app.state.store.get(b.key)
        assert b"QA Academy" not in raw and raw.startswith(b"gAAAA")
    body = get_workspace(client, sid)
    original_name = body["workspace"]["students"][0]["name"]
    body["workspace"]["students"][0]["name"] = "Changed"
    assert save_workspace(client, sid, body).status_code == 200
    revision = get_workspace(client, sid)["revision"]
    path = f"/api/schools/{sid}/backups/{bid}/restore"
    assert client.post(path, json={"password": PASSWORD, "revision": revision - 1}).status_code == 409
    assert client.post(path, json={"password": "wrong", "revision": revision}).status_code == 403
    assert client.post(path, json={"password": PASSWORD, "revision": revision}).status_code == 200
    assert get_workspace(client, sid)["workspace"]["students"][0]["name"] == original_name
    assert any(b["name"] == "Before restore" for b in client.get(f"/api/schools/{sid}/backups").json()["backups"])
