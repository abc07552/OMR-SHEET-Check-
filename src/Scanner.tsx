import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Camera,
  Check,
  CircleAlert,
  FileImage,
  FileStack,
  Focus,
  LoaderCircle,
  Play,
  ScanLine,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Upload,
  Video,
  X,
} from "lucide-react";
import type { Exam, Option, Page, Result, Workspace } from "./data";
import { getOptions } from "./data";
import { getLayout, pageCount, sheetSignature } from "./layout";
import { createSheet, downloadTemplatePDF, templatePDF } from "./omr";
import { pdfImages, scanPageFile } from "./scanEngine";
import type { ScannedPage } from "./scanEngine";
import { api, useSession } from "./session";
import { Modal, PageHeading, ResultsTable, Select } from "./components";
import { ExamBar } from "./Overview";
interface QueueItem {
  id: string;
  file: File;
  name: string;
  roll: string;
  pageIndex: number;
  status: "queued" | "scanning" | "done" | "error";
  error?: string;
  preview?: string;
  confidence?: number;
  resultId?: string;
}
interface Props {
  workspace: Workspace;
  exam: Exam;
  results: Result[];
  setExamId: (id: string) => void;
  navigate: (p: Page) => void;
  onResults: (r: Result[]) => void;
  onOpen: (r: Result) => void;
  toast: (s: string) => void;
  onBusy?: (b: boolean) => void;
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
  onBusy,
}: Props) {
  const session = useSession(),
    connected =
      session.phase === "authenticated" &&
      session.backend === "fastapi" &&
      !session.offline;
  const [queue, setQueue] = useState<QueueItem[]>([]),
    [busy, setBusy] = useState(false),
    [rendering, setRendering] = useState(false),
    [stage, setStage] = useState(""),
    [section, setSection] = useState(workspace.classes?.[0]?.name || "12 A"),
    [ocr, setOCR] = useState(true),
    [engine, setEngine] = useState<"opencv" | "opencv-python">("opencv"),
    [replace, setReplace] = useState(false),
    [dragging, setDragging] = useState(false),
    [camera, setCamera] = useState(false),
    [recent, setRecent] = useState<string[]>([]),
    [showPreview, setShowPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null),
    mobile = useRef<HTMLInputElement>(null),
    cancel = useRef(false),
    alive = useRef(true),
    queueRef = useRef(queue);
  queueRef.current = queue;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancel.current = true;
    };
  }, []);
  useEffect(() => {
    onBusy?.(busy || rendering);
    return () => {
      onBusy?.(false);
    };
  }, [busy, rendering, onBusy]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (busy || rendering) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [busy, rendering]);
  const patch = (id: string, p: Partial<QueueItem>) =>
    setQueue((q) => q.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const addFiles = async (files: File[]) => {
    if (busy || rendering) return;
    if (!exam.published) {
      toast("Complete and save the answer key before adding sheets.");
      return;
    }
    if (files.length + queue.length > 200) {
      toast("Add up to 200 images or PDF pages per batch.");
      return;
    }
    setRendering(true);
    cancel.current = false;
    let added = 0;
    const items: QueueItem[] = [];
    try {
      for (const file of files) {
        if (cancel.current) break;
        if (queue.length + items.length >= 200) {
          toast(
            "The batch reached 200 pages. Add the remaining files in another batch.",
          );
          break;
        }
        if (file.size > 50 * 1024 * 1024) {
          toast(`${file.name}: use a file smaller than 50 MB.`);
          continue;
        }
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          try {
            for await (const p of pdfImages(file, setStage)) {
              if (cancel.current) break;
              if (queue.length + items.length >= 200) {
                toast(
                  "The batch reached 200 pages. Split remaining files into another batch.",
                );
                break;
              }
              items.push({
                id: crypto.randomUUID(),
                file: p.file,
                name: "",
                roll: "",
                pageIndex: p.page % pageCount(exam),
                status: "queued",
              });
              added++;
            }
          } catch (e) {
            toast(
              `${file.name}: ${e instanceof Error ? e.message : "Could not read PDF."}`,
            );
          }
        } else if (
          ["image/png", "image/jpeg", "image/webp", "image/bmp"].includes(
            file.type,
          )
        ) {
          const base = file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "),
            roll = base.match(/(?:^|\s)(\d{3,})$/)?.[1] || "";
          items.push({
            id: crypto.randomUUID(),
            file,
            name: roll ? base.replace(/\s*\d+$/, "").trim() : "",
            roll,
            pageIndex: 0,
            status: "queued",
          });
          added++;
        } else toast(`${file.name}: use JPEG, PNG, WebP, BMP or PDF.`);
      }
      if (alive.current) {
        setQueue((q) => [...q, ...items]);
        if (added)
          toast(
            `${added} pages added. Check identities and page numbers before scanning.`,
          );
      }
    } finally {
      setRendering(false);
      setStage("");
      if (input.current) input.current.value = "";
      if (mobile.current) mobile.current.value = "";
    }
  };
  const scan = async (items = queue) => {
    if (busy || rendering || !exam.published) return;
    if (!section.trim()) {
      toast("Enter a class or section before scanning.");
      return;
    }
    const pending = items.filter(
      (i) => i.status === "queued" || i.status === "error",
    );
    if (!pending.length) return;
    setBusy(true);
    cancel.current = false;
    const updated = new Map<string, Result>(),
      all = [...results];
    let processed = 0;
    try {
      for (const item of pending) {
        if (cancel.current) break;
        patch(item.id, { status: "scanning", error: undefined });
        try {
          let read: ScannedPage;
          if (engine === "opencv-python") {
            if (!connected)
              throw new Error(
                "The native engine needs an authenticated FastAPI connection. Choose OpenCV.js for offline scanning.",
              );
            setStage("Reading on the native OpenCV server…");
            const form = new FormData();
            form.append("file", item.file);
            form.append("pageIndex", String(item.pageIndex));
            form.append("ocr", String(ocr));
            form.append("operationId", `scan-${item.id}`);
            read = await api<ScannedPage>(
              `/schools/${workspace.activeSchoolId}/exams/${exam.id}/scan`,
              { method: "POST", body: form },
            );
          } else
            read = await scanPageFile(item.file, exam, {
              pageIndex: item.pageIndex,
              ocr,
              engine: "opencv",
              onStage: setStage,
            });
          const entered = item.roll.trim(),
            detected = read.roll.trim();
          if (
            entered &&
            detected &&
            entered.toLowerCase() !== detected.toLowerCase()
          )
            throw new Error(
              `Identity mismatch: entered roll ${entered}, but the sheet reads ${detected}. Correct the roll and retry.`,
            );
          const roll = entered || detected,
            registered = workspace.students?.find(
              (s) => s.roll.toLowerCase() === roll.toLowerCase(),
            ),
            known = !!registered,
            verified =
              !!entered ||
              (!!detected &&
                (read.qrMatched || read.rollConfidence >= 75) &&
                known);
          const identityReview = !verified || (!known && !item.name.trim()),
            studentId =
              registered?.id ||
              all.find((r) => r.roll === roll && roll)?.studentId ||
              `scan-${crypto.randomUUID()}`;
          let result =
            [...updated.values()].find((r) => r.studentId === studentId) ||
            all.find((r) => r.studentId === studentId && r.examId === exam.id);
          const p = read.pageIndex,
            per = getLayout(exam).questionsPerPage,
            offset = p * per;
          if (
            result &&
            ((result.layoutSignature &&
              result.layoutSignature !== sheetSignature(exam)) ||
              (result.pageTotal && result.pageTotal !== pageCount(exam)))
          )
            throw new Error(
              "This student's saved scan uses a different layout. Restore its matching layout, or delete that result before starting a new complete scan.",
            );
          if (result && (result.pageIndices || [0]).includes(p) && !replace)
            throw new Error(
              `Page ${p + 1} is already recorded for ${result.name}. Enable “Replace a previously scanned page” to rescan it.`,
            );
          if (!result)
            result = {
              id: crypto.randomUUID(),
              studentId,
              name:
                registered?.name || item.name.trim() || "Unidentified student",
              roll: roll || `UNVERIFIED-${crypto.randomUUID().slice(0, 6)}`,
              section: registered?.section || section.trim(),
              examId: exam.id,
              answers: Array(exam.questions).fill(null),
              flagged: [],
              confirmed: false,
              createdAt: new Date().toISOString(),
              source: "scan",
              pageIndices: [],
              pageTotal: pageCount(exam),
            };
          if (
            result.questionSet &&
            result.questionSet !== (read.questionSet || "A")
          )
            throw new Error(
              "Question-set mismatch between this page and the student's saved pages. Verify the set before replacing a page.",
            );
          const { retainOriginal, uploadOriginal } =
            await import("./scanArchive");
          let objectId = read.objectId;
          if (!objectId) {
            if (connected)
              objectId = await uploadOriginal(
                workspace.activeSchoolId!,
                exam.id,
                item.file,
                `upload-${item.id}`,
              );
            else {
              if (
                session.phase === "authenticated" &&
                session.backend !== "fastapi"
              )
                toast(
                  "Legacy Node scanning: originals are not archived by this service. Migrate to FastAPI for encrypted evidence retention.",
                );
              else {
                objectId = `local-${item.id}`;
                await retainOriginal(
                  objectId,
                  item.file,
                  session.phase === "authenticated",
                );
              }
            }
          }
          const detectedOptions = (
            result.detectedOptions || result.answers.map((a) => (a ? [a] : []))
          ).map((a) => [...a]);
          (
            read.detectedOptions || read.answers.map((a) => (a ? [a] : []))
          ).forEach((a, q) => {
            detectedOptions[offset + q] = a;
          });
          const answers = [...result.answers];
          read.answers.forEach((a, q) => {
            answers[offset + q] = a;
          });
          result = {
            ...result,
            source: "scan",
            createdAt: new Date().toISOString(),
            layoutSignature: sheetSignature(exam),
            answers,
            detectedOptions,
            answerMeta: [
              ...(result.answerMeta || []).filter(
                (m) =>
                  m.question < offset ||
                  m.question >= offset + read.answers.length,
              ),
              ...(read.answerMeta || []).map((m) => ({
                ...m,
                question: m.question + offset,
              })),
            ],
            scanIds: [
              ...new Set([
                ...(result.scanIds || []),
                ...(objectId ? [objectId] : []),
              ]),
            ],
            sourceTransforms: [
              ...(result.sourceTransforms || []).filter(
                (t) => t.pageIndex !== p,
              ),
              ...(read.sourceToAligned && objectId
                ? [
                    {
                      objectId,
                      pageIndex: p,
                      sourceToAligned: read.sourceToAligned,
                    },
                  ]
                : []),
            ],
            questionSet: read.questionSet || "A",
            flagged: [
              ...result.flagged.filter(
                (q) => q < offset || q >= offset + read.answers.length,
              ),
              ...read.flagged.map((q) => offset + q),
            ],
            confirmed: false,
            missingPagesAccepted: false,
            pageIndices: [...new Set([...(result.pageIndices || [0]), p])].sort(
              (a, b) => a - b,
            ),
            identityReview: !!result.identityReview || identityReview,
            engine: read.engine,
            scanConfidence: Math.min(
              result.scanConfidence ?? 100,
              read.confidence,
            ),
          };
          updated.set(result.id, result);
          const index = all.findIndex((r) => r.id === result!.id);
          if (index >= 0) all[index] = result;
          else all.push(result);
          patch(item.id, {
            status: "done",
            name: result.name,
            roll: result.roll,
            pageIndex: p,
            preview: read.preview,
            confidence: read.confidence,
            resultId: result.id,
          });
          if (read.warnings?.length) toast(read.warnings.join(" "));
          processed++;
        } catch (e) {
          patch(item.id, {
            status: "error",
            error:
              e instanceof Error
                ? e.message
                : "Could not read this sheet. Try a clearer upright photo.",
          });
        }
      }
    } finally {
      if (updated.size && alive.current) {
        onResults([...updated.values()]);
        setRecent([...updated.keys()]);
        toast(
          `${processed} pages read into ${updated.size} student results. Review flagged identities or marks before publishing.`,
        );
      }
      setBusy(false);
      setStage("");
    }
  };
  const demo = async (pdf = false) => {
    if (busy || rendering) return;
    if (pageCount(exam) * (pdf ? 1 : 2) > 200) {
      toast(
        "This layout creates too many sample pages. Increase questions per page before generating a sample batch.",
      );
      return;
    }
    const items: QueueItem[] = [];
    for (let n = 0; n < (pdf ? 1 : 2); n++) {
      const name = n ? "Neel Bose" : "Maya Verma",
        roll = n ? "13002" : "13001",
        answers: (Option | null)[] = exam.answers.map((a, q) =>
          (q + n) % (n ? 4 : 7) === 0
            ? getOptions(exam).find((o) => o !== a)!
            : a,
        );
      if (pdf) {
        const doc = await templatePDF(exam, { name, roll }, answers);
        await addFiles([
          new File([doc.output("blob")], `${name}-${roll}.pdf`, {
            type: "application/pdf",
          }),
        ]);
        return;
      }
      for (let p = 0; p < pageCount(exam); p++) {
        const canvas = await createSheet(exam, answers, name, roll, p),
          blob = await new Promise<Blob>((r) =>
            canvas.toBlob((b) => r(b!), "image/png"),
          );
        items.push({
          id: crypto.randomUUID(),
          file: new File([blob], `${name}_${roll}_page${p + 1}.png`, {
            type: "image/png",
          }),
          name,
          roll,
          pageIndex: p,
          status: "queued",
        });
      }
    }
    setQueue(items);
    await scan(items);
  };
  const pending = queue.filter(
      (i) => i.status === "queued" || i.status === "error",
    ).length,
    done = queue.filter((i) => i.status === "done").length;
  return (
    <>
      <PageHeading
        eyebrow="PAPER IN. POSSIBILITY OUT."
        title="A smarter kind of scanning."
        description="Images, multipage PDFs, or your camera. Every answer, brought into focus."
        actions={
          <>
            <button
              className="button button-secondary"
              onClick={() => navigate("templates")}
            >
              <Settings2 size={16} />
              Layout studio
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                void downloadTemplatePDF(exam).catch((e) => toast(e.message));
              }}
            >
              <ArrowDownToLine size={16} />
              Printable OMR PDF
            </button>
          </>
        }
      />
      <ExamBar
        workspace={workspace}
        exam={exam}
        setExamId={(id) => {
          if (!busy && !rendering) {
            setQueue([]);
            setRecent([]);
            setExamId(id);
          }
        }}
      />
      {!exam.published && (
        <div className="v2-notice warning">
          <CircleAlert size={19} />
          <div>
            <strong>Your answer key needs a finishing touch.</strong>
            <p>Set every correct answer and save the key to enable scanning.</p>
          </div>
          <button
            className="button button-secondary button-small"
            onClick={() => navigate("keys")}
          >
            Complete key
            <ArrowRight size={14} />
          </button>
        </div>
      )}
      <div className="v2-scanner-grid">
        <section className="card scan-main">
          <div className="scan-mode-bar">
            <span className="active">
              <FileStack size={16} />
              Batch upload
            </span>
            <button
              disabled={!exam.published || busy || rendering}
              onClick={() => setCamera(true)}
            >
              <Video size={16} />
              Live camera <span className="tiny-new">LIVE</span>
            </button>
          </div>
          <div
            className={`v2-dropzone ${dragging ? "dragging" : ""} ${!exam.published ? "disabled" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addFiles(Array.from(e.dataTransfer.files));
            }}
          >
            <div className="drop-orbit">
              <ScanLine size={37} />
              <i />
              <i />
            </div>
            <span className="micro-label">
              LESS PAPERWORK. MORE POSSIBILITIES.
            </span>
            <h2>Bring your answer sheets to life.</h2>
            <p>
              Drop images or a multipage PDF here.
              <br />
              We’ll handle the alignment, bubbles, and numbers.
            </p>
            <div>
              <button
                className="button button-primary"
                disabled={!exam.published || busy || rendering}
                onClick={() => input.current?.click()}
              >
                <Upload size={16} />
                Browse files
              </button>
              <button
                className="button button-secondary"
                disabled={!exam.published || busy || rendering}
                onClick={() => mobile.current?.click()}
              >
                <Camera size={16} />
                Take a photo
              </button>
            </div>
            <small>
              JPEG, PNG, WebP, BMP, PDF · 50 MB per file · 200 pages per batch
            </small>
          </div>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/bmp,application/pdf"
            className="sr-only"
            aria-label="Upload OMR sheets or PDF"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files || []));
            }}
          />
          <input
            ref={mobile}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label="Capture OMR photo"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files || []));
            }}
          />
          <div className="scan-demo-row">
            <span>
              <Sparkles size={15} />
              Just exploring?
            </span>
            <button
              className="text-link"
              disabled={busy || rendering || !exam.published}
              onClick={() => {
                void demo().catch((error) =>
                  toast(
                    error instanceof Error
                      ? error.message
                      : "Sample generation failed.",
                  ),
                );
              }}
            >
              Scan 2 sample students
              <ArrowRight size={14} />
            </button>
            <button
              className="text-link"
              disabled={busy || rendering || !exam.published}
              onClick={() => {
                void demo(true).catch((error) =>
                  toast(
                    error instanceof Error
                      ? error.message
                      : "Sample PDF generation failed.",
                  ),
                );
              }}
            >
              Try sample PDF
              <ArrowRight size={14} />
            </button>
          </div>
        </section>
        <aside className="scan-settings">
          <section className="card">
            <div className="card-heading">
              <h2>
                <Focus size={17} />
                Reading preferences
              </h2>
            </div>
            <div className="form-fields">
              <label>
                Default class / section
                <input
                  list="scan-classes"
                  value={section}
                  maxLength={60}
                  onChange={(e) => setSection(e.target.value)}
                  disabled={busy || rendering}
                />
                <datalist id="scan-classes">
                  {workspace.classes?.map((c) => (
                    <option key={c.id}>{c.name}</option>
                  ))}
                </datalist>
              </label>
              <label>
                Detection engine
                <Select
                  value={engine}
                  onChange={(e) => setEngine(e.target.value as typeof engine)}
                  disabled={busy || rendering}
                >
                  <option value="opencv">OpenCV · perspective alignment</option>
                  <option value="opencv-python" disabled={!connected}>
                    Native Python OpenCV · online server
                  </option>
                </Select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={ocr}
                  disabled={busy || rendering}
                  onChange={(e) => setOCR(e.target.checked)}
                />
                Read roll numbers with OCR
              </label>
              <p className="small muted">
                Numeric OCR and QR identification match registered students.
                Low-confidence or unknown identities always require manual
                review.
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={replace}
                  disabled={busy || rendering}
                  onChange={(e) => setReplace(e.target.checked)}
                />
                Replace a previously scanned page
              </label>
              <div className="scan-layout-info">
                <LayersIcon />
                <div>
                  <strong>{exam.layout?.name || "Markly legacy layout"}</strong>
                  <span>
                    {exam.questions} questions · A–{getOptions(exam).at(-1)} ·{" "}
                    {pageCount(exam)} {pageCount(exam) > 1 ? "pages" : "page"}
                  </span>
                </div>
              </div>
            </div>
          </section>
          <div className="scan-tip">
            <ShieldCheck size={22} />
            <h3>Private by design.</h3>
            <p>
              OpenCV, PDF rendering, and OCR run in your browser. Sheet images
              are not sent to the server or saved with results. Only responses
              and verified student details are retained.
            </p>
          </div>
        </aside>
      </div>
      {(queue.length > 0 || rendering) && (
        <section className="card scan-queue">
          <div className="card-heading">
            <div>
              <h2>
                Your scanning queue{" "}
                <span className="count-badge">{queue.length}</span>
              </h2>
              <p>
                {busy || rendering
                  ? stage || "Preparing pages…"
                  : `${done} pages read. ${pending} ready or need a retry.`}
              </p>
            </div>
            <div className="row-actions">
              {busy || rendering ? (
                <button
                  className="button button-secondary button-small"
                  onClick={() => {
                    cancel.current = true;
                    toast("Stopping after the current page finishes.");
                  }}
                >
                  <Square size={13} />
                  Stop after page
                </button>
              ) : (
                <>
                  <button className="text-button" onClick={() => setQueue([])}>
                    Clear queue
                  </button>
                  <button
                    className="button button-primary"
                    disabled={!pending}
                    onClick={() => {
                      void scan();
                    }}
                  >
                    <Play size={15} />
                    Scan {pending} {pending === 1 ? "page" : "pages"}
                  </button>
                </>
              )}
            </div>
          </div>
          {(busy || rendering) && (
            <div className="scan-progress">
              <i
                style={{
                  width: `${queue.length ? ((done + queue.filter((i) => i.status === "error").length) / queue.length) * 100 : 5}%`,
                }}
              />
            </div>
          )}
          <div className="scan-queue-items">
            {queue.map((item) => (
              <div key={item.id} className={`scan-queue-item ${item.status}`}>
                <button
                  className="queue-file-icon"
                  disabled={!item.preview}
                  title={item.preview ? "View scanned page" : item.file.name}
                  onClick={() => setShowPreview(item.preview || null)}
                >
                  {item.status === "scanning" ? (
                    <LoaderCircle className="spinning" size={21} />
                  ) : item.status === "done" ? (
                    <Check size={21} />
                  ) : item.status === "error" ? (
                    <CircleAlert size={21} />
                  ) : (
                    <FileImage size={21} />
                  )}
                </button>
                <div className="queue-file-name">
                  <strong>{item.file.name}</strong>
                  <small>
                    {item.error ||
                      `${(item.file.size / 1024).toFixed(0)} KB${item.confidence !== undefined ? ` · ${item.confidence.toFixed(0)}% mark confidence` : ""}`}
                  </small>
                </div>
                <label>
                  <span>Roll number</span>
                  <input
                    aria-label={`Roll number for ${item.file.name}`}
                    value={item.roll}
                    placeholder="QR / OCR"
                    maxLength={40}
                    disabled={busy || rendering || item.status === "done"}
                    onChange={(e) => {
                      const roll = e.target.value,
                        s = workspace.students?.find(
                          (s) => s.roll.toLowerCase() === roll.toLowerCase(),
                        );
                      patch(item.id, { roll, ...(s ? { name: s.name } : {}) });
                    }}
                  />
                </label>
                <label>
                  <span>Student name</span>
                  <input
                    aria-label={`Student name for ${item.file.name}`}
                    value={item.name}
                    placeholder="Match from register"
                    maxLength={120}
                    disabled={busy || rendering || item.status === "done"}
                    onChange={(e) => patch(item.id, { name: e.target.value })}
                  />
                </label>
                <label className="queue-page">
                  <span>Page</span>
                  <Select
                    aria-label={`Page number for ${item.file.name}`}
                    value={item.pageIndex}
                    disabled={busy || rendering || item.status === "done"}
                    onChange={(e) =>
                      patch(item.id, { pageIndex: Number(e.target.value) })
                    }
                  >
                    {Array.from({ length: pageCount(exam) }, (_, p) => (
                      <option value={p} key={p}>
                        {p + 1}
                      </option>
                    ))}
                  </Select>
                </label>
                {item.status === "done" ? (
                  <button
                    className="icon-button"
                    aria-label={`Review ${item.name}`}
                    onClick={() => {
                      const r = results.find((r) => r.id === item.resultId);
                      if (r) onOpen(r);
                    }}
                  >
                    <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    className="icon-button"
                    aria-label={`Remove ${item.file.name}`}
                    disabled={busy || rendering}
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
        </section>
      )}
      {recent.length > 0 && (
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Freshly read. Ready for a closer look.</h2>
              <p>
                Review uncertain marks and identities. Multipage results remain
                provisional until all pages arrive.
              </p>
            </div>
            <button className="text-link" onClick={() => navigate("students")}>
              All results
              <ArrowRight size={14} />
            </button>
          </div>
          <ResultsTable
            results={results.filter((r) => recent.includes(r.id))}
            exam={exam}
            onOpen={onOpen}
          />
        </section>
      )}
      <p className="page-bottom-note">
        <Check size={13} />
        Keep sheets upright, evenly lit, and fully visible. Verify one sample
        before scanning a large batch.
      </p>
      {camera && (
        <CameraCapture
          exam={exam}
          onClose={() => setCamera(false)}
          onCapture={async (file) => {
            setCamera(false);
            const item: QueueItem = {
              id: crypto.randomUUID(),
              file,
              name: "",
              roll: "",
              pageIndex: 0,
              status: "queued",
            };
            setQueue((q) => [...q, item]);
            await scan([item]);
          }}
        />
      )}
      {showPreview && (
        <Modal
          title="Scanned page preview"
          onClose={() => setShowPreview(null)}
        >
          <div className="modal-body scanned-preview">
            <img src={showPreview} alt="Aligned scanned answer sheet" />
            <p className="muted">
              Temporary preview only. Original images are not retained.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
function LayersIcon() {
  return <FileStack size={21} />;
}
function CameraCapture({
  exam,
  onClose,
  onCapture,
}: {
  exam: Exam;
  onClose: () => void;
  onCapture: (f: File) => Promise<void>;
}) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [auto, setAuto] = useState(false),
    [hint, setHint] = useState("Position the whole sheet inside the guide."),
    [busy, setBusy] = useState(false),
    captured = useRef(false);
  useEffect(() => {
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Live camera is unavailable. Use an HTTPS connection, allow camera access, or use “Take a photo” instead.",
      );
      return;
    }
    void navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((s) => {
        if (!active) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => {
            setError("Tap your browser’s camera permission and try again.");
          });
        }
      })
      .catch((e) => {
        setError(
          e.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in browser settings, or use a photo upload."
            : "No available camera was found. Connect a camera or upload a photo instead.",
        );
      });
    return () => {
      active = false;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  const capture = async () => {
    if (!video.current || !ready || captured.current) return;
    captured.current = true;
    setBusy(true);
    const canvas = document.createElement("canvas");
    canvas.width = video.current.videoWidth;
    canvas.height = video.current.videoHeight;
    canvas.getContext("2d")!.drawImage(video.current, 0, 0);
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/jpeg", 0.95),
    );
    if (blob) {
      stream.current?.getTracks().forEach((t) => t.stop());
      await onCapture(
        new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" }),
      );
    } else {
      captured.current = false;
      setBusy(false);
      setError("Could not capture this frame. Please try again.");
    }
  };
  useEffect(() => {
    if (!auto || !ready) return;
    let working = false,
      stable = 0,
      disposed = false;
    let previous: { x: number; y: number }[] | null = null;
    const interval = setInterval(() => {
      if (working || captured.current || !video.current) return;
      working = true;
      void (async () => {
        try {
          const { cameraRegistration } = await import("./scanEngine");
          if (disposed || !video.current) return;
          const canvas = document.createElement("canvas");
          canvas.width = 620;
          canvas.height = Math.round(
            (video.current.videoHeight / video.current.videoWidth) * 620,
          );
          canvas
            .getContext("2d")!
            .drawImage(video.current, 0, 0, canvas.width, canvas.height);
          const points = await cameraRegistration(canvas, exam);
          if (disposed) return;
          if (!points) {
            stable = 0;
            previous = null;
            setHint("Looking for all four registration squares…");
            return;
          }
          const still =
            previous &&
            points.every(
              (p, i) =>
                Math.hypot(p.x - previous![i].x, p.y - previous![i].y) < 0.015,
            );
          stable = still ? stable + 1 : 1;
          previous = points;
          setHint(
            `Registration points detected. Hold still… ${Math.min(3, stable)}/3`,
          );
          if (stable >= 3) {
            setAuto(false);
            void capture();
          }
        } catch {
          if (!disposed) {
            setAuto(false);
            setHint(
              "Automatic framing is unavailable. Use Capture sheet below.",
            );
          }
        } finally {
          working = false;
        }
      })();
    }, 1400);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [auto, ready, exam]);
  return (
    <Modal
      title="Live camera scanner"
      className="camera-modal"
      onClose={onClose}
    >
      <div className="modal-body">
        <div className="camera-view">
          <video
            ref={video}
            playsInline
            muted
            onLoadedMetadata={() => setReady(true)}
          />
          <div className="camera-guide">
            <i />
            <i />
            <i />
            <i />
          </div>
          {!ready && !error && <LoaderCircle className="spinning" size={32} />}
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="camera-hint">
            <Focus size={15} />
            {hint}
          </p>
        )}
        <p className="small muted">
          Live framing captures the sheet; the calibrated OpenCV pipeline reads
          it automatically after capture. Automatic capture needs four visible
          registration squares. Camera access depends on browser and device
          permissions.
        </p>
      </div>
      <div className="modal-footer">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
            disabled={!ready || exam.layout?.anchorMode === "page"}
          />
          Auto-capture when framed
        </label>
        <button
          className="button button-primary"
          onClick={() => {
            void capture();
          }}
          disabled={!ready || busy}
        >
          <Camera size={16} />
          {busy ? "Capturing…" : "Capture sheet"}
        </button>
      </div>
    </Modal>
  );
}
