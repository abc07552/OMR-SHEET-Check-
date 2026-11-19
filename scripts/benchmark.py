"""Bounded synthetic scoring/CV benchmark. Never opens a school database.

Run with the development lock installed. Outputs only aggregate measurements,
checksums and runtime versions; no credentials, images or student records.
This is not a network, concurrent-user or low-end Android capacity test.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import resource
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def bounded(lower, upper):
    def parse(value):
        number = int(value)
        if not lower <= number <= upper:
            raise argparse.ArgumentTypeError(f"Choose a value from {lower} to {upper}.")
        return number

    return parse


def measure(action, iterations):
    samples = []
    result = None
    for _ in range(iterations):
        start = time.perf_counter()
        result = action()
        samples.append((time.perf_counter() - start) * 1000)
    ordered = sorted(samples)
    return result, {
        "samplesMs": [round(s, 3) for s in samples],
        "medianMs": round(statistics.median(samples), 3),
        "p95Ms": round(ordered[math.ceil(0.95 * len(ordered)) - 1], 3),
        "minimumMs": round(ordered[0], 3),
    }


def ranking_case(records, questions, iterations):
    from backend.scoring import analytics
    from backend.tests.test_omr import scan_exam

    exam = scan_exam(questions=questions)
    pages = math.ceil(questions / min(100, questions))
    responses = [
        {
            "id": f"synthetic-result-{i}",
            "studentId": f"synthetic-student-{i}",
            "examId": exam["id"],
            "name": f"Synthetic learner {i:06d}",
            "roll": str(i),
            "section": "Synthetic QA",
            "answers": ["A" if q < i % (questions + 1) else "B" for q in range(questions)],
            "flagged": [0] if i % 17 == 0 else [],
            "confirmed": False,
            "source": "demo",
            "pageTotal": pages,
            "pageIndices": list(range(pages)),
            "createdAt": "2026-11-17T00:00:00Z",
        }
        for i in range(records)
    ]
    summary, timing = measure(lambda: analytics(responses, exam), iterations)
    expected = records - sum(bool(r["flagged"]) for r in responses)
    assert summary["evaluated"] == expected and len(summary["rankings"]) == expected
    percentages = Counter(row["percentage"] for row in summary["rankings"])
    below, cursor = {}, 0
    for percentage, count in sorted(percentages.items()):
        below[percentage] = cursor
        cursor += count
    previous, rank = None, 0
    for i, row in enumerate(summary["rankings"]):
        if row["score"] != previous:
            rank, previous = i + 1, row["score"]
        assert row["rank"] == rank
        assert row["percentile"] == below[row["percentage"]] / expected * 100
    digest = hashlib.sha256(
        json.dumps(
            [[r["id"], r["score"], r["rank"], r["percentile"]] for r in summary["rankings"]],
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    return {
        "records": records,
        "questions": questions,
        "evaluated": expected,
        "checksPassed": True,
        "rankingChecksum": digest,
        **timing,
    }


def optical_cases(iterations):
    from backend.omr import scan_image
    from backend.tests.test_omr import png, scan_exam, sheet_image
    from backend.tests.test_omr_conditions import exposure

    output = []
    for condition in ("clean", "dark", "shadow", "500-question-last-page"):
        exam = scan_exam(questions=500 if condition == "500-question-last-page" else 20)
        count, page = min(100, exam["questions"]), 4 if exam["questions"] == 500 else 0
        marks = [["ABCDE"[q % 5]] for q in range(count)]
        image = sheet_image(exam, marks, page=page)
        if condition in {"dark", "shadow"}:
            image = exposure(image, condition)
        data = png(image)
        result, timing = measure(lambda: scan_image(data, exam, ocr=False), iterations)
        assert result["answers"] == [m[0] for m in marks]
        assert all(not row["verified"] for row in result["answerMeta"])
        assert result["pageIndex"] == page
        output.append(
            {
                "condition": condition,
                "measuredAnswers": count,
                "flaggedForReview": len(result["flagged"]),
                "inputBytes": len(data),
                "checksPassed": True,
                **timing,
            }
        )
    return output


def main():
    import cv2
    import numpy
    import sqlalchemy

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", nargs="+", type=bounded(2, 10000), default=[1000, 5000])
    parser.add_argument("--questions", type=bounded(1, 500), default=20)
    parser.add_argument("--iterations", type=bounded(1, 20), default=3)
    parser.add_argument("--output", type=Path, default=ROOT / ".cache/qa/performance.json")
    args = parser.parse_args()
    report = {
        "scope": "Synthetic, single-process Python scoring/analytics and real native OpenCV; no database/network/physical device",
        "environment": {
            "python": platform.python_version(),
            "system": platform.system(),
            "architecture": platform.machine(),
            "logicalCPUs": os.cpu_count(),
            "opencv": cv2.__version__,
            "opencvThreads": cv2.getNumThreads(),
            "numpy": numpy.__version__,
            "sqlalchemy": sqlalchemy.__version__,
        },
        "iterations": args.iterations,
        "percentileMethod": "nearest-rank p95 of measured wall-clock samples; small samples, not a capacity/SLA estimate",
        "rankings": [ranking_case(n, args.questions, args.iterations) for n in args.records],
        "optical": optical_cases(args.iterations),
        "peakProcessRSSKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
