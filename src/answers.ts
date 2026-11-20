import type { Exam } from "./data";

export type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
export type Choice = "A" | "B" | "C" | "D" | "E";
/** Integers are fixed-width strings: 7 is stored/printed as 007, never as a float. */
export type IntegerAnswer = `${number}`; // Runtime guards below enforce exactly three ASCII digits.
export type Option = Choice | IntegerAnswer;
export type QuestionType = "choice" | "integer3";
export const isIntegerAnswer = (value: unknown): value is IntegerAnswer =>
  typeof value === "string" && /^[0-9]{3}$/.test(value);
export const questionType = (
  exam: Pick<Exam, "questionTypes">,
  question: number,
): QuestionType => exam.questionTypes?.[question] || "choice";
export function normaliseInteger(value: string): IntegerAnswer | null {
  return /^[0-9]{1,3}$/.test(value)
    ? (value.padStart(3, "0") as IntegerAnswer)
    : null;
}
export function validAnswer(
  exam: Pick<Exam, "questionTypes" | "optionCount">,
  q: number,
  value: unknown,
): value is Option | null {
  return (
    value === null ||
    (questionType(exam, q) === "integer3"
      ? isIntegerAnswer(value)
      : typeof value === "string" &&
        value.length === 1 &&
        "ABCDE".slice(0, exam.optionCount || 4).includes(value))
  );
}
export function validSelection(
  exam: Pick<Exam, "questionTypes" | "optionCount">,
  q: number,
  values: unknown,
): values is Option[] {
  return (
    Array.isArray(values) &&
    values.length <=
      (questionType(exam, q) === "integer3" ? 1 : exam.optionCount || 4) &&
    new Set(values).size === values.length &&
    values.every((v) => v !== null && validAnswer(exam, q, v))
  );
}
/** Classify one independent column/choice row solely from measured ink. */
export function classifyInk(
  ratios: number[],
  threshold: number,
  invalid = false,
) {
  const filled = invalid
    ? []
    : ratios.flatMap((v, i) => (v >= threshold ? [i] : []));
  const maximum = Math.max(0, ...ratios);
  const others = ratios.filter((_, i) => i !== filled[0]);
  let status:
    | "blank"
    | "filled"
    | "multiple"
    | "partial"
    | "erased"
    | "uncertain"
    | "invalid" = "blank";
  if (invalid) status = "invalid";
  else if (filled.length > 1) status = "multiple";
  else if (filled.length === 1)
    status =
      maximum < threshold + 0.12 || others.some((v) => v > 0.22)
        ? "uncertain"
        : "filled";
  else if (maximum > 0.32) status = "partial";
  else if (maximum > 0.22) status = "erased";
  const confidence = invalid
    ? 0
    : filled.length === 1
      ? Math.max(0, maximum - Math.max(0, ...others))
      : filled.length
        ? 0
        : 1 - maximum;
  return { filled, status, confidence };
}
/** No partial digit string is an answer. Every column must contain one clear mark. */
export function classifyInteger(
  ratios: number[],
  threshold: number,
  invalid = false,
) {
  const digits = Array.from({ length: 3 }, (_, col) =>
    classifyInk(ratios.slice(col * 10, col * 10 + 10), threshold, invalid),
  );
  const complete = digits.every((d) => d.status === "filled");
  const blank = digits.every((d) => d.status === "blank");
  const status: "filled" | "blank" | "invalid" | "multiple" | "uncertain" =
    complete
      ? "filled"
      : blank
        ? "blank"
        : digits.some((d) => d.status === "invalid")
          ? "invalid"
          : digits.some((d) => d.status === "multiple")
            ? "multiple"
            : "uncertain";
  const answer = complete
    ? (digits.map((d) => d.filled[0]).join("") as IntegerAnswer)
    : null;
  return {
    status,
    answer,
    selected: answer ? [answer] : [],
    confidence: Math.min(...digits.map((d) => d.confidence)),
    digits,
  };
}
