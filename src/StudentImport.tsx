import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  CheckCheck,
  Columns3,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import type { Student, Workspace } from "./data";
import { downloadFile, studentValidation } from "./data";
import { parseCSV } from "./documents";
import { Modal, Select } from "./components";
import { api, useSession } from "./session";
interface Inspection {
  uploadId: string;
  headers: string[];
  sample: string[][];
  rowCount: number;
}
interface Issue {
  row: number;
  roll: string;
  error: string;
}
interface Preview {
  students: Student[];
  validCount: number;
  issues: Issue[];
  previewHash: string;
  revision: number;
}
const fields = [
  { id: "name", label: "Student name", required: true },
  { id: "roll", label: "Roll / registration", required: true },
  { id: "section", label: "Class / section" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "guardian", label: "Guardian" },
  { id: "batch", label: "Batch" },
];
function inspectZip(data: ArrayBuffer) {
  const view = new DataView(data);
  let end = -1;
  for (
    let i = view.byteLength - 22;
    i >= Math.max(0, view.byteLength - 65557);
    i--
  )
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("Invalid workbook ZIP container.");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true),
    size = 0;
  if (count > 2000)
    throw new Error("The workbook contains too many internal files.");
  for (let i = 0; i < count; i++) {
    if (
      cursor + 46 > view.byteLength ||
      view.getUint32(cursor, true) !== 0x02014b50
    )
      throw new Error("Damaged workbook directory.");
    size += view.getUint32(cursor + 24, true);
    const nameSize = view.getUint16(cursor + 28, true),
      extra = view.getUint16(cursor + 30, true),
      comment = view.getUint16(cursor + 32, true);
    const name = new TextDecoder().decode(
      new Uint8Array(data, cursor + 46, nameSize),
    );
    if (size > 40 * 1024 * 1024 || name.includes("vbaProject"))
      throw new Error(
        "Use a macro-free workbook smaller than 40 MB after decompression.",
      );
    cursor += 46 + nameSize + extra + comment;
  }
}
async function readLocal(file: File) {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Use a student file smaller than 10 MB.");
  let rows: string[][] = [];
  if (/\.csv$/i.test(file.name)) rows = parseCSV(await file.text());
  else if (/\.xlsx$/i.test(file.name)) {
    const data = await file.arrayBuffer();
    inspectZip(data);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(data);
    const sheet = book.worksheets[0];
    if (!sheet || sheet.rowCount > 20001 || sheet.columnCount > 40)
      throw new Error("Use at most 20,000 rows and 40 columns.");
    sheet.eachRow((row) => {
      rows.push(
        Array.from({ length: sheet.columnCount }, (_, n) => {
          const value = row.getCell(n + 1).value;
          if (value && typeof value === "object" && "formula" in value)
            return "=" + value.formula;
          return row.getCell(n + 1).text.slice(0, 500);
        }),
      );
    });
  } else throw new Error("Use UTF-8 CSV or a modern .xlsx file.");
  if (rows.length < 2 || rows.length > 20001 || rows.some((r) => r.length > 40))
    throw new Error(
      "Include a header and up to 20,000 student rows, with at most 40 columns.",
    );
  const headers = rows.shift()!.map((s) => s.trim());
  while (headers.length && !headers.at(-1)) headers.pop();
  if (
    !headers.length ||
    headers.some((h) => !h) ||
    new Set(headers.map((h) => h.toLowerCase())).size !== headers.length
  )
    throw new Error("Column names must be non-empty and unique.");
  return { headers, rows: rows.filter((r) => r.some((v) => v.trim())) };
}
export default function StudentImport({
  file,
  workspace,
  onClose,
  onLocalImport,
  onServerImport,
  toast,
}: {
  file: File;
  workspace: Workspace;
  onClose: () => void;
  onLocalImport: (students: Student[]) => void;
  onServerImport: () => Promise<void>;
  toast: (s: string) => void;
}) {
  const session = useSession(),
    school = workspace.activeSchoolId!,
    server =
      session.phase === "authenticated" &&
      session.backend === "fastapi" &&
      !session.offline;
  const [inspection, setInspection] = useState<Inspection | null>(null),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [classId, setClassId] = useState(workspace.classes?.[0]?.id || ""),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(true),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  const localRows = useRef<string[][]>([]),
    inspected = useRef(false),
    operation = useRef(crypto.randomUUID());
  useEffect(() => {
    if (inspected.current) return;
    inspected.current = true;
    void (async () => {
      try {
        let result: Inspection;
        if (server) {
          const form = new FormData();
          form.append("file", file);
          result = await api(`/schools/${school}/imports/students/inspect`, {
            method: "POST",
            body: form,
          });
        } else {
          const local = await readLocal(file);
          localRows.current = local.rows;
          result = {
            uploadId: "local",
            headers: local.headers,
            sample: local.rows.slice(0, 5),
            rowCount: local.rows.length,
          };
        }
        const proposed: Record<string, string> = {};
        for (const f of fields) {
          const aliases: Record<string, RegExp> = {
            name: /^(name|student\s*name|full\s*name)$/i,
            roll: /^(roll(\s*(no|number))?|registration|admission|student\s*id)$/i,
            section: /^(class|section|class\s*\/\s*section)$/i,
          };
          proposed[f.id] =
            result.headers.find((h) =>
              (aliases[f.id] || new RegExp(`^${f.id}$`, "i")).test(h),
            ) || "";
        }
        setInspection(result);
        setMapping(proposed);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not inspect this file.",
        );
      } finally {
        setBusy(false);
      }
    })();
  }, [file, server, school]);
  const buildPreview = async () => {
    if (!inspection) return;
    setBusy(true);
    setError("");
    setConfirmed(false);
    try {
      const columns = Object.values(mapping).filter(Boolean);
      if (new Set(columns).size !== columns.length)
        throw new Error("Map each source column to only one student field.");
      if (server)
        setPreview(
          await api(`/schools/${school}/imports/students/preview`, {
            method: "POST",
            body: JSON.stringify({
              uploadId: inspection.uploadId,
              mapping,
              classId: classId || undefined,
            }),
          }),
        );
      else {
        const seen = new Set(
            (workspace.students || []).map((s) => s.roll.trim().toLowerCase()),
          ),
          students: Student[] = [],
          issues: Issue[] = [];
        localRows.current.forEach((row, i) => {
          const values = Object.fromEntries(
            fields.map((f) => [
              f.id,
              row[inspection.headers.indexOf(mapping[f.id])] || "",
            ]),
          );
          const classroom =
            workspace.classes?.find(
              (c) => c.name.toLowerCase() === values.section.toLowerCase(),
            ) ||
            (!values.section.trim()
              ? workspace.classes?.find((c) => c.id === classId)
              : undefined);
          const s: Student = {
            id: crypto.randomUUID(),
            schoolId: school,
            name: values.name.trim(),
            roll: values.roll.trim(),
            section: values.section.trim() || classroom?.name || "Unassigned",
            classId: classroom?.id,
            email: values.email.trim(),
            phone: values.phone.trim(),
            guardian: values.guardian.trim(),
            batch: values.batch.trim(),
            registeredAt: new Date().toISOString(),
          };
          const invalid =
            (values.section.trim() &&
            !classroom &&
            session.phase === "authenticated"
              ? "The class does not match an authorized class."
              : "") ||
            (s.email &&
            (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email) ||
              s.email.length > 200)
              ? "Use a valid email address."
              : "") ||
            (s.phone!.length > 40 ||
            s.guardian!.length > 120 ||
            s.batch!.length > 80
              ? "Contact, guardian or batch exceeds the allowed length."
              : "") ||
            studentValidation(s, workspace.students || []) ||
            (seen.has(s.roll.toLowerCase())
              ? "Duplicate roll in the file or existing register."
              : "") ||
            (Object.values(values).some((v) => /^\s*[=+@-]/.test(v))
              ? "Formula-like cell values are not allowed."
              : "");
          if (invalid)
            issues.push({ row: i + 2, roll: s.roll, error: invalid });
          else {
            students.push(s);
            seen.add(s.roll.toLowerCase());
          }
        });
        setPreview({
          students,
          validCount: students.length,
          issues,
          previewHash: "local",
          revision: 0,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview validation failed.");
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (
      !busy &&
      (!preview ||
        confirm("Close this preview? No rows are imported until you confirm."))
    )
      onClose();
  };
  return (
    <Modal
      title="Import students, with confidence."
      onClose={close}
      className="import-modal"
    >
      <div className="modal-body">
        <div className="v2-notice">
          <ShieldCheck size={19} />
          <p>
            <strong>{file.name}</strong> ·{" "}
            {inspection?.rowCount.toLocaleString() || "Inspecting"} rows.
            Mapping and preview do not change your register. Only confirmed
            valid rows are imported.
          </p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <div className="page-loader">
            <LoaderCircle className="spinning" size={22} />
            <span>Validating the import…</span>
          </div>
        )}
        {inspection && !preview && (
          <>
            <div className="import-mapping-grid">
              {fields.map((f) => (
                <label key={f.id}>
                  {f.label}
                  {f.required ? " *" : ""}
                  <Select
                    aria-label={`Map ${f.label}`}
                    value={mapping[f.id] || ""}
                    onChange={(e) =>
                      setMapping({ ...mapping, [f.id]: e.target.value })
                    }
                  >
                    <option value="">
                      {f.required ? "Choose a column" : "Do not import"}
                    </option>
                    {inspection.headers.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </Select>
                </label>
              ))}
              <label>
                Default class
                <Select
                  aria-label="Default import class"
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                >
                  <option value="">
                    {server ? "Choose a class" : "Unassigned"}
                  </option>
                  {workspace.classes?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <h3>File preview</h3>
            <div className="table-scroll">
              <table className="results-table">
                <thead>
                  <tr>
                    {inspection.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inspection.sample.map((r, i) => (
                    <tr key={i}>
                      {inspection.headers.map((_, j) => (
                        <td key={j}>{r[j]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {preview && (
          <>
            <div className="import-preview-counts">
              <span>
                <CheckCheck size={17} />
                {preview.validCount} valid rows
              </span>
              <span>
                {preview.issues.length} invalid / duplicate rows skipped
              </span>
            </div>
            <div className="table-scroll">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Student name</th>
                    <th>Roll / registration</th>
                    <th>Class</th>
                    <th>Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.students.slice(0, 30).map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{s.roll}</td>
                      <td>{s.section}</td>
                      <td>{s.email || s.phone || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.validCount > 30 && (
              <p className="small muted">
                Showing the first 30 validated rows. Confirmation applies to all{" "}
                {preview.validCount} valid rows.
              </p>
            )}
            {preview.issues.length > 0 && (
              <div className="import-errors">
                <h3>Rows needing attention</h3>
                {preview.issues.slice(0, 8).map((e) => (
                  <p key={e.row}>
                    Row {e.row} · {e.roll || "Missing roll"}: {e.error}
                  </p>
                ))}
                <button
                  className="text-button"
                  onClick={() => {
                    const rows = [
                      ["Row", "Roll", "Error"],
                      ...preview.issues.map((e) => [e.row, e.roll, e.error]),
                    ];
                    void downloadFile(
                      "student-import-invalid-rows.csv",
                      "\ufeff" +
                        rows
                          .map((r) =>
                            r
                              .map(
                                (c) =>
                                  `"${(/^\s*[=+@-]/.test(String(c)) ? "'" : "") + String(c).replaceAll('"', '""')}"`,
                              )
                              .join(","),
                          )
                          .join("\r\n"),
                      "text/csv",
                    ).catch((error) =>
                      setError(
                        error instanceof Error
                          ? error.message
                          : "Export failed.",
                      ),
                    );
                  }}
                >
                  <ArrowDownToLine size={14} />
                  Download all invalid-row details
                </button>
              </div>
            )}
            <label className="checkbox-label import-confirmation">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed the mapped columns and valid/invalid rows. Import{" "}
              {preview.validCount} valid students and skip{" "}
              {preview.issues.length} invalid rows.
            </label>
          </>
        )}
      </div>
      <div className="modal-footer">
        {preview ? (
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => {
              setPreview(null);
              setConfirmed(false);
              setError("");
            }}
          >
            <ArrowLeft size={15} />
            Change mapping
          </button>
        ) : (
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
        )}
        {preview ? (
          <button
            className="button button-primary"
            disabled={busy || !confirmed || !preview.validCount}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                if (server) {
                  const receipt = await api<{
                    imported: number;
                    skipped: number;
                  }>(`/schools/${school}/imports/students/confirm`, {
                    method: "POST",
                    body: JSON.stringify({
                      uploadId: inspection!.uploadId,
                      previewHash: preview.previewHash,
                      confirmed: true,
                      operationId: operation.current,
                    }),
                  });
                  await onServerImport();
                  toast(
                    `${receipt.imported} students imported transactionally. ${receipt.skipped} rows skipped.`,
                  );
                } else {
                  const existing = new Set(
                    (workspace.students || []).map((s) =>
                      s.roll.trim().toLowerCase(),
                    ),
                  );
                  if (
                    preview.students.some((s) =>
                      existing.has(s.roll.toLowerCase()),
                    )
                  )
                    throw new Error(
                      "The register changed after preview. Rebuild the preview before importing.",
                    );
                  onLocalImport(preview.students);
                  toast(
                    `${preview.validCount} students imported after confirmation. ${preview.issues.length} rows skipped.`,
                  );
                }
                onClose();
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Import failed; no changes were confirmed.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <CheckCheck size={16} />
            Confirm student import
          </button>
        ) : (
          <button
            className="button button-primary"
            disabled={busy || !inspection || !mapping.name || !mapping.roll}
            onClick={() => void buildPreview()}
          >
            <Columns3 size={16} />
            Validate & preview rows
          </button>
        )}
      </div>
    </Modal>
  );
}
