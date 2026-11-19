"""Real database migration/recovery drills, using synthetic school records only."""

from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import os
import sqlite3
import stat
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import func, select

from backend import models as m
from backend.cli import migrate_node, reset_password
from backend.config import Settings
from backend.omr import ANCHORS
from backend.schemas import Student
from backend.security import COOKIE, digest, verify_password
from backend.tests.conftest import PASSWORD, get_workspace
from backend.workspaces import blank_workspace


@pytest.fixture
def legacy_source(tmp_path):
    # Mirrors the preserved Node schema, not the destination SQLAlchemy tables.
    folder = tmp_path / "legacy ? school"
    folder.mkdir()
    source = folder / "markly.sqlite"
    connection = sqlite3.connect(source)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.executescript("""
        CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, password_hash TEXT, owner INTEGER, created_at TEXT);
        CREATE TABLE schools(id TEXT PRIMARY KEY, name TEXT, code TEXT, address TEXT);
        CREATE TABLE memberships(user_id TEXT, school_id TEXT, role TEXT, PRIMARY KEY(user_id, school_id));
        CREATE TABLE workspaces(school_id TEXT PRIMARY KEY, revision INTEGER, payload TEXT, updated_at TEXT);
        CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id TEXT, expires INTEGER);
        CREATE TABLE backups(id TEXT PRIMARY KEY, school_id TEXT, name TEXT, filename TEXT, created_at TEXT, automatic INTEGER);
    """)
    salt = "b1" * 16
    key = hashlib.scrypt(PASSWORD.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64)
    stored = f"{salt}:{key.hex()}"
    for identifier, role in [("legacy-admin", 1), ("legacy-teacher", 0)]:
        connection.execute(
            "INSERT INTO users VALUES (?,?,?,?,?,?)",
            (identifier, f"{identifier}@school.edu", identifier, stored, role, "2026-11-17T10:00:00Z"),
        )
    image = io.BytesIO()
    Image.new("RGB", (120, 50), "navy").save(image, format="PNG")
    logo = "data:image/png;base64," + base64.b64encode(image.getvalue()).decode()
    workspaces = {}
    for index in (1, 2):
        school = m.School(
            id=f"legacy-school-{index}", name=f"Legacy Academy {index}", code=f"LA{index}", address="Kolkata"
        )
        w = blank_workspace(school, "Legacy Educator")
        w["institutionSettings"] = {"academicSession": "2026–27", "contactEmail": "office@school.edu", "logo": logo}
        w["classes"] = [{"id": "class-10", "schoolId": school.id, "name": "10 A", "academicYear": "2026–27"}]
        w["students"] = [
            {
                "id": "same-student-id",
                "schoolId": school.id,
                "name": f"Legacy Learner {index}",
                "roll": "00101",
                "section": "10 A",
                "classId": "class-10",
                "registeredAt": "2026-11-17T10:00:00Z",
            }
        ]
        exam = w["exams"][0]
        exam.update(
            id="same-exam-id",
            questions=500,
            answers=["ABCDE"[q % 5] for q in range(500)],
            optionCount=5,
            classIds=["class-10"],
            published=True,
            layout={
                "version": 2,
                "name": "Five-page preserved template",
                "questionsPerPage": 100,
                "columns": 4,
                "startX": 156,
                "startY": 420,
                "columnGap": 275,
                "rowGap": 44,
                "optionGap": 34,
                "radius": 10,
                "labelOffset": 65,
                "bubbleShape": "circle",
                "threshold": 0.52,
                "anchorMode": "markers",
                "anchors": ANCHORS,
                "fields": [],
                "rollRegion": {"x": 710, "y": 248, "width": 295, "height": 58},
            },
        )
        w["results"] = [
            {
                "id": "same-result-id",
                "studentId": "same-student-id",
                "examId": exam["id"],
                "name": f"Legacy Learner {index}",
                "roll": "00101",
                "section": "10 A",
                "answers": list(exam["answers"]),
                "flagged": [],
                "confirmed": False,
                "source": "scan",
                "pageIndices": [0, 1, 2, 3, 4],
                "pageTotal": 5,
                "createdAt": "2026-11-17T10:00:00Z",
            }
        ]
        connection.execute(
            "INSERT INTO schools VALUES (?,?,?,?)", (school.id, school.name, school.code, school.address)
        )
        connection.execute(
            "INSERT INTO workspaces VALUES (?,?,?,?)", (school.id, 7, json.dumps(w), "2026-11-17T10:00:00Z")
        )
        connection.execute("INSERT INTO memberships VALUES (?,?,?)", ("legacy-admin", school.id, "admin"))
        connection.execute("INSERT INTO memberships VALUES (?,?,?)", ("legacy-teacher", school.id, "teacher"))
        workspaces[school.id] = w
    connection.execute(
        "INSERT INTO sessions VALUES (?,?,?)", ("old-cookie-must-not-survive", "legacy-admin", 9999999999)
    )
    connection.execute(
        "INSERT INTO backups VALUES (?,?,?,?,?,?)",
        ("old-backup", "legacy-school-1", "Historical baseline", "old.json", "2026-11-17T10:00:00Z", 0),
    )
    historical = folder / "old.json"
    historical.write_text("Historical baseline backup must be retained.")
    connection.commit()
    # Keep the source open to exercise committed data still in its WAL.
    yield source, connection, workspaces, historical
    connection.close()


