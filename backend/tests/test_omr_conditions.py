"""Deterministic raster corpus: the real OpenCV pipeline measures every fixture.

These images exercise failure modes; they do not establish physical-sheet or
handwriting accuracy. No answer key is passed to the fixture transformations.
"""

import copy

import cv2
import numpy as np
import pytest

from backend.omr import HEIGHT, WIDTH, ScanError, default_layout, position, scan_image
from backend.schemas import Exam
from backend.tests.test_omr import png, scan_exam, sheet_image


def exposure(image, condition):
    pixels = image.astype(np.float32)
    if condition == "dark":
        pixels *= 0.28
    elif condition == "overexposed":
        pixels += 115
    elif condition == "shadow":
        pixels *= np.linspace(0.27, 1, image.shape[1])[None, :, None]
    elif condition == "faded-print":
        pixels = pixels * 0.40 + 150
    else:
        raise ValueError(f"Unknown fixture: {condition}")
    return np.clip(pixels, 0, 255).astype(np.uint8)


def calibrated_exam(radius=14, shape="circle", questions=20):
    exam = scan_exam(questions=questions)
    layout = default_layout(exam)
    layout.update(
        name="Measured QA layout",
        radius=radius,
        rowGap=max(layout["rowGap"], 2 * radius + 4),
        bubbleShape=shape,
        labelOffset=65 if layout["columns"] == 4 else 100,
        fields=[],
        rollRegion={"x": 710, "y": 248, "width": 295, "height": 58},
    )
    exam["layout"] = layout
    return Exam.model_validate(exam).model_dump(mode="json", by_alias=True, exclude_none=True)


@pytest.mark.parametrize("condition", ["dark", "overexposed", "shadow", "faded-print"])
def test_readable_exposure_changes_preserve_real_answers(condition):
    exam = scan_exam()
    marks = [["ABCDE"[q % 5]] for q in range(exam["questions"])]
    output = scan_image(png(exposure(sheet_image(exam, marks), condition)), exam, ocr=False)
    assert output["answers"] == [m[0] for m in marks]
    assert all(not answer["verified"] for answer in output["answerMeta"])
    assert all(0 <= answer["confidence"] <= 100 for answer in output["answerMeta"])
    assert output["readability"] >= 9


@pytest.mark.parametrize("shape", ["circle", "square"])
@pytest.mark.parametrize("radius", [5, 10, 18, 25])
def test_designer_bubble_shapes_and_sizes_are_actually_readable(shape, radius):
    exam = calibrated_exam(radius=radius, shape=shape)
    marks = [["ABCDE"[q % 5]] for q in range(exam["questions"])]
    output = scan_image(png(sheet_image(exam, marks)), exam, ocr=False)
    assert output["answers"] == [m[0] for m in marks]
    assert all(not row["verified"] for row in output["answerMeta"])
    assert len(output["answerMeta"][0]["coordinates"]) == 5


@pytest.mark.parametrize("condition", ["dark", "overexposed", "shadow", "faded-print"])
def test_blank_answers_under_uneven_lighting_never_become_filled(condition):
    exam = scan_exam()
    output = scan_image(png(exposure(sheet_image(exam), condition)), exam, ocr=False)
    assert output["answers"] == [None] * exam["questions"]
    assert output["detectedOptions"] == [[] for _ in range(exam["questions"])]


@pytest.mark.parametrize("sigma", [8, 12])
def test_unreadable_blur_requires_retake_instead_of_guessing(sigma):
    exam = scan_exam()
    blurred = cv2.GaussianBlur(sheet_image(exam, [["A"]] * 20), (0, 0), sigma)
    with pytest.raises(ScanError) as rejected:
        scan_image(png(blurred), exam, ocr=False)
    assert rejected.value.category in {"registration", "calibration"}


def test_moderate_blur_requires_review_and_never_verifies_an_answer():
    exam = scan_exam()
    image = cv2.GaussianBlur(sheet_image(exam, [["A"]] * 20), (0, 0), 3)
    output = scan_image(png(image), exam, ocr=False)
    assert output["flagged"] == list(range(20))
    assert output["warnings"] and all(not row["verified"] for row in output["answerMeta"])


def test_jpeg_compression_and_half_resolution_preserve_measured_ink():
    exam = scan_exam()
    marks = [["ABCDE"[q % 5]] for q in range(20)]
    half = cv2.resize(sheet_image(exam, marks), (WIDTH // 2, HEIGHT // 2), interpolation=cv2.INTER_AREA)
    ok, jpeg = cv2.imencode(".jpg", half, [cv2.IMWRITE_JPEG_QUALITY, 25])
    assert ok
    output = scan_image(jpeg.tobytes(), exam, ocr=False)
    assert output["answers"] == [m[0] for m in marks]


def test_residual_partial_multiple_and_crossed_marks_remain_unverified():
    exam = scan_exam()
    marks = [[] for _ in range(20)]
    marks[2] = ["B", "D"]
    image = sheet_image(exam, marks)
    for question, ink_radius in [(0, 4), (1, 5)]:
        y, xs, _ = position(question, exam)
        cv2.circle(image, (round(xs[0]), round(y)), ink_radius, (60, 60, 60), -1)
    y, xs, _ = position(3, exam)
    cv2.line(image, (round(xs[0]) - 10, round(y)), (round(xs[-1]) + 10, round(y)), (35, 35, 35), 5)
    output = scan_image(png(image), exam, ocr=False)
    assert output["answerMeta"][0]["status"] == "erased"
    assert output["answerMeta"][1]["status"] == "partial"
    assert output["answerMeta"][2]["status"] == "multiple"
    assert set(range(4)) <= set(output["flagged"])
    assert all(not row["verified"] for row in output["answerMeta"])
    assert output["answers"][4:] == [None] * 16


def test_wrong_geometry_is_rejected_even_without_an_identity_qr():
    printed = calibrated_exam()
    selected = copy.deepcopy(printed)
    selected["layout"]["startY"] += 70
    with pytest.raises(ScanError) as rejected:
        scan_image(png(sheet_image(printed, [["A"]] * 20, qr=False)), selected, ocr=False)
    assert rejected.value.category == "calibration"


def test_qr_rejects_a_nearby_but_different_template_version():
    printed = calibrated_exam()
    selected = copy.deepcopy(printed)
    selected["layout"]["radius"] += 0.5
    with pytest.raises(ScanError) as rejected:
        scan_image(png(sheet_image(printed, [["A"]] * 20)), selected, ocr=False)
    assert rejected.value.category == "layout_mismatch"


def test_detection_does_not_change_when_the_answer_key_changes():
    exam = scan_exam()
    image = png(sheet_image(exam, [["BCDEA"[q % 5]] for q in range(20)]))
    first = scan_image(image, exam, ocr=False)
    exam["answers"] = ["E"] * 20
    second = scan_image(image, exam, ocr=False)
    for field in ("answers", "answerMeta", "flagged", "detectedOptions", "confidence"):
        assert first[field] == second[field]


def test_five_page_500_question_a_to_e_layout_reads_last_page_coordinates():
    exam = scan_exam(questions=500)
    marks = [["ABCDE"[q % 5]] for q in range(100)]
    output = scan_image(png(sheet_image(exam, marks, page=4)), exam, ocr=False)
    assert output["pageIndex"] == 4 and output["pageTotal"] == 5
    assert output["answers"] == [m[0] for m in marks]
    assert len(output["answerMeta"]) == 100
    assert output["answerMeta"][-1]["question"] == 99
    assert output["answerMeta"][-1]["coordinates"][-1]["option"] == "E"
