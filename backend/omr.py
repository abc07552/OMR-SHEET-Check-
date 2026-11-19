"""Genuine OpenCV sheet registration and pixel-based bubble measurement.

No answer key is consulted to choose orientation, marks, or confidence. The
image geometry and measured ink are the only sources of detection evidence.
"""

from __future__ import annotations

import base64
import io
import json
import math
import shutil
from dataclasses import dataclass

import cv2
import numpy as np
import zxingcpp
from PIL import Image, ImageOps

from .object_store import verified_image

WIDTH, HEIGHT = 1240, 1754
ANCHORS = [{"x": 55, "y": 55}, {"x": 1185, "y": 55}, {"x": 1185, "y": 1699}, {"x": 55, "y": 1699}]
OPTIONS = "ABCDE"


class ScanError(ValueError):
    def __init__(self, message, category="unreadable"):
        super().__init__(message)
        self.category = category


def default_layout(exam):
    per = min(100, exam["questions"])
    columns = 4 if per > 60 else 2
    five = exam.get("optionCount", 4) == 5
    return {
        "version": 2,
        "questionsPerPage": per,
        "columns": columns,
        "startX": 156 if columns == 4 else 210,
        "startY": 420,
        "columnGap": 1100 / columns,
        "rowGap": min(44, 1120 / max(1, math.ceil(per / columns) - 1)),
        "optionGap": (34 if five else 42) if columns == 4 else (63 if five else 79),
        "radius": 10 if columns == 4 else 14,
        "bubbleShape": "circle",
        "threshold": 0.52,
        "anchorMode": "markers",
        "anchors": ANCHORS,
    }


def modern(exam):
    return bool(exam.get("layout") or exam.get("optionCount", 4) != 4 or exam["questions"] > 100)


def position(question, exam, page=0):
    layout = exam.get("layout") or default_layout(exam)
    options = exam.get("optionCount", 4)
    if modern(exam):
        rows = math.ceil(layout["questionsPerPage"] / layout["columns"])
        x, y = (
            layout["startX"] + (question // rows) * layout["columnGap"],
            layout["startY"] + (question % rows) * layout["rowGap"],
        )
        return y, [x + i * layout["optionGap"] for i in range(options)], layout["radius"]
    count = min(layout["questionsPerPage"], exam["questions"] - page * layout["questionsPerPage"])
    columns = 4 if count > 60 else 2
    rows = math.ceil(count / columns)
    x = 80 + (1100 / columns) * (question // rows) + (76 if columns == 4 else 130)
    gap = (34 if options == 5 else 42) if columns == 4 else (63 if options == 5 else 79)
    return (
        400 + (question % rows) * min(46, 1160 / max(1, rows - 1)),
        [x + i * gap for i in range(options)],
        11 if columns == 4 else 15,
    )


def js_json(value):
    # Match JSON.stringify's compact integer rendering for printed geometry hashes.
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [js_json(v) for v in value]
    if isinstance(value, dict):
        return {k: js_json(v) for k, v in value.items()}
    return value


def signature(exam):
    layout = exam.get("layout") or default_layout(exam)
    anchors = [{"x": p["x"], "y": p["y"]} for p in layout["anchors"]]
    value = [
        modern(exam),
        exam["questions"],
        exam.get("optionCount", 4),
        layout["questionsPerPage"],
        layout["columns"],
        layout["startX"],
        layout["startY"],
        layout["columnGap"],
        layout["rowGap"],
        layout["optionGap"],
        layout["radius"],
        layout["bubbleShape"],
        layout["anchorMode"],
        anchors,
    ]
    raw = json.dumps(js_json(value), separators=(",", ":"), ensure_ascii=False)
    h = 2166136261
    for c in raw:
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return f"{h:08x}"


def order_quad(points):
    by_y = sorted(points, key=lambda p: p[1])
    top, bottom = sorted(by_y[:2], key=lambda p: p[0]), sorted(by_y[2:], key=lambda p: p[0])
    return np.float32([top[0], top[1], bottom[1], bottom[0]])


def markers(image, reference):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # Local contrast, not a fixed brightness cutoff: readable corner ink can be
    # above 90 in an overexposed photo while the paper can be below 90 in shadow.
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 61, 12)
    contours = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]
    height, width = gray.shape
    expected_area = 34 * 34 * width * height / (WIDTH * HEIGHT)
    candidates = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        area = cv2.contourArea(c)
        if 30 < area < 4 * expected_area and 0.6 < w / h < 1.65 and area / (w * h) > 0.68:
            candidates.append((x + w / 2, y + h / 2, area))
    result = []
    for i, (rx, ry) in enumerate(((0, 0), (0.76, 0), (0.76, 0.76), (0, 0.76))):
        available = [
            c
            for c in candidates
            if rx * width <= c[0] <= (rx + 0.24) * width and ry * height <= c[1] <= (ry + 0.24) * height
        ]
        if not available:
            raise ScanError(
                "Four registration squares were not found. Include every corner, improve lighting, or calibrate the page-edge template.",
                "registration",
            )
        best = min(
            available,
            key=lambda c: (
                abs(math.log(c[2] / expected_area))
                + 5 * math.hypot(c[0] / width - reference[i]["x"] / WIDTH, c[1] / height - reference[i]["y"] / HEIGHT)
            ),
        )
        result.append(best[:2])
    return np.float32(result)


