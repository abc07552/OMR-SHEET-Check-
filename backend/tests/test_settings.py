import base64
import copy
import io

from PIL import Image

from backend.tests.conftest import PASSWORD, get_workspace, login_as, new_member, save_workspace


def preferences(client, school):
    return client.get(f"/api/schools/{school}/settings").json()


def save_preferences(client, school, **changes):
    current = preferences(client, school)
    return client.put(
        f"/api/schools/{school}/settings", json=dict(current["settings"], revision=current["revision"], **changes)
    )


def test_institution_preferences_are_validated_authorized_projected_and_restorable(client, populated):
    school, exam = populated["school"], populated["exam"]
    image = io.BytesIO()
    Image.new("RGB", (120, 50), "navy").save(image, format="PNG")
    logo = "data:image/png;base64," + base64.b64encode(image.getvalue()).decode()
    reply = save_preferences(
        client,
        school,
        logo=logo,
        contactEmail="school@example.edu",
        academicSession="2026–27",
        defaultNegativeMarks=0.25,
    )
    assert reply.status_code == 200, reply.text
    assert get_workspace(client, school)["workspace"]["institutionSettings"]["logo"] == logo
    snapshot = client.post(f"/api/schools/{school}/backups", json={"name": "Institution preferences"}).json()["backup"][
        "id"
    ]
    for invalid in ["data:image/svg+xml;base64,PHN2Zy8+", "https://example.org/logo.png", "data:image/png;base64,YmFk"]:
        assert save_preferences(client, school, logo=invalid).status_code == 422
    assert save_preferences(client, school, contactEmail="invalid").status_code == 422
    assert (
        client.put(
            f"/api/schools/{school}/settings",
            content='{"revision":1,"defaultNegativeMarks":1e309}',
            headers={"Content-Type": "application/json"},
        ).status_code
        == 422
    )
    pdf = client.get(f"/api/schools/{school}/reports/merit?examId={exam}&format=pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert save_preferences(client, school, logo="", academicSession="Changed").status_code == 200
    revision = get_workspace(client, school)["revision"]
    restored = client.post(
        f"/api/schools/{school}/backups/{snapshot}/restore", json={"password": PASSWORD, "revision": revision}
    )
    assert restored.status_code == 200, restored.text
    assert preferences(client, school)["settings"]["logo"] == logo
    assert preferences(client, school)["settings"]["academicSession"] == "2026–27"
    new_member(client, school, "teacher-settings@school.edu", classIds=["class-a"])
    login_as(client, "teacher-settings@school.edu")
    current = preferences(client, school)
    assert current["settings"]["defaultNegativeMarks"] == 0.25
    assert (
        client.put(
            f"/api/schools/{school}/settings", json=dict(current["settings"], revision=current["revision"])
        ).status_code
        == 403
    )
    body = get_workspace(client, school)
    assert save_workspace(client, school, body).status_code == 200


def test_student_exam_class_checks_rollback_the_entire_revision(client, populated):
    school = populated["school"]
    original = get_workspace(client, school)
    body = copy.deepcopy(original)
    body["workspace"]["results"][0].update(studentId="student-3", roll="103", name="Learner 3", section="10 B")
    body["workspace"]["results"][1]["name"] = "Must not be saved"
    reply = save_workspace(client, school, body)
    assert reply.status_code == 400 and "class" in reply.text
    assert get_workspace(client, school) == original


def test_report_class_filter_never_exports_the_other_cohort(client, populated):
    school, exam = populated["school"], populated["exam"]
    url = f"/api/schools/{school}/reports/results?examId={exam}&format=csv"
    assert "Learner 1" in client.get(url + "&section=10%20A").text
    empty = client.get(url + "&section=10%20B")
    assert empty.status_code == 200 and "Learner" not in empty.text
