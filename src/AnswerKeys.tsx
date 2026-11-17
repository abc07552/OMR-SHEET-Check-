import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  CheckCheck,
  ClipboardPaste,
  FileCheck2,
  KeyRound,
  Plus,
  RotateCcw,
  Save,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { Exam, Option, Page, Workspace } from "./data";
import { OPTIONS } from "./data";
import { downloadTemplate } from "./omr";
import { Modal, PageHeading, SavedIndicator, Select } from "./components";
import { ExamBar } from "./Overview";
interface Props {
  workspace: Workspace;
  exam: Exam;
  setExamId: (id: string) => void;
  onSave: (exam: Exam) => void;
  onCreate: (exam: Exam) => void;
  navigate: (page: Page) => void;
  toast: (message: string) => void;
}
export default function AnswerKeys({
  workspace,
  exam,
  setExamId,
  onSave,
  onCreate,
  navigate,
  toast,
}: Props) {
  const [draft, setDraft] = useState<Exam>({
    ...exam,
    answers: [...exam.answers],
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  useEffect(() => {
    setDraft({ ...exam, answers: [...exam.answers] });
  }, [exam]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(exam);
  const completed = draft.answers.filter(Boolean).length;
  const save = () => {
    if (
      !draft.title.trim() ||
      !draft.subject.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ||
      !Number.isFinite(Date.parse(draft.date)) ||
      !Number.isFinite(draft.marksCorrect) ||
      !Number.isFinite(draft.negativeMarks) ||
      !Number.isFinite(draft.passPercentage) ||
      draft.marksCorrect > 100 ||
      draft.negativeMarks > 100 ||
      draft.marksCorrect <= 0 ||
      draft.negativeMarks < 0 ||
      draft.passPercentage < 1 ||
      draft.passPercentage > 100
    ) {
      toast("Please check the assessment details and scoring rules.");
      return;
    }
    onSave({
      ...draft,
      title: draft.title.trim(),
      published: completed === draft.questions,
    });
    toast(
      completed === draft.questions
        ? "Answer key saved. All student results have been recalculated."
        : "Draft saved. Complete every answer to start scanning.",
    );
  };
  const choose = (i: number, option: Option) =>
    setDraft((d) => ({
      ...d,
      answers: d.answers.map((a, q) =>
        q === i ? (a === option ? null : option) : a,
      ),
    }));
  const applyPaste = () => {
    const values = paste
      .toUpperCase()
      .replace(/[\s,;|\d.():\-]/g, "")
      .split("");
    if (
      values.length !== draft.questions ||
      values.some((v) => !OPTIONS.includes(v as Option))
    ) {
      setPasteError(
        `Enter exactly ${draft.questions} answers using only A, B, C and D. You entered ${values.length}.`,
      );
      return;
    }
    setDraft((d) => ({ ...d, answers: values as Option[] }));
    setPasteOpen(false);
    setPaste("");
    toast("Answers added. Save your key when you’re ready.");
  };
  return (
    <>
      <PageHeading
        eyebrow="GET THE LITTLE THINGS RIGHT"
        title="Good grading starts here."
        description="Set the right answers once. Leave the rest to Markly."
        actions={
          <button
            className="button button-primary"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={17} />
            New answer key
          </button>
        }
      />
      <ExamBar workspace={workspace} exam={exam} setExamId={setExamId} />
      <div className="key-layout">
        <section className="card key-card">
          <div className="card-heading">
            <div>
              <h2>
                <KeyRound size={17} /> Answer key
                <span
                  className={`key-state ${exam.published ? "published" : ""}`}
                >
                  {exam.published ? "Ready to scan" : "Draft"}
                </span>
              </h2>
              <p>
                Click an option to set the correct answer for each question.
              </p>
            </div>
            <button
              className="button button-small button-secondary"
              onClick={() => {
                setPasteOpen(true);
                setPasteError("");
              }}
            >
              <ClipboardPaste size={14} />
              Paste answers
            </button>
          </div>
          <div className="key-progress">
            <span>
              <strong>{completed}</strong> of {draft.questions} answers selected
            </span>
            <span className="key-progress-track">
              <i style={{ width: `${(completed / draft.questions) * 100}%` }} />
            </span>
            <button
              className="text-button"
              onClick={() => setClearOpen(true)}
              disabled={!completed}
            >
              <RotateCcw size={12} />
              Clear
            </button>
          </div>
          <div className="answer-key-grid">
            {draft.answers.map((answer, i) => (
              <div
                className={`answer-key-question ${answer ? "filled" : ""}`}
                key={i}
              >
                <span className="question-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  {OPTIONS.map((o) => (
                    <button
                      key={o}
                      aria-label={`Question ${i + 1}, option ${o}`}
                      aria-pressed={answer === o}
                      className={answer === o ? "selected" : ""}
                      onClick={() => choose(i, o)}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="key-footer">
            <SavedIndicator dirty={dirty} />
            <button
              className="button button-primary"
              onClick={save}
              disabled={!dirty}
            >
              <Save size={15} />
              {completed === draft.questions ? "Save answer key" : "Save draft"}
            </button>
          </div>
        </section>
        <aside className="key-aside">
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>Assessment details</h2>
                <p>A few things that make it yours.</p>
              </div>
              <BookOpen size={17} className="muted" />
            </div>
            <div className="form-fields">
              <label>
                Assessment name
                <input
                  value={draft.title}
                  maxLength={70}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, title: e.target.value }))
                  }
                />
              </label>
              <label>
                Subject
                <input
                  value={draft.subject}
                  maxLength={35}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, subject: e.target.value }))
                  }
                />
              </label>
              <label>
                Assessment date
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, date: e.target.value }))
                  }
                />
              </label>
              <div className="form-divider" />
              <h3>Scoring rules</h3>
              <div className="form-two-columns">
                <label>
                  Correct answer
                  <span className="number-input">
                    <span>+</span>
                    <input
                      type="number"
                      min="0.25"
                      max="100"
                      step="0.25"
                      value={draft.marksCorrect}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          marksCorrect: Number(e.target.value),
                        }))
                      }
                    />
                  </span>
                </label>
                <label>
                  Incorrect answer
                  <span className="number-input">
                    <span>−</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.25"
                      value={draft.negativeMarks}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          negativeMarks: Number(e.target.value),
                        }))
                      }
                    />
                  </span>
                </label>
              </div>
              <label>
                Passing score
                <span className="number-input">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={draft.passPercentage}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        passPercentage: Number(e.target.value),
                      }))
                    }
                  />
                  <span>%</span>
                </span>
              </label>
              <div className="total-marks">
                <span>Total marks</span>
                <strong>{draft.questions * draft.marksCorrect}</strong>
              </div>
            </div>
          </section>
          <section className="key-tip">
            <Sparkles size={20} />
            <h3>One key. Endless possibilities.</h3>
            <p>
              Changing an answer key automatically regrades every linked student
              result. No rescanning needed.
            </p>
          </section>
          <button
            className="button button-secondary full-width"
            onClick={() => downloadTemplate(exam)}
          >
            <ArrowDownToLine size={16} />
            Download OMR template
          </button>
          <button
            className="button button-primary full-width"
            disabled={!exam.published || dirty}
            onClick={() => navigate("scanner")}
          >
            <ScanLine size={16} />
            Let’s scan some sheets
            <ArrowRight size={15} />
          </button>
          <p className="aside-caption">
            <ShieldCheck size={12} />
            Saved securely on your device
          </p>
        </aside>
      </div>
      {createOpen && (
        <NewExamModal
          onClose={() => setCreateOpen(false)}
          onCreate={(newExam) => {
            onCreate(newExam);
            setCreateOpen(false);
          }}
        />
      )}
      {pasteOpen && (
        <Modal
          title="A little shortcut for your answer key"
          onClose={() => setPasteOpen(false)}
        >
          <div className="modal-body">
            <p className="muted">
              Paste {draft.questions} answers in order, separated by spaces,
              commas, or new lines. For example: A, C, B, D.
            </p>
            <label className="field-label">
              Your correct answers
              <textarea
                className="paste-area"
                value={paste}
                onChange={(e) => {
                  setPaste(e.target.value);
                  setPasteError("");
                }}
                placeholder="A C B D A B C D…"
                rows={7}
              />
            </label>
            {pasteError && <p className="form-error">{pasteError}</p>}
          </div>
          <div className="modal-footer">
            <button
              className="button button-secondary"
              onClick={() => setPasteOpen(false)}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={!paste.trim()}
              onClick={applyPaste}
            >
              <CheckCheck size={16} />
              Apply answers
            </button>
          </div>
        </Modal>
      )}
      {clearOpen && (
        <Modal
          title="Clear this answer key?"
          onClose={() => setClearOpen(false)}
        >
          <div className="modal-body">
            <p>
              This clears your selected answers in the editor. Your saved key
              and student results won’t change until you save.
            </p>
          </div>
          <div className="modal-footer">
            <button
              className="button button-secondary"
              onClick={() => setClearOpen(false)}
            >
              Keep answers
            </button>
            <button
              className="button button-danger"
              onClick={() => {
                setDraft((d) => ({
                  ...d,
                  answers: Array(d.questions).fill(null),
                }));
                setClearOpen(false);
              }}
            >
              Clear answers
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function NewExamModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (exam: Exam) => void;
}) {
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("Physics");
  const [count, setCount] = useState("50");
  return (
    <Modal title="A fresh start, one answer at a time." onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim() || !subject.trim()) return;
          onCreate({
            id: `exam-${crypto.randomUUID().slice(0, 8)}`,
            title: title.trim(),
            subject: subject.trim(),
            date: new Date().toISOString().slice(0, 10),
            questions: Number(count),
            marksCorrect: 2,
            negativeMarks: 0,
            passPercentage: 40,
            answers: Array(Number(count)).fill(null),
            published: false,
          });
        }}
      >
        <div className="modal-body">
          <div className="new-exam-icon">
            <FileCheck2 size={27} />
          </div>
          <p className="muted">
            Give your assessment a name. Then add the correct options to create
            your answer key.
          </p>
          <div className="form-fields no-padding">
            <label>
              Assessment name
              <input
                required
                value={title}
                maxLength={70}
                placeholder="e.g. Mid-term assessment"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="form-two-columns">
              <label>
                Subject
                <input
                  required
                  value={subject}
                  maxLength={35}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </label>
              <label>
                Number of questions
                <Select
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                >
                  {[10, 20, 30, 40, 50, 60, 100].map((n) => (
                    <option key={n} value={n}>
                      {n} questions
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Not now
          </button>
          <button className="button button-primary" type="submit">
            <Plus size={16} />
            Create answer key
          </button>
        </div>
      </form>
    </Modal>
  );
}