def paper_quad(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 45, 150)
    contours = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]
    candidates = []
    for c in contours:
        approx = cv2.approxPolyDP(c, 0.025 * cv2.arcLength(c, True), True)
        if len(approx) == 4 and cv2.contourArea(approx) > image.shape[0] * image.shape[1] * 0.2:
            candidates.append((cv2.contourArea(approx), approx[:, 0, :]))
    if not candidates:
        raise ScanError(
            "The paper boundary is not visible. Place the entire sheet on a contrasting background.", "registration"
        )
    return order_quad(max(candidates, key=lambda x: x[0])[1])


def ring_quality(gray, exam):
    # Printed outlines, independent of the selected or correct option.
    layout = exam.get("layout") or default_layout(exam)
    count = min(24, layout["questionsPerPage"], exam["questions"])
    quality = []
    for q in range(count):
        y, xs, radius = position(q, exam)
        for x in xs:
            r = max(4, int(radius + 4))
            left, top = round(x) - r, round(y) - r
            roi = gray[top : top + 2 * r + 1, left : left + 2 * r + 1]
            if roi.shape != (2 * r + 1, 2 * r + 1):
                continue
            yy, xx = np.ogrid[-r : r + 1, -r : r + 1]
            dist = (
                np.maximum(np.abs(xx), np.abs(yy)) if layout["bubbleShape"] == "square" else np.sqrt(xx * xx + yy * yy)
            )
            ring = (dist >= radius - 1.8) & (dist <= radius + 1.8)
            outer = (dist > radius + 2) & (dist <= radius + 4)
            if ring.any() and outer.any():
                quality.append(float(np.mean(roi[outer])) - float(np.mean(roi[ring])))
    return float(np.mean(quality)) if quality else 0


def rotation_matrix(k, width, height):
    return [
        np.eye(3),
        np.array([[0, 1, 0], [-1, 0, width - 1], [0, 0, 1]]),
        np.array([[-1, 0, width - 1], [0, -1, height - 1], [0, 0, 1]]),
        np.array([[0, -1, height - 1], [1, 0, 0], [0, 0, 1]]),
    ][k].astype(float)


@dataclass
class Registration:
    image: np.ndarray
    matrix: np.ndarray
    rotation: int
    readability: float


def register(image, exam):
    layout = exam.get("layout") or default_layout(exam)
    reference = np.float32([[p["x"], p["y"]] for p in layout["anchors"]])
    possibilities = []
    height, width = image.shape[:2]
    for k in range(4):
        rotated = np.ascontiguousarray(np.rot90(image, k))
        # A portrait sheet should retain plausible aspect ratio after rotation.
        if rotated.shape[1] / rotated.shape[0] > 1.35:
            continue
        try:
            if layout["anchorMode"] == "markers":
                source, target = markers(rotated, layout["anchors"]), reference
            else:
                source, target = (
                    paper_quad(rotated),
                    np.float32([[0, 0], [WIDTH - 1, 0], [WIDTH - 1, HEIGHT - 1], [0, HEIGHT - 1]]),
                )
            matrix = cv2.getPerspectiveTransform(source, target)
            aligned = cv2.warpPerspective(rotated, matrix, (WIDTH, HEIGHT), borderValue=(255, 255, 255))
            gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
            quality = ring_quality(gray, exam)
            possibilities.append(Registration(aligned, matrix @ rotation_matrix(k, width, height), k * 90, quality))
        except (ScanError, cv2.error):
            continue
    if not possibilities:
        raise ScanError(
            "No reliable sheet boundary or all four reference markers were found. Retake a sharper image with every corner visible.",
            "registration",
        )
    chosen = max(possibilities, key=lambda r: r.readability)
    if chosen.readability < 9:
        raise ScanError(
            "Bubble grid does not match the selected template, or the image is too blurred to read safely. Check the template and retake the image.",
            "calibration",
        )
    return chosen