def source_fingerprint(source):
    return {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in (source, Path(str(source) + "-wal"))
        if path.exists()
    }


def test_node_migration_preserves_wal_multischool_500_questions_and_upgrades_passwords(app, client, legacy_source):
    source, connection, originals, historical = legacy_source
    before = source_fingerprint(source)
    result = migrate_node(source, app.state.settings)
    assert {k: result[k] for k in ("users", "schools", "students", "examinations", "results")} == {
        "users": 2,
        "schools": 2,
        "students": 2,
        "examinations": 2,
        "results": 2,
    }
    safety = Path(result["sourceBackup"])
    assert stat.S_IMODE(safety.stat().st_mode) == 0o600
    with sqlite3.connect(safety) as copy_db:
        assert copy_db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert copy_db.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0] == 2
    assert source_fingerprint(source) == before
    assert historical.read_text() == "Historical baseline backup must be retained."
    assert connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1
    with app.state.sessions() as db:
        assert db.get(m.User, "legacy-admin").password_hash.startswith("legacy$")
        assert db.scalar(select(func.count()).select_from(m.Session)) == 0
        assert db.scalar(select(func.count()).select_from(m.RecoveryPoint)) == 0
        assert db.scalar(select(func.count()).select_from(m.AnswerDetection)) == 1000
        assert db.scalar(select(func.count()).select_from(m.TemplateVersion)) == 2
    assert client.get("/api/setup/status").json()["needsSetup"] is False
    client.cookies.set(COOKIE, "old-cookie-must-not-survive")
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.clear()
    login = client.post("/api/auth/login", json={"email": "legacy-admin@school.edu", "password": PASSWORD})
    assert login.status_code == 200, login.text
    assert len(login.json()["user"]["memberships"]) == 2
    for school, original in originals.items():
        body = get_workspace(client, school)
        assert body["revision"] == 8
        actual = body["workspace"]
        assert actual["students"] == [
            Student.model_validate(s).model_dump(mode="json", by_alias=True, exclude_none=True)
            for s in original["students"]
        ]
        assert actual["exams"][0]["answers"] == original["exams"][0]["answers"]
        assert actual["exams"][0]["layout"] == dict(original["exams"][0]["layout"], pageWidthMM=210, pageHeightMM=297)
        assert actual["results"][0]["answers"] == original["results"][0]["answers"]
        assert actual["institutionSettings"]["logo"] == original["institutionSettings"]["logo"]
        report = client.get(f"/api/schools/{school}/reports/results?examId=same-exam-id&format=csv")
        assert report.status_code == 200 and original["students"][0]["name"] in report.text
        history = client.get(f"/api/schools/{school}/results/same-result-id/history").json()["evaluations"]
        assert history[0]["outcome"]["score"] == 1000
        assert not history[0]["outcome"]["needsReview"]
    with app.state.sessions() as db:
        assert db.get(m.User, "legacy-admin").password_hash.startswith("$argon2id$")
    client.cookies.clear()
    assert (
        client.post("/api/auth/login", json={"email": "legacy-teacher@school.edu", "password": PASSWORD}).status_code
        == 200
    )
    for school in originals:
        assert get_workspace(client, school)["workspace"]["students"] == []
        assert get_workspace(client, school)["workspace"]["exams"] == []
    with pytest.raises(ValueError, match="empty enterprise"):
        migrate_node(source, app.state.settings)
    assert len(list(app.state.settings.data_dir.glob("node-before-migration-*.sqlite"))) == 1
    assert source_fingerprint(source) == before


