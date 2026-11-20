import copy

import cv2
import numpy as np
import pytest
from pydantic import ValidationError

from backend.geometry import bubble_points, default_layout, signature
from backend.omr import HEIGHT, WIDTH, ScanError, outer_marker_quad, scan_image
from backend.schemas import Exam, Workspace
from backend.scoring import evaluate
from backend.tests.conftest import get_workspace, save_workspace
from backend.tests.integer_fixtures import mixed_exam, mixed_image
from backend.tests.test_omr import png


def result(exam):
    return {
        "id": "numeric-result",
        "studentId": "numeric-student",
        "name": "Numeric Learner",
        "roll": "10001",
        "section": "10 A",
        "examId": exam["id"],
        "answers": exam["answers"].copy(),
        "detectedOptions": [[a] if a else [] for a in exam["answers"]],
        "flagged": [],
        "confirmed": True,
        "createdAt": "2026-11-17",
        "source": "scan",
    }


def test_shared_geometry_signature_and_three_digit_schema():
    exam = mixed_exam()
    saved = Exam.model_validate(exam).model_dump(mode="json", by_alias=True, exclude_none=True)
    assert signature(exam) == signature(saved) == "b6cec795"
    assert saved["answers"][20:] == ["007", "042", "999", "000", "105"]
    assert len(saved["layout"]["questionRegions"][20]["points"]) == 30


@pytest.mark.parametrize("value", ["7", "-01", "1000", "1.0", "1e2", "１２３", 7, "A"])
def test_malformed_integer_keys_rejected(value):
    exam = mixed_exam()
    exam["answers"][20] = value
    with pytest.raises(ValidationError):
        Exam.model_validate(exam)


@pytest.mark.parametrize(
    "change",
    [
        lambda e: e["questionTypes"].pop(),
        lambda e: e["questionTypes"].__setitem__(0, "integer4"),
        lambda e: e["layout"]["questionRegions"].append(e["layout"]["questionRegions"][0]),
        lambda e: e["layout"]["questionRegions"][20]["points"].pop(),
        lambda e: e["layout"]["questionRegions"][20]["points"][0].__setitem__("x", 10),
        lambda e: e["layout"]["questionRegions"][20]["points"].__setitem__(
            1, e["layout"]["questionRegions"][20]["points"][0]
        ),
        lambda e: e["answers"].__setitem__(0, "007"),
        lambda e: e.__setitem__(
            "questionSets",
            [
                {
                    "code": "A",
                    "answers": [[a] for a in e["answers"][:20]] + [["007", "042"]] + [[a] for a in e["answers"][21:]],
                }
            ],
        ),
    ],
)
def test_question_types_regions_and_sets_are_bounded_and_coherent(change):
    exam = mixed_exam()
    change(exam)
    with pytest.raises(ValidationError):
        Exam.model_validate(exam)


def test_numeric_scoring_is_exact_and_has_no_per_digit_partial_credit():
    exam = mixed_exam()
    record = result(exam)
    assert evaluate(record, exam)["score"] == 50
    record["answers"][20] = "008"
    record["detectedOptions"][20] = ["008"]
    outcome = evaluate(record, exam)
    assert (outcome["score"], outcome["wrong"], outcome["partial"]) == (47.5, 1, 0)
    record["answers"][20] = None
    record["detectedOptions"][20] = ["007", "042"]
    outcome = evaluate(record, exam)
    assert outcome["needsReview"] and outcome["score"] == 48 and outcome["partial"] == 0


def test_integer_question_sets_keep_zero_prefixes_and_regrade_exactly():
    exam = mixed_exam()
    exam["questionSets"] = [{"code": "B", "answers": [[a] for a in exam["answers"]]}]
    record = dict(result(exam), questionSet="B")
    assert evaluate(record, exam)["score"] == 50
    exam["questionSets"][0]["answers"][20] = ["008"]
    assert evaluate(record, exam)["score"] == 47.5


def test_real_opencv_reads_mixed_integer_columns_without_key_inference():
    exam = mixed_exam()
    image = mixed_image(exam)
    read = scan_image(png(image), exam, ocr=False)
    assert read["answers"] == exam["answers"]
    assert read["flagged"] == []
    assert len(read["answerMeta"][20]["coordinates"]) == 30
    assert read["answerMeta"][20]["coordinates"][27]["digitColumn"] == 2
    assert read["answerMeta"][20]["coordinates"][27]["digit"] == 7
    assert read["answerMeta"][20]["coordinates"][27]["inkRatio"] > 0.8
    assert not read["roll"]  # Imported-layout OCR remains disabled.
    exam["answers"] = [None] * 25
    assert scan_image(png(image), exam, ocr=False)["answers"] == read["answers"]


