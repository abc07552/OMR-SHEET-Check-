import { describe, expect, it } from "vitest";
import type { Exam, Result } from "./data";
import {
  blankWorkspace,
  gradeResult,
  isValidWorkspace,
  questionStats,
  subjectStats,
} from "./data";
import { defaultMarkingRules } from "./scoring";
import { verifyResponse } from "./verification";
import {
  identity3,
  inverse3,
  multiply3,
  project3,
  rotation3,
} from "./geometry";

const exam: Exam = {
  id: "e",
  schoolId: "s",
  title: "Physics",
  subject: "Physics",
  date: "2026-11-17",
  questions: 5,
  optionCount: 5,
  answers: ["A", "B", "C", "D", "E"],
  marksCorrect: 2,
  negativeMarks: 0.5,
  passPercentage: 40,
  published: true,
};
const result: Result = {
  id: "r",
  studentId: "student",
  examId: "e",
  name: "Learner",
  roll: "123",
  section: "10 A",
  answers: ["A", "C", null, "D", "E"],
  flagged: [],
  confirmed: false,
  source: "scan",
  createdAt: "2026-11-17",
};
describe("enterprise deterministic scoring and verification", () => {
  it("matches the backend decimal fixture and does not introduce floating-point penalties", () => {
    expect(gradeResult(result, exam)).toMatchObject({
      correct: 3,
      wrong: 1,
      blank: 1,
      positiveMarks: 6,
      negativeMarks: 0.5,
      score: 5.5,
      percentage: 55,
      status: "Passed",
    });
    expect(
      gradeResult(result, { ...exam, marksCorrect: 0.1, negativeMarks: 0.3 })
        .score,
    ).toBe(0);
  });
  it("scores alternate exact/subset/multiple keys and derives question and subject statistics from them", () => {
    const e: Exam = {
      ...exam,
      questionSets: [
        { code: "B", answers: [["A", "B"], ["C"], ["D"], ["D"], ["E"]] },
      ],
      subjects: [{ name: "Core", from: 1, to: 5 }],
      markingRules: {
        ...defaultMarkingRules,
        partialMarks: 0.5,
        unansweredMarks: -0.25,
        multiplePolicy: "wrong",
      },
    };
    const r: Result = {
      ...result,
      questionSet: "B",
      answers: ["A", "C", null, null, "E"],
      detectedOptions: [["A"], ["C"], [], ["A", "D"], ["E"]],
    };
    expect(gradeResult(r, e)).toMatchObject({
      partial: 1,
      multiple: 1,
      score: 3.75,
      positiveMarks: 4.5,
      negativeMarks: 0.75,
    });
    expect(subjectStats([r], e)[0].students[0]).toMatchObject({
      score: 3.75,
      percentage: 37.5,
    });
    expect(questionStats([r], e)[1]).toMatchObject({
      correct: 1,
      percentage: 100,
    });
    expect(
      questionStats([r], e)[3].counts.find((c) => c.option === "A")?.count,
    ).toBe(1);
    expect(gradeResult({ ...r, questionSet: "UNKNOWN" }, e).needsReview).toBe(
      true,
    );
  });
  it.each(["partial", "erased", "uncertain", "invalid", "multiple"] as const)(
    "a blanket confirmation cannot bypass unverified %s evidence",
    (status) => {
      const r: Result = {
        ...result,
        confirmed: true,
        answerMeta: [
          {
            question: 0,
            selected: ["A"],
            status,
            verified: false,
            coordinates: [],
          },
        ],
      };
      expect(gradeResult(r, exam).needsReview).toBe(true);
      expect(gradeResult(verifyResponse(r, 0, ["A"]), exam).needsReview).toBe(
        false,
      );
      expect(
        gradeResult({ ...r, answerMeta: [], flagged: [0] }, exam).needsReview,
      ).toBe(true);
    },
  );
  it("a correction atomically changes evidence and the answer actually used for scoring", () => {
    const r: Result = {
      ...result,
      answers: ["B", "C", null, "D", "E"],
      detectedOptions: [["B"], ["C"], [], ["D"], ["E"]],
      flagged: [0],
      answerMeta: [
        {
          question: 0,
          selected: ["B"],
          status: "uncertain",
          verified: false,
          coordinates: [{ x: 100, y: 200, inkRatio: 0.51 }],
        },
      ],
    };
    const corrected = verifyResponse(r, 0, ["A"]);
    expect(corrected.answers[0]).toBe("A");
    expect(corrected.detectedOptions?.[0]).toEqual(["A"]);
    expect(corrected.answerMeta?.[0]).toMatchObject({
      status: "manual",
      verified: true,
      coordinates: [{ x: 100, y: 200, inkRatio: 0.51 }],
    });
    expect(gradeResult(corrected, exam)).toMatchObject({
      correct: 3,
      needsReview: false,
    });
    expect(r.answers[0]).toBe("B");
    expect(r.answerMeta?.[0].verified).toBe(false);
  });
  it("verification can deliberately retain multiple marks without inventing a scalar answer", () => {
    const r = verifyResponse(result, 0, ["B", "A"]);
    expect(r.answers[0]).toBe(null);
    expect(r.detectedOptions?.[0]).toEqual(["A", "B"]);
    expect(r.answerMeta?.[0].verified).toBe(true);
    expect(gradeResult({ ...r, identityReview: true }, exam).needsReview).toBe(
      true,
    );
  });
  it("requires missing-page acceptance separately from answer verification", () => {
    expect(
      gradeResult(
        { ...result, confirmed: true, pageTotal: 2, pageIndices: [0] },
        exam,
      ).needsReview,
    ).toBe(true);
    expect(
      gradeResult(
        {
          ...result,
          confirmed: true,
          pageTotal: 2,
          pageIndices: [0],
          missingPagesAccepted: true,
        },
        exam,
      ).needsReview,
    ).toBe(false);
  });
  it("accepts an empty authorized exam projection without inventing an assessment", () => {
    const workspace = blankWorkspace(
      { id: "s", name: "School", code: "S" },
      "Teacher",
    );
    workspace.exams = [];
    expect(isValidWorkspace(workspace)).toBe(true);
  });
});
describe("original-image geometry", () => {
  it.each([0, 1, 2, 3])(
    "inverts rotation %i and a nontrivial perspective without losing original coordinates",
    (k) => {
      const matrix = multiply3(
        [
          [0.9, 0.01, 42],
          [-0.01, 0.93, 18],
          [0.00001, 0.00003, 1],
        ],
        rotation3(k, 1240, 1754),
      );
      const aligned = project3(matrix, 315, 671),
        original = project3(inverse3(matrix), aligned.x, aligned.y);
      expect(original.x).toBeCloseTo(315, 8);
      expect(original.y).toBeCloseTo(671, 8);
      expect(multiply3(matrix, inverse3(matrix))[0][0]).toBeCloseTo(1, 6);
    },
  );
  it("rejects a singular transform rather than drawing fabricated coordinates", () =>
    expect(() =>
      inverse3([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ).toThrow(/singular/));
  it("identity projection preserves the source", () =>
    expect(project3(identity3(), 12, 34)).toEqual({ x: 12, y: 34 }));
});
