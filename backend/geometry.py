"""Shared, key-independent canonical print/scan geometry. Historical MCQ hashes remain stable."""

from __future__ import annotations

import json
import math

WIDTH, HEIGHT = 1240, 1754
ANCHORS = [{"x": 55, "y": 55}, {"x": 1185, "y": 55}, {"x": 1185, "y": 1699}, {"x": 55, "y": 1699}]


def default_layout(exam):
    numeric = "integer3" in (exam.get("questionTypes") or [])
    per = min(12 if numeric else 100, exam["questions"])
    columns = 4 if numeric or per > 60 else 2
    five = exam.get("optionCount", 4) == 5
    return {
        "version": 2,
        "questionsPerPage": per,
        "columns": columns,
        "startX": 156 if columns == 4 else 210,
        "startY": 420,
        "columnGap": 1100 / columns,
        "rowGap": 370 if numeric else min(44, 1120 / max(1, math.ceil(per / columns) - 1)),
        "optionGap": (34 if five else 42) if columns == 4 else (63 if five else 79),
        "radius": 10 if columns == 4 else 14,
        "bubbleShape": "circle",
        "threshold": 0.52,
        "anchorMode": "markers",
        "anchors": ANCHORS,
    }


def modern(exam):
    return bool(
        exam.get("layout")
        or exam.get("optionCount", 4) != 4
        or exam["questions"] > 100
        or "integer3" in (exam.get("questionTypes") or [])
    )


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
    if "integer3" in (exam.get("questionTypes") or []) or layout.get("questionRegions"):
        value.extend(
            [
                [question_type(exam, q) for q in range(exam["questions"])],
                [
                    [r["question"], r["radius"], [[p["x"], p["y"]] for p in r["points"]]]
                    for r in sorted(layout.get("questionRegions", []), key=lambda r: r["question"])
                ],
            ]
        )
    raw = json.dumps(js_json(value), separators=(",", ":"), ensure_ascii=False)
    h = 2166136261
    for c in raw:
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return f"{h:08x}"


def question_type(exam, q):
    types = exam.get("questionTypes")
    return types[q] if types else "choice"


def valid_answer(exam, q, value):
    import re

    if value is None:
        return True
    if not isinstance(value, str):
        return False
    return (
        bool(re.fullmatch(r"[0-9]{3}", value))
        if question_type(exam, q) == "integer3"
        else value in list("ABCDE"[: exam.get("optionCount", 4)])
    )


def valid_selection(exam, q, selected):
    return (
        isinstance(selected, list)
        and len(selected) <= (1 if question_type(exam, q) == "integer3" else exam.get("optionCount", 4))
        and len(set(selected)) == len(selected)
        and all(v is not None and valid_answer(exam, q, v) for v in selected)
    )


def bubble_points(question, exam, page=0):
    layout = exam.get("layout") or default_layout(exam)
    q = page * layout["questionsPerPage"] + question
    numeric = question_type(exam, q) == "integer3"
    region = next((r for r in layout.get("questionRegions", []) if r["question"] == q), None)
    if region:
        return [(p["x"], p["y"]) for p in region["points"]], region["radius"], numeric
    y, xs, radius = position(question, exam, page)
    points = (
        [(xs[0] + (i // 10) * layout["optionGap"], y + (i % 10) * 30) for i in range(30)]
        if numeric
        else [(x, y) for x in xs]
    )
    return points, radius, numeric


def validate_geometry(exam):
    layout = exam.get("layout") or default_layout(exam)
    regions = layout.get("questionRegions", [])
    if len({r["question"] for r in regions}) != len(regions) or any(
        r["question"] >= exam["questions"] for r in regions
    ):
        raise ValueError("Imported regions need unique question numbers inside this examination.")
    spatial = {}
    for q in range(exam["questions"]):
        page, local = divmod(q, layout["questionsPerPage"])
        points, radius, numeric = bubble_points(local, exam, page)
        if len(points) != (30 if numeric else exam.get("optionCount", 4)):
            raise ValueError("Question region has the wrong number of bubbles.")
        for x, y in points:
            if x - radius < 25 or x + radius > WIDTH - 25 or y - radius < 25 or y + radius > HEIGHT - 70:
                raise ValueError("Bubble grid extends outside the printable page.")
            cx, cy = int(x // 52), int(y // 52)
            for dx in range(-1, 2):
                for dy in range(-1, 2):
                    if any(
                        (max(abs(a - x), abs(b - y)) if layout["bubbleShape"] == "square" else math.hypot(a - x, b - y))
                        < r + radius + 2
                        for a, b, r in spatial.get((page, cx + dx, cy + dy), [])
                    ):
                        raise ValueError("Layout bubbles overlap.")
            spatial.setdefault((page, cx, cy), []).append((x, y, radius))