@pytest.mark.parametrize("rotation", [1, 2, 3])
def test_numeric_registration_survives_rotation_perspective_and_repeated_markers(rotation):
    exam = mixed_exam()
    image = mixed_image(exam)
    source = np.float32([[0, 0], [WIDTH - 1, 0], [WIDTH - 1, HEIGHT - 1], [0, HEIGHT - 1]])
    target = np.float32([[20, 15], [WIDTH - 35, 30], [WIDTH - 10, HEIGHT - 40], [12, HEIGHT - 10]])
    image = cv2.warpPerspective(
        image, cv2.getPerspectiveTransform(source, target), (WIDTH, HEIGHT), borderValue=(220, 220, 220)
    )
    read = scan_image(png(np.ascontiguousarray(np.rot90(image, rotation))), exam, ocr=False)
    assert read["answers"] == exam["answers"]
    assert read["flagged"] == []


@pytest.mark.parametrize("kind", ["blank", "missing", "multiple", "partial"])
def test_blank_or_uncertain_columns_are_never_guessed(kind):
    exam = mixed_exam()
    image = mixed_image(exam, marks=False)
    points, radius, _ = bubble_points(20, exam)
    indexes = (
        []
        if kind == "blank"
        else [0, 10]
        if kind == "missing"
        else [0, 2, 10, 27]
        if kind == "multiple"
        else [0, 10, 27]
    )
    for i in indexes:
        x, y = points[i]
        r = round(radius * 0.4) if kind == "partial" and i == 27 else round(radius) - 1
        cv2.circle(image, (round(x), round(y)), r, (12, 12, 12), -1)
    read = scan_image(png(image), exam, ocr=False)
    assert read["answers"][20] is None and read["detectedOptions"][20] == []
    if kind == "blank":
        assert 20 not in read["flagged"] and read["answerMeta"][20]["status"] == "blank"
    else:
        assert 20 in read["flagged"] and read["answerMeta"][20]["status"] in ("multiple", "uncertain")


def test_outer_markers_are_squares_not_filled_answer_bubbles():
    image = mixed_image()
    assert outer_marker_quad(image).shape == (4, 2)
    image[:90, :90] = 255
    # A wrong/partial quadrilateral must fail the subsequent printed-outline gate.
    with pytest.raises(ScanError):
        scan_image(png(image), mixed_exam(), ocr=False)


def test_five_hundred_integer_questions_keep_twelve_per_page():
    exam = mixed_exam()
    exam.pop("layout")
    exam.update(questions=500, questionTypes=["integer3"] * 500, answers=["000"] * 500)
    saved = Exam.model_validate(exam)
    assert default_layout(saved.model_dump(exclude_none=True))["questionsPerPage"] == 12
    assert len(bubble_points(7, exam, 41)[0]) == 30


