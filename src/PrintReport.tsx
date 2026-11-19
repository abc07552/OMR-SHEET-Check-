import type { Workspace, Exam, Result } from "./data";
import { formatDate, getStats, gradeResult, questionStats } from "./data";
export default function PrintReport({
  workspace,
  exam,
  results,
}: {
  workspace: Workspace;
  exam: Exam;
  results: Result[];
}) {
  const stats = getStats(results, exam);
  const difficult = questionStats(results, exam)
    .sort((a, b) => a.percentage - b.percentage)
    .slice(0, 5);
  return (
    <div className="print-report">
      <header>
        <strong>OMR PRO</strong>
        <span>{workspace.school}</span>
      </header>
      <h1>
        {exam.subject} · {exam.title}
      </h1>
      <p>
        {formatDate(exam.date)} · {exam.questions} questions ·{" "}
        {exam.questions * exam.marksCorrect} marks · Pass mark{" "}
        {exam.passPercentage}%
      </p>
      <div className="print-stats">
        <div>
          <strong>{stats.total}</strong>Students
        </div>
        <div>
          <strong>{stats.evaluated}</strong>Evaluated
        </div>
        <div>
          <strong>{stats.average.toFixed(1)}%</strong>Average score
        </div>
        <div>
          <strong>{stats.passRate.toFixed(1)}%</strong>Pass rate
        </div>
      </div>
      <h2>Questions to revisit</h2>
      <p>
        {difficult
          .map(
            (q) =>
              `Q${q.number}: ${q.percentage.toFixed(0)}% correct (answer ${q.answer || "not set"})`,
          )
          .join(" · ")}
      </p>
      <h2>Student results</h2>
      <table>
        <thead>
          <tr>
            <th>Roll no.</th>
            <th>Student</th>
            <th>Class</th>
            <th>Correct</th>
            <th>Wrong</th>
            <th>Blank</th>
            <th>Score</th>
            <th>Accuracy</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const g = gradeResult(r, exam);
            return (
              <tr key={r.id}>
                <td>{r.roll}</td>
                <td>{r.name}</td>
                <td>{r.section}</td>
                <td>{g.correct}</td>
                <td>{g.wrong}</td>
                <td>{g.blank}</td>
                <td>
                  {g.score}/{g.maximum}
                </td>
                <td>{g.accuracy.toFixed(1)}%</td>
                <td>{g.status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <footer>
        ULTIMATE OMR CHECKER AI PRO · {stats.review} sheets awaiting review are
        excluded from class averages and pass rates.{" "}
        {results.some((r) => r.source === "demo")
          ? "Includes sample data."
          : ""}
      </footer>
    </div>
  );
}
