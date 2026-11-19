from __future__ import annotations

import copy
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select, update

from . import models as m
from .schemas import Workspace
from .scoring import evaluate
from .security import audit, canonical, fingerprint


def blank_workspace(school: m.School, teacher: str):
    return Workspace.model_validate(
        {
            "version": 1,
            "school": school.name,
            "teacher": teacher,
            "schools": [{"id": school.id, "name": school.name, "code": school.code, "address": school.address}],
            "activeSchoolId": school.id,
            "classes": [],
            "students": [],
            "results": [],
            "exams": [
                {
                    "id": m.uid(),
                    "schoolId": school.id,
                    "title": "My first assessment",
                    "subject": "General",
                    "date": date.today().isoformat(),
                    "questions": 50,
                    "marksCorrect": 2,
                    "negativeMarks": 0,
                    "passPercentage": 40,
                    "answers": [None] * 50,
                    "optionCount": 5,
                    "published": False,
                }
            ],
        }
    ).model_dump(mode="json", by_alias=True, exclude_none=True)


def load_workspace(db, school_id, member=None):
    school = db.get(m.School, school_id)
    if not school:
        raise HTTPException(404, "School not found.")
    classes = [
        row.payload
        for row in db.scalars(select(m.Classroom).where(m.Classroom.school_id == school_id).order_by(m.Classroom.id))
        if not row.payload.get("archived", False)
    ]
    students = [
        row.payload
        for row in db.scalars(
            select(m.Student)
            .where(m.Student.school_id == school_id, m.Student.deleted_at.is_(None))
            .order_by(m.Student.id)
        )
    ]
    exams = [
        dict(row.payload, keyVersion=row.key_version)
        for row in db.scalars(
            select(m.Examination)
            .where(m.Examination.school_id == school_id, m.Examination.deleted_at.is_(None))
            .order_by(m.Examination.date, m.Examination.id)
        )
    ]
    results = [
        row.payload
        for row in db.scalars(
            select(m.ResultRecord)
            .where(m.ResultRecord.school_id == school_id, m.ResultRecord.deleted_at.is_(None))
            .order_by(m.ResultRecord.id)
        )
    ]
    if member and member.role == "teacher":
        classes = [c for c in classes if c["id"] in member.class_ids]
        students = [s for s in students if s.get("classId") in member.class_ids]
        ids = {s["id"] for s in students}
        exams = [e for e in exams if set(e.get("classIds", [])).intersection(member.class_ids)]
        exam_ids = {e["id"] for e in exams}
        results = [r for r in results if r["studentId"] in ids and r["examId"] in exam_ids]
    return {
        "version": 1,
        "school": school.name,
        "teacher": school.teacher,
        "schools": [{"id": school.id, "name": school.name, "code": school.code, "address": school.address}],
        "activeSchoolId": school.id,
        "classes": classes,
        "students": students,
        "exams": exams,
        "results": results,
    }


def _key_data(e):
    return {
        k: e.get(k)
        for k in (
            "answers",
            "questionSets",
            "markingRules",
            "marksCorrect",
            "negativeMarks",
            "passPercentage",
            "published",
            "questions",
            "subjects",
            "optionCount",
        )
    }