def test_migration_invalid_second_school_rolls_back_first_and_retains_source(app, legacy_source):
    source, connection, originals, _ = legacy_source
    bad = copy.deepcopy(originals["legacy-school-2"])
    bad["students"].append(dict(bad["students"][0], id="duplicate-roll"))
    connection.execute("UPDATE workspaces SET payload=? WHERE school_id=?", (json.dumps(bad), "legacy-school-2"))
    connection.commit()
    before = source_fingerprint(source)
    with pytest.raises(ValidationError, match="Roll numbers must be unique"):
        migrate_node(source, app.state.settings)
    with app.state.sessions() as db:
        for model in (
            m.User,
            m.School,
            m.Student,
            m.Examination,
            m.ResultRecord,
            m.Evaluation,
            m.TemplateVersion,
            m.SystemState,
        ):
            assert db.scalar(select(func.count()).select_from(model)) == 0
    assert source_fingerprint(source) == before
    assert list(app.state.settings.data_dir.glob("node-before-migration-*.sqlite"))


def test_migration_same_destination_missing_source_and_cli_confirmation_do_not_touch_source(tmp_path, legacy_source):
    source, _, _, _ = legacy_source
    before = source_fingerprint(source)
    with pytest.raises(ValueError, match="different databases"):
        migrate_node(source, Settings(data_dir=tmp_path / "invalid", database_url=f"sqlite:///{source}"))
    with pytest.raises(ValueError, match="does not exist"):
        migrate_node(tmp_path / "missing.sqlite", Settings(data_dir=tmp_path / "invalid"))
    environment = dict(
        os.environ,
        DATA_DIR=str(tmp_path / "cli-no-confirm"),
        DATABASE_URL="",
        APP_ENV="development",
    )
    response = subprocess.run(
        [sys.executable, "-m", "backend.cli", "migrate-node", str(source)],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert response.returncode != 0 and "--confirm" in response.stderr
    assert not (tmp_path / "cli-no-confirm").exists()
    assert source_fingerprint(source) == before


def test_trusted_recovery_hidden_prompts_revoke_sessions_and_preserve_records(
    app, client, populated, monkeypatch, capsys
):
    original = get_workspace(client, populated["school"])
    with app.state.sessions() as db:
        user = db.scalar(select(m.User))
        old_hash = user.password_hash
        db.add(
            m.PasswordReset(
                token_hash=digest("pending-recovery-token"), user_id=user.id, expires_at=m.now() + timedelta(minutes=10)
            )
        )
        db.commit()
    answers = iter(["new-private-password-2026", "mismatch-password-2026"])
    monkeypatch.setattr("getpass.getpass", lambda prompt: next(answers))
    with pytest.raises(ValueError, match="Passwords differ"):
        reset_password("admin@school.edu", app.state.settings)
    assert client.get("/api/auth/me").status_code == 200
    with app.state.sessions() as db:
        assert db.scalar(select(m.User)).password_hash == old_hash
        assert db.scalar(select(m.PasswordReset)) is not None
        # Trusted recovery also enables an app password for a Google-only account.
        db.scalar(select(m.User)).has_password = False
        db.commit()
    new_password = "new-private-password-2026"
    prompts = []

    def hidden_prompt(prompt):
        prompts.append(prompt)
        return new_password

    monkeypatch.setattr("getpass.getpass", hidden_prompt)
    reset_password(" ADMIN@SCHOOL.EDU ", app.state.settings)
    assert len(prompts) == 2 and all("hidden" in p for p in prompts)
    output = capsys.readouterr()
    assert "sessions revoked" in output.out and new_password not in output.out + output.err
    assert client.get("/api/auth/me").status_code == 401
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(m.Session)) == 0
        assert db.scalar(select(func.count()).select_from(m.PasswordReset)) == 0
        assert verify_password(new_password, db.scalar(select(m.User)).password_hash)
        assert db.scalar(select(m.User)).has_password
    assert client.post("/api/auth/login", json={"email": "admin@school.edu", "password": PASSWORD}).status_code == 401
    assert (
        client.post("/api/auth/login", json={"email": "admin@school.edu", "password": new_password}).status_code == 200
    )
    assert get_workspace(client, populated["school"]) == original
    with pytest.raises(ValueError, match="No matching account"):
        reset_password("absent@school.edu", app.state.settings)
    assert len(prompts) == 2
