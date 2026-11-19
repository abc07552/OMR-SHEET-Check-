from backend.tests.conftest import get_workspace, login_as, new_member


def test_column_mapping_preview_confirmation_idempotency_and_duplicates(client, populated):
    sid = populated["school"]
    content = b"Full name,Admission,Class,Contact\r\nNew Learner,900,10 A,900000001\r\nDuplicate,101,10 A,0\r\nInvalid,,10 A,0\r\nFormula,901,10 A,=2+2\r\nAnother Learner,902,10 B,1\r\n"
    inspect = client.post(
        f"/api/schools/{sid}/imports/students/inspect", files={"file": ("students.csv", content, "text/csv")}
    )
    assert inspect.status_code == 200, inspect.text
    identifier = inspect.json()["uploadId"]
    assert inspect.json()["rowCount"] == 5
    preview = client.post(
        f"/api/schools/{sid}/imports/students/preview",
        json={
            "uploadId": identifier,
            "mapping": {"name": "Full name", "roll": "Admission", "section": "Class", "phone": "Contact"},
        },
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["validCount"] == 2 and len(preview.json()["issues"]) == 3
    assert len(get_workspace(client, sid)["workspace"]["students"]) == 4
    payload = {
        "uploadId": identifier,
        "previewHash": preview.json()["previewHash"],
        "confirmed": False,
        "operationId": "confirmed-student-import",
    }
    assert client.post(f"/api/schools/{sid}/imports/students/confirm", json=payload).status_code == 400
    payload["confirmed"] = True
    response = client.post(f"/api/schools/{sid}/imports/students/confirm", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["imported"] == 2
    assert client.post(f"/api/schools/{sid}/imports/students/confirm", json=payload).json()["replayed"]
    assert len(get_workspace(client, sid)["workspace"]["students"]) == 6


def test_import_preview_private_and_stale_revision_not_overwritten(client, populated):
    sid = populated["school"]
    new_member(client, sid, "teacher@school.edu", classIds=["class-a"])
    inspect = client.post(
        f"/api/schools/{sid}/imports/students/inspect",
        files={"file": ("students.csv", b"Name,Roll\nNew,900\n", "text/csv")},
    ).json()
    identifier = inspect["uploadId"]
    payload = {"uploadId": identifier, "mapping": {"name": "Name", "roll": "Roll"}, "classId": "class-a"}
    preview = client.post(f"/api/schools/{sid}/imports/students/preview", json=payload).json()
    login_as(client, "teacher@school.edu")
    assert client.post(f"/api/schools/{sid}/imports/students/preview", json=payload).status_code == 404
    login_as(client, "admin@school.edu")
    settings = client.get(f"/api/schools/{sid}/settings").json()
    assert (
        client.put(
            f"/api/schools/{sid}/settings", json={"revision": settings["revision"], "academicSession": "2027"}
        ).status_code
        == 200
    )
    confirm = {
        "uploadId": identifier,
        "previewHash": preview["previewHash"],
        "confirmed": True,
        "operationId": "stale-import-operation",
    }
    assert client.post(f"/api/schools/{sid}/imports/students/confirm", json=confirm).status_code == 409
    assert len(get_workspace(client, sid)["workspace"]["students"]) == 4