def authorize_changes(old, incoming, member):
    if member.role == "admin":
        return incoming
    if member.role != "teacher":
        raise HTTPException(403, "Students cannot modify the school workspace.")
    for key in ("school", "teacher", "schools", "activeSchoolId"):
        if canonical(old.get(key)) != canonical(incoming.get(key)):
            raise HTTPException(403, "Only administrators can change institution settings.")
    merged = copy.deepcopy(old)
    allowed_classes = set(member.class_ids)
    visible_students = {s["id"] for s in old["students"] if s.get("classId") in allowed_classes}
    visible_exams = {e["id"] for e in old["exams"] if set(e.get("classIds", [])).intersection(allowed_classes)}
    for kind in ("classes", "students", "exams", "results"):

        def visible(row):
            if kind == "classes":
                return row["id"] in allowed_classes
            if kind == "students":
                return row.get("classId") in allowed_classes
            if kind == "exams":
                return row["id"] in visible_exams
            return row["studentId"] in visible_students and row["examId"] in visible_exams

        existing = {r["id"]: r for r in old[kind]}
        supplied = {r["id"]: r for r in incoming[kind]}
        if any(identifier in existing and not visible(existing[identifier]) for identifier in supplied):
            raise HTTPException(403, "A supplied record is outside your assigned classes.")
        permitted = {r["id"] for r in old[kind] if visible(r)}
        changed = {i for i in permitted | supplied.keys() if canonical(existing.get(i)) != canonical(supplied.get(i))}
        for identifier in changed:
            before, after = existing.get(identifier), supplied.get(identifier)
            if before and not visible(before):
                raise HTTPException(403, "A changed record is outside your assigned classes.")
            if kind == "classes":
                raise HTTPException(403, "Only administrators manage classes and teacher assignments.")
            if kind == "students" and after and after.get("classId") not in allowed_classes:
                raise HTTPException(403, "Assign students only to your authorized classes.")
            if kind == "exams":
                if not member.permissions.get("createExams", False):
                    raise HTTPException(403, "Your account cannot change examinations or answer keys.")
                if any(
                    not e.get("classIds") or not set(e["classIds"]) <= allowed_classes for e in (before, after) if e
                ):
                    raise HTTPException(
                        403, "Only an administrator may edit examinations shared with unassigned classes."
                    )
                if (after or {}).get("resultsPublished", False) != (before or {}).get("resultsPublished", False):
                    raise HTTPException(403, "Only administrators publish student results.")
            if kind == "results":
                if not member.permissions.get("scan", False):
                    raise HTTPException(403, "Your account cannot save or correct scans.")
                allowed_ids = {s["id"] for s in incoming["students"] if s.get("classId") in allowed_classes}
                allowed_exam_ids = {
                    e["id"] for e in incoming["exams"] if set(e.get("classIds", [])).intersection(allowed_classes)
                }
                if after and (after["studentId"] not in allowed_ids or after["examId"] not in allowed_exam_ids):
                    raise HTTPException(403, "Result is outside your assigned classes.")
        merged[kind] = [r for r in old[kind] if r["id"] not in permitted and r["id"] not in supplied] + list(
            supplied.values()
        )
    return merged


