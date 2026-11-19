import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  CheckCheck,
  FileStack,
  Image,
  LoaderCircle,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import type { Exam, Workspace } from "./data";
import { downloadFile } from "./data";
import { api, API_BASE, useSession } from "./session";
import type { SaveStatus } from "./session";
import { EmptyState, Modal, PageHeading, Select } from "./components";
import { ExamBar } from "./Overview";
import { pageCount } from "./layout";
import { pdfImages } from "./scanEngine";
import { queryClient } from "./query";
interface Job {
  id: string;
  objectId: string;
  status: string;
  attempt: number;
  error: string;
  category: string;
  output: {
    roll?: string;
    questionSet?: string;
    confidence?: number;
    flagged?: number[];
    preview?: string;
    pageIndex?: number;
    warnings?: string[];
    answers?: (string | null)[];
    resultId?: string;
    answerMeta?: { status: string; confidence?: number }[];
  };
}
interface Batch {
  id: string;
  name: string;
  examId: string;
  createdAt?: string;
}
interface BatchState {
  batch: Batch;
  summary: Record<string, number>;
  jobs: Job[];
}
export default function BatchCenter({
  workspace,
  exam,
  setExamId,
  revision,
  reload,
  saveStatus,
  toast,
  onOpen,
}: {
  workspace: Workspace;
  exam: Exam;
  setExamId: (id: string) => void;
  revision: number;
  reload: () => Promise<void>;
  saveStatus: SaveStatus;
  toast: (s: string) => void;
  onOpen: (id: string) => void;
}) {
  const session = useSession(),
    school = workspace.activeSchoolId!,
    connected =
      session.phase === "authenticated" &&
      session.backend === "fastapi" &&
      !session.offline,
    key = `omr-last-batch:${session.user?.id}:${school}`;
  const [batchId, setBatchId] = useState(
      () => sessionStorage.getItem(key) || "",
    ),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [stage, setStage] = useState(""),
    [errors, setErrors] = useState<string[]>([]),
    [selected, setSelected] = useState(""),
    [student, setStudent] = useState(""),
    [verified, setVerified] = useState(false),
    [replace, setReplace] = useState(false),
    [original, setOriginal] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    cancel = useRef(false),
    applying = useRef<{
      job: string;
      operation: string;
      payload?: string;
    } | null>(null);
  const batches = useQuery<{ batches: Batch[] }>({
    queryKey: ["scan-batches", session.user?.id, school],
    queryFn: () => api(`/schools/${school}/batches`),
    enabled: connected,
  });
  const batch = useQuery<BatchState>({
    queryKey: ["scan-batch", session.user?.id, school, batchId],
    queryFn: () =>
      api(`/schools/${school}/batches/${batchId}?include_output=false`),
    enabled: connected && !!batchId,
    refetchInterval: (q) =>
      q.state.data &&
      (q.state.data.summary.queued || q.state.data.summary.processing)
        ? 1600
        : false,
  });
  const detail = useQuery<Job>({
    queryKey: ["scan-job", session.user?.id, school, batchId, selected],
    queryFn: () =>
      api(`/schools/${school}/batches/${batchId}/jobs/${selected}`),
    enabled: connected && !!selected,
  });
  const read = detail.data?.output;
  useEffect(() => {
    setStudent(
      workspace.students?.find(
        (s) => s.roll.toLowerCase() === read?.roll?.toLowerCase(),
      )?.id || "",
    );
    setVerified(false);
    setReplace(false);
    setOriginal(false);
    applying.current = null;
  }, [read, selected]);
  const chooseBatch = (id: string) => {
    setBatchId(id);
    sessionStorage.setItem(key, id);
    setSelected("");
    setErrors([]);
  };
  const create = async () => {
    setBusy(true);
    setErrors([]);
    try {
      const response = await api<{ batch: Batch }>(
        `/schools/${school}/batches`,
        {
          method: "POST",
          body: JSON.stringify({
            examId: exam.id,
            name:
              name.trim() ||
              `${exam.title} · ${new Date().toLocaleDateString()}`,
          }),
        },
      );
      chooseBatch(response.batch.id);
      await queryClient.invalidateQueries({ queryKey: ["scan-batches"] });
      toast(
        "Durable batch created. Uploaded pages continue processing if you leave this page.",
      );
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Batch creation failed."]);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (files: File[]) => {
    if (!batchId || busy) return;
    setBusy(true);
    setErrors([]);
    cancel.current = false;
    const issues: string[] = [];
    let added = 0;
    const selectedExam =
      workspace.exams.find((e) => e.id === batch.data?.batch.examId) || exam;
    try {
      const pages: { file: File; page: number }[] = [];
      for (const file of files) {
        if (cancel.current) break;
        if (file.size > 50 * 1024 * 1024) {
          issues.push(`${file.name}: exceeds 50 MB.`);
          continue;
        }
        try {
          if (/\.pdf$/i.test(file.name) || file.type === "application/pdf")
            for await (const p of pdfImages(file, setStage)) {
              if (pages.length >= 200)
                throw new Error("Use at most 200 pages per batch.");
              pages.push({
                file: p.file,
                page: p.page % pageCount(selectedExam),
              });
            }
          else pages.push({ file, page: 0 });
        } catch (e) {
          issues.push(
            `${file.name}: ${e instanceof Error ? e.message : "Unreadable PDF"}`,
          );
        }
        if (pages.length >= 200) break;
      }
      for (const [i, page] of pages.entries()) {
        if (cancel.current) break;
        setStage(`Uploading page ${i + 1} of ${pages.length}…`);
        const form = new FormData();
        form.append("file", page.file);
        form.append("operationId", crypto.randomUUID());
        form.append("pageIndex", String(page.page));
        form.append("ocr", "true");
        try {
          await api(`/schools/${school}/batches/${batchId}/pages`, {
            method: "POST",
            body: form,
          });
          added++;
        } catch (e) {
          issues.push(
            `${page.file.name}: ${e instanceof Error ? e.message : "Upload failed"}`,
          );
        }
      }
      setErrors(issues);
      toast(
        `${added} pages queued on the server. ${issues.length} upload issues. Verify identities before applying detected responses.`,
      );
      await batch.refetch();
    } finally {
      setBusy(false);
      setStage("");
      if (input.current) input.current.value = "";
    }
  };
  const exportSummary = () => {
    const rows = [
      ["Job ID", "Status", "Attempts", "Category", "Error"],
      ...(batch.data?.jobs || []).map((j) => [
        j.id,
        j.status,
        j.attempt,
        j.category,
        j.error,
      ]),
    ];
    downloadFile(
      "omr-batch-summary.csv",
      "\ufeff" +
        rows
          .map((r) =>
            r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
          )
          .join("\r\n"),
      "text/csv",
    );
  };
  return (
    <>
      <PageHeading
        eyebrow="A HUNDRED SHEETS. ONE CLEAR WORKFLOW."
        title="Built for your busiest exam day."
        description="Persistent server queues, real optical detection and deliberate identity verification."
        actions={
          <button
            className="button button-secondary"
            disabled={!batch.data}
            onClick={exportSummary}
          >
            <ArrowDownToLine size={15} />
            Download batch summary
          </button>
        }
      />
      <ExamBar workspace={workspace} exam={exam} setExamId={setExamId} />
      {!connected ? (
        <section className="card">
          <EmptyState
            icon={<FileStack size={30} />}
            title="Server queues need a connection."
            description="Durable batches run on the FastAPI server. For offline camera/images/PDFs, use Scan sheets with OpenCV.js and an unlocked encrypted device vault."
          />
        </section>
      ) : (
        <>
          <section className="card batch-controls">
            <div>
              <label>
                New batch name
                <input
                  value={name}
                  maxLength={120}
                  placeholder="e.g. Science mid-term · morning session"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button
                className="button button-primary"
                disabled={busy || !exam.published || saveStatus !== "saved"}
                onClick={() => void create()}
              >
                <Plus size={16} />
                Create durable batch
              </button>
            </div>
            <label>
              Existing batches
              <Select
                aria-label="Current scan batch"
                value={batchId}
                onChange={(e) => chooseBatch(e.target.value)}
              >
                <option value="">Choose a batch</option>
                {batches.data?.batches.map((b) => (
                  <option value={b.id} key={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </label>
          </section>
          {(batches.error || batch.error) && (
            <p className="v2-notice warning" role="alert">
              {batches.error?.message || batch.error?.message}
            </p>
          )}
          {batchId && (
            <>
              <div className="batch-summary-grid">
                {[
                  { label: "Queued", key: "queued" },
                  { label: "Processing", key: "processing" },
                  { label: "Ready to verify", key: "done" },
                  { label: "Applied to results", key: "applied" },
                  { label: "Failed", key: "error" },
                ].map((s) => (
                  <div className="card" key={s.key}>
                    <span>{s.label}</span>
                    <strong>{batch.data?.summary[s.key] || 0}</strong>
                  </div>
                ))}
              </div>
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h2>{batch.data?.batch.name || "Loading batch…"}</h2>
                    <p>
                      Exact duplicate images are blocked in the database.
                      Interrupted processing is recovered using expiring worker
                      leases.
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Refresh batch"
                    onClick={() => void batch.refetch()}
                  >
                    <RefreshCw size={17} />
                  </button>
                </div>
                <div
                  className="batch-dropzone"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void upload(Array.from(e.dataTransfer.files));
                  }}
                >
                  <Upload size={26} />
                  <div>
                    <strong>Drop images or multi-page PDFs</strong>
                    <p>PNG, JPEG, WebP, BMP, PDF · up to 200 pages per batch</p>
                  </div>
                  <button
                    className="button button-primary"
                    disabled={busy}
                    onClick={() => input.current?.click()}
                  >
                    <Upload size={15} />
                    Choose files
                  </button>
                </div>
                <input
                  className="sr-only"
                  ref={input}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/bmp,application/pdf"
                  aria-label="Upload durable batch pages"
                  onChange={(e) =>
                    void upload(Array.from(e.target.files || []))
                  }
                />
                {busy && (
                  <div className="v2-notice">
                    <LoaderCircle className="spinning" size={18} />
                    <span>{stage || "Preparing batch…"}</span>
                    <button
                      className="text-button"
                      onClick={() => {
                        cancel.current = true;
                      }}
                    >
                      Stop remaining uploads
                    </button>
                  </div>
                )}
                {errors.length > 0 && (
                  <div className="form-fields">
                    <h3>Upload issues</h3>
                    {errors.map((e, i) => (
                      <p className="form-error" key={i}>
                        {e}
                      </p>
                    ))}
                  </div>
                )}
                <div className="table-scroll">
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th>Page job</th>
                        <th>Status</th>
                        <th>Attempt</th>
                        <th>Issue category</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batch.data?.jobs.map((j) => (
                        <tr key={j.id}>
                          <td>
                            <code>{j.id.slice(0, 12)}</code>
                          </td>
                          <td>
                            <span className="soft-tag">{j.status}</span>
                          </td>
                          <td>{j.attempt}</td>
                          <td>
                            <span>{j.category || "—"}</span>
                            {j.error && (
                              <small className="table-secondary">
                                {j.error}
                              </small>
                            )}
                          </td>
                          <td>
                            {j.status === "done" || j.status === "applied" ? (
                              <button
                                className="text-button"
                                onClick={() => setSelected(j.id)}
                              >
                                <ShieldCheck size={14} />
                                {j.status === "applied"
                                  ? "View applied page"
                                  : "Match & verify"}
                              </button>
                            ) : j.status === "error" ? (
                              <button
                                className="text-button"
                                disabled={busy || j.attempt >= 5}
                                onClick={async () => {
                                  try {
                                    await api(
                                      `/schools/${school}/batches/${batchId}/jobs/${j.id}/retry`,
                                      { method: "POST" },
                                    );
                                    await batch.refetch();
                                  } catch (e) {
                                    toast(
                                      e instanceof Error
                                        ? e.message
                                        : "Retry failed.",
                                    );
                                  }
                                }}
                              >
                                <RefreshCw size={14} />
                                Retry failed page
                              </button>
                            ) : (
                              <span className="small muted">
                                Processing independently
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {batch.data?.jobs.length === 0 && (
                  <EmptyState
                    icon={<ScanLine size={28} />}
                    title="Your batch is ready for its first sheet."
                    description="Upload pages to begin genuine OpenCV processing. No result is created until an identity is verified."
                  />
                )}
              </section>
            </>
          )}
        </>
      )}
      {selected && (
        <Modal
          title="Match the person. Verify the evidence."
          onClose={() => {
            if (!busy) setSelected("");
          }}
          className="batch-review-modal"
        >
          <div className="modal-body">
            {detail.isPending && <LoaderCircle className="spinning" />}
            {detail.error && (
              <p className="form-error">{detail.error.message}</p>
            )}
            {read && (
              <div className="batch-review-grid">
                <div>
                  <div className="row-actions">
                    <button
                      className="text-button"
                      onClick={() => setOriginal((v) => !v)}
                    >
                      <Image size={15} />
                      {original
                        ? "Show detection overlay"
                        : "Show original uploaded image"}
                    </button>
                    <span className="soft-tag">
                      Page {(read.pageIndex || 0) + 1}
                    </span>
                  </div>
                  <img
                    className="scan-evidence-image"
                    alt={
                      original
                        ? "Original uploaded answer sheet"
                        : "Measured OpenCV bubble overlay"
                    }
                    src={
                      original
                        ? `${API_BASE}/schools/${school}/objects/${detail.data!.objectId}`
                        : read.preview
                    }
                  />
                </div>
                <div className="form-fields no-padding">
                  <div className="v2-notice">
                    <ShieldCheck size={18} />
                    <p>
                      Detected roll:{" "}
                      <strong>{read.roll || "Not identified"}</strong> ·
                      confidence {read.confidence?.toFixed(1)}% ·{" "}
                      {read.flagged?.length || 0} marks need review.
                    </p>
                  </div>
                  {read.warnings?.map((w, i) => (
                    <p className="small form-error" key={i}>
                      {w}
                    </p>
                  ))}
                  <label>
                    Match registered student
                    <Select
                      aria-label="Matched batch student"
                      value={student}
                      onChange={(e) => {
                        setStudent(e.target.value);
                        setVerified(false);
                        applying.current = null;
                      }}
                    >
                      <option value="">
                        Select the learner shown on the sheet
                      </option>
                      {workspace.students?.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.roll} · {s.name} · {s.section}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={verified}
                      onChange={(e) => setVerified(e.target.checked)}
                    />
                    I verified this identity against the original sheet.
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={replace}
                      onChange={(e) => {
                        setReplace(e.target.checked);
                        applying.current = null;
                      }}
                    />
                    Explicitly replace this student's previously scanned page
                  </label>
                  <p className="small muted">
                    Partial, erased, multiple and uncertain responses remain
                    flagged. Applying a page does not confirm answers or publish
                    a result.
                  </p>
                  <div className="batch-answer-chips">
                    {read.answerMeta?.map((m, i) => (
                      <span
                        key={i}
                        className={
                          ["filled", "blank"].includes(m.status)
                            ? ""
                            : "needs-review"
                        }
                        title={`${m.status} · ${m.confidence?.toFixed(0)}%`}
                      >
                        Q{i + 1}: {read.answers?.[i] || "—"}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => setSelected("")}
            >
              <X size={15} />
              Close
            </button>
            {read?.resultId ? (
              <button
                className="button button-primary"
                onClick={() => {
                  setSelected("");
                  onOpen(read.resultId!);
                }}
              >
                Open saved result
              </button>
            ) : (
              <button
                className="button button-primary"
                disabled={
                  busy ||
                  !student ||
                  !verified ||
                  saveStatus !== "saved" ||
                  !read
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    if (!applying.current || applying.current.job !== selected)
                      applying.current = {
                        job: selected,
                        operation: crypto.randomUUID(),
                      };
                    if (!applying.current.payload)
                      applying.current.payload = JSON.stringify({
                        studentId: student,
                        identityVerified: true,
                        replacePage: replace,
                        revision,
                        operationId: applying.current.operation,
                      });
                    const receipt = await api<{ resultId: string }>(
                      `/schools/${school}/batches/${batchId}/jobs/${selected}/apply`,
                      { method: "POST", body: applying.current.payload },
                    );
                    setSelected("");
                    await queryClient.invalidateQueries({
                      queryKey: ["scan-batch"],
                    });
                    await reload();
                    toast(
                      `Detected page applied to result ${receipt.resultId.slice(0, 8)}. Flagged responses still require manual verification.`,
                    );
                  } catch (e) {
                    toast(
                      e instanceof Error
                        ? e.message
                        : "Page application failed. Retry uses the same operation ID.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <CheckCheck size={16} />
                Apply verified page
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
