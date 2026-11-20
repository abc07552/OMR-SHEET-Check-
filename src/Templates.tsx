import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  FileImage,
  Grip,
  Layers,
  Move,
  RotateCcw,
  Save,
  ScanLine,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import type { Exam, Workspace } from "./data";
import { getOptions } from "./data";
import { questionType } from "./answers";
import LayoutScanner from "./LayoutScanner";
import {
  DEFAULT_ANCHORS,
  HEIGHT,
  WIDTH,
  defaultLayout,
  getLayout,
  layoutQuestionPoints,
  regularRegion,
  layoutErrors,
  pageCount,
  pageQuestionCount,
} from "./layout";
import type { OMRLayout, SheetField } from "./layout";
import { createSheet, downloadTemplate, downloadTemplatePDF } from "./omr";
import { normaliseLogo } from "./sheetImages";
import { PageHeading, SavedIndicator, Select } from "./components";
import { ExamBar } from "./Overview";
interface Props {
  workspace: Workspace;
  exam: Exam;
  setExamId: (id: string) => void;
  onSave: (exam: Exam) => void;
  toast: (s: string) => void;
}
type Tool =
  | "select"
  | "first"
  | "option"
  | "row"
  | "column"
  | "roll"
  | `anchor-${number}`;
export default function Templates({
  workspace,
  exam,
  setExamId,
  onSave,
  toast,
}: Props) {
  const [layout, setLayout] = useState<OMRLayout>(() =>
      structuredClone(getLayout(exam)),
    ),
    [selected, setSelected] = useState<string>("exam-title"),
    [page, setPage] = useState(0),
    [reference, setReference] = useState(true),
    [tool, setTool] = useState<Tool>("select"),
    [busy, setBusy] = useState(false),
    [logoBusy, setLogoBusy] = useState(false),
    [preview, setPreview] = useState(""),
    [previewError, setPreviewError] = useState("");
  const [scanOpen, setScanOpen] = useState(false),
    [importedExam, setImportedExam] = useState<Exam | null>(null),
    [selectedQuestion, setSelectedQuestion] = useState(0);
  const bubbleDrag = useRef<{ question: number; point: number } | null>(null);
  const upload = useRef<HTMLInputElement>(null),
    logoUpload = useRef<HTMLInputElement>(null),
    stage = useRef<SVGSVGElement>(null),
    drag = useRef<{
      id: string;
      x: number;
      y: number;
      fx: number;
      fy: number;
    } | null>(null);
  useEffect(() => {
    setLayout(structuredClone(getLayout(exam)));
    setPage(0);
    setSelected("exam-title");
    setImportedExam(null);
    setSelectedQuestion(0);
  }, [exam]);
  const design = importedExam || exam;
  const draft = { ...design, layout },
    pages = pageCount(draft),
    safe = Math.min(page, pages - 1),
    dirty = !exam.layout || JSON.stringify(draft) !== JSON.stringify(exam),
    errors = [...layoutErrors(draft), ...(previewError ? [previewError] : [])],
    field = layout.fields.find((f) => f.id === selected);
  useEffect(() => {
    let active = true;
    setPreviewError("");
    void createSheet({ ...design, layout }, undefined, "", "", safe)
      .then((canvas) => {
        if (active) setPreview(canvas.toDataURL("image/png"));
      })
      .catch((error) => {
        if (active)
          setPreviewError(
            error instanceof Error
              ? error.message
              : "The sheet preview could not be rendered.",
          );
      });
    return () => {
      active = false;
    };
  }, [layout, design, safe]);
  const update = (key: keyof OMRLayout, value: unknown) =>
    setLayout((l) => ({ ...l, [key]: value }));
  const patchField = (patch: Partial<SheetField>) =>
    setLayout((l) => ({
      ...l,
      fields: l.fields.map((f) => (f.id === selected ? { ...f, ...patch } : f)),
    }));
  const selectedGeometry = layoutQuestionPoints(
    selectedQuestion % layout.questionsPerPage,
    draft,
    Math.floor(selectedQuestion / layout.questionsPerPage),
  );
  const patchQuestion = (
    points = selectedGeometry.points,
    radius = selectedGeometry.radius,
  ) =>
    setLayout((l) => ({
      ...l,
      questionRegions: [
        ...(l.questionRegions || []).filter(
          (r) => r.question !== selectedQuestion,
        ),
        { question: selectedQuestion, points, radius },
      ],
    }));
  const regularise = (gap?: number, rowGap?: number) => {
    const p = selectedGeometry.points,
      numeric = selectedGeometry.numeric;
    const next = regularRegion(
      selectedQuestion,
      p[0].x,
      p[0].y,
      gap ?? p[numeric ? 10 : 1].x - p[0].x,
      rowGap ?? (numeric ? p[1].y - p[0].y : 0),
      selectedGeometry.radius,
      numeric,
      draft.optionCount || 4,
    );
    patchQuestion(next.points);
  };
  const position = (e: React.PointerEvent) => {
    const r = stage.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * WIDTH,
      y: ((e.clientY - r.top) / r.height) * HEIGHT,
    };
  };
  const handlePoint = (p: { x: number; y: number }) => {
    if (tool.startsWith("anchor-")) {
      const i = Number(tool.split("-")[1]);
      setLayout((l) => ({
        ...l,
        anchors: l.anchors.map((a, j) =>
          j === i ? { x: Math.round(p.x), y: Math.round(p.y) } : a,
        ),
      }));
      setTool(i < 3 ? `anchor-${i + 1}` : "select");
    } else if (tool === "first") {
      setLayout((l) => ({
        ...l,
        startX: Math.round(p.x),
        startY: Math.round(p.y),
      }));
      setTool("option");
    } else if (tool === "option") {
      update("optionGap", Math.max(12, Math.round(p.x - layout.startX)));
      setTool("row");
    } else if (tool === "row") {
      update("rowGap", Math.max(12, Math.round(p.y - layout.startY)));
      setTool("select");
    } else if (tool === "column") {
      update("columnGap", Math.max(40, Math.round(p.x - layout.startX)));
      setTool("select");
    } else if (tool === "roll") {
      update("rollRegion", {
        ...layout.rollRegion,
        x: Math.round(p.x),
        y: Math.round(p.y),
      });
      setTool("select");
    }
  };
  const controls: [keyof OMRLayout, string, number, number, number][] = [
    ["questionsPerPage", "Questions / page", 1, 100, 1],
    ["columns", "Columns", 1, 5, 1],
    ["startX", "First bubble X", 30, 1200, 1],
    ["startY", "First bubble Y", 30, 1650, 1],
    ["columnGap", "Column spacing", 40, 1100, 1],
    ["rowGap", "Row spacing", 12, 1200, 1],
    ["optionGap", "Option spacing", 12, 160, 1],
    ["radius", "Bubble radius", 5, 25, 1],
    ["labelOffset", "Question label offset", 20, 160, 1],
  ];
  const addField = (type: SheetField["type"]) => {
    if (layout.fields.length >= 40) {
      toast("Use up to 40 fields in one template.");
      return;
    }
    const id = crypto.randomUUID(),
      f: SheetField = {
        id,
        type,
        text:
          type === "student"
            ? "Student name: {name}"
            : type === "roll"
              ? "{roll}"
              : type === "qr"
                ? "Page identification"
                : type === "logo"
                  ? "School logo"
                  : "Your text",
        x: 100,
        y: 200,
        width: type === "qr" ? 100 : type === "logo" ? 160 : 500,
        height: type === "qr" ? 100 : type === "logo" ? 120 : 40,
        fontSize: 24,
        bold: false,
        visible: true,
      };
    setLayout((l) => ({ ...l, fields: [...l.fields, f] }));
    setSelected(id);
  };
  const importLogo = async (file: File) => {
    if (!field || field.type !== "logo") return;
    const id = field.id;
    setLogoBusy(true);
    try {
      const image = await normaliseLogo(file);
      setLayout((l) => ({
        ...l,
        fields: l.fields.map((f) => (f.id === id ? { ...f, image } : f)),
      }));
      toast("Logo embedded. It will appear in saved PNG and PDF templates.");
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : "This logo could not be opened.",
      );
    } finally {
      setLogoBusy(false);
    }
  };
  const importReference = async (file: File) => {
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      toast(
        "Choose a PNG, JPEG or WebP reference smaller than 10 MB. For a PDF, export one page as an image first.",
      );
      return;
    }
    try {
      const bitmap = await createImageBitmap(file),
        c = document.createElement("canvas");
      c.width = WIDTH;
      c.height = HEIGHT;
      c.getContext("2d")!.drawImage(bitmap, 0, 0, WIDTH, HEIGHT);
      bitmap.close();
      update("referenceImage", c.toDataURL("image/jpeg", 0.7));
      setReference(true);
      toast(
        "Reference loaded. Calibrate the bubble grid and registration points to match.",
      );
    } catch {
      toast("This reference image could not be opened.");
    }
  };
  const downloadPDF = async () => {
    setBusy(true);
    try {
      await downloadTemplatePDF(exam);
    } catch (e) {
      toast(e instanceof Error ? e.message : "PDF export failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="PAPER, WITH POSSIBILITIES"
        title="Your sheet. Your rules."
        description="Design a multipage OMR template, or calibrate the bubble grid to an existing sheet."
        actions={
          <>
            <button
              className="button button-secondary"
              disabled={dirty && scanOpen}
              onClick={() => setScanOpen(true)}
            >
              <ScanLine size={16} />
              Scan a layout
            </button>
            <button
              className="button button-secondary"
              disabled={busy || dirty || logoBusy || scanOpen}
              title={
                dirty
                  ? "Save this layout before downloading its template."
                  : undefined
              }
              onClick={downloadPDF}
            >
              <ArrowDownToLine size={16} />
              {busy ? "Preparing…" : "Download saved PDF"}
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                if (errors.length) {
                  toast(errors[0]);
                  return;
                }
                onSave(draft);
                toast(
                  "Layout saved. Print a new template and verify one sample before batch scanning.",
                );
              }}
              disabled={!dirty || !!errors.length || logoBusy || scanOpen}
            >
              <Save size={16} />
              Save layout
            </button>
          </>
        }
      />
      <ExamBar
        workspace={workspace}
        exam={exam}
        setExamId={(id) => {
          if (dirty && !confirm("Discard unsaved layout changes?")) return;
          setExamId(id);
        }}
      />
      <div className="template-meta-strip">
        <span>
          <Layers size={16} />
          {pages} printed {pages === 1 ? "page" : "pages"} · {draft.questions}{" "}
          questions · A–{getOptions(draft).at(-1)}
          {draft.questionTypes?.includes("integer3")
            ? " + 3-digit integers"
            : ""}
        </span>
        <SavedIndicator dirty={dirty} />
        {dirty && (
          <span className="small muted">
            Save layout to enable template downloads.
          </span>
        )}
        <span>
          <ScanLine size={15} />{" "}
          {layout.anchorMode !== "page"
            ? "4-point registration"
            : "Paper-edge alignment"}
        </span>
      </div>
      <div className="template-editor">
        <aside className="card template-controls">
          <div className="card-heading">
            <h2>
              <Grip size={16} />
              Sheet geometry
            </h2>
          </div>
          <div className="form-fields">
            <label>
              Layout name
              <input
                value={layout.name}
                maxLength={120}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            <div className="form-two-columns">
              {controls.map(([key, label, min, max, step]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    disabled={
                      !!layout.questionRegions?.length &&
                      layout.questionRegions.length >= draft.questions &&
                      key !== "questionsPerPage"
                    }
                    min={min}
                    max={max}
                    step={step}
                    value={layout[key] as number}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v))
                        update(
                          key,
                          Math.max(min, Math.min(max, Math.round(v))),
                        );
                    }}
                  />
                </label>
              ))}
            </div>
            <label>
              Bubble shape
              <Select
                value={layout.bubbleShape}
                onChange={(e) => update("bubbleShape", e.target.value)}
              >
                <option value="circle">Circle</option>
                <option value="square">Square</option>
              </Select>
            </label>
            <label>
              Fill threshold · {Math.round(layout.threshold * 100)}%
              <input
                type="range"
                min="20"
                max="85"
                value={layout.threshold * 100}
                onChange={(e) =>
                  update("threshold", Number(e.target.value) / 100)
                }
              />
            </label>
            <label>
              Alignment mode
              <Select
                value={layout.anchorMode}
                onChange={(e) =>
                  setLayout((l) => ({
                    ...l,
                    anchorMode: e.target.value as OMRLayout["anchorMode"],
                    anchors:
                      e.target.value === "page"
                        ? [
                            { x: 0, y: 0 },
                            { x: WIDTH - 1, y: 0 },
                            { x: WIDTH - 1, y: HEIGHT - 1 },
                            { x: 0, y: HEIGHT - 1 },
                          ]
                        : DEFAULT_ANCHORS.map((p) => ({ ...p })),
                  }))
                }
              >
                <option value="markers">Four dark registration squares</option>
                <option value="fiducials">
                  Outermost squares · repeated-marker layout
                </option>
                <option value="page">Paper edges (no squares)</option>
              </Select>
            </label>
            {layout.questionRegions?.length ? (
              <p className="small muted">
                This sheet has per-question geometry. Use Question regions on
                the right to edit measured points, spacing and radius; global
                grid controls apply only to unmapped questions.
              </p>
            ) : null}
            <p className="small muted">
              Paper-edge mode needs the whole sheet on a contrasting background.
              Marker mode is more reliable for photographs.
            </p>
            <button
              className="button button-secondary button-small"
              onClick={() => {
                if (
                  confirm("Reset geometry and fields to the standard layout?")
                )
                  setLayout(defaultLayout(design));
              }}
            >
              <RotateCcw size={14} />
              Reset layout
            </button>
          </div>
        </aside>
        <section className="template-stage-wrap">
          <div className="template-toolbar">
            <span>
              <Move size={15} />
              Drag fields to arrange
            </span>
            <div>
              <button
                className={`icon-button ${reference ? "active" : ""}`}
                aria-label="Toggle reference image"
                title="Toggle reference image"
                disabled={!layout.referenceImage}
                onClick={() => setReference((r) => !r)}
              >
                <FileImage size={17} />
              </button>
              <button
                className="icon-button"
                title={
                  dirty
                    ? "Save this layout before downloading its template."
                    : "Download saved page PNG"
                }
                aria-label="Download saved page PNG"
                disabled={dirty || logoBusy || scanOpen}
                onClick={() => {
                  void downloadTemplate(exam, safe).catch((error) =>
                    toast(
                      error instanceof Error
                        ? error.message
                        : "PNG export failed.",
                    ),
                  );
                }}
              >
                <ArrowDownToLine size={17} />
              </button>
            </div>
          </div>
          <div className="template-stage-scroll">
            <svg
              ref={stage}
              className={`template-stage ${tool !== "select" ? "calibrating" : ""}`}
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-label="OMR template layout preview"
              onPointerDown={(e) => {
                if (tool !== "select") {
                  handlePoint(position(e));
                  return;
                }
                const target = e.target as SVGElement;
                if (
                  target.dataset.question !== undefined &&
                  target.dataset.point !== undefined
                ) {
                  const question = Number(target.dataset.question),
                    point = Number(target.dataset.point);
                  setSelectedQuestion(question);
                  setSelected("");
                  const geometry = layoutQuestionPoints(
                    question % layout.questionsPerPage,
                    draft,
                    Math.floor(question / layout.questionsPerPage),
                  );
                  setLayout((l) => ({
                    ...l,
                    questionRegions: [
                      ...(l.questionRegions || []).filter(
                        (r) => r.question !== question,
                      ),
                      {
                        question,
                        points: geometry.points.map((p) => ({ ...p })),
                        radius: geometry.radius,
                      },
                    ],
                  }));
                  bubbleDrag.current = { question, point };
                  e.currentTarget.setPointerCapture(e.pointerId);
                  return;
                }
                const id = target.dataset.field;
                if (!id) {
                  setSelected("");
                  return;
                }
                const f = layout.fields.find((f) => f.id === id)!;
                setSelected(id);
                const p = position(e);
                drag.current = { id, x: p.x, y: p.y, fx: f.x, fy: f.y };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (bubbleDrag.current) {
                  const p = position(e),
                    d = bubbleDrag.current;
                  setLayout((l) => ({
                    ...l,
                    questionRegions: l.questionRegions?.map((r) =>
                      r.question !== d.question
                        ? r
                        : {
                            ...r,
                            points: r.points.map((point, i) =>
                              i !== d.point
                                ? point
                                : { x: Math.round(p.x), y: Math.round(p.y) },
                            ),
                          },
                    ),
                  }));
                  return;
                }
                if (!drag.current) return;
                const p = position(e),
                  d = drag.current;
                setLayout((l) => ({
                  ...l,
                  fields: l.fields.map((f) =>
                    f.id === d.id
                      ? {
                          ...f,
                          x: Math.round(
                            Math.max(
                              0,
                              Math.min(WIDTH - f.width, d.fx + p.x - d.x),
                            ),
                          ),
                          y: Math.round(
                            Math.max(
                              0,
                              Math.min(HEIGHT - f.height, d.fy + p.y - d.y),
                            ),
                          ),
                        }
                      : f,
                  ),
                }));
              }}
              onPointerUp={() => {
                drag.current = null;
                bubbleDrag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
                bubbleDrag.current = null;
              }}
            >
              <image
                href={
                  reference && layout.referenceImage
                    ? layout.referenceImage
                    : preview || undefined
                }
                x="0"
                y="0"
                width={WIDTH}
                height={HEIGHT}
              />
              {((reference && layout.referenceImage) ||
                selectedGeometry.numeric ||
                layout.questionRegions?.length) &&
                Array.from(
                  { length: pageQuestionCount(draft, safe) },
                  (_, q) => {
                    const p = layoutQuestionPoints(q, draft, safe),
                      global = q + safe * layout.questionsPerPage,
                      first = p.points[0];
                    return (
                      <g
                        key={q}
                        fill="none"
                        stroke={
                          selectedQuestion === global ? "#ed8400" : "#13b895"
                        }
                        strokeWidth="2"
                      >
                        <text
                          x={Math.max(25, first.x - p.radius - 35)}
                          y={first.y - 16}
                          fontSize="16"
                          fill="#00795b"
                          stroke="white"
                          paintOrder="stroke"
                          strokeWidth="3"
                        >
                          {global + 1}
                          {p.numeric ? " · 3d" : ""}
                        </text>
                        {p.points.map((b, i) => (
                          <circle
                            key={i}
                            cx={b.x}
                            cy={b.y}
                            r={p.radius}
                            data-question={global}
                            data-point={i}
                            className="bubble-hit"
                            fill="transparent"
                          />
                        ))}
                      </g>
                    );
                  },
                )}
              {layout.anchors.map((a, i) => (
                <g key={i} stroke="#e37460" strokeWidth="2">
                  <path d={`M${a.x - 20},${a.y}h40M${a.x},${a.y - 20}v40`} />
                  <text
                    x={a.x + 12}
                    y={a.y - 12}
                    fontSize="14"
                    fill="#d65142"
                    stroke="none"
                  >
                    {i + 1}
                  </text>
                </g>
              ))}
              {(layout.ocrEnabled !== false || tool === "roll") && (
                <rect
                  {...layout.rollRegion}
                  fill="#8a9fff22"
                  stroke="#6c80e7"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                />
              )}
              {layout.fields
                .filter((f) => f.visible)
                .map((f) => (
                  <rect
                    key={f.id}
                    data-field={f.id}
                    x={f.x - 4}
                    y={f.y - 4}
                    width={f.width + 8}
                    height={f.height + 8}
                    fill={selected === f.id ? "#49bd9022" : "transparent"}
                    stroke={selected === f.id ? "#2caa7c" : "transparent"}
                    strokeWidth="2"
                    strokeDasharray="6 3"
                    className="field-hit"
                  />
                ))}
            </svg>
          </div>
          <div className="template-pagination">
            <button
              className="icon-button"
              disabled={safe === 0}
              aria-label="Previous template page"
              onClick={() => setPage(safe - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              Page {safe + 1} of {pages}
            </span>
            <button
              className="icon-button"
              disabled={safe === pages - 1}
              aria-label="Next template page"
              onClick={() => setPage(safe + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
          {errors.length > 0 && (
            <div className="template-errors" role="alert">
              {errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}
        </section>
        <aside className="template-inspector">
          <section className="card">
            <div className="card-heading">
              <h2>
                <Crosshair size={16} />
                Question regions
              </h2>
            </div>
            <div className="form-fields">
              <label>
                Question to calibrate
                <Select
                  aria-label="Calibrate question region"
                  value={selectedQuestion}
                  onChange={(e) => {
                    const q = Number(e.target.value);
                    setSelectedQuestion(q);
                    setPage(Math.floor(q / layout.questionsPerPage));
                  }}
                >
                  {Array.from({ length: draft.questions }, (_, q) => (
                    <option key={q} value={q}>
                      Q{q + 1} ·{" "}
                      {questionType(draft, q) === "integer3"
                        ? "3-digit integer"
                        : "MCQ"}
                    </option>
                  ))}
                </Select>
              </label>
              <p className="small muted">
                Drag any green bubble to correct its measured centre. Orange is
                the selected question. Coordinates are saved per question, so
                irregular spacing and mixed sections are supported.
              </p>
              <div className="form-two-columns">
                {(["x", "y"] as const).map((axis) => (
                  <label key={axis}>
                    First bubble {axis}
                    <input
                      type="number"
                      aria-label={`Question origin ${axis}`}
                      value={selectedGeometry.points[0][axis]}
                      onChange={(e) => {
                        const delta =
                          Number(e.target.value) -
                          selectedGeometry.points[0][axis];
                        if (Number.isFinite(delta))
                          patchQuestion(
                            selectedGeometry.points.map((p) => ({
                              ...p,
                              [axis]: Math.round((p[axis] + delta) * 10) / 10,
                            })),
                          );
                      }}
                    />
                  </label>
                ))}
                <label>
                  Bubble radius
                  <input
                    type="number"
                    min="5"
                    max="25"
                    step="0.1"
                    value={selectedGeometry.radius}
                    onChange={(e) =>
                      patchQuestion(undefined, Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  {selectedGeometry.numeric ? "Digit column gap" : "Option gap"}
                  <input
                    type="number"
                    min="12"
                    max="400"
                    step="0.1"
                    value={
                      Math.round(
                        (selectedGeometry.points[
                          selectedGeometry.numeric ? 10 : 1
                        ].x -
                          selectedGeometry.points[0].x) *
                          10,
                      ) / 10
                    }
                    onChange={(e) => regularise(Number(e.target.value))}
                  />
                </label>
                {selectedGeometry.numeric && (
                  <label>
                    Digit row gap
                    <input
                      type="number"
                      min="12"
                      max="100"
                      step="0.1"
                      value={
                        Math.round(
                          (selectedGeometry.points[1].y -
                            selectedGeometry.points[0].y) *
                            10,
                        ) / 10
                      }
                      onChange={(e) =>
                        regularise(undefined, Number(e.target.value))
                      }
                    />
                  </label>
                )}
              </div>
              <button
                className="button button-secondary button-small"
                onClick={() => regularise()}
              >
                Make this question a regular grid
              </button>
              <p className="small muted">
                Numeric order: hundreds 0–9, tens 0–9, units 0–9. Select a
                scanned layout’s three columns before importing. Print/scan a
                test sheet after calibration.
              </p>
            </div>
          </section>
          <section className="card">
            <div className="card-heading">
              <h2>
                <Type size={16} />
                Fields & content
              </h2>
            </div>
            <div className="template-field-list">
              {layout.fields.map((f) => (
                <button
                  key={f.id}
                  className={selected === f.id ? "active" : ""}
                  onClick={() => setSelected(f.id)}
                >
                  <Type size={13} />
                  <span>{f.type === "text" ? f.text || "Text" : f.type}</span>
                  {!f.visible && <small>hidden</small>}
                </button>
              ))}
            </div>
            <div className="field-add">
              <Select
                aria-label="Add field type"
                value=""
                onChange={(e) => {
                  addField(e.target.value as SheetField["type"]);
                }}
              >
                <option value="" disabled>
                  + Add a field
                </option>
                {["text", "student", "roll", "qr", "line", "logo"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            {field && (
              <div className="form-fields field-inspector">
                {field.type === "logo" && (
                  <div className="template-logo-upload">
                    {field.image && (
                      <img
                        src={field.image}
                        alt={field.text || "Uploaded school logo"}
                        style={{
                          display: "block",
                          maxWidth: "100%",
                          maxHeight: 120,
                          marginBottom: 12,
                          background: "#fff",
                          borderRadius: 8,
                        }}
                      />
                    )}
                    <input
                      ref={logoUpload}
                      type="file"
                      className="sr-only"
                      accept="image/png,image/jpeg,image/webp"
                      aria-label="Upload school logo"
                      disabled={logoBusy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void importLogo(file);
                        e.target.value = "";
                      }}
                    />
                    <button
                      className="button button-secondary button-small"
                      disabled={logoBusy}
                      onClick={() => logoUpload.current?.click()}
                    >
                      <Upload size={14} />
                      {logoBusy
                        ? "Preparing logo…"
                        : field.image
                          ? "Replace logo"
                          : "Upload logo"}
                    </button>
                    <p className="small muted">
                      PNG, JPEG or WebP · up to 5 MB. Embedded in the template;
                      aspect ratio is preserved.
                    </p>
                  </div>
                )}
                <label>
                  {field.type === "logo" ? "Logo description" : "Field content"}
                  <textarea
                    value={field.text}
                    rows={3}
                    maxLength={2000}
                    onChange={(e) => patchField({ text: e.target.value })}
                  />
                </label>
                <small className="muted">
                  Dynamic values:{" "}
                  {
                    "{exam}, {subject}, {name}, {roll}, {page}, {pages}, {questions}"
                  }
                </small>
                <div className="form-two-columns">
                  {(["x", "y", "width", "height", "fontSize"] as const).map(
                    (k) => (
                      <label key={k}>
                        {k}
                        <input
                          type="number"
                          min={k === "x" || k === "y" ? 0 : 1}
                          value={field[k]}
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            if (Number.isFinite(value))
                              patchField({
                                [k]: Math.max(
                                  k === "x" || k === "y" ? 0 : 1,
                                  Math.min(
                                    k === "fontSize"
                                      ? 120
                                      : k === "x" || k === "width"
                                        ? WIDTH
                                        : HEIGHT,
                                    value,
                                  ),
                                ),
                              });
                          }}
                        />
                      </label>
                    ),
                  )}
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={field.bold}
                    onChange={(e) => patchField({ bold: e.target.checked })}
                  />
                  Bold text
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={field.visible}
                    onChange={(e) => patchField({ visible: e.target.checked })}
                  />
                  Visible on printed sheet
                </label>
                <button
                  className="text-button danger-text"
                  onClick={() => {
                    update(
                      "fields",
                      layout.fields.filter((f) => f.id !== selected),
                    );
                    setSelected("");
                  }}
                >
                  <Trash2 size={13} />
                  Remove field
                </button>
              </div>
            )}
          </section>
          <section className="card calibration-card">
            <div className="card-heading">
              <div>
                <h2>
                  <Crosshair size={16} />
                  Calibrate a sheet
                </h2>
                <p>Match an existing upright OMR image.</p>
              </div>
            </div>
            <div className="form-fields">
              <input
                ref={upload}
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Upload reference OMR"
                onChange={(e) => {
                  if (e.target.files?.[0])
                    void importReference(e.target.files[0]);
                  e.target.value = "";
                }}
              />
              <button
                className="button button-secondary button-small"
                onClick={() => upload.current?.click()}
              >
                <Upload size={14} />
                Upload reference
              </button>
              {layout.referenceImage && (
                <button
                  className="text-button danger-text"
                  onClick={() => {
                    if (
                      confirm(
                        "Remove the reference photo from this layout? Measured geometry is kept. Existing backups may still contain the old photo.",
                      )
                    )
                      update("referenceImage", undefined);
                  }}
                >
                  Remove reference photo
                </button>
              )}
              <div className="calibration-tools">
                {(
                  [
                    ["first", "1. First A bubble"],
                    ["option", "2. Next option"],
                    ["row", "3. Next question"],
                    ["column", "Next column A"],
                    ["anchor-0", "Registration points"],
                    ["roll", "OCR region origin"],
                  ] as [Tool, string][]
                ).map(([t, label]) => (
                  <button
                    key={t}
                    disabled={
                      !!layout.questionRegions?.length &&
                      layout.questionRegions.length >= draft.questions &&
                      ["first", "option", "row", "column"].includes(t)
                    }
                    className={tool === t ? "active" : ""}
                    onClick={() => setTool(tool === t ? "select" : t)}
                  >
                    <Crosshair size={13} />
                    {label}
                  </button>
                ))}
              </div>
              <p className="small muted">
                {tool.startsWith("anchor-")
                  ? `Click registration square ${Number(tool.split("-")[1]) + 1}: top-left, top-right, bottom-right, bottom-left.`
                  : tool === "select"
                    ? "Click a calibration tool, then its matching point on the sheet."
                    : "Click the matching bubble centre or region origin on the sheet."}
              </p>
              <h3>Roll OCR crop</h3>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={layout.ocrEnabled !== false}
                  onChange={(e) => update("ocrEnabled", e.target.checked)}
                />
                Enable roll OCR for this layout
              </label>
              <p className="small muted">
                Imported layouts start with OCR off. Calibrate the handwritten
                roll-number box first; a bubble roll grid is not a text crop.
                Otherwise enter the roll manually while scanning.
              </p>
              <div className="form-two-columns">
                {(["x", "y", "width", "height"] as const).map((k) => (
                  <label key={k}>
                    {k}
                    <input
                      type="number"
                      min="0"
                      value={layout.rollRegion[k]}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (Number.isFinite(value))
                          update("rollRegion", {
                            ...layout.rollRegion,
                            [k]: Math.max(
                              k === "width" || k === "height" ? 1 : 0,
                              Math.min(
                                k === "x" || k === "width" ? WIDTH : HEIGHT,
                                value,
                              ),
                            ),
                          });
                      }}
                    />
                  </label>
                ))}
              </div>
              <p className="small muted">
                OCR reads numeric roll numbers in the blue region. QR identity
                supports letters and numbers. Reference images are for
                calibration only and are not printed.
              </p>
            </div>
          </section>
        </aside>
      </div>
      {scanOpen && (
        <LayoutScanner
          exam={draft}
          locked={workspace.results.some((r) => r.examId === exam.id)}
          onClose={() => setScanOpen(false)}
          onApply={(next) => {
            setImportedExam(next);
            setLayout(next.layout!);
            setPage(0);
            setSelectedQuestion(0);
            setReference(true);
            setScanOpen(false);
            toast(
              "Detected geometry opened as a draft. Check the editable bubbles, then save. No answers were read from the reference.",
            );
          }}
        />
      )}
    </>
  );
}
