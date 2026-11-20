"""Synthetic public-domain QA sheet. Contains no real identity or uploaded photo."""

import json
from pathlib import Path

import cv2
import numpy as np

from backend.geometry import ANCHORS, HEIGHT, WIDTH, bubble_points


def mixed_exam():
    return json.loads((Path(__file__).resolve().parents[2] / "test-fixtures/mixed-integer-layout.json").read_text())


def mixed_image(exam=None, marks=True, repeated=True, four_columns=False):
    exam = exam or mixed_exam()
    image = np.full((HEIGHT, WIDTH, 3), 255, np.uint8)
    half = 12 if repeated else 17
    for p in ANCHORS:
        cv2.rectangle(image, (p["x"] - half, p["y"] - half), (p["x"] + half - 1, p["y"] + half - 1), (12, 12, 12), -1)
    if repeated:
        for x in [55, 430, 810, 1185]:
            for y in [55, 260, 465, 670, 875, 1080, 1285, 1490, 1699]:
                cv2.rectangle(image, (x - 12, y - 12), (x + 11, y + 11), (12, 12, 12), -1)
    for q in range(exam["questions"]):
        points, radius, numeric = bubble_points(q, exam)
        if four_columns and numeric:
            first = points[0]
            points = [(first[0] + col * 45, first[1] - 42 + row * 42) for col in range(4) for row in range(11)]
        for i, (x, y) in enumerate(points):
            cv2.circle(image, (round(x), round(y)), round(radius), (45, 45, 45), 2)
            if marks and not four_columns:
                answer = exam["answers"][q]
                filled = numeric and answer and answer[i // 10] == str(i % 10) or not numeric and answer == "ABCDE"[i]
                if filled:
                    cv2.circle(image, (round(x), round(y)), round(radius) - 1, (12, 12, 12), -1)
    if four_columns:
        # A separate five-column roll grid, deliberately not an answer question.
        for col in range(5):
            for row in range(10):
                cv2.circle(image, (175 + col * 45, 130 + row * 35), 12, (45, 45, 45), 2)
    return image