def barcode_data(image):
    data = []
    for code in zxingcpp.read_barcodes(image, try_rotate=True, try_downscale=True):
        if code.valid:
            data.append({"text": code.text[:4000], "format": str(code.format), "orientation": code.orientation})
    return data


def scan_image(data: bytes, exam: dict, page_index=0, ocr=True):
    verified_image(data)
    with Image.open(io.BytesIO(data)) as raw:
        photo = ImageOps.exif_transpose(raw).convert("RGB")
        source_width, source_height = photo.size
        scale = min(1, 2800 / max(photo.size))
        if scale < 1:
            photo = photo.resize((round(photo.width * scale), round(photo.height * scale)))
        image = cv2.cvtColor(np.array(photo), cv2.COLOR_RGB2BGR)
    registration = register(image, exam)
    aligned = registration.image
    layout = exam.get("layout") or default_layout(exam)
    page_total = math.ceil(exam["questions"] / layout["questionsPerPage"])
    codes = barcode_data(aligned)
    roll, question_set, qr_matched, roll_confidence = "", "A", False, 0
    for code in codes:
        try:
            meta = json.loads(code["text"])
        except (ValueError, TypeError):
            if code["format"] != "QRCode" and not roll and code["text"].isalnum() and len(code["text"]) <= 40:
                roll, roll_confidence = code["text"], 90
            continue
        if not isinstance(meta, dict) or meta.get("m") != 2:
            continue
        if meta.get("e") != exam["id"]:
            raise ScanError("The sheet QR identifies a different examination.", "exam_mismatch")
        if (
            meta.get("q") != exam["questions"]
            or meta.get("o") != exam.get("optionCount", 4)
            or meta.get("n") != page_total
            or (meta.get("l") is not None and meta["l"] != signature(exam))
        ):
            raise ScanError("The printed sheet geometry does not match this template version.", "layout_mismatch")
        if not isinstance(meta.get("p"), int) or not 0 <= meta["p"] < page_total:
            raise ScanError("Invalid page number in the sheet QR.", "page_mismatch")
        page_index, qr_matched = meta["p"], True
        roll = str(meta.get("r", ""))[:40]
        question_set = str(meta.get("s", "A"))[:20]
        roll_confidence = 100 if roll else 0
    if not isinstance(page_index, int) or not 0 <= page_index < page_total:
        raise ScanError("Choose a valid page number.", "page_mismatch")
    variants = exam.get("questionSets", [])
    if variants and question_set not in {v["code"] for v in variants}:
        raise ScanError("The question set is not configured for this examination.", "set_mismatch")
    gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
    # Local illumination normalization and two independent thresholds reduce shadows.
    radius = layout["radius"]
    background = cv2.GaussianBlur(gray, (0, 0), max(23, radius * 2))
    normalized = cv2.divide(gray, np.maximum(background, 1), scale=255)
    normalized = cv2.medianBlur(normalized, 3)
    # The neighborhood must surround even the designer's largest filled bubble;
    # a fixed 35px window mistakes a large uniformly dark interior for paper.
    block = max(35, 2 * math.ceil(radius * 2.2) + 1)
    adaptive = cv2.adaptiveThreshold(normalized, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, block, 12)
    absolute = cv2.threshold(normalized, 145, 255, cv2.THRESH_BINARY_INV)[1]
    answers, flagged, detections, selected_options, confidences = [], [], [], [], []
    inverse = np.linalg.inv(registration.matrix)
    overlay = aligned.copy()
    count = min(layout["questionsPerPage"], exam["questions"] - page_index * layout["questionsPerPage"])
    for q in range(count):
        y, xs, radius = position(q, exam, page_index)
        ratios, coords = [], []
        r = max(3, round(radius * 0.60))
        yy, xx = np.ogrid[-r : r + 1, -r : r + 1]
        mask = (
            np.ones((2 * r + 1, 2 * r + 1), dtype=bool)
            if layout["bubbleShape"] == "square"
            else (xx * xx + yy * yy <= r * r)
        )
        for x in xs:
            x0, y0 = round(x) - r, round(y) - r
            roi, dark = (
                adaptive[y0 : y0 + 2 * r + 1, x0 : x0 + 2 * r + 1],
                absolute[y0 : y0 + 2 * r + 1, x0 : x0 + 2 * r + 1],
            )
            if roi.shape != mask.shape:
                raise ScanError("A calibrated bubble lies outside the page.", "calibration")
            # Both actual darkness and adaptive ink evidence are measured, never guessed.
            ratio = 0.65 * float(np.mean(roi[mask] > 0)) + 0.35 * float(np.mean(dark[mask] > 0))
            ratios.append(ratio)
            point = cv2.perspectiveTransform(np.float32([[[x, y]]]), inverse)[0, 0]
            coords.append(
                {
                    "option": OPTIONS[len(coords)],
                    "x": float(point[0] / scale),
                    "y": float(point[1] / scale),
                    "alignedX": x,
                    "alignedY": y,
                    "radius": radius,
                    "inkRatio": round(ratio, 4),
                }
            )
        threshold = layout.get("threshold", 0.52)
        filled = [i for i, value in enumerate(ratios) if value >= threshold]
        maximum = max(ratios, default=0)
        suspicious = any(0.20 < value < threshold for value in ratios)
        selected = [OPTIONS[i] for i in filled]
        if len(filled) > 1:
            state, answer, confidence = "multiple", None, min(ratios[i] for i in filled) * 100
        elif len(filled) == 1:
            others = [v for i, v in enumerate(ratios) if i != filled[0]]
            uncertain = suspicious or maximum < threshold + 0.12 or (others and maximum - max(others) < 0.22)
            state, answer = ("uncertain" if uncertain else "filled"), selected[0]
            confidence = min(100, max(0, (maximum - max(others, default=0)) * 100))
        elif maximum > 0.20:
            state, answer, confidence = ("partial" if maximum > 0.32 else "erased"), None, (1 - maximum) * 100
        else:
            state, answer, confidence = "blank", None, (1 - maximum) * 100
        if state not in ("filled", "blank"):
            flagged.append(q)
        confidence = round(confidence, 2)
        answers.append(answer)
        selected_options.append(selected)
        confidences.append(confidence)
        detections.append(
            {
                "question": q,
                "selected": selected,
                "status": state,
                "confidence": confidence,
                "coordinates": coords,
                "verified": False,
                "inkRatios": [round(v, 4) for v in ratios],
            }
        )
        for i, x in enumerate(xs):
            color = (
                (20, 170, 20)
                if state == "filled" and i in filled
                else (0, 150, 255)
                if state not in ("filled", "blank")
                else (210, 140, 40)
            )
            cv2.circle(overlay, (round(x), round(y)), round(radius + 3), color, 2)
    warnings = []
    if ocr and not roll:
        if shutil.which("tesseract"):
            import pytesseract

            region = layout.get(
                "rollRegion",
                {
                    "x": 880 if not modern(exam) else 710,
                    "y": 268 if not modern(exam) else 248,
                    "width": 275,
                    "height": 39 if not modern(exam) else 58,
                },
            )
            x, y, w, h = (round(region[k]) for k in ("x", "y", "width", "height"))
            crop = cv2.resize(gray[y : y + h, x : x + w], None, fx=3, fy=3)
            try:
                recognized = pytesseract.image_to_data(
                    crop,
                    config="--psm 7 -c tessedit_char_whitelist=0123456789",
                    output_type=pytesseract.Output.DICT,
                    timeout=15,
                )
                pieces = [
                    (t.strip(), float(c))
                    for t, c in zip(recognized["text"], recognized["conf"])
                    if t.strip().isdigit() and float(c) >= 0
                ]
                roll = "".join(t for t, _ in pieces)[:40]
                roll_confidence = min((c for _, c in pieces), default=0)
            except (RuntimeError, pytesseract.TesseractError):
                warnings.append(
                    "Server OCR did not complete; verify the identity manually or use the browser OCR engine."
                )
        else:
            warnings.append(
                "Server Tesseract is not installed. Browser OCR remains available; manually verify this identity."
            )
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if blur < 35:
        warnings.append("Low image sharpness: inspect all detected marks before confirmation.")
        flagged = list(range(count))
    thumbnail = cv2.resize(overlay, (620, 877))
    ok, jpg = cv2.imencode(".jpg", thumbnail, [cv2.IMWRITE_JPEG_QUALITY, 78])
    return {
        "answers": answers,
        "flagged": flagged,
        "detectedOptions": selected_options,
        "answerMeta": detections,
        "pageIndex": page_index,
        "pageTotal": page_total,
        "roll": roll,
        "rollConfidence": round(roll_confidence, 2),
        "questionSet": question_set,
        "qrMatched": qr_matched,
        "confidence": round(sum(confidences) / max(1, len(confidences)), 2),
        "engine": "opencv-python",
        "layoutSignature": signature(exam),
        "rotation": registration.rotation,
        "readability": round(registration.readability, 2),
        "sharpness": round(blur, 2),
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "sourceToAligned": (registration.matrix @ np.diag([scale, scale, 1])).tolist(),
        "preview": "data:image/jpeg;base64," + base64.b64encode(jpg).decode() if ok else "",
        "warnings": warnings,
        "barcodes": codes,
    }
