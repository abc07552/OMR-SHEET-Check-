import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  GraduationCap,
  RotateCcw,
  Save,
  ScanLine,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Exam, Option, Page, Result, Workspace } from "./data";
import {
  downloadFile,
  formatNumber,
  getStats,
  gradeResult,
  getOptions,
  rankings,
  subjectStats,
  resultsCSV,
} from "./data";
import {
  Avatar,
  EmptyState,
  ExportButton,
  Modal,
  PageHeading,
  ResultsTable,
  SearchInput,
  Select,
  StatusBadge,
} from "./components";
import { ExamBar } from "./Overview";
import { studentPDF } from "./documents";
interface Props {
  workspace: Workspace;
  exam: Exam;
  results: Result[];
  setExamId: (id: string) => void;
  navigate: (p: Page) => void;
  onOpen: (r: Result) => void;
  toast: (text: string) => void;
}
export default function Students({
  workspace,
  exam,
  results,
  setExamId,
  navigate,
  onOpen,
  toast,
}: Props) {
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pageSize = 10;
  const filtered = useMemo(
    () =>
      results
        .filter(
          (r) =>
            (!search ||
              `${r.name} ${r.roll}`
                .toLowerCase()
                .includes(search.toLowerCase())) &&
            (section === "all" || r.section === section) &&
            (status === "all" || gradeResult(r, exam).status === status),
        )
        .sort((a, b) =>
          sort === "score-desc"
            ? gradeResult(b, exam).percentage - gradeResult(a, exam).percentage
            : sort === "score-asc"
              ? gradeResult(a, exam).percentage -
                gradeResult(b, exam).percentage
              : sort === "name"
                ? a.name.localeCompare(b.name)
                : (b.source === "scan" ? 1 : 0) -
                    (a.source === "scan" ? 1 : 0) ||
                  (a.source === "scan"
                    ? b.createdAt.localeCompare(a.createdAt)
                    : 0),
        ),
    [results, search, section, status, sort, exam],
  );
  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, maxPage);
  const visible = filtered.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  const stats = getStats(results, exam);
  const exportFiltered = () => {
    const items = selected.size
      ? filtered.filter((r) => selected.has(r.id))
      : filtered;
    if (!items.length) return;
    downloadFile(`markly-students-${exam.id}.csv`, resultsCSV(items, exam));
    toast(`${items.length} student results exported to CSV.`);
  };
  const reset = () => {
    setSearch("");
    setSection("all");
    setStatus("all");
    setPage(1);
    setSelected(new Set());
  };
  return (
    <>
      <PageHeading
        eyebrow="EVERY STUDENT. EVERY STEP."
        title="More than a roll number."
        description="Behind every result is a learner. Get to know their progress."
        actions={
          <>
            <ExportButton onClick={exportFiltered} label="Export results" />
            <button
              className="button button-primary"
              onClick={() => navigate("scanner")}
            >
              <ScanLine size={17} />
              Scan sheets
            </button>
          </>
        }
      />
      <ExamBar
        workspace={workspace}
        exam={exam}
        setExamId={(id) => {
          reset();
          setExamId(id);
        }}
      />
      <div className="student-summary">
        <div>
          <Users size={18} />
          <strong>{results.length}</strong>
          <span>Total students</span>
        </div>
        <div>
          <CheckCheck size={18} />
          <strong>
            {stats.scored.filter((r) => r.status === "Passed").length}
          </strong>
          <span>Passed</span>
        </div>
        <div>
          <CircleAlert size={18} />
          <strong>{stats.review}</strong>
          <span>Awaiting review</span>
        </div>
        <div>
          <GraduationCap size={19} />
          <strong>{stats.average.toFixed(1)}%</strong>
          <span>Class average</span>
        </div>
      </div>
      <section className="card students-card">
        <div className="card-heading">
          <div>
            <h2>
              Your classroom
              <span className="count-badge">{filtered.length}</span>
            </h2>
            <p>All their efforts, in one thoughtful place.</p>
          </div>
          {selected.size > 0 && (
            <button
              className="button button-secondary button-small"
              onClick={exportFiltered}
            >
              <ArrowDownToLine size={14} />
              Export {selected.size} selected
            </button>
          )}
        </div>
        <div className="student-filters">
          <SearchInput
            value={search}
            onChange={(s) => {
              setSearch(s);
              setPage(1);
              setSelected(new Set());
            }}
          />
          <div className="filter-selects">
            <Select
              aria-label="Filter by class"
              value={section}
              onChange={(e) => {
                setSection(e.target.value);
                setPage(1);
                setSelected(new Set());
              }}
            >
              <option value="all">All classes</option>
              {[...new Set(results.map((r) => r.section))].sort().map((s) => (
                <option key={s} value={s}>
                  Class {s}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
                setSelected(new Set());
              }}
            >
              <option value="all">All statuses</option>
              <option value="Passed">Passed</option>
              <option value="Failed">Failed</option>
              <option value="Review">Needs review</option>
            </Select>
            <Select
              aria-label="Sort students"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="recent">Latest first</option>
              <option value="name">Name A–Z</option>
              <option value="score-desc">Highest score</option>
              <option value="score-asc">Lowest score</option>
            </Select>
            {(search || section !== "all" || status !== "all") && (
              <button
                className="icon-button"
                aria-label="Reset filters"
                title="Reset filters"
                onClick={reset}
              >
                <RotateCcw size={16} />
              </button>
            )}
          </div>
        </div>
        {filtered.length ? (
          <ResultsTable
            results={visible}
            exam={exam}
            onOpen={onOpen}
            selected={selected}
            onSelect={(id) =>
              setSelected((s) => {
                const next = new Set(s);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onSelectAll={() =>
              setSelected((s) => {
                const next = new Set(s);
                const all = visible.every((r) => next.has(r.id));
                visible.forEach((r) => {
                  if (all) next.delete(r.id);
                  else next.add(r.id);
                });
                return next;
              })
            }
            sort={sort.startsWith("score") ? sort : ""}
            onSort={() =>
              setSort((s) => (s === "score-desc" ? "score-asc" : "score-desc"))
            }
          />
        ) : (
          <EmptyState
            icon={<Search size={28} />}
            title={
              results.length
                ? "No students in this corner yet."
                : "Meet your next success stories."
            }
            description={
              results.length
                ? "Try a different name, roll number, or filter."
                : "Scan your first batch of sheets and your student results will appear here."
            }
            action={
              <button
                className="button button-secondary"
                onClick={results.length ? reset : () => navigate("scanner")}
              >
                {results.length ? "Clear filters" : "Scan answer sheets"}
                <ArrowRight size={14} />
              </button>
            }
          />
        )}
        <div className="pagination">
          <span>
            {filtered.length
              ? `Showing ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filtered.length)} of ${filtered.length} students`
              : "0 students"}
            {selected.size ? ` · ${selected.size} selected` : ""}
          </span>
          <div>
            <button
              className="pagination-button"
              disabled={safePage === 1}
              onClick={() => setPage(safePage - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(5, maxPage) }, (_, i) => {
              const p = Math.max(1, Math.min(safePage - 2, maxPage - 4)) + i;
              return (
                <button
                  className={`pagination-button ${p === safePage ? "active" : ""}`}
                  key={p}
                  onClick={() => setPage(p)}
                  aria-label={`Go to page ${p}`}
                  aria-current={p === safePage ? "page" : undefined}
                >
                  {p}
                </button>
              );
            })}
            {maxPage > 5 && safePage < maxPage - 2 && <span>…</span>}
            <button
              className="pagination-button"
              disabled={safePage === maxPage}
              onClick={() => setPage(safePage + 1)}
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>
      <p className="page-bottom-note">
        <Check size={13} />
        Results follow your workspace storage mode. Keep a separate backup for
        long-term safety.
      </p>
    </>
  );
}
export function StudentDetail({
  result,
  exam,
  allResults,
  onClose,
  onUpdate,
  onDelete,
  toast,
  workspace,
}: {
  workspace?: Workspace;
  result: Result;
  exam: Exam;
  allResults: Result[];
  onClose: () => void;
  onUpdate: (r: Result) => boolean | void;
  onDelete?: () => void;
  toast: (text: string) => void;
}) {
  const [answers, setAnswers] = useState([...result.answers]);
  const [name, setName] = useState(result.name);
  const [roll, setRoll] = useState(result.roll);
  const [section, setSection] = useState(result.section);
  const [identityVerified, setIdentityVerified] = useState(
    !result.identityReview,
  );
  const [acceptMissing, setAcceptMissing] = useState(
    !!result.missingPagesAccepted,
  );
  const [pdfBusy, setPDFBusy] = useState(false);
  const [flagged, setFlagged] = useState([...result.flagged]);
  const [activeQuestion, setActiveQuestion] = useState<number | null>(
    result.flagged[0] ?? null,
  );
  const [editing, setEditing] = useState(false);
  const draft = {
    ...result,
    answers,
    flagged,
    name: name.trim(),
    roll: roll.trim(),
    section: section.trim(),
    identityReview: !identityVerified,
    missingPagesAccepted: acceptMissing,
  };
  const rank = rankings(allResults, exam).find(
    (r) => r.result.id === result.id,
  );
  const graded = gradeResult(draft, exam);
  const classAverage = getStats(allResults, exam).average;
  const dirty =
    JSON.stringify(answers) !== JSON.stringify(result.answers) ||
    JSON.stringify(flagged) !== JSON.stringify(result.flagged) ||
    name !== result.name ||
    roll !== result.roll ||
    section !== result.section ||
    identityVerified !== !result.identityReview ||
    acceptMissing !== !!result.missingPagesAccepted;
  const close = () => {
    if (!dirty || confirm("Discard unsaved response or identity changes?"))
      onClose();
  };
  const setResponse = (option: Option | null) => {
    if (activeQuestion === null) return;
    setAnswers((a) => a.map((v, i) => (i === activeQuestion ? option : v)));
    setFlagged((f) => f.filter((q) => q !== activeQuestion));
    setEditing(true);
  };
  const save = () => {
    if (!name.trim() || !roll.trim() || !section.trim()) {
      toast("Name, roll number and class are required.");
      return;
    }
    if (onUpdate({ ...draft, confirmed: flagged.length === 0 }) === false)
      return;
    setEditing(false);
    toast(
      flagged.length
        ? "Responses saved. Some marks still need review."
        : "Result saved and analysis updated.",
    );
    onClose();
  };
  return (
    <Modal
      title="A closer look at their progress"
      onClose={close}
      className="student-modal"
    >
      <div className="student-detail-body">
        <div className="student-profile">
          <Avatar name={result.name} index={2} large />
          <div>
            <h2>{result.name}</h2>
            <p>
              Roll no. {result.roll}
              <span>·</span>Class {result.section}
              <span>·</span>
              {exam.subject}
            </p>
          </div>
          <StatusBadge status={graded.status} />
        </div>
        <div className="student-score-panel">
          <div className="big-score">
            <span>Assessment score</span>
            <strong>
              {formatNumber(graded.score)}
              <small> / {graded.maximum}</small>
            </strong>
            <p>
              {graded.percentage >= classAverage ? "+" : ""}
              {(graded.percentage - classAverage).toFixed(1)}% vs. class average
            </p>
          </div>
          <div className="response-stat correct-stat">
            <Check size={17} />
            <strong>{graded.correct}</strong>
            <span>Correct</span>
          </div>
          <div className="response-stat wrong-stat">
            <X size={17} />
            <strong>{graded.wrong}</strong>
            <span>Incorrect</span>
          </div>
          <div className="response-stat">
            <span className="blank-response">−</span>
            <strong>{graded.blank}</strong>
            <span>Unanswered</span>
          </div>
        </div>
        <div className="result-identity-fields">
          <div className="form-two-columns">
            <label>
              Student name
              <input
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Roll number
              <input
                value={roll}
                maxLength={40}
                onChange={(e) => {
                  const value = e.target.value;
                  setRoll(value);
                  const registered = workspace?.students?.find(
                    (s) => s.roll.toLowerCase() === value.toLowerCase(),
                  );
                  if (registered) {
                    setName(registered.name);
                    setSection(registered.section);
                  }
                }}
              />
            </label>
          </div>
          <label>
            Class / section
            <input
              value={section}
              maxLength={60}
              onChange={(e) => setSection(e.target.value)}
            />
          </label>
          {result.identityReview && (
            <label className="checkbox-label warning">
              <input
                type="checkbox"
                checked={identityVerified}
                onChange={(e) => setIdentityVerified(e.target.checked)}
              />
              I have verified this student’s identity against the sheet.
            </label>
          )}
          {gradeResult(result, exam).missingPages && (
            <div className="v2-notice warning">
              <CircleAlert size={17} />
              <div>
                <strong>Some answer-sheet pages are missing.</strong>
                <p>
                  Received pages:{" "}
                  {(result.pageIndices || []).map((p) => p + 1).join(", ") ||
                    "none"}
                  . Scan the remaining pages, or explicitly accept the missing
                  responses as unanswered.
                </p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={acceptMissing}
                    onChange={(e) => setAcceptMissing(e.target.checked)}
                  />
                  Accept missing pages as unanswered
                </label>
              </div>
            </div>
          )}
        </div>
        <div className="student-ranking-strip">
          <span>
            Overall rank{" "}
            <strong>{rank ? `#${rank.rank}` : "Under review"}</strong>
          </span>
          <span>
            Percentile{" "}
            <strong>{rank ? rank.percentile.toFixed(2) : "—"}</strong>
          </span>
          <span>
            Mark confidence{" "}
            <strong>
              {result.scanConfidence !== undefined
                ? `${result.scanConfidence.toFixed(0)}%`
                : "Manual / sample"}
            </strong>
          </span>
        </div>
        {exam.subjects?.length ? (
          <div className="result-subjects">
            {subjectStats(
              [
                {
                  ...draft,
                  flagged: [],
                  confirmed: true,
                  identityReview: false,
                  missingPagesAccepted: true,
                },
              ],
              exam,
            ).map((s) => (
              <div key={s.name}>
                <span>{s.name}</span>
                <strong>{s.students[0]?.percentage.toFixed(1) || 0}%</strong>
                <small>
                  {s.students[0]?.score || 0} / {s.maximum}
                </small>
              </div>
            ))}
          </div>
        ) : null}
        {flagged.length > 0 && (
          <div className="detail-review-banner">
            <CircleAlert size={17} />
            <p>
              <strong>
                {flagged.length}{" "}
                {flagged.length === 1 ? "answer needs" : "answers need"} a quick
                look.
              </strong>{" "}
              Select a highlighted question and confirm its response below.
            </p>
          </div>
        )}
        <div className="answer-review-heading">
          <div>
            <h3>Every answer, at a glance</h3>
            <p>Choose a question to see or correct its response.</p>
          </div>
          <div className="answer-legend">
            <span>
              <i className="correct-dot" />
              Correct
            </span>
            <span>
              <i className="wrong-dot" />
              Incorrect
            </span>
            <span>
              <i />
              Blank
            </span>
          </div>
        </div>
        <div className="student-answer-grid">
          {exam.answers.map((key, q) => (
            <button
              key={q}
              className={`${flagged.includes(q) ? "flagged-answer" : !answers[q] ? "blank-answer" : answers[q] === key ? "correct-answer" : "wrong-answer"} ${activeQuestion === q ? "active" : ""}`}
              onClick={() => setActiveQuestion(q)}
              aria-label={`Question ${q + 1}, ${flagged.includes(q) ? "needs review" : !answers[q] ? "unanswered" : answers[q] === key ? "correct" : "incorrect"}`}
            >
              <span>{q + 1}</span>
              <strong>{answers[q] || "–"}</strong>
            </button>
          ))}
        </div>
        {activeQuestion !== null && (
          <div className="response-editor">
            <div>
              <strong>Question {activeQuestion + 1}</strong>
              <span>
                Correct answer:{" "}
                <b>{exam.answers[activeQuestion] || "Not set"}</b>
                {flagged.includes(activeQuestion)
                  ? " · Confirm the mark below"
                  : ""}
              </span>
            </div>
            <div>
              {getOptions(exam).map((o) => (
                <button
                  className={answers[activeQuestion] === o ? "selected" : ""}
                  key={o}
                  onClick={() => setResponse(o)}
                  aria-label={`Set question ${activeQuestion + 1} response to ${o}`}
                >
                  {o}
                </button>
              ))}
              <button
                className={`blank-option ${!answers[activeQuestion] ? "selected" : ""}`}
                onClick={() => setResponse(null)}
              >
                Unanswered
              </button>
            </div>
          </div>
        )}
        <p className="detail-caption">
          {result.source === "demo"
            ? "Sample student record · "
            : "Automatically read from an OMR image · "}
          {exam.title}
        </p>
      </div>
      <div className="modal-footer detail-footer">
        {onDelete && (
          <button
            className="text-button danger-text"
            onClick={() => {
              if (
                confirm(
                  "Delete this student's result for this assessment? The student register and their other assessment results will be kept. Download a backup first if needed.",
                )
              )
                onDelete();
            }}
          >
            <Trash2 size={15} />
            Delete result
          </button>
        )}
        <button
          className="button button-secondary"
          onClick={() => {
            downloadFile(
              `markly-${result.roll}-result.csv`,
              resultsCSV([result], exam),
            );
            toast("Student result exported.");
          }}
        >
          <ArrowDownToLine size={15} />
          Export CSV
        </button>
        {workspace && (
          <button
            className="button button-secondary"
            disabled={pdfBusy || dirty}
            onClick={async () => {
              setPDFBusy(true);
              try {
                await studentPDF(workspace, exam, result, allResults);
              } catch (e) {
                toast(e instanceof Error ? e.message : "PDF export failed.");
              } finally {
                setPDFBusy(false);
              }
            }}
          >
            <ArrowDownToLine size={15} />
            {pdfBusy ? "Preparing…" : "PDF report card"}
          </button>
        )}
        <div>
          <button className="button button-secondary" onClick={close}>
            Close
          </button>
          <button
            className="button button-primary"
            disabled={!dirty && !editing}
            onClick={save}
          >
            <Save size={15} />
            Save responses
          </button>
        </div>
      </div>
    </Modal>
  );
}
