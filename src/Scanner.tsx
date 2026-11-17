import { useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  FileCheck2,
  FileImage,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ScanLine,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type { Exam, Option, Page, Result, Workspace } from "./data";
import { OPTIONS } from "./data";
import { createSheet, downloadTemplate, scanFile } from "./omr";
import { PageHeading, ResultsTable, Select } from "./components";
import { ExamBar } from "./Overview";

interface QueueItem {
  id: string;
  file: File;
  name: string;
  roll: string;
  status: "queued" | "scanning" | "done" | "error";
  error?: string;
}
interface Props {
  workspace: Workspace;
  exam: Exam;
  results: Result[];
  setExamId: (id: string) => void;
  navigate: (p: Page) => void;
  onResults: (results: Result[]) => void;
  onOpen: (result: Result) => void;
  toast: (text: string) => void;
}
export default function Scanner({
  workspace,
  exam,
  results,
  setExamId,
  navigate,
  onResults,
  onOpen,
  toast,
}: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [section, setSection] = useState("12 A");
  const [customSection, setCustomSection] = useState("");
  const [completed, setCompleted] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const preview = useMemo(
    () => createSheet(exam).toDataURL("image/png"),
    [exam],
  );
  const addFiles = (files: File[]) => {
    if (busy) return;
    if (!exam.published) {
      toast("Complete your answer key before adding sheets.");
      return;
    }
    const valid = files.filter(
      (f) =>
        ["image/png", "image/jpeg", "image/webp", "image/bmp"].includes(
          f.type,
        ) && f.size <= 20 * 1024 * 1024,
    );
    if (valid.length !== files.length)
      toast("Only PNG, JPG, WebP or BMP images under 20 MB can be added.");
    if (valid.length + queue.length > 30) {
      toast("Please scan up to 30 sheets per batch.");
      return;
    }
    setQueue((q) => [
      ...q,
      ...valid.map((file) => {
        const basename = file.name
          .replace(/\.[^.]+$/, "")
          .replace(/[_-]/g, " ");
        const roll = basename.match(/\d+$/)?.[0] || "";
        return {
          id: crypto.randomUUID(),
          file,
          name: basename.replace(/\s*\d+$/, "").trim() || "New student",
          roll,
          status: "queued" as const,
        };
      }),
    ]);
    setCompleted(0);
    if (input.current) input.current.value = "";
  };
  const scan = async (items = queue) => {
    if (busy || !exam.published) return;
    const pending = items.filter(
      (i) => i.status === "queued" || i.status === "error",
    );
    if (!pending.length) return;
    if (section === "custom" && !customSection.trim()) {
      toast("Please add a class or section name before scanning.");
      return;
    }
    if (pending.some((i) => !i.name.trim())) {
      toast("Please enter a student name for each sheet.");
      return;
    }
    setBusy(true);
    setCompleted(0);
    const fresh: Result[] = [];
    for (const item of pending) {
      setQueue((q) =>
        q.map((i) =>
          i.id === item.id ? { ...i, status: "scanning", error: undefined } : i,
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      try {
        const analyzed = await scanFile(item.file, exam);
        fresh.push({
          id: crypto.randomUUID(),
          studentId: `scan-${crypto.randomUUID().slice(0, 8)}`,
          name: item.name.trim(),
          roll:
            item.roll.trim() ||
            `S${String(workspace.results.filter((r) => r.source === "scan").length + fresh.length + 1).padStart(4, "0")}`,
          section: section === "custom" ? customSection.trim() : section,
          examId: exam.id,
          ...analyzed,
          confirmed: false,
          createdAt: new Date().toISOString(),
          source: "scan",
        });
        setQueue((q) =>
          q.map((i) => (i.id === item.id ? { ...i, status: "done" } : i)),
        );
      } catch (error) {
        setQueue((q) =>
          q.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  status: "error",
                  error:
                    error instanceof Error
                      ? error.message
                      : "Could not read this image. Try a clearer scan.",
                }
              : i,
          ),
        );
      }
    }
    if (fresh.length) {
      onResults(fresh);
      setCompleted(fresh.length);
      toast(
        `${fresh.length} ${fresh.length === 1 ? "sheet checked" : "sheets checked"}. A little less marking, a lot more insight.`,
      );
    }
    setBusy(false);
  };
  const demo = async () => {
    if (busy) return;
    const items: QueueItem[] = [];
    for (let n = 0; n < 2; n++) {
      const answers: (Option | null)[] = exam.answers.map((a, q) =>
        (q + n) % (n ? 4 : 7) === 0 ? OPTIONS.find((o) => o !== a)! : a,
      );
      const name = n ? "Neel Bose" : "Maya Verma";
      const roll = n ? "13002" : "13001";
      const canvas = createSheet(exam, answers, name, roll);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/png"),
      );
      items.push({
        id: crypto.randomUUID(),
        file: new File([blob], `${name.replace(" ", "_")}_${roll}.png`, {
          type: "image/png",
        }),
        name,
        roll,
        status: "queued",
      });
    }
    setQueue(items);
    await scan(items);
  };
  const queued = queue.filter(
    (q) => q.status === "queued" || q.status === "error",
  ).length;
  return (
    <>
      <PageHeading
        eyebrow="MEET YOUR NEW TEACHING ASSISTANT"
        title="From paper to possibility."
        description="Upload your OMR sheets. We’ll make sense of every answer."
        actions={
          <button
            className="button button-secondary"
            onClick={() => downloadTemplate(exam)}
          >
            <ArrowDownToLine size={16} />
            Download template
          </button>
        }
      />
      <ExamBar
        workspace={workspace}
        exam={exam}
        setExamId={(id) => {
          if (busy) return;
          setQueue([]);
          setCompleted(0);
          setExamId(id);
        }}
      />
      <div className="scanner-steps">
        <div className={exam.published ? "completed" : "active"}>
          <span>{exam.published ? <Check size={15} /> : "1"}</span>
          <div>
            <strong>Choose your answer key</strong>
            <small>
              {exam.published
                ? `${exam.questions} answers. Ready to go.`
                : "Complete your key to continue."}
            </small>
          </div>
        </div>
        <i />
        <div className={completed ? "completed" : "active"}>
          <span>{completed ? <Check size={15} /> : "2"}</span>
          <div>
            <strong>Upload answer sheets</strong>
            <small>One sheet or a whole classroom.</small>
          </div>
        </div>
        <i />
        <div className={completed ? "active" : ""}>
          <span>3</span>
          <div>
            <strong>Let the insights begin</strong>
            <small>Graded. Sorted. Ready for you.</small>
          </div>
        </div>
      </div>
      {!exam.published && (
        <div className="notice notice-amber">
          <KeyRound size={20} />
          <div>
            <strong>Your answer key needs a few more answers.</strong>
            <p>
              Choose a correct option for all {exam.questions} questions before
              you scan.
            </p>
          </div>
          <button
            className="button button-secondary"
            onClick={() => navigate("keys")}
          >
            Complete answer key
            <ArrowRight size={14} />
          </button>
        </div>
      )}
      <div className="scanner-layout">
        <div>
          <section className="card upload-card">
            <div className="card-heading">
              <div>
                <h2>Let’s check those sheets.</h2>
                <p>Your classroom’s next chapter is just an upload away.</p>
              </div>
              <Select
                aria-label="Class for new scans"
                className="small-select"
                value={section}
                onChange={(e) => setSection(e.target.value)}
                disabled={busy}
              >
                {[
                  ...new Set([
                    "12 A",
                    "12 B",
                    "12 C",
                    "12 D",
                    ...workspace.results.map((r) => r.section),
                  ]),
                ].map((s) => (
                  <option key={s} value={s}>
                    Class {s}
                  </option>
                ))}
                <option value="custom">Other class…</option>
              </Select>
            </div>
            {section === "custom" && (
              <div className="scan-custom-class">
                <label className="field-label">
                  Class or section name
                  <input
                    value={customSection}
                    maxLength={30}
                    disabled={busy}
                    onChange={(e) => setCustomSection(e.target.value)}
                    placeholder="e.g. 10 B"
                  />
                </label>
              </div>
            )}
            <div
              className={`dropzone ${dragging ? "dragging" : ""} ${!exam.published ? "disabled" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <div className="upload-illustration">
                <span className="upload-paper">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
                <span className="upload-icon">
                  <ScanLine size={29} />
                </span>
                <span className="upload-spark">✳</span>
              </div>
              <h2>
                A stack of sheets.
                <br />A few seconds.
              </h2>
              <p>Drop your OMR images here, or choose them below.</p>
              <button
                className="button button-dark"
                disabled={busy || !exam.published}
                onClick={() => input.current?.click()}
              >
                <Upload size={16} />
                Choose answer sheets
              </button>
              <small>
                PNG, JPG or WebP · Up to 20 MB per sheet · 30 sheets per batch
              </small>
              <input
                ref={input}
                type="file"
                className="sr-only"
                aria-label="Upload OMR images"
                accept="image/png,image/jpeg,image/webp,image/bmp"
                multiple
                onChange={(e) => addFiles(Array.from(e.target.files || []))}
              />
            </div>
            <div className="sample-callout">
              <Sparkles size={17} />
              <span>Just looking around? Give it a test run.</span>
              <button onClick={demo} disabled={busy || !exam.published}>
                Try sample sheets
                <ArrowRight size={14} />
              </button>
            </div>
          </section>
          {queue.length > 0 && (
            <section className="card queue-card">
              <div className="card-heading">
                <div>
                  <h2>
                    Your sheets
                    <span className="count-badge">{queue.length}</span>
                  </h2>
                  <p>
                    Check the student details. We’ll read the bubbles
                    automatically.
                  </p>
                </div>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setQueue([]);
                    setCompleted(0);
                  }}
                >
                  Clear all
                </button>
              </div>
              <div className="scan-queue">
                {queue.map((item) => (
                  <div
                    className={`queue-row queue-${item.status}`}
                    key={item.id}
                  >
                    <span className="file-icon">
                      <FileImage size={22} />
                    </span>
                    <div className="queue-file">
                      <strong title={item.file.name}>{item.file.name}</strong>
                      <small>
                        {(item.file.size / 1024).toFixed(0)} KB
                        {item.status === "done" ? " · Checked and saved" : ""}
                      </small>
                      {item.error && <p className="form-error">{item.error}</p>}
                      <div className="queue-fields">
                        <input
                          aria-label={`Student name for ${item.file.name}`}
                          value={item.name}
                          disabled={busy || item.status === "done"}
                          onChange={(e) =>
                            setQueue((q) =>
                              q.map((i) =>
                                i.id === item.id
                                  ? { ...i, name: e.target.value }
                                  : i,
                              ),
                            )
                          }
                          placeholder="Student name"
                        />
                        <input
                          aria-label={`Roll number for ${item.file.name}`}
                          value={item.roll}
                          disabled={busy || item.status === "done"}
                          onChange={(e) =>
                            setQueue((q) =>
                              q.map((i) =>
                                i.id === item.id
                                  ? { ...i, roll: e.target.value }
                                  : i,
                              ),
                            )
                          }
                          placeholder="Roll no. (optional)"
                        />
                      </div>
                    </div>
                    {item.status === "scanning" ? (
                      <LoaderCircle className="spin" size={19} />
                    ) : item.status === "done" ? (
                      <CheckCheck size={20} className="green-text" />
                    ) : (
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() =>
                          setQueue((q) => q.filter((i) => i.id !== item.id))
                        }
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="key-footer">
                <span className="muted small">
                  {busy
                    ? "Reading registration marks and checking answers…"
                    : `${queued} ${queued === 1 ? "sheet" : "sheets"} ready to check`}
                </span>
                <button
                  className="button button-primary"
                  disabled={busy || !queued}
                  onClick={() => scan()}
                >
                  {busy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <ScanLine size={16} />
                  )}{" "}
                  {busy
                    ? "Checking sheets…"
                    : `Check ${queued || ""} ${queued === 1 ? "sheet" : "sheets"}`}
                </button>
              </div>
            </section>
          )}
          {completed > 0 && (
            <div className="notice notice-green">
              <span className="notice-success-icon">
                <Check size={20} />
              </span>
              <div>
                <strong>{completed} sheets. Checked, just like that.</strong>
                <p>Your new results and analysis are ready.</p>
              </div>
              <button
                className="button button-dark"
                onClick={() => navigate("students")}
              >
                See results
                <ArrowRight size={15} />
              </button>
            </div>
          )}
          <p className="privacy-line">
            <LockKeyhole size={13} />
            Read right here in your browser. Your answer sheet images never
            leave your device.
          </p>
        </div>
        <aside>
          <div className="template-card">
            <span className="eyebrow">
              A GOOD START MAKES ALL THE DIFFERENCE
            </span>
            <h2>
              Made to read.
              <br />
              Easy to print.
            </h2>
            <div className="template-preview">
              <span className="template-back-sheet" />
              <img
                src={preview}
                alt="Preview of the printable Markly OMR sheet with four registration markers"
              />
              <span className="template-sticker">
                <FileCheck2 size={14} />
                {exam.questions} questions
              </span>
            </div>
            <p>
              For accurate results, use our OMR template. A little structure
              goes a long way.
            </p>
            <button
              className="button button-secondary full-width"
              onClick={() => downloadTemplate(exam)}
            >
              <ArrowDownToLine size={15} />
              Get your free template
            </button>
          </div>
          <div className="scan-tips">
            <h3>A few tips for a great scan</h3>
            <p>
              <span>01</span>Fill each bubble fully with a dark pen.
            </p>
            <p>
              <span>02</span>Keep the sheet upright and well lit.
            </p>
            <p>
              <span>03</span>Include all four black corner squares.
            </p>
            <p>
              <span>04</span>We’ll flag any unclear marks for review.
            </p>
          </div>
        </aside>
      </div>
      {results.some((r) => r.source === "scan") && (
        <section className="card recent-scans">
          <div className="card-heading">
            <div>
              <h2>Fresh off your scanner</h2>
              <p>Real sheets. Ready-to-use results.</p>
            </div>
          </div>
          <ResultsTable
            exam={exam}
            results={results
              .filter((r) => r.source === "scan")
              .slice(-5)
              .reverse()}
            onOpen={onOpen}
          />
        </section>
      )}
    </>
  );
}
