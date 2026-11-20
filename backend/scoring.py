"""Deterministic decimal scoring. No image inference and no random choices here."""

from __future__ import annotations

import math
import statistics
from bisect import bisect_left
from collections import Counter
from decimal import Decimal

from .geometry import default_layout, question_type, valid_selection
from .schemas import Exam, Result
from .security import fingerprint


def number(v):
    return Decimal(str(v))


def key_for(exam: dict, set_code="A"):
    variants = {s["code"]: s["answers"] for s in exam.get("questionSets", [])}
    if variants:
        return variants.get(set_code)
    return [[a] if a else None for a in exam["answers"]]


def evaluate(result: dict, exam: dict):
    e = Exam.model_validate(exam).model_dump(mode="json", by_alias=True, exclude_none=True)
    r = Result.model_validate(result).model_dump(mode="json", exclude_none=True)
    rules = e["markingRules"]
    key = key_for(e, r.get("questionSet", "A"))
    unknown_set = key is None
    key = key or [None] * e["questions"]
    correct = wrong = blank = multiple = partial = 0
    positive = negative = Decimal(0)
    maximum = number(e["marksCorrect"]) * sum(bool(k) for k in key)
    outcomes = []
    multi_review = False
    invalid_response = False
    for i, expected in enumerate(key):
        chosen = r["detectedOptions"][i] if r.get("detectedOptions") else ([r["answers"][i]] if r["answers"][i] else [])
        invalid = not valid_selection(e, i, chosen)
        chosen, expected = set(chosen), set(expected or [])
        points = Decimal(0)
        state = "unkeyed"
        if invalid:
            invalid_response = True
            state = "invalid"
        elif expected:
            if not chosen:
                blank += 1
                state, points = "blank", number(rules["unansweredMarks"])
            elif chosen == expected:
                correct += 1
                state, points = "correct", number(e["marksCorrect"])
                if len(chosen) > 1:
                    multiple += 1
            elif len(chosen) > 1:
                multiple += 1
                if rules["multiplePolicy"] == "review":
                    state = "multiple"
                    multi_review = True
                elif rules["multiplePolicy"] == "partial" and chosen.intersection(expected) and chosen <= expected:
                    partial += 1
                    state, points = "partial", min(number(rules["partialMarks"]), number(e["marksCorrect"]))
                else:
                    wrong += 1
                    state, points = "wrong", -number(e["negativeMarks"])
            elif len(expected) > 1 and chosen < expected and rules["partialMarks"]:
                partial += 1
                state, points = "partial", min(number(rules["partialMarks"]), number(e["marksCorrect"]))
            else:
                wrong += 1
                state, points = "wrong", -number(e["negativeMarks"])
            positive += max(Decimal(0), points)
            negative += max(Decimal(0), -points)
        outcomes.append(
            {
                "question": i + 1,
                "selected": sorted(chosen),
                "expected": sorted(expected),
                "status": state,
                "marks": float(points),
            }
        )
    score = positive - negative
    if rules["floorZero"]:
        score = max(Decimal(0), score)
    percentage = score / maximum * 100 if maximum else Decimal(0)
    expected_pages = r.get("pageTotal") or math.ceil(
        e["questions"] / (e.get("layout") or default_layout(e))["questionsPerPage"]
    )
    missing = (
        expected_pages > 1
        and len(set(r.get("pageIndices", []))) < expected_pages
        and not r.get("missingPagesAccepted", False)
    )
    unverified = any(
        a["status"] in ("uncertain", "partial", "erased", "invalid", "multiple") and not a["verified"]
        for a in r.get("answerMeta", [])
    )
    review = bool(
        invalid_response
        or not e["published"]
        or unknown_set
        or r.get("identityReview")
        or missing
        or r["flagged"]
        or unverified
        or (multi_review and not r["confirmed"])
    )
    grade = next(
        (
            b["name"]
            for b in sorted(rules["grades"], key=lambda b: b["min"], reverse=True)
            if percentage >= number(b["min"])
        ),
        "F",
    )
    subjects = []
    for subject in e.get("subjects", []):
        qs = outcomes[subject["from"] - 1 : subject["to"]]
        mx = number(e["marksCorrect"]) * sum(x["status"] != "unkeyed" for x in qs)
        total = sum((number(q["marks"]) for q in qs), Decimal(0))
        subjects.append(
            {
                "name": subject["name"],
                "score": float(total),
                "maximum": float(mx),
                "percentage": float(total / mx * 100) if mx else 0,
                "correct": sum(q["status"] == "correct" for q in qs),
                "wrong": sum(q["status"] == "wrong" for q in qs),
                "blank": sum(q["status"] == "blank" for q in qs),
            }
        )
    return {
        "correct": correct,
        "wrong": wrong,
        "blank": blank,
        "multiple": multiple,
        "partial": partial,
        "positiveMarks": float(positive),
        "negativeMarks": float(negative),
        "maximum": float(maximum),
        "score": float(score),
        "percentage": float(percentage),
        "accuracy": correct / (correct + wrong + blank + partial) * 100 if (correct + wrong + blank + partial) else 0,
        "status": "Review" if review else "Passed" if percentage >= number(e["passPercentage"]) else "Failed",
        "needsReview": review,
        "missingPages": missing,
        "grade": grade,
        "subjects": subjects,
        "questions": outcomes,
        "ruleVersion": fingerprint(rules),
        "fingerprint": fingerprint({"exam": e, "result": r}),
    }


