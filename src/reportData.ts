import type { Exam, Result } from "./data";
import { questionStats, getOptions } from "./data";
import { questionType } from "./answers";
export function questionCSV(results: Result[], exam: Exam) {
  const stats = questionStats(results, exam);
  return [
    `Question,Correct answer,Correct responses,Total evaluated,Accuracy (%),${getOptions(exam).join(",")},Unanswered${exam.questionTypes?.includes("integer3") ? ",Integer response frequencies" : ""}`,
    ...stats.map((q) =>
      [
        q.number,
        q.answer || "",
        q.correct,
        q.total,
        q.percentage.toFixed(1),
        ...getOptions(exam).map(
          (option) => q.counts.find((c) => c.option === option)?.count || 0,
        ),
        q.blank,
        ...(exam.questionTypes?.includes("integer3")
          ? [
              questionType(exam, q.number - 1) === "integer3"
                ? q.counts.map((c) => `${c.option}: ${c.count}`).join("; ")
                : "",
            ]
          : []),
      ].join(","),
    ),
  ].join("\r\n");
}
