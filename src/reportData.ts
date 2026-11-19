import type { Exam, Result } from "./data";
import { questionStats, getOptions } from "./data";
export function questionCSV(results: Result[], exam: Exam) {
  const stats = questionStats(results, exam);
  return [
    `Question,Correct answer,Correct responses,Total evaluated,Accuracy (%),${getOptions(exam).join(",")},Unanswered`,
    ...stats.map((q) =>
      [
        q.number,
        q.answer || "",
        q.correct,
        q.total,
        q.percentage.toFixed(1),
        ...q.counts.map((c) => c.count),
        q.blank,
      ].join(","),
    ),
  ].join("\r\n");
}
