from __future__ import annotations

import copy
import os
import uuid
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app

PASSWORD = "correct-horse-battery-2026"
DB_KINDS = ["sqlite", "postgresql"] if os.getenv("OMR_TEST_POSTGRES_URL") else ["sqlite"]


@pytest.fixture(params=DB_KINDS)
def app(tmp_path, request):
    url = ""
    cleanup = None
    if request.param == "postgresql":
        import psycopg

        uri = os.environ["OMR_TEST_POSTGRES_URL"]
        schema = "test_" + uuid.uuid4().hex
        connection = psycopg.connect(uri, autocommit=True)
        connection.execute(f'CREATE SCHEMA "{schema}"')
        parsed = urlsplit(uri)
        query = dict(parse_qsl(parsed.query))
        query["options"] = f"-c search_path={schema}"
        url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), ""))

        def cleanup():
            connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
            connection.close()

    application = create_app(
        Settings(data_dir=tmp_path, database_url=url, testing=True, static_dir=Path(".cache/no-static"))
    )
    yield application
    application.state.engine.dispose()
    if cleanup:
        cleanup()


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        c.headers["X-Markly-Request"] = "1"
        yield c


@pytest.fixture
def school(client):
    r = client.post(
        "/api/setup",
        json={
            "email": "admin@school.edu",
            "password": PASSWORD,
            "name": "School Admin",
            "school": {"name": "QA Academy", "code": "QA"},
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["user"]["memberships"][0]["schoolId"]


def get_workspace(client, school):
    r = client.get(f"/api/schools/{school}/workspace")
    assert r.status_code == 200, r.text
    return r.json()


def save_workspace(client, school, body, operation=None):
    body = copy.deepcopy(body)
    body["operationId"] = operation or str(uuid.uuid4())
    return client.put(f"/api/schools/{school}/workspace", json=body)


@pytest.fixture
def populated(client, school):
    body = get_workspace(client, school)
    w = body["workspace"]
    w["classes"] = [
        {"id": "class-a", "schoolId": school, "name": "10 A", "academicYear": "2026–27"},
        {"id": "class-b", "schoolId": school, "name": "10 B", "academicYear": "2026–27"},
    ]
    w["students"] = [
        {
            "id": f"student-{i}",
            "schoolId": school,
            "name": f"Learner {i}",
            "roll": str(100 + i),
            "section": "10 A" if i < 3 else "10 B",
            "classId": "class-a" if i < 3 else "class-b",
            "registeredAt": "2026-11-17T10:00:00Z",
        }
        for i in range(1, 5)
    ]
    e = w["exams"][0]
    e.update(
        {
            "questions": 5,
            "answers": ["A", "B", "C", "D", "E"],
            "optionCount": 5,
            "published": True,
            "resultsPublished": False,
            "marksCorrect": 2,
            "negativeMarks": 0.5,
            "classIds": ["class-a"],
            "subjects": [{"name": "Physics", "from": 1, "to": 3}, {"name": "Math", "from": 4, "to": 5}],
        }
    )
    e2 = dict(e, id="exam-b", title="B assessment", classIds=["class-b"])
    w["exams"].append(e2)
    w["results"] = [
        {
            "id": f"result-{i}",
            "studentId": f"student-{i}",
            "examId": e["id"] if i < 3 else "exam-b",
            "name": f"Learner {i}",
            "roll": str(100 + i),
            "section": "10 A" if i < 3 else "10 B",
            "answers": ["A", "B", "C", "D", "E"] if i % 2 else ["B", "B", None, "D", "E"],
            "flagged": [],
            "confirmed": False,
            "source": "scan",
            "createdAt": "2026-11-17T10:00:00Z",
        }
        for i in range(1, 5)
    ]
    r = save_workspace(client, school, body)
    assert r.status_code == 200, r.text
    return {"school": school, "exam": e["id"], "workspace": get_workspace(client, school)}


def new_member(client, school, email, role="teacher", **kwargs):
    r = client.post(
        f"/api/schools/{school}/users",
        json={"name": email.split("@")[0], "email": email, "password": PASSWORD, "role": role, **kwargs},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def login_as(client, email):
    client.cookies.clear()
    r = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["user"]
