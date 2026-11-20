import type { Exam, MarkingRules, Option, Result } from "./data";
import Decimal from "decimal.js";
import { validSelection } from "./answers";
import { getLayout } from "./layout";
export const ScoringDecimal = Decimal.clone({
  precision: 28,
  rounding: Decimal.ROUND_HALF_EVEN,
});

export const defaultMarkingRules: MarkingRules = {
  version: 1,
  partialMarks: 0,
  unansweredMarks: 0,
  multiplePolicy: "review",
  floorZero: true,
  grades: [
    { name: "A+", min: 90 },
    { name: "A", min: 80 },
    { name: "B", min: 60 },
    { name: "C", min: 40 },
    { name: "F", min: 0 },
  ],
};
export function scoreLocally(result: Result, exam: Exam) {
  const rules = { ...defaultMarkingRules, ...exam.markingRules };
  const variants = exam.questionSets || [];
  const key = variants.length
    ? variants.find((v) => v.code === (result.questionSet || "A"))?.answers
    : exam.answers.map((a) => (a ? [a] : null));
  let correct = 0,
    wrong = 0,
    blank = 0,
    multiple = 0,
    partial = 0;
  let positive = new ScoringDecimal(0),
    negative = new ScoringDecimal(0),
    multipleReview = false,
    invalidResponse = false;
  const questions = (key || Array(exam.questions).fill(null)).map(
    (expected: Option[] | null, i: number) => {
      const chosen =
        result.detectedOptions?.[i] ||
        (result.answers[i] ? [result.answers[i]!] : []);
      let marks = 0,
        status = "unkeyed";
      if (!validSelection(exam, i, chosen)) {
        invalidResponse = true;
        status = "invalid";
      } else if (expected?.length) {
        const exact =
          chosen.length === expected.length &&
          chosen.every((o) => expected.includes(o));
        const subset =
          chosen.length > 0 && chosen.every((o) => expected.includes(o));
        if (!chosen.length) {
          blank++;
          status = "blank";
          marks = rules.unansweredMarks;
        } else if (exact) {
          correct++;
          status = "correct";
          marks = exam.marksCorrect;
          if (chosen.length > 1) multiple++;
        } else if (chosen.length > 1) {
          multiple++;
          if (rules.multiplePolicy === "review") {
            status = "multiple";
            multipleReview = true;
          } else if (rules.multiplePolicy === "partial" && subset) {
            partial++;
            status = "partial";
            marks = Math.min(rules.partialMarks, exam.marksCorrect);
          } else {
            wrong++;
            status = "wrong";
            marks = -exam.negativeMarks;
          }
        } else if (expected.length > 1 && subset && rules.partialMarks) {
          partial++;
          status = "partial";
          marks = Math.min(rules.partialMarks, exam.marksCorrect);
        } else {
          wrong++;
          status = "wrong";
          marks = -exam.negativeMarks;
        }
        positive = positive.plus(Math.max(0, marks));
        negative = negative.plus(Math.max(0, -marks));
      }
      return {
        question: i + 1,
        selected: chosen,
        expected: expected || [],
        status,
        marks,
      };
    },
  );
  const max = new ScoringDecimal(exam.marksCorrect).times(
    (key || []).filter((k) => k?.length).length,
  );
  const rawScore = positive.minus(negative),
    total = rules.floorZero ? ScoringDecimal.max(0, rawScore) : rawScore;
  const percent = max.isZero()
    ? new ScoringDecimal(0)
    : total.div(max).times(100);
  const maximum = max.toNumber(),
    score = total.toNumber(),
    percentage = percent.toNumber(),
    positiveMarks = positive.toNumber(),
    negativeMarks = negative.toNumber();
  const expectedPages =
    result.pageTotal ||
    Math.ceil(exam.questions / getLayout(exam).questionsPerPage);
  const missingPages =
    expectedPages > 1 &&
    new Set(result.pageIndices || []).size < expectedPages &&
    !result.missingPagesAccepted;
  const unverified = result.answerMeta?.some(
    (a) =>
      ["partial", "erased", "uncertain", "invalid", "multiple"].includes(
        a.status,
      ) && !a.verified,
  );
  const needsReview =
    !exam.published ||
    invalidResponse ||
    !key ||
    !!result.identityReview ||
    missingPages ||
    !!result.flagged.length ||
    !!unverified ||
    (multipleReview && !result.confirmed);
  const status: "Review" | "Passed" | "Failed" = needsReview
    ? "Review"
    : percent.gte(exam.passPercentage)
      ? "Passed"
      : "Failed";
  const grade =
    [...rules.grades]
      .sort((a, b) => b.min - a.min)
      .find((b) => percent.gte(b.min))?.name || "F";
  return {
    correct,
    wrong,
    blank,
    multiple,
    partial,
    maximum,
    score,
    percentage,
    positiveMarks,
    negativeMarks,
    accuracy:
      correct + wrong + blank + partial
        ? (correct / (correct + wrong + blank + partial)) * 100
        : 0,
    status,
    needsReview,
    missingPages,
    grade,
    questions,
  };
}
