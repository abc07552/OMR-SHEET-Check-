import type { Option, Result } from "./data";

/** One explicit human decision updates scalar answers and multi-option evidence atomically. */
export function verifyResponse(
  result: Result,
  question: number,
  selected: Option[],
): Result {
  if (
    !Number.isInteger(question) ||
    question < 0 ||
    question >= result.answers.length ||
    new Set(selected).size !== selected.length
  )
    throw new Error("Invalid answer verification.");
  const choices = [...selected].sort();
  const answers = [...result.answers];
  answers[question] = choices.length === 1 ? choices[0] : null;
  const detectedOptions = (
    result.detectedOptions || result.answers.map((a) => (a ? [a] : []))
  ).map((a) => [...a]);
  detectedOptions[question] = choices;
  const previous = result.answerMeta?.find((a) => a.question === question);
  const evidence = {
    ...previous,
    question,
    selected: choices,
    status: "manual" as const,
    verified: true,
    coordinates: previous?.coordinates || [],
  };
  const flagged = result.flagged.filter((q) => q !== question);
  return {
    ...result,
    answers,
    detectedOptions,
    flagged,
    confirmed: flagged.length === 0,
    answerMeta: [
      ...(result.answerMeta || []).filter((a) => a.question !== question),
      evidence,
    ].sort((a, b) => a.question - b.question),
  };
}
