import {
  ArrowDownToLine,
  ArrowRight,
  ChartColumnIncreasing,
  Check,
  FileSpreadsheet,
  FolderDown,
  LockKeyhole,
  Printer,
  Sparkles,
} from "lucide-react";
import type { Exam, Result, Workspace } from "./data";
import {
  downloadFile,
  formatDate,
  getStats,
  gradeResult,
  questionStats,
  resultsCSV,
} from "./data";
import { PageHeading } from "./components";
import { ExamBar } from "./Overview";
import { questionCSV } from "./Analytics";
interface Props {
  workspace: Workspace;
  exam: Exam;
  results: Result[];
  setExamId: (id: string) => void;
  toast: (text: string) => void;
}
export default function Reports({
  workspace,
  exam,
  results,
  setExamId,
  toast,
}: Props) {
  const stats = getStats(results, exam);
  const download = (kind: "students" | "questions" | "backup") => {
    if (kind === "students")
      downloadFile(`markly-results-${exam.id}.csv`, resultsCSV(results, exam));
    if (kind === "questions")
      downloadFile(
        `markly-analysis-${exam.id}.csv`,
        questionCSV(results, exam),
      );
    if (kind === "backup")
      downloadFile(
        "markly-workspace-backup.json",
        JSON.stringify(workspace, null, 2),
        "application/json",
      );
    toast(
      kind === "backup"
        ? "Workspace backup downloaded. Keep it somewhere safe."
        : "Your report is ready. Downloaded to your device.",
    );
  };
  return (
    <>
      <PageHeading
        eyebrow="GOOD INSIGHTS DESERVE TO BE SHARED"
        title="The full story. Ready to share."
        description="Turn your classroom’s hard work into thoughtful, useful reports."
        actions={
          <button
            className="button button-primary"
            onClick={() => window.print()}
          >
            <Printer size={16} />
            Print exam report
          </button>
        }
      />
      <ExamBar workspace={workspace} exam={exam} setExamId={setExamId} />
      <div className="report-hero">
        <div className="report-hero-content">
          <span className="eyebrow">
            YOUR CLASSROOM, BEAUTIFULLY SUMMARISED
          </span>
          <h2>
            A little perspective.
            <br />
            On paper, too.
          </h2>
          <p>
            A clean, print-ready report with student results, classroom
            averages, and the questions worth revisiting.
          </p>
          <button className="button button-dark" onClick={() => window.print()}>
            <Printer size={16} />
            Print or save as PDF
            <ArrowRight size={15} />
          </button>
        </div>
        <div className="report-sheet">
          <span className="report-mini-brand">markly.</span>
          <span className="report-mini-label">ASSESSMENT REPORT</span>
          <h3>
            {exam.subject}
            <br />
            {exam.title}
          </h3>
          <span className="report-mini-date">{formatDate(exam.date)}</span>
          <div className="report-mini-stats">
            <div>
              <strong>{stats.total}</strong>
              <span>students</span>
            </div>
            <div>
              <strong>{stats.average.toFixed(0)}%</strong>
              <span>average</span>
            </div>
            <div>
              <strong>{stats.passRate.toFixed(0)}%</strong>
              <span>passed</span>
            </div>
          </div>
          <div className="report-mini-chart">
            {[35, 50, 42, 67, 55, 79, 67, 90, 78, 94, 65, 82].map((h, i) => (
              <i key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="report-mini-lines">
            <i />
            <i />
            <i />
          </div>
        </div>
        <Sparkles className="report-star" size={38} />
      </div>
      <div className="report-cards">
        <section className="card report-download-card">
          <span className="report-type-icon green">
            <FileSpreadsheet size={25} />
          </span>
          <span className="file-type">CSV</span>
          <h2>Student results</h2>
          <p>
            Every student’s score, accuracy, and status. Ready for your
            spreadsheet.
          </p>
          <div>
            <span>{results.length} student records</span>
            <button className="text-link" onClick={() => download("students")}>
              Download
              <ArrowDownToLine size={15} />
            </button>
          </div>
        </section>
        <section className="card report-download-card">
          <span className="report-type-icon lavender">
            <ChartColumnIncreasing size={25} />
          </span>
          <span className="file-type">CSV</span>
          <h2>Question analysis</h2>
          <p>
            Question-level accuracy and answer breakdowns. Find the next
            teaching moment.
          </p>
          <div>
            <span>{exam.questions} questions</span>
            <button className="text-link" onClick={() => download("questions")}>
              Download
              <ArrowDownToLine size={15} />
            </button>
          </div>
        </section>
        <section className="card report-download-card">
          <span className="report-type-icon peach">
            <FolderDown size={25} />
          </span>
          <span className="file-type">JSON</span>
          <h2>A little peace of mind</h2>
          <p>
            Back up your whole workspace, including answer keys and all student
            results.
          </p>
          <div>
            <span>{workspace.exams.length} assessments</span>
            <button className="text-link" onClick={() => download("backup")}>
              Back up
              <ArrowDownToLine size={15} />
            </button>
          </div>
        </section>
      </div>
      <div className="report-privacy">
        <LockKeyhole size={18} />
        <div>
          <strong>Yours to keep. Yours to share.</strong>
          <p>
            Reports are generated right here in your browser. No student data is
            sent to a server.
          </p>
        </div>
        <Check size={19} />
      </div>
    </>
  );
}
export function PrintReport({
  workspace,
  exam,
  results,
}: Pick<Props, "workspace" | "exam" | "results">) {
  const stats = getStats(results, exam);
  const difficult = questionStats(results, exam)
    .sort((a, b) => a.percentage - b.percentage)
    .slice(0, 5);
  return (
    <div className="print-report">
      <header>
        <strong>markly.</strong>
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
        Generated with Markly · {stats.review} sheets awaiting review are
        excluded from class averages and pass rates.{" "}
        {results.some((r) => r.source === "demo")
          ? "Includes sample data."
          : ""}
      </footer>
    </div>
  );
}
