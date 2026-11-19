import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  FileChartColumn,
  FileSpreadsheet,
  FileText,
  Layers,
  Printer,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import type { Exam, Result, Workspace } from "./data";
import { downloadFile, formatDate, getStats, resultsCSV } from "./data";
import { EmptyState, PageHeading, Select } from "./components";
import { ExamBar } from "./Overview";
import { questionCSV } from "./reportData";
import { exportExcel, examPDF, studentPDF } from "./documents";
import { downloadTemplatePDF } from "./omr";
import ReportCatalogue from "./ReportCatalogue";
interface Props {
  workspace: Workspace;
  exam: Exam;
  results: Result[];
  setExamId: (id: string) => void;
  toast: (s: string) => void;
}
export default function Reports({
  workspace,
  exam,
  results,
  setExamId,
  toast,
}: Props) {
  const [busy, setBusy] = useState(""),
    [section, setSection] = useState("all"),
    [student, setStudent] = useState("");
  const filtered = results.filter(
      (r) => section === "all" || r.section === section,
    ),
    stats = getStats(filtered, exam),
    selected = results.find((r) => r.id === student) || results[0];
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
      toast("Your download is ready.");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "This report could not be generated.",
      );
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="INSIGHT, READY TO GO"
        title="The full story. Beautifully shared."
        description="Real Excel workbooks, portable PDF reports, and print-ready answer sheets."
        actions={
          <button
            className="button button-secondary"
            onClick={() => window.print()}
          >
            <Printer size={16} />
            Print full exam report
          </button>
        }
      />
      <ExamBar
        workspace={workspace}
        exam={exam}
        setExamId={(id) => {
          setSection("all");
          setStudent("");
          setExamId(id);
        }}
      />
      <section className="v2-report-hero">
        <div>
          <span className="micro-label">FROM INSIGHT TO IMPACT</span>
          <h2>
            Good work deserves
            <br />
            <em>a thoughtful report.</em>
          </h2>
          <p>
            Scores, subjects, rankings, and every answer.
            <br />
            All the detail. None of the busywork.
          </p>
          <button
            className="button button-primary"
            disabled={!!busy}
            onClick={() => {
              void run("pdf", () => examPDF(workspace, exam, filtered));
            }}
          >
            <FileText size={16} />
            {busy === "pdf" ? "Preparing PDF…" : "Download assessment PDF"}
            <ArrowRight size={15} />
          </button>
        </div>
        <div className="v2-report-preview">
          <span>markly. / ASSESSMENT INTELLIGENCE</span>
          <h3>{exam.title}</h3>
          <p>
            {workspace.school} · {formatDate(exam.date)}
          </p>
          <div>
            <span>
              <strong>{stats.evaluated}</strong>evaluated
            </span>
            <span>
              <strong>{stats.average.toFixed(1)}%</strong>average
            </span>
            <span>
              <strong>{stats.passRate.toFixed(1)}%</strong>pass rate
            </span>
          </div>
          <i />
          <i />
          <i />
          <small>THE BIGGER PICTURE. EVERY LITTLE DETAIL.</small>
        </div>
      </section>
      <div className="report-filter-row">
        <span>Result exports use this class filter:</span>
        <Select
          aria-label="Report class filter"
          value={section}
          onChange={(e) => setSection(e.target.value)}
        >
          <option value="all">All classes</option>
          {[...new Set(results.map((r) => r.section))].sort().map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <strong>{filtered.length} result records</strong>
      </div>
      <div className="v2-report-grid">
        {[
          {
            key: "xlsx",
            icon: FileSpreadsheet,
            type: "XLSX",
            title: "The complete workbook",
            description:
              "Four formatted sheets: student results, question analysis, subject rankings, and assessment summary.",
            note: `${filtered.length} students · ${exam.questions} questions`,
            action: () => exportExcel(workspace, exam, filtered),
          },
          {
            key: "csv",
            icon: FileChartColumn,
            type: "CSV",
            title: "Student results",
            description:
              "A spreadsheet-friendly export of scores, accuracy, response counts and review status.",
            note: "UTF-8 · formula-safe cells",
            action: async () => {
              downloadFile(
                `markly-results-${exam.id}.csv`,
                resultsCSV(filtered, exam),
              );
            },
          },
          {
            key: "questions",
            icon: Layers,
            type: "CSV",
            title: "Question-level analysis",
            description:
              "Correct-answer percentage, distractor choices, and unanswered counts for every question.",
            note: `A–${exam.optionCount === 5 ? "E" : "D"} response breakdown`,
            action: async () => {
              downloadFile(
                `markly-analysis-${exam.id}.csv`,
                questionCSV(filtered, exam),
              );
            },
          },
        ].map((c) => (
          <section className="card v2-export-card" key={c.key}>
            <div>
              <span className="export-icon">
                <c.icon size={24} />
              </span>
              <b>{c.type}</b>
            </div>
            <h2>{c.title}</h2>
            <p>{c.description}</p>
            <footer>
              <span>{c.note}</span>
              <button
                className="text-link"
                disabled={!!busy}
                onClick={() => {
                  void run(c.key, c.action);
                }}
              >
                {busy === c.key ? "Preparing…" : "Download"}
                <ArrowDownToLine size={15} />
              </button>
            </footer>
          </section>
        ))}
      </div>
      <div className="v2-report-bottom">
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>One learner. Their whole story.</h2>
              <p>
                Individual report cards with rank, percentile, subject scores,
                and every response.
              </p>
            </div>
            <FileText size={20} className="muted" />
          </div>
          <div className="form-fields">
            {results.length ? (
              <>
                <label>
                  Choose a student
                  <Select
                    aria-label="Student report card"
                    value={selected?.id || ""}
                    onChange={(e) => setStudent(e.target.value)}
                  >
                    {[...results]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((r) => (
                        <option value={r.id} key={r.id}>
                          {r.name} · {r.roll} · {r.section}
                        </option>
                      ))}
                  </Select>
                </label>
                <button
                  className="button button-primary"
                  disabled={!!busy || !selected}
                  onClick={() => {
                    if (selected)
                      void run("student", () =>
                        studentPDF(workspace, exam, selected, results),
                      );
                  }}
                >
                  <ArrowDownToLine size={16} />
                  {busy === "student"
                    ? "Preparing…"
                    : "Download PDF report card"}
                </button>
              </>
            ) : (
              <EmptyState
                title="A fresh set of stories."
                description="Scan sheets to generate individual report cards."
              />
            )}
          </div>
        </section>
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Print a little possibility.</h2>
              <p>Multipage OMR sheets with your saved layout.</p>
            </div>
            <ScanLine size={20} className="muted" />
          </div>
          <div className="form-fields">
            <p className="muted">
              A4 PDF templates use registration squares or calibrated paper
              edges. Print at 100% scale and keep all corners visible when
              scanning.
            </p>
            <div className="row-actions">
              <button
                className="button button-secondary"
                disabled={!!busy}
                onClick={() => {
                  void run("template", () => downloadTemplatePDF(exam));
                }}
              >
                <ArrowDownToLine size={15} />
                Blank OMR PDF
              </button>
              <button
                className="button button-secondary"
                disabled={!!busy || !selected}
                onClick={() => {
                  if (selected)
                    void run("personal", () =>
                      downloadTemplatePDF(exam, selected),
                    );
                }}
              >
                <ArrowDownToLine size={15} />
                For selected student
              </button>
            </div>
          </div>
        </section>
      </div>
      <ReportCatalogue
        workspace={workspace}
        exam={exam}
        results={filtered}
        section={section}
        toast={toast}
      />
      <p className="page-bottom-note">
        <ShieldCheck size={13} />
        Unverified results are marked provisional and excluded from averages,
        rankings, and pass rates. Exports may contain personal data; share with
        care.
      </p>
    </>
  );
}
