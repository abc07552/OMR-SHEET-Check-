import copy
import uuid

from backend.tests.conftest import get_workspace, login_as, new_member, save_workspace


def test_re_evaluation_history_receipt_and_scoped_sync_journal(client, populated):
    school, exam = populated["school"], populated["exam"]
    new_member(client, school, "teacher@school.edu", classIds=["class-a"])
    new_member(client, school, "student@school.edu", role="student", studentId="student-1")
    before = client.get(f"/api/schools/{school}/results/result-1/history").json()["evaluations"]
    owner_operation = str(uuid.uuid4())
    body = {
        "revision": get_workspace(client, school)["revision"],
        "operationId": owner_operation,
        "reason": "QA deliberate re-evaluation",
    }
    path = f"/api/schools/{school}/exams/{exam}/reevaluate"
    response = client.post(path, json=body)
    assert response.status_code == 200, response.text
    assert response.json()["evaluated"] == 2
    assert client.post(path, json=body).json()["replayed"]
    assert client.post(path, json=dict(body, reason="Reused for different reason")).status_code == 409
    assert client.post(path, json=dict(body, operationId=str(uuid.uuid4()))).status_code == 409
    after = client.get(f"/api/schools/{school}/results/result-1/history").json()["evaluations"]
    assert len(after) == len(before) + 1
    login_as(client, "teacher@school.edu")
    body.update(revision=get_workspace(client, school)["revision"], operationId=str(uuid.uuid4()))
    assert client.post(path, json=body).status_code == 200
    journal = client.get(f"/api/schools/{school}/sync/log").json()["operations"]
    assert [r["id"] for r in journal] == [body["operationId"]]
    assert owner_operation not in str(journal)
    assert (
        client.post(
            f"/api/schools/{school}/exams/exam-b/reevaluate", json=dict(body, operationId=str(uuid.uuid4()))
        ).status_code
        == 403
    )
    login_as(client, "student@school.edu")
    assert client.get(f"/api/schools/{school}/sync/log").status_code == 403
    assert client.post(path, json=body).status_code == 403


def test_no_assigned_exams_is_a_valid_restricted_workspace(client, populated):
    school = populated["school"]
    new_member(client, school, "unassigned@school.edu", classIds=[])
    login_as(client, "unassigned@school.edu")
    body = get_workspace(client, school)
    assert body["workspace"]["exams"] == [] and body["workspace"]["students"] == []
    assert save_workspace(client, school, body).status_code == 200
    login_as(client, "admin@school.edu")
    assert len(get_workspace(client, school)["workspace"]["exams"]) == 2


def test_blanket_confirmation_cannot_override_unverified_measured_evidence(client, populated):
    school = populated["school"]
    body = copy.deepcopy(get_workspace(client, school))
    row = body["workspace"]["results"][0]
    row.update(
        confirmed=True,
        flagged=[],
        answerMeta=[{"question": 0, "selected": ["A"], "status": "uncertain", "verified": False, "coordinates": []}],
    )
    assert save_workspace(client, school, body).status_code == 200
    latest = client.get(f"/api/schools/{school}/results/{row['id']}/history").json()["evaluations"][0]
    assert latest["outcome"]["needsReview"]
    body = get_workspace(client, school)
    body["workspace"]["results"][0]["answerMeta"][0]["verified"] = True
    assert save_workspace(client, school, body).status_code == 200
    latest = client.get(f"/api/schools/{school}/results/{row['id']}/history").json()["evaluations"][0]
    assert not latest["outcome"]["needsReview"]
