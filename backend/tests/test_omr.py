import json

import cv2
import numpy as np
import pytest
import zxingcpp

from backend.omr import ANCHORS, HEIGHT, WIDTH, ScanError, position, scan_image, signature
from backend.schemas import Exam


def scan_exam(questions=20, options=5):
    return Exam.model_validate(
        {
            "id": "qa-omr",
            "schoolId": "school",
            "title": "Real CV test",
            "subject": "Science",
            "date": "2026-11-17",
            "questions": questions,
            "optionCount": options,
            "answers": ["A"] * questions,
            "marksCorrect": 2,
            "negativeMarks": 0.5,
            "passPercentage": 40,
            "published": True,
        }
    ).model_dump(mode="json", by_alias=True, exclude_none=True)


def sheet_image(exam, selections=None, qr=True, page=0):
    canvas = np.full((HEIGHT, WIDTH, 3), 255, dtype=np.uint8)
    for p in ANCHORS:
        cv2.rectangle(canvas, (p["x"] - 17, p["y"] - 17), (p["x"] + 16, p["y"] + 16), (10, 10, 10), -1)
    cv2.putText(canvas, "QA ANSWER SHEET", (85, 160), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (20, 20, 20), 2)
    per = (exam.get("layout") or {}).get("questionsPerPage", min(100, exam["questions"]))
    for q in range(min(per, exam["questions"] - page * per)):
        y, xs, radius = position(q, exam, page)
        for i, x in enumerate(xs):
            cv2.circle(canvas, (round(x), round(y)), round(radius), (65, 65, 65), 2)
            if selections and "ABCDE"[i] in selections[q]:
                cv2.circle(canvas, (round(x), round(y)), round(radius) - 1, (15, 15, 15), -1)
    if qr:
        meta = {
            "m": 2,
            "e": exam["id"],
            "q": exam["questions"],
            "o": exam.get("optionCount", 4),
            "n": -(-exam["questions"] // per),
            "p": page,
            "r": "10001",
            "l": signature(exam),
        }
        image = np.asarray(
            zxingcpp.write_barcode(
                zxingcpp.BarcodeFormat.QRCode, json.dumps(meta, separators=(",", ":")), width=170, height=170
            )
        )
        h, w = image.shape
        canvas[200 : 200 + h, 1030 : 1030 + w] = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    return canvas


def png(image):
    return cv2.imencode(".png", image)[1].tobytes()


@pytest.mark.parametrize("options", [2, 3, 4, 5])
def test_real_ink_detection_all_option_counts(options):
    exam = scan_exam(options=options)
    marks = [["ABCDE"[i % options]] for i in range(20)]
    output = scan_image(png(sheet_image(exam, marks)), exam, ocr=False)
    assert output["answers"] == [m[0] for m in marks]
    assert output["flagged"] == []
    assert output["roll"] == "10001" and output["qrMatched"]
    assert len(output["answerMeta"]) == 20
    assert output["answerMeta"][0]["coordinates"][0]["inkRatio"] > 0.7


@pytest.mark.parametrize("rotation", [1, 2, 3])
def test_rotation_and_perspective_are_measured_not_guessed(rotation):
    exam = scan_exam()
    marks = [["ABCDE"[i % 5]] for i in range(20)]
    image = sheet_image(exam, marks)
    src = np.float32([[0, 0], [WIDTH - 1, 0], [WIDTH - 1, HEIGHT - 1], [0, HEIGHT - 1]])
    dest = np.float32([[35, 12], [WIDTH - 45, 32], [WIDTH - 10, HEIGHT - 50], [15, HEIGHT - 8]])
    photo = cv2.warpPerspective(
        image, cv2.getPerspectiveTransform(src, dest), (WIDTH, HEIGHT), borderValue=(220, 220, 220)
    )
    output = scan_image(png(np.ascontiguousarray(np.rot90(photo, rotation))), exam, ocr=False)
    assert output["answers"] == [m[0] for m in marks]
    assert output["flagged"] == []


def test_empty_multiple_partial_and_unreadable_are_not_silently_accepted():
    exam = scan_exam()
    marks = [[] for _ in range(20)]
    marks[0] = ["A", "B"]
    image = sheet_image(exam, marks)
    y, xs, radius = position(1, exam)
    cv2.circle(image, (round(xs[0]), round(y)), round(radius * 0.45), (60, 60, 60), -1)
    output = scan_image(png(image), exam, ocr=False)
    assert output["answers"][0] is None and 0 in output["flagged"]
    assert output["answerMeta"][0]["status"] == "multiple"
    assert output["answerMeta"][1]["status"] in ("partial", "uncertain", "erased")
    assert 1 in output["flagged"]
    assert output["answers"][2:] == [None] * 18
    with pytest.raises(ScanError):
        scan_image(png(np.full((HEIGHT, WIDTH, 3), 255, dtype=np.uint8)), exam, ocr=False)


def test_qr_exam_mismatch_rejected():
    exam = scan_exam()
    image = sheet_image(exam, [["A"]] * 20)
    other = dict(exam, id="different-exam")
    with pytest.raises(ScanError, match="different examination"):
        scan_image(png(image), other, ocr=False)
