import { useRef, useState } from "react";
import { Camera, LoaderCircle, ScanLine, Upload } from "lucide-react";
import type { Exam } from "./data";
import { Modal, Select } from "./components";
import {
  applyLayoutScan,
  initialMappings,
  mappedRegions,
  scanLayoutImage,
} from "./layoutImport";
import type { BlockMapping, LayoutScan } from "./layoutImport";
import { questionType } from "./answers";

export default function LayoutScanner({
  exam,
  locked,
  onClose,
  onApply,
}: {
  exam: Exam;
  locked: boolean;
  onClose: () => void;
  onApply: (exam: Exam) => void;
}) {
  const upload = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<LayoutScan["mode"]>("fiducials"),
    [scan, setScan] = useState<LayoutScan | null>(null),
    [mappings, setMappings] = useState<BlockMapping[]>([]),
    [busy, setBusy] = useState(false),
    [stage, setStage] = useState(""),
    [error, setError] = useState(""),
    [accepted, setAccepted] = useState(false),
    [resize, setResize] = useState(!locked);
  const patch = (id: string, change: Partial<BlockMapping>) => {
    setAccepted(false);
    setMappings((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...change } : r)),
    );
  };
  const read = async (file: File) => {
    setBusy(true);
    setError("");
    setScan(null);
    setAccepted(false);
    try {
      const found = await scanLayoutImage(file, mode, setStage);
      setScan(found);
      setMappings(initialMappings(found));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Layout detection failed. No changes have been saved.",
      );
    } finally {
      setBusy(false);
      setStage("");
    }
  };
  const apply = () => {
    if (!scan || !accepted) return;
    try {
      const next = applyLayoutScan(exam, scan, mappings, resize);
      if (
        locked &&
        (next.questions !== exam.questions ||
          next.optionCount !== (exam.optionCount || 4) ||
          next.questionTypes?.some((t, q) => t !== questionType(exam, q)))
      )
        throw new Error(
          "This assessment already has student results. Import into a new assessment to change its question types or count. Existing responses must not be reinterpreted.",
        );
      onApply(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the question mapping.");
    }
  };
  return (
    <Modal
      title="Scan a layout"
      onClose={() => {
        if (!busy) onClose();
      }}
      className="layout-scan-modal"
    >
      <div className="modal-body">
        <p className="muted">
          Photograph or upload an upright OMR sheet. OpenCV finds printed
          outlines—not correct answers. Review question numbers, exclude roll
          grids, and check every overlay before using it.
        </p>
        <div className="form-fields no-padding">
          <label>
            Registration on this sheet
            <Select
              value={mode}
              disabled={busy}
              onChange={(e) => {
                setMode(e.target.value as LayoutScan["mode"]);
                setScan(null);
                setAccepted(false);
              }}
            >
              <option value="fiducials">
                Outer black squares · including repeated-marker sheets
              </option>
              <option value="page">
                Whole paper edges · no registration squares
              </option>
            </Select>
          </label>
          <div className="row-actions">
            <input
              ref={upload}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Scan layout image"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void read(f);
              }}
            />
            <input
              ref={camera}
              className="sr-only"
              type="file"
              capture="environment"
              accept="image/*"
              aria-label="Photograph a layout"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void read(f);
              }}
            />
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => upload.current?.click()}
            >
              <Upload size={16} />
              Choose layout image
            </button>
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => camera.current?.click()}
            >
              <Camera size={16} />
              Use camera
            </button>
          </div>
          <p className="small muted">
            PNG, JPEG or WebP · up to 10 MB / 30 megapixels. Keep the sheet
            upright and all outer squares or paper corners visible. This imports
            one page; it does not read the answer key or the roll number.
            Detection runs on this device. Saving the layout also saves its
            normalized reference photo to the school workspace. Prefer a blank
            sheet, or remove the reference photo after calibration.
          </p>
        </div>
        {busy && (
          <p role="status">
            <LoaderCircle size={17} className="spinning" />
            {stage}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {scan && (
          <>
            <div className="layout-scan-review">
              <svg
                viewBox="0 0 1240 1754"
                role="img"
                aria-label="Detected layout with numbered question mappings"
              >
                <image href={scan.referenceImage} width="1240" height="1754" />
                {scan.circles.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={p.radius}
                    fill="none"
                    stroke="#607d8b"
                    strokeWidth="1.5"
                  />
                ))}
                {mappings
                  .filter((m) => m.enabled)
                  .map((m) => {
                    const b = scan.blocks.find((b) => b.id === m.id)!;
                    const regions = mappedRegions(b, m);
                    return regions.map((r) => {
                      const p = r.points[0];
                      return (
                        <g
                          key={`${m.id}-${r.question}`}
                          fill="none"
                          stroke="#00a070"
                          strokeWidth="2.5"
                        >
                          {r.points.map((p, i) => (
                            <circle key={i} cx={p.x} cy={p.y} r={r.radius} />
                          ))}
                          <text
                            x={p.x - 36}
                            y={p.y - 20}
                            fontSize="24"
                            fontWeight="bold"
                            fill="#00583f"
                            stroke="white"
                            paintOrder="stroke"
                            strokeWidth="4"
                          >
                            Q{r.question + 1}
                          </text>
                        </g>
                      );
                    });
                  })}
              </svg>
              <div className="layout-detected-list">
                <h3>
                  Detected regions · {mappings.filter((m) => m.enabled).length}{" "}
                  selected
                </h3>
                <button
                  className="button button-secondary button-small"
                  onClick={() => {
                    let q = 1;
                    setMappings((all) =>
                      all.map((m) => {
                        if (!m.enabled) return m;
                        const b = scan.blocks.find((b) => b.id === m.id)!,
                          question = q;
                        q += b.kind === "digits" && m.as === "mcq" ? b.rows : 1;
                        return { ...m, question };
                      }),
                    );
                    setAccepted(false);
                  }}
                >
                  Renumber selected regions
                </button>
                <p className="small muted">
                  Grey: measured outlines. Green: selected answer bubbles.
                  Missing outlines are never filled in automatically. Number
                  questions explicitly. A regular grid could be MCQ rows,
                  integer columns or a roll number: choose its type instead of
                  trusting an automatic guess. All grids start excluded.
                </p>
                {scan.blocks.map((b) => {
                  const m = mappings.find((m) => m.id === b.id)!;
                  return (
                    <section className="detected-region" key={b.id}>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={m.enabled}
                          onChange={(e) =>
                            patch(b.id, { enabled: e.target.checked })
                          }
                        />
                        {b.kind === "choice"
                          ? `${b.columns}-option MCQ row`
                          : `${b.columns} columns × ${b.rows} rows · review grid type`}
                      </label>
                      {b.kind === "digits" && (
                        <label>
                          Use grid as
                          <Select
                            aria-label={`${b.id} grid type`}
                            value={m.as || "integer3"}
                            onChange={(e) =>
                              patch(b.id, {
                                as: e.target.value as "mcq" | "integer3",
                              })
                            }
                          >
                            <option value="integer3">
                              One 3-digit integer question
                            </option>
                            <option value="mcq">
                              {b.rows} multiple-choice question rows
                            </option>
                          </Select>
                        </label>
                      )}
                      {b.kind === "digits" &&
                        m.as !== "mcq" &&
                        (b.columns !== 3 || b.rows !== 10) && (
                          <p className="small warning">
                            {b.columns} columns detected
                            {b.rows === 11 ? ", including an extra row" : ""}.
                            Only three integer columns and the ten 0–9 rows will
                            be used. Decimal points, signs and unused columns
                            are not supported. Confirm the mapping below.
                          </p>
                        )}
                      <div className="form-two-columns">
                        <label>
                          Question number
                          <input
                            aria-label={`${b.id} question number`}
                            type="number"
                            min="1"
                            max="500"
                            value={m.question}
                            onChange={(e) =>
                              patch(b.id, { question: Number(e.target.value) })
                            }
                          />
                        </label>
                        {b.kind === "digits" && m.as !== "mcq" && (
                          <label>
                            Use digit columns
                            <Select
                              aria-label={`${b.id} digit columns`}
                              value={m.firstColumn}
                              onChange={(e) =>
                                patch(b.id, {
                                  firstColumn: Number(e.target.value),
                                })
                              }
                            >
                              {Array.from({ length: b.columns - 2 }, (_, i) => (
                                <option key={i} value={i}>
                                  {i + 1}, {i + 2}, {i + 3} · hundreds, tens,
                                  units
                                </option>
                              ))}
                            </Select>
                          </label>
                        )}
                        {b.kind === "digits" &&
                          m.as !== "mcq" &&
                          b.rows > 10 && (
                            <label>
                              First zero row
                              <Select
                                aria-label={`${b.id} zero row`}
                                value={m.firstRow}
                                onChange={(e) =>
                                  patch(b.id, {
                                    firstRow: Number(e.target.value),
                                  })
                                }
                              >
                                {Array.from({ length: b.rows - 9 }, (_, i) => (
                                  <option key={i} value={i}>
                                    Detected row {i + 1}
                                    {i === 1 ? " · skip dot row" : ""}
                                  </option>
                                ))}
                              </Select>
                            </label>
                          )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={resize}
                disabled={locked}
                onChange={(e) => {
                  setResize(e.target.checked);
                  setAccepted(false);
                }}
              />
              Use mapped question count for this assessment
            </label>
            <p className="small muted">
              Existing answers are kept only where question types and MCQ
              options still match. Changed types become unkeyed. Imported
              reference photos are never printed.{" "}
              {locked
                ? "Question types/count are locked because this assessment already has results."
                : "For a different sheet, create a new assessment first."}
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              I checked the numbering, three-digit columns, 0–9 rows and
              excluded identity grids. Open this as an editable draft.
            </label>
          </>
        )}
      </div>
      <div className="modal-footer">
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="button button-primary"
          disabled={!scan || busy || !accepted}
          onClick={apply}
        >
          <ScanLine size={16} />
          Use reviewed layout
        </button>
      </div>
    </Modal>
  );
}
