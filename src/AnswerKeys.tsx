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
import { getOptions } from "./data";
import { questionType, validAnswer } from "./answers";
import type { QuestionType } from "./answers";
import { changeQuestionTypes, layoutErrors } from "./layout";
import IntegerAnswerInput from "./IntegerAnswerInput";
import { downloadTemplatePDF } from "./omr";
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
  const [keyPage, setKeyPage] = useState(0);
  const [typeFrom, setTypeFrom] = useState(1),
    [typeTo, setTypeTo] = useState(exam.questions),
    [rangeType, setRangeType] = useState<QuestionType>("integer3");
  const typesLocked = workspace.results.some((r) => r.examId === exam.id);
  const changeTypes = (from: number, to: number, type: QuestionType) => {
    if (typesLocked) {
      toast(
        "Create a new assessment to change question types after results exist.",
      );
      return;
    }
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 1 ||
      to < from ||
      to > draft.questions
    ) {
      toast("Choose a valid question range.");
      return;
    }
    const types = Array.from({ length: draft.questions }, (_, q) =>
      q >= from - 1 && q < to ? type : questionType(draft, q),
    );
    setDraft(changeQuestionTypes(draft, types));
  };
  useEffect(() => {
    setDraft({ ...exam, answers: [...exam.answers] });
    setKeyPage(0);
    setTypeFrom(1);
    setTypeTo(exam.questions);
  }, [exam]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(exam);
  const completed = draft.answers.filter(Boolean).length;
  const save = () => {
    if (
      !draft.title.trim() ||
      !draft.subject.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ||
      !Number.isFinite(Date.parse(draft.date)) ||
      new Date(draft.date).toISOString().slice(0, 10) !== draft.date ||
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
    const covered = new Set<number>();
    for (const s of draft.subjects || []) {
      if (
        !s.name.trim() ||
        !Number.isInteger(s.from) ||
        !Number.isInteger(s.to) ||
        s.from < 1 ||
        s.to < s.from ||
        s.to > draft.questions
      ) {
        toast("Check the subject names and question ranges.");
        return;
      }
      for (let q = s.from; q <= s.to; q++) {
        if (covered.has(q)) {
          toast("Subject question ranges must not overlap.");
          return;
        }
        covered.add(q);
      }
    }
    if (draft.subjects?.length && covered.size !== draft.questions) {
      toast(
        "Subject ranges must cover every question for complete subject analytics.",
      );
      return;
    }
    const geometryErrors = layoutErrors(draft);
    if (geometryErrors.length) {
      toast(geometryErrors[0]);
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
    const values = draft.questionTypes?.includes("integer3")
      ? paste
          .toUpperCase()
          .trim()
          .split(/[\s,;|]+/)
          .filter(Boolean)
          .map((v, q) =>
            questionType(draft, q) === "integer3" && /^[0-9]{1,3}$/.test(v)
              ? v.padStart(3, "0")
              : v,
          )
      : paste
          .toUpperCase()
          .replace(/[\s,;|\d.():\-]/g, "")
          .split("");
    if (
      values.length !== draft.questions ||
      values.some((v, q) => !validAnswer(draft, q, v))
    ) {
      setPasteError(
        `Enter exactly ${draft.questions} answers using ${getOptions(draft).join(", ")} for MCQs and 0–999 for integer questions. You entered ${values.length}.`,
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
          {draft.questions > 50 && (
            <div className="key-page-controls">
              <span>
                Questions {keyPage * 50 + 1}–
                {Math.min(draft.questions, (keyPage + 1) * 50)}
              </span>
              <Select
                aria-label="Answer key question range"
                value={keyPage}
                onChange={(e) => setKeyPage(Number(e.target.value))}
              >
                {Array.from(
                  { length: Math.ceil(draft.questions / 50) },
                  (_, p) => (
                    <option value={p} key={p}>
                      {p * 50 + 1}–{Math.min(draft.questions, (p + 1) * 50)}
                    </option>
                  ),
                )}
              </Select>
            </div>
          )}
          <div className="answer-key-grid">
            {draft.answers
              .slice(keyPage * 50, (keyPage + 1) * 50)
              .map((answer, localIndex) => {
                const i = keyPage * 50 + localIndex;
                return (
                  <div
                    className={`answer-key-question ${answer ? "filled" : ""}`}
                    key={i}
                  >
                    <span className="question-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      {questionType(draft, i) === "integer3" ? (
                        <IntegerAnswerInput
                          label={`Question ${i + 1}, three-digit integer answer`}
                          value={answer}
                          onChange={(value) =>
                            setDraft((d) => ({
                              ...d,
                              answers: d.answers.map((a, q) =>
                                q === i ? value : a,
                              ),
                            }))
                          }
                        />
                      ) : (
                        getOptions(draft).map((o) => (
                          <button
                            key={o}
                            aria-label={`Question ${i + 1}, option ${o}`}
                            aria-pressed={answer === o}
                            className={answer === o ? "selected" : ""}
                            onClick={() => choose(i, o)}
                          >
                            {o}
                          </button>
                        ))
                      )}
                    </div>
                    <Select
                      aria-label={`Question ${i + 1} answer type`}
                      disabled={typesLocked}
                      value={questionType(draft, i)}
                      onChange={(e) =>
                        changeTypes(
                          i + 1,
                          i + 1,
                          e.target.value as QuestionType,
                        )
                      }
                    >
                      <option value="choice">MCQ</option>
                      <option value="integer3">3-digit integer</option>
                    </Select>
                  </div>
                );
              })}
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
          <section className="card subject-range-editor">
            <div className="card-heading">
              <div>
                <h2>Subjects & sections</h2>
                <p>Question ranges power subject analytics.</p>
              </div>
            </div>
            <div className="form-fields">
              {(draft.subjects || []).map((s, i) => (
                <div className="subject-range" key={i}>
                  <label>
                    Subject
                    <input
                      aria-label={`Subject ${i + 1} name`}
                      value={s.name}
                      maxLength={60}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          subjects: d.subjects!.map((v, j) =>
                            j === i ? { ...v, name: e.target.value } : v,
                          ),
                        }))
                      }
                    />
                  </label>
                  <div className="form-two-columns">
                    {(["from", "to"] as const).map((k) => (
                      <label key={k}>
                        {k === "from" ? "First question" : "Last question"}
                        <input
                          aria-label={`Subject ${i + 1} ${k}`}
                          type="number"
                          min={1}
                          max={draft.questions}
                          value={s[k]}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              subjects: d.subjects!.map((v, j) =>
                                j === i
                                  ? { ...v, [k]: Number(e.target.value) }
                                  : v,
                              ),
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    className="text-button danger-text"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        subjects: d.subjects!.filter((_, j) => j !== i),
                      }))
                    }
                  >
                    Remove subject
                  </button>
                </div>
              ))}
              <button
                className="button button-secondary button-small"
                disabled={(draft.subjects?.length || 0) >= 30}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    subjects: [
                      ...(d.subjects || []),
                      {
                        name: "",
                        from: (d.subjects?.at(-1)?.to || 0) + 1,
                        to: d.questions,
                      },
                    ],
                  }))
                }
              >
                <Plus size={14} />
                Add subject range
              </button>
              <p className="small muted">
                Leave empty for a single-subject exam. Otherwise cover all
                questions with non-overlapping ranges.
              </p>
            </div>
          </section>
          <button
            className="button button-secondary full-width"
            disabled={dirty}
            title={
              dirty
                ? "Save the key and types before opening Layout Studio"
                : undefined
            }
            onClick={() => navigate("templates")}
          >
            Open layout studio
            <ArrowRight size={14} />
          </button>
          <section className="card">
            <div className="card-heading">
              <h2>Question answer types</h2>
            </div>
            <div className="form-fields">
              <p className="small muted">
                Mix MCQs and three-digit integers. Integer bubbles are three
                columns of 0–9; 7 is entered as 007. No signs or decimal row.
                Changing types clears those keys and regenerates the
                layout—check it before printing.
              </p>
              <div className="form-two-columns">
                <label>
                  From question
                  <input
                    type="number"
                    min="1"
                    max={draft.questions}
                    value={typeFrom}
                    onChange={(e) => setTypeFrom(Number(e.target.value))}
                  />
                </label>
                <label>
                  To question
                  <input
                    type="number"
                    min="1"
                    max={draft.questions}
                    value={typeTo}
                    onChange={(e) => setTypeTo(Number(e.target.value))}
                  />
                </label>
              </div>
              <label>
                Answer type
                <Select
                  value={rangeType}
                  disabled={typesLocked}
                  onChange={(e) => setRangeType(e.target.value as QuestionType)}
                >
                  <option value="choice">Multiple choice</option>
                  <option value="integer3">3-digit integer · 000–999</option>
                </Select>
              </label>
              <button
                className="button button-secondary"
                disabled={typesLocked}
                onClick={() => changeTypes(typeFrom, typeTo, rangeType)}
              >
                Apply type to range
              </button>
              {typesLocked && (
                <p className="small muted">
                  Types are locked because results already exist. Create a new
                  assessment for a different sheet.
                </p>
              )}
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
            onClick={() => {
              void downloadTemplatePDF(exam).catch((e) => toast(e.message));
            }}
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
            Changes follow your workspace storage mode
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
              commas, or new lines. For example: A, C, 042, 007 for a mixed key.
              Use a whole integer token, not separate digit answers.
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
  const [options, setOptions] = useState<2 | 3 | 4 | 5>(5);
  const [integer, setInteger] = useState(false);
  return (
    <Modal title="A fresh start, one answer at a time." onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !title.trim() ||
            !subject.trim() ||
            !Number.isInteger(Number(count)) ||
            Number(count) < 1 ||
            Number(count) > 500
          )
            return;
          onCreate({
            id: `exam-${crypto.randomUUID().slice(0, 8)}`,
            title: title.trim(),
            subject: subject.trim(),
            date: new Date().toISOString().slice(0, 10),
            questions: Number(count),
            optionCount: options,
            ...(integer
              ? { questionTypes: Array(Number(count)).fill("integer3") }
              : {}),
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
                <input
                  type="number"
                  required
                  min="1"
                  max="500"
                  step="1"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              </label>
            </div>
            <label>
              Answer options
              <Select
                value={integer ? "integer3" : options}
                onChange={(e) => {
                  setInteger(e.target.value === "integer3");
                  if (e.target.value !== "integer3")
                    setOptions(Number(e.target.value) as 2 | 3 | 4 | 5);
                }}
              >
                <option value={2}>2 options · A–B</option>
                <option value={3}>3 options · A–C</option>
                <option value={4}>A–D · four options</option>
                <option value={5}>A–E · five options</option>
                <option value="integer3">3-digit integer · 000–999</option>
              </Select>
            </label>
            <p className="small muted">
              Up to 500 questions. Exams longer than 100 questions print across
              multiple identified pages.
            </p>
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