def persist_workspace(db, school_id, value, actor_id=None):
    """Called only inside an authorized, revision-checked transaction (or migration)."""
    w = Workspace.model_validate(value).model_dump(mode="json", by_alias=True, exclude_none=True)
    class_ids = {c["id"] for c in w["classes"]}
    if any(set(e.get("classIds", [])) - class_ids for e in w["exams"]):
        raise HTTPException(400, "Examination class assignment is invalid.")
    if w["activeSchoolId"] != school_id:
        raise HTTPException(403, "This workspace belongs to another school.")
    school = db.get(m.School, school_id)
    school.name, school.code, school.address = (
        w["schools"][0]["name"],
        w["schools"][0]["code"],
        w["schools"][0].get("address", ""),
    )
    school.teacher = w["teacher"]
    active_class_ids = {x["id"] for x in w["classes"]}
    for row in w["classes"]:
        obj = db.get(m.Classroom, (school_id, row["id"]))
        if not obj:
            obj = m.Classroom(school_id=school_id, id=row["id"])
            db.add(obj)
        obj.name, obj.academic_year, obj.payload = row["name"], row["academicYear"], row
    db.flush()
    existing_students = {r.id: r for r in db.scalars(select(m.Student).where(m.Student.school_id == school_id))}
    incoming_student_ids = {s["id"] for s in w["students"]}
    # Retire removed students before inserting replacement roll numbers.
    for identifier, obj in existing_students.items():
        if identifier not in incoming_student_ids and not obj.deleted_at:
            obj.deleted_at = m.now()
    # Temporarily unindex existing roll numbers to permit a transactional roll swap.
    new_students = {s["id"]: s for s in w["students"]}
    for identifier, obj in existing_students.items():
        if identifier in incoming_student_ids and obj.roll_key != new_students[identifier]["roll"].strip().casefold():
            obj.deleted_at = obj.deleted_at or m.now()
    db.flush()
    for row in w["students"]:
        obj = existing_students.get(row["id"])
        if not obj:
            obj = m.Student(school_id=school_id, id=row["id"])
            db.add(obj)
        obj.class_id, obj.name, obj.roll, obj.roll_key, obj.payload, obj.deleted_at = (
            row.get("classId"),
            row["name"],
            row["roll"],
            row["roll"].strip().casefold(),
            row,
            None,
        )
    db.flush()
    current_exams = {r.id: r for r in db.scalars(select(m.Examination).where(m.Examination.school_id == school_id))}
    exam_ids = {r["id"] for r in w["exams"]}
    changed_exams = set()
    for identifier, obj in current_exams.items():
        if identifier not in exam_ids:
            obj.deleted_at = obj.deleted_at or m.now()
    for row in w["exams"]:
        obj = current_exams.get(row["id"])
        if not obj:
            obj = m.Examination(school_id=school_id, id=row["id"], key_version=1)
            db.add(obj)
            changed_exams.add(row["id"])
        elif fingerprint(_key_data(obj.payload)) != fingerprint(_key_data(row)):
            changed_exams.add(row["id"])
            obj.key_version += 1
            audit(
                db,
                school_id,
                actor_id,
                "Answer key or marking rules versioned",
                examId=row["id"],
                keyVersion=obj.key_version,
            )
        obj.title, obj.code, obj.subject, obj.date = row["title"], row.get("code", ""), row["subject"], row["date"]
        obj.questions, obj.class_ids, obj.results_published, obj.deleted_at = (
            row["questions"],
            row.get("classIds", []),
            row.get("resultsPublished", False),
            None,
        )
        row["keyVersion"] = obj.key_version
        obj.payload = row
        if row.get("layout"):
            tid = row["id"]
            template = db.get(m.Template, (school_id, tid))
            if not template:
                template = m.Template(
                    school_id=school_id, id=tid, name=row["layout"]["name"], geometry=row["layout"], version=1
                )
                db.add(template)
                db.flush()
                db.add(m.TemplateVersion(school_id=school_id, template_id=tid, version=1, geometry=row["layout"]))
            elif fingerprint(template.geometry) != fingerprint(row["layout"]):
                template.version += 1
                template.geometry, template.name = row["layout"], row["layout"]["name"]
                db.add(
                    m.TemplateVersion(
                        school_id=school_id, template_id=tid, version=template.version, geometry=row["layout"]
                    )
                )
    db.flush()
    exams = {r["id"]: r for r in w["exams"]}
    existing = {r.id: r for r in db.scalars(select(m.ResultRecord).where(m.ResultRecord.school_id == school_id))}
    incoming_results = {r["id"]: r for r in w["results"]}
    for identifier, obj in existing.items():
        incoming = incoming_results.get(identifier)
        if not incoming or (obj.student_key, obj.exam_id) != (incoming["studentId"], incoming["examId"]):
            obj.deleted_at = obj.deleted_at or m.now()
    db.flush()
    for row in w["results"]:
        exam = exams[row["examId"]]
        student = new_students.get(row["studentId"])
        if not student and not row.get("identityReview", False):
            raise HTTPException(400, "Unmatched student identities must remain in manual review.")
        if student and student["roll"].strip().casefold() != row["roll"].strip().casefold():
            raise HTTPException(400, "Result roll number does not match its registered student.")
        if exam.get("questionSets") and row.get("questionSet", "A") not in {s["code"] for s in exam["questionSets"]}:
            raise HTTPException(400, "Result question set is not configured for this examination.")
        obj = existing.get(row["id"])
        if (
            obj
            and not obj.deleted_at
            and obj.exam_id not in changed_exams
            and fingerprint(obj.payload) == fingerprint(row)
        ):
            continue
        g = evaluate(row, exam)
        if not obj:
            obj = m.ResultRecord(school_id=school_id, id=row["id"])
            db.add(obj)
        obj.exam_id, obj.student_key, obj.student_ref, obj.payload = (
            row["examId"],
            row["studentId"],
            student["id"] if student else None,
            row,
        )
        obj.score, obj.percentage, obj.needs_review, obj.deleted_at = (
            g["score"],
            g["percentage"],
            g["needsReview"],
            None,
        )
        db.flush()
        last = db.scalar(
            select(m.Evaluation)
            .where(m.Evaluation.school_id == school_id, m.Evaluation.result_id == row["id"])
            .order_by(m.Evaluation.created_at.desc())
            .limit(1)
        )
        if not last or last.fingerprint != g["fingerprint"]:
            db.add(
                m.Evaluation(
                    school_id=school_id,
                    result_id=row["id"],
                    key_version=exam["keyVersion"],
                    rule_version=g["ruleVersion"],
                    fingerprint=g["fingerprint"],
                    answers={
                        "answers": row["answers"],
                        "detectedOptions": row.get("detectedOptions"),
                        "questionSet": row.get("questionSet", "A"),
                    },
                    marking_rules={
                        "rules": exam["markingRules"],
                        "key": exam["answers"],
                        "sets": exam["questionSets"],
                        "correct": exam["marksCorrect"],
                        "negative": exam["negativeMarks"],
                    },
                    outcome=g,
                    actor_id=actor_id,
                )
            )
        detections = {
            a.question: a
            for a in db.scalars(
                select(m.AnswerDetection).where(
                    m.AnswerDetection.school_id == school_id, m.AnswerDetection.result_id == row["id"]
                )
            )
        }
        meta = {a["question"]: a for a in row.get("answerMeta", [])}
        for q, answer in enumerate(row["answers"]):
            data = meta.get(q, {})
            detection = detections.pop(q, None)
            if not detection:
                detection = m.AnswerDetection(school_id=school_id, result_id=row["id"], question=q)
                db.add(detection)
            detection.selected = data.get(
                "selected",
                (row.get("detectedOptions") or [])[q] if row.get("detectedOptions") else ([answer] if answer else []),
            )
            detection.status = data.get(
                "status",
                "uncertain"
                if q in row["flagged"] and not row["confirmed"]
                else "manual"
                if row["confirmed"]
                else "filled"
                if answer
                else "blank",
            )
            detection.confidence, detection.coordinates = data.get("confidence"), data.get("coordinates", [])
            detection.verified = bool(data.get("verified") or row["confirmed"])
        for detection in detections.values():
            db.delete(detection)
    # Retain class rows referenced by historical student records; omit them from active views by payload flag.
    for obj in db.scalars(select(m.Classroom).where(m.Classroom.school_id == school_id)):
        if obj.id not in active_class_ids:
            if any(
                s.class_id == obj.id and not s.deleted_at
                for s in db.scalars(select(m.Student).where(m.Student.school_id == school_id))
            ):
                raise HTTPException(400, "Reassign students before deleting a class.")
            # Historical records retain the reference; deleted class excluded from API.
            obj.payload = dict(obj.payload, archived=True)
    return w


def advance_revision(db, school_id, expected):
    result = db.execute(
        update(m.School)
        .where(m.School.id == school_id, m.School.revision == expected)
        .values(revision=m.School.revision + 1)
    )
    if result.rowcount != 1:
        raise HTTPException(
            409,
            "This workspace changed on another device. Your changes have not been overwritten. Export your unsaved changes, then reload and resolve the conflict.",
        )
    return expected + 1