def test_api_roundtrip_scan_evidence_manual_correction_and_key_version(client, school):
    body = get_workspace(client, school)
    exam = mixed_exam()
    exam["schoolId"] = school
    body["workspace"]["exams"].append(exam)
    body["workspace"]["students"] = [
        {
            "id": "numeric-student",
            "schoolId": school,
            "section": "10 A",
            "name": "Numeric Learner",
            "roll": "10001",
            "registeredAt": "2026-11-17",
        }
    ]
    saved = save_workspace(client, school, body)
    assert saved.status_code == 200, saved.text
    image = mixed_image(exam, marks=False)
    points, radius, _ = bubble_points(20, exam)
    for i in [0, 10]:
        x, y = points[i]
        cv2.circle(image, (round(x), round(y)), round(radius) - 1, (12, 12, 12), -1)
    form = {"pageIndex": "0", "ocr": "false", "operationId": "integer-scan-operation"}
    response = client.post(
        f"/api/schools/{school}/exams/{exam['id']}/scan",
        data=form,
        files={"file": ("integer.png", png(image), "image/png")},
    )
    assert response.status_code == 200, response.text
    read = response.json()
    assert read["answers"][20] is None and 20 in read["flagged"]
    replay = client.post(
        f"/api/schools/{school}/exams/{exam['id']}/scan",
        data=form,
        files={"file": ("integer.png", png(image), "image/png")},
    )
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert replay.json()["objectId"] == read["objectId"]
    record = result(exam)
    record.update(
        answers=read["answers"],
        detectedOptions=read["detectedOptions"],
        answerMeta=read["answerMeta"],
        flagged=read["flagged"],
        scanIds=[read["objectId"]],
    )
    body = get_workspace(client, school)
    body["workspace"]["results"].append(record)
    assert save_workspace(client, school, body).status_code == 200
    body = get_workspace(client, school)
    roundtrip = body["workspace"]["results"][0]
    assert len(roundtrip["answerMeta"][20]["coordinates"]) == 30
    # Explicit human decision updates all three representations, retaining original coordinates.
    roundtrip["answers"][20] = "007"
    roundtrip["detectedOptions"][20] = ["007"]
    roundtrip["answerMeta"][20].update(selected=["007"], status="manual", verified=True)
    roundtrip["flagged"] = []
    assert save_workspace(client, school, body).status_code == 200
    body = get_workspace(client, school)
    assert body["workspace"]["results"][0]["answers"][20] == "007"
    current = next(e for e in body["workspace"]["exams"] if e["id"] == exam["id"])
    version = current["keyVersion"]
    current["answers"][20] = "008"
    assert save_workspace(client, school, body).status_code == 200
    body = get_workspace(client, school)
    assert next(e for e in body["workspace"]["exams"] if e["id"] == exam["id"])["keyVersion"] == version + 1
    incompatible = copy.deepcopy(body)
    changed = next(e for e in incompatible["workspace"]["exams"] if e["id"] == exam["id"])
    changed["questionTypes"][20] = "choice"
    changed["answers"][20] = "A"
    changed.pop("layout")
    # Reject even if a client tries to reinterpret old numeric evidence as MCQ data.
    assert save_workspace(client, school, incompatible).status_code == 422


def test_workspace_rejects_mismatched_numeric_evidence(client, school):
    body = get_workspace(client, school)
    exam = mixed_exam()
    exam["schoolId"] = school
    body["workspace"]["exams"] = [exam]
    body["workspace"]["results"] = [result(exam)]
    Workspace.model_validate(body["workspace"])
    body["workspace"]["results"][0]["detectedOptions"][20] = ["042"]
    with pytest.raises(ValidationError, match="disagree"):
        Workspace.model_validate(body["workspace"])


@pytest.mark.parametrize("setting", ["geometry", "threshold", "ocrEnabled"])
def test_scan_operation_is_bound_to_actual_calibrated_geometry(client, school, setting):
    body = get_workspace(client, school)
    exam = mixed_exam()
    exam["schoolId"] = school
    body["workspace"]["exams"].append(exam)
    assert save_workspace(client, school, body).status_code == 200
    image = png(mixed_image(exam))
    form = {"pageIndex": "0", "ocr": "false", "operationId": "geometry-bound-operation"}
    url = f"/api/schools/{school}/exams/{exam['id']}/scan"
    first = client.post(url, data=form, files={"file": ("filled.png", image, "image/png")})
    assert first.status_code == 200
    body = get_workspace(client, school)
    current = next(e for e in body["workspace"]["exams"] if e["id"] == exam["id"])
    if setting == "geometry":
        current["layout"]["questionRegions"][20]["points"][0]["x"] += 1
    elif setting == "threshold":
        current["layout"]["threshold"] += 0.01
    else:
        current["layout"]["ocrEnabled"] = not current["layout"]["ocrEnabled"]
    assert save_workspace(client, school, body).status_code == 200
    response = client.post(url, data=form, files={"file": ("filled.png", image, "image/png")})
    assert response.status_code == 409


@pytest.mark.parametrize("kind", ["count", "type", "options"])
def test_existing_response_semantics_cannot_change_even_when_client_removes_results(client, populated, kind):
    sid = populated["school"]
    body = get_workspace(client, sid)
    original = copy.deepcopy(body)
    e = next(e for e in body["workspace"]["exams"] if e["id"] == populated["exam"])
    body["workspace"]["results"] = []
    if kind == "count":
        e["questions"] += 1
        e["answers"].append("A")
    elif kind == "type":
        e["questionTypes"] = ["integer3"] + ["choice"] * (e["questions"] - 1)
        e["answers"][0] = "007"
    else:
        e["optionCount"] = 4
        e["answers"] = ["A"] * e["questions"]
    response = save_workspace(client, sid, body)
    assert response.status_code == 409, response.text
    assert get_workspace(client, sid) == original


