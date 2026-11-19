import copy

import pytest

from backend.schemas import Exam, Result
from backend.scoring import analytics, evaluate


@pytest.fixture
def exam():
    return Exam.model_validate(
        {
            "id": "exam",
            "schoolId": "school",
            "title": "Physics",
            "subject": "Physics",
            "date": "2026-11-17",
            "questions": 5,
            "optionCount": 5,
            "answers": ["A", "B", "C", "D", "E"],
            "marksCorrect": 2,
            "negativeMarks": 0.5,
            "passPercentage": 40,
            "published": True,
        }
    ).model_dump(mode="json", by_alias=True, exclude_none=True)


@pytest.fixture
def result():
    return Result.model_validate(
        {
            "id": "r",
            "studentId": "s",
            "examId": "exam",
            "name": "Learner",
            "roll": "123",
            "section": "A",
            "answers": ["A", "C", None, "D", "E"],
            "flagged": [],
            "confirmed": False,
            "source": "scan",
            "createdAt": "2026-11-17",
        }
    ).model_dump(mode="json", exclude_none=True)


def test_decimal_scoring_and_default_rules(exam, result):
    g = evaluate(result, exam)
    assert (g["correct"], g["wrong"], g["blank"]) == (3, 1, 1)
    assert g["positiveMarks"] == 6 and g["negativeMarks"] == 0.5
    assert g["score"] == 5.5 and g["percentage"] == 55 and g["status"] == "Passed"
    exam["marksCorrect"], exam["negativeMarks"] = 0.1, 0.3
    assert evaluate(result, exam)["score"] == 0


@pytest.mark.parametrize("field,value", [("identityReview", True), ("flagged", [0]), ("pageTotal", 3)])
def test_uncertainty_never_silently_evaluates(exam, result, field, value):
    result[field] = value
    g = evaluate(result, exam)
    assert g["status"] == "Review" and g["needsReview"]
    result["confirmed"] = True
    if field != "flagged":
        assert evaluate(result, exam)["needsReview"]


def test_multiple_sets_partial_unanswered_and_floor(exam, result):
    exam["questionSets"] = [{"code": "B", "answers": [["A", "B"], ["C"], ["D"], ["D"], ["E"]]}]
    result["questionSet"] = "B"
    result["detectedOptions"] = [["A"], ["C"], [], ["A", "D"], ["E"]]
    exam["markingRules"].update({"partialMarks": 0.5, "unansweredMarks": -0.25, "multiplePolicy": "wrong"})
    g = evaluate(result, exam)
    assert g["partial"] == 1 and g["multiple"] == 1
    assert g["score"] == 3.75
    result["questionSet"] = "UNKNOWN"
    assert evaluate(result, exam)["needsReview"]


def test_competition_ranks_percentile_and_population_sd(exam, result):
    a = copy.deepcopy(result)
    b = dict(a, id="b", studentId="b", name="Beta")
    c = dict(a, id="c", studentId="c", name="Gamma", answers=["B"] * 5)
    d = dict(a, id="d", flagged=[0])
    report = analytics([a, b, c, d], exam)
    assert report["evaluated"] == 3 and report["review"] == 1
    assert [r["rank"] for r in report["rankings"]] == [1, 1, 3]
    assert report["rankings"][0]["percentile"] == pytest.approx(100 / 3)
    assert report["questions"][0]["total"] == 3
    assert report["questions"][0]["difficulty"] == pytest.approx(200 / 3)


def test_percentiles_use_strictly_lower_percentages_even_when_set_maxima_differ(exam, result):
    exam["answers"] = ["A"] * 5
    exam["negativeMarks"] = 0
    exam["questionSets"] = [
        {"code": "A", "answers": [["A"]] * 5},
        {"code": "B", "answers": [["A"], None, None, None, None]},
    ]
    responses = [
        dict(result, id="ten-of-ten", questionSet="A", answers=["A"] * 5),
        dict(result, id="two-of-two", questionSet="B", answers=["A"] * 5),
        dict(result, id="two-of-ten", questionSet="A", answers=["A", "B", "B", "B", "B"]),
        dict(result, id="zero", questionSet="A", answers=["B"] * 5),
        dict(result, id="review", questionSet="A", answers=["A"] * 5, flagged=[0]),
    ]
    report = analytics(responses, exam)
    ranked = {r["id"]: r for r in report["rankings"]}
    assert (report["evaluated"], report["review"]) == (4, 1)
    assert [ranked[k]["rank"] for k in ("ten-of-ten", "two-of-two", "two-of-ten", "zero")] == [1, 2, 2, 4]
    assert [ranked[k]["percentile"] for k in ("ten-of-ten", "two-of-two", "two-of-ten", "zero")] == [50, 50, 25, 0]
