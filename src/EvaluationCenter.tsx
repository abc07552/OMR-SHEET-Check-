import { useEffect, useState } from "react";
import {
  CheckCheck,
  FileCheck2,
  History,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { z } from "zod";
import type { Exam, Option, Workspace } from "./data";
import { getOptions, gradeResult } from "./data";
import { defaultMarkingRules } from "./scoring";
import { api, useSession } from "./session";
import { ExamBar } from "./Overview";
import { PageHeading, Select } from "./components";
import type { SaveStatus } from "./session";
const rulesSchema = z.object({
  partialMarks: z.number().min(0).max(100),
  unansweredMarks: z.number().min(-100).max(100),
  multiplePolicy: z.enum(["review", "wrong", "partial", "exact"]),
  floorZero: z.boolean(),
  grades: z
    .array(
      z.object({
        name: z.string().min(1).max(20),
        min: z.number().min(0).max(100),
      }),
    )
    .min(1)
    .max(20),
  version: z.number().int().positive(),
});
export default function EvaluationCenter({
  workspace,
  exam,
  setExamId,
  onSave,
  toast,
  revision,
  reload,
  status,
}: {
  workspace: Workspace;
  exam: Exam;
  setExamId: (id: string) => void;
  onSave: (e: Exam) => void;
  toast: (s: string) => void;
  revision: number;
  reload: () => Promise<void>;
  status: SaveStatus;
}) {
  const session = useSession(),
    member = session.user?.memberships.find(
      (m) => m.schoolId === workspace.activeSchoolId,
    ),
    admin = session.phase === "local" || member?.role === "admin";
  const [rules, setRules] = useState({
      ...defaultMarkingRules,
      ...exam.markingRules,
    }),
    [published, setPublished] = useState(!!exam.resultsPublished),
    [classes, setClasses] = useState(exam.classIds || []),
    [sets, setSets] = useState(
      (exam.questionSets || []).map((s) => ({
        code: s.code,
        text: s.answers.map((a) => a?.join("") || "-").join(" "),
      })),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setRules({ ...defaultMarkingRules, ...exam.markingRules });
    setPublished(!!exam.resultsPublished);
    setClasses(exam.classIds || []);
    setSets(
      (exam.questionSets || []).map((s) => ({
        code: s.code,
        text: s.answers.map((a) => a?.join("") || "-").join(" "),
      })),
    );
    setError("");
  }, [exam]);
  const save = () => {
    setError("");
    const parsed = rulesSchema.safeParse(rules);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Check the scoring rules.");
      return;
    }
    const variants: NonNullable<Exam["questionSets"]> = [];
    for (const set of sets) {
      const tokens = set.text
        .toUpperCase()
        .trim()
        .split(/[\s,;|]+/)
        .filter(Boolean);
      if (
        !set.code.trim() ||
        variants.some(
          (v) => v.code.toUpperCase() === set.code.trim().toUpperCase(),
        ) ||
        tokens.length !== exam.questions ||
        tokens.some(
          (t) =>
            t !== "-" &&
            ([...t].some((o) => !getOptions(exam).includes(o as Option)) ||
              new Set(t).size !== t.length),
        )
      ) {
        setError(
          `Each set needs a unique code and exactly ${exam.questions} responses. Use AB for an exact multi-answer key and - for unkeyed questions.`,
        );
        return;
      }
      variants.push({
        code: set.code.trim().toUpperCase(),
        answers: tokens.map((t) => (t === "-" ? null : ([...t] as Option[]))),
      });
    }
    onSave({
      ...exam,
      markingRules: {
        ...parsed.data,
        version: (exam.markingRules?.version || 0) + 1,
      },
      questionSets: variants,
      classIds: classes,
      resultsPublished: published,
    });
    toast(
      "Rules saved to the workspace. The server versions the key and deterministically re-evaluates changed records; unresolved responses remain under review.",
    );
  };
  const ownResults = workspace.results.filter((r) => r.examId === exam.id),
    review = ownResults.filter((r) => gradeResult(r, exam).needsReview).length;
  return (
    <>
      <PageHeading
        eyebrow="CONSISTENT. EXPLAINABLE. VERSIONED."
        title="Every mark has a reason."
        description="Configure deterministic scoring, question sets, class access and deliberate publication."
        actions={
          <button className="button button-primary" onClick={save}>
            <Save size={16} />
            Save evaluation policy
          </button>
        }
      />
      <ExamBar workspace={workspace} exam={exam} setExamId={setExamId} />
      {error && (
        <p className="v2-notice warning" role="alert">
          {error}
        </p>
      )}
      <div className="enterprise-two-columns">
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>
                <FileCheck2 size={18} />
                Marking rules
              </h2>
              <p>
                Correct +{exam.marksCorrect} · Incorrect −{exam.negativeMarks} ·
                Pass {exam.passPercentage}%
              </p>
            </div>
            <span className="soft-tag">Key v{exam.keyVersion || 1}</span>
          </div>
          <div className="form-fields">
            <label>
              Multiple-mark response policy
              <Select
                value={rules.multiplePolicy}
                onChange={(e) =>
                  setRules({
                    ...rules,
                    multiplePolicy: e.target
                      .value as typeof rules.multiplePolicy,
                  })
                }
              >
                <option value="review">Require human verification</option>
                <option value="wrong">Score as incorrect</option>
                <option value="partial">
                  Partial credit only for a correct subset
                </option>
                <option value="exact">Exact multi-answer key match only</option>
              </Select>
            </label>
            <div className="form-two-columns">
              <label>
                Partial credit
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={rules.partialMarks}
                  onChange={(e) =>
                    setRules({ ...rules, partialMarks: +e.target.value })
                  }
                />
              </label>
              <label>
                Unanswered marks
                <input
                  type="number"
                  min={-100}
                  max={100}
                  step="0.01"
                  value={rules.unansweredMarks}
                  onChange={(e) =>
                    setRules({ ...rules, unansweredMarks: +e.target.value })
                  }
                />
              </label>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={rules.floorZero}
                onChange={(e) =>
                  setRules({ ...rules, floorZero: e.target.checked })
                }
              />
              Floor the final score at zero
            </label>
            <p className="small muted">
              Score = positive credits − negative penalties. A partial response
              receives at most the marks for a correct answer. Multiple marks
              under review receive no credit until verified. Identity and
              missing-page review cannot be bypassed by a scoring rule.
            </p>
          </div>
        </section>
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>
                <ShieldCheck size={18} />
                Access & publication
              </h2>
              <p>
                Scanning readiness and student result publication are separate
                decisions.
              </p>
            </div>
          </div>
          <div className="form-fields">
            <strong>Assigned classes</strong>
            {(workspace.classes || []).length ? (
              workspace.classes?.map((c) => (
                <label key={c.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={classes.includes(c.id)}
                    onChange={(e) =>
                      setClasses(
                        e.target.checked
                          ? [...classes, c.id]
                          : classes.filter((id) => id !== c.id),
                      )
                    }
                  />
                  {c.name} <span className="muted">{c.academicYear}</span>
                </label>
              ))
            ) : (
              <p className="muted">
                Create classes in Settings before granting teacher access.
              </p>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                disabled={!admin}
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
              />
              <CheckCheck size={16} />
              Publish evaluated results to linked student accounts
            </label>
            <p className="small muted">
              {ownResults.length - review} evaluated · {review} under review.
              Unverified results remain private even when publication is
              enabled. Only administrators can publish.
            </p>
            <button
              className="button button-secondary"
              disabled={
                busy ||
                status !== "saved" ||
                session.offline ||
                session.backend !== "fastapi"
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const response = await api<{ evaluated: number }>(
                    `/schools/${workspace.activeSchoolId}/exams/${exam.id}/reevaluate`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        revision,
                        operationId: crypto.randomUUID(),
                        reason:
                          "Explicit staff re-evaluation from policy center",
                      }),
                    },
                  );
                  await reload();
                  toast(
                    `${response.evaluated} authorized results re-evaluated. A history entry and audit event were recorded.`,
                  );
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Re-evaluation failed.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw size={15} className={busy ? "spinning" : ""} />
              Re-evaluate authorized results
            </button>
          </div>
        </section>
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Grade bands</h2>
              <p>Highest matching minimum percentage wins.</p>
            </div>
            <button
              className="icon-button"
              aria-label="Add grade band"
              disabled={rules.grades.length >= 20}
              onClick={() =>
                setRules({
                  ...rules,
                  grades: [...rules.grades, { name: "New", min: 0 }],
                })
              }
            >
              <Plus size={17} />
            </button>
          </div>
          <div className="form-fields">
            {rules.grades.map((g, i) => (
              <div key={i} className="grade-band-row">
                <label>
                  Grade
                  <input
                    aria-label={`Grade ${i + 1} name`}
                    value={g.name}
                    maxLength={20}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        grades: rules.grades.map((old, n) =>
                          n === i ? { ...old, name: e.target.value } : old,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Minimum %
                  <input
                    aria-label={`Grade ${i + 1} minimum`}
                    type="number"
                    min={0}
                    max={100}
                    value={g.min}
                    onChange={(e) =>
                      setRules({
                        ...rules,
                        grades: rules.grades.map((old, n) =>
                          n === i ? { ...old, min: +e.target.value } : old,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  className="icon-button danger-text"
                  aria-label={`Remove grade ${g.name}`}
                  disabled={rules.grades.length < 2}
                  onClick={() =>
                    setRules({
                      ...rules,
                      grades: rules.grades.filter((_, n) => n !== i),
                    })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Question-set keys</h2>
              <p>
                Optional alternate sets. Separate responses with spaces; AB is a
                two-option correct key.
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="Add question set"
              disabled={sets.length >= 26}
              onClick={() =>
                setSets([
                  ...sets,
                  {
                    code: "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[sets.length] || "Z",
                    text: exam.answers.map((a) => a || "-").join(" "),
                  },
                ])
              }
            >
              <Plus size={17} />
            </button>
          </div>
          <div className="form-fields">
            {sets.length ? (
              sets.map((s, i) => (
                <div key={i} className="question-set-editor">
                  <div className="row-actions">
                    <label>
                      Set code
                      <input
                        value={s.code}
                        maxLength={20}
                        onChange={(e) =>
                          setSets(
                            sets.map((v, n) =>
                              n === i ? { ...v, code: e.target.value } : v,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      className="icon-button danger-text"
                      aria-label={`Remove set ${s.code}`}
                      onClick={() => setSets(sets.filter((_, n) => n !== i))}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <label>
                    Answers · {exam.questions} questions
                    <textarea
                      rows={4}
                      value={s.text}
                      onChange={(e) =>
                        setSets(
                          sets.map((v, n) =>
                            n === i ? { ...v, text: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              ))
            ) : (
              <p className="muted">
                No alternate sets: the main answer key applies. Add an A set as
                well if you introduce B, C or other versions.
              </p>
            )}
            <div className="v2-notice">
              <History size={17} />
              <p>
                Key, marking-rule and template changes retain prior evaluations
                on the server. Rank uses competition ties; percentile counts
                strictly lower evaluated scores.
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