def analytics(results, exam):
    scored = [(r, evaluate(r, exam)) for r in results]
    valid = sorted(
        [(r, g) for r, g in scored if not g["needsReview"]],
        key=lambda pair: (-pair[1]["score"], pair[0]["name"].casefold(), pair[0]["id"]),
    )
    percentages = [g["percentage"] for _, g in valid]
    # One sorted index replaces an O(n²) scan for every student's percentile.
    # This must use percentages, not rank/score: sets may have different maxima.
    sorted_percentages = sorted(percentages)
    ranked = []
    last_score, rank = None, 0
    for i, (r, g) in enumerate(valid):
        if g["score"] != last_score:
            rank, last_score = i + 1, g["score"]
        ranked.append(
            {
                "id": r["id"],
                "studentId": r["studentId"],
                "name": r["name"],
                "roll": r["roll"],
                "section": r["section"],
                "rank": rank,
                "percentile": bisect_left(sorted_percentages, g["percentage"]) / len(valid) * 100,
                **{k: v for k, v in g.items() if k not in ("questions", "fingerprint", "ruleVersion")},
            }
        )
    question_data = []
    for i in range(exam["questions"]):
        answers = [g["questions"][i] for _, g in valid]
        n_correct = sum(q["status"] == "correct" for q in answers)
        choices = Counter(a for q in answers for a in q["selected"])
        available = (
            sorted(
                set(choices)
                | {a for q in answers for a in q["expected"]}
                | ({exam["answers"][i]} if exam["answers"][i] else set())
            )
            if question_type(exam, i) == "integer3"
            else "ABCDE"[: exam.get("optionCount", 4)]
        )
        question_data.append(
            {
                "question": i + 1,
                "correct": n_correct,
                "total": len(valid),
                "difficulty": n_correct / len(valid) * 100 if valid else 0,
                "blank": sum(q["status"] == "blank" for q in answers),
                "options": {a: choices[a] for a in available},
            }
        )
    distribution = [
        {
            "label": f"{start}–{min(100, start + 19)}",
            "count": sum(start <= p < (start + 20 if start < 80 else 101) for p in percentages),
        }
        for start in range(0, 100, 20)
    ]
    return {
        "total": len(results),
        "evaluated": len(valid),
        "review": len(results) - len(valid),
        "average": statistics.fmean(percentages) if percentages else 0,
        "median": statistics.median(percentages) if percentages else 0,
        "standardDeviation": statistics.pstdev(percentages) if percentages else 0,
        "highest": max(percentages, default=0),
        "lowest": min(percentages, default=0),
        "passRate": sum(g["status"] == "Passed" for _, g in valid) / len(valid) * 100 if valid else 0,
        "grades": dict(Counter(g["grade"] for _, g in valid)),
        "distribution": distribution,
        "rankings": ranked,
        "questions": question_data,
        "formulas": {
            "percentile": "100 × count(strictly lower evaluated percentages) / evaluated count",
            "ranks": "Competition ranking: 1, 1, 3",
            "standardDeviation": "Population standard deviation of evaluated percentages",
            "difficulty": "100 × correct / evaluated",
        },
    }