def test_numeric_analytics_and_question_export_include_whole_response_frequencies(client, school):
    import csv
    import io

    from openpyxl import load_workbook

    body = get_workspace(client, school)
    exam = mixed_exam()
    exam["schoolId"] = school
    body["workspace"]["exams"] = [exam]
    records = [result(exam), dict(result(exam), id="second", studentId="second", name="Second", roll="10002")]
    for r in records:
        r["identityReview"] = False
        body["workspace"]["students"].append(
            {
                "id": r["studentId"],
                "schoolId": school,
                "section": "10 A",
                "name": r["name"],
                "roll": r["roll"],
                "registeredAt": "2026-11-17",
            }
        )
    records[1]["answers"][20] = "008"
    records[1]["detectedOptions"][20] = ["008"]
    body["workspace"]["results"] = records
    saved = save_workspace(client, school, body)
    assert saved.status_code == 200, saved.text
    summary = client.get(f"/api/schools/{school}/exams/{exam['id']}/analytics").json()
    assert summary["questions"][20]["options"] == {"007": 1, "008": 1}
    assert summary["questions"][21]["options"] == {"042": 2}
    url = f"/api/schools/{school}/reports/questions?examId={exam['id']}"
    exported = client.get(url + "&format=csv")
    assert exported.status_code == 200
    rows = list(csv.reader(io.StringIO(exported.content.decode("utf-8-sig"))))
    assert all(len(r) == len(rows[0]) for r in rows)
    assert rows[21][-1] == "007: 1; 008: 1"
    assert rows[21][5:9] == ["0"] * 4
    assert rows[1][-1] == ""
    book = load_workbook(io.BytesIO(client.get(url + "&format=xlsx").content))
    assert book.active.cell(22, 10).value == "007: 1; 008: 1"
    assert client.get(url + "&format=pdf").content.startswith(b"%PDF-")


@pytest.mark.parametrize("qr", [False, True])
def test_registration_measures_the_requested_or_qr_identified_page(qr):
    import json

    import zxingcpp

    from backend.geometry import ANCHORS
    from backend.omr import ring_quality

    exam = mixed_exam()
    exam.update(questions=2, answers=["A", "007"], questionTypes=["choice", "integer3"])
    exam["layout"].update(
        questionsPerPage=1,
        columns=1,
        anchorMode="markers",
        questionRegions=[
            {"question": 0, "radius": 12, "points": [{"x": 220 + i * 45, "y": 500} for i in range(4)]},
            {
                "question": 1,
                "radius": 12,
                "points": [{"x": 750 + (i // 10) * 45, "y": 950 + (i % 10) * 35} for i in range(30)],
            },
        ],
    )
    Exam.model_validate(exam)
    image = np.full((HEIGHT, WIDTH, 3), 255, np.uint8)
    for p in ANCHORS:
        cv2.rectangle(image, (p["x"] - 17, p["y"] - 17), (p["x"] + 16, p["y"] + 16), (12, 12, 12), -1)
    points, radius, _ = bubble_points(0, exam, 1)
    for i, (x, y) in enumerate(points):
        cv2.circle(image, (round(x), round(y)), round(radius), (45, 45, 45), 2)
        if i in (0, 10, 27):
            cv2.circle(image, (round(x), round(y)), round(radius) - 1, (12, 12, 12), -1)
    if qr:
        meta = {"m": 2, "e": exam["id"], "q": 2, "o": 4, "n": 2, "p": 1, "l": signature(exam)}
        barcode = zxingcpp.create_barcode(json.dumps(meta, separators=(",", ":")), zxingcpp.BarcodeFormat.QRCode)
        modules = np.asarray(zxingcpp.write_barcode_to_image(barcode))
        code = cv2.resize(modules, None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST)
        h, w = code.shape
        image[180 : 180 + h, 900 : 900 + w] = cv2.cvtColor(code, cv2.COLOR_GRAY2BGR)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    assert ring_quality(gray, exam, 0) < 9
    assert ring_quality(gray, exam, 1) > 60
    output = scan_image(png(image), exam, page_index=0 if qr else 1, ocr=False)
    assert output["pageIndex"] == 1
    assert output["answers"] == ["007"] and output["flagged"] == []
