import type { Exam } from "./data";
import { questionType } from "./answers";
import type { QuestionType } from "./answers";

export interface Point {
  x: number;
  y: number;
}
export interface SheetField {
  id: string;
  type: "text" | "student" | "roll" | "qr" | "line" | "logo";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  bold: boolean;
  visible: boolean;
  /** Normalised, embedded raster only. Remote URLs and SVG are not accepted. */
  image?: string;
}
export const MAX_LOGO_LENGTH = 500000;
export function isEmbeddedRaster(
  value: unknown,
  maxLength = MAX_LOGO_LENGTH,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}
export interface QuestionRegion {
  /** Global zero-based question number; page comes from questionsPerPage. */
  question: number;
  radius: number;
  /** Choice order A–E, or 30 points in column-major order: hundreds 0–9, tens 0–9, units 0–9. */
  points: Point[];
}
export interface OMRLayout {
  version: 2;
  name: string;
  questionsPerPage: number;
  columns: number;
  startX: number;
  startY: number;
  columnGap: number;
  rowGap: number;
  optionGap: number;
  radius: number;
  labelOffset: number;
  bubbleShape: "circle" | "square";
  threshold: number;
  anchorMode: "markers" | "page" | "fiducials";
  questionRegions?: QuestionRegion[];
  anchors: Point[];
  fields: SheetField[];
  referenceImage?: string;
  /** Imported sheets start disabled until the operator calibrates the identity crop. */
  ocrEnabled?: boolean;
  rollRegion: { x: number; y: number; width: number; height: number };
}
export const WIDTH = 1240,
  HEIGHT = 1754;
export const DEFAULT_ANCHORS: Point[] = [
  { x: 55, y: 55 },
  { x: 1185, y: 55 },
  { x: 1185, y: 1699 },
  { x: 55, y: 1699 },
];
export function defaultLayout(
  exam: Pick<Exam, "questions" | "optionCount" | "questionTypes">,
): OMRLayout {
  const numeric = exam.questionTypes?.includes("integer3"),
    perPage = Math.min(numeric ? 12 : 100, exam.questions),
    columns = numeric || perPage > 60 ? 4 : 2;
  return {
    version: 2,
    name: "Markly standard",
    questionsPerPage: perPage,
    columns,
    startX: columns === 4 ? 156 : 210,
    startY: 420,
    columnGap: 1100 / columns,
    rowGap: numeric
      ? 370
      : Math.min(44, 1120 / Math.max(1, Math.ceil(perPage / columns) - 1)),
    optionGap:
      columns === 4
        ? exam.optionCount === 5
          ? 34
          : 42
        : exam.optionCount === 5
          ? 63
          : 79,
    radius: columns === 4 ? 10 : 14,
    labelOffset: columns === 4 ? 65 : 100,
    bubbleShape: "circle",
    threshold: 0.52,
    anchorMode: "markers",
    anchors: DEFAULT_ANCHORS.map((p) => ({ ...p })),
    rollRegion: { x: 710, y: 248, width: 295, height: 58 },
    fields: [
      {
        id: "brand",
        type: "text",
        text: "markly.",
        x: 85,
        y: 108,
        width: 500,
        height: 48,
        fontSize: 45,
        bold: true,
        visible: true,
      },
      {
        id: "tagline",
        type: "text",
        text: "EXAMINATION ANSWER SHEET",
        x: 85,
        y: 161,
        width: 900,
        height: 25,
        fontSize: 17,
        bold: false,
        visible: true,
      },
      {
        id: "exam-title",
        type: "text",
        text: "{exam}",
        x: 85,
        y: 215,
        width: 920,
        height: 35,
        fontSize: 26,
        bold: true,
        visible: true,
      },
      {
        id: "student",
        type: "student",
        text: "Student name: {name}",
        x: 85,
        y: 277,
        width: 600,
        height: 30,
        fontSize: 20,
        bold: false,
        visible: true,
      },
      {
        id: "roll",
        type: "roll",
        text: "{roll}",
        x: 720,
        y: 260,
        width: 280,
        height: 40,
        fontSize: 31,
        bold: true,
        visible: true,
      },
      {
        id: "qr",
        type: "qr",
        text: "Page identification",
        x: 1050,
        y: 212,
        width: 100,
        height: 100,
        fontSize: 16,
        bold: false,
        visible: true,
      },
      {
        id: "instructions",
        type: "text",
        text: "Fill one bubble completely. Use a dark pen. Keep all four registration squares visible.",
        x: 85,
        y: 340,
        width: 1060,
        height: 24,
        fontSize: 16,
        bold: false,
        visible: true,
      },
      {
        id: "divider",
        type: "line",
        text: "",
        x: 85,
        y: 375,
        width: 1070,
        height: 1,
        fontSize: 1,
        bold: false,
        visible: true,
      },
      {
        id: "footer",
        type: "text",
        text: "{subject} · {questions} questions · Page {page} of {pages}",
        x: 85,
        y: 1640,
        width: 1070,
        height: 24,
        fontSize: 16,
        bold: false,
        visible: true,
      },
    ],
  };
}
export function getLayout(exam: Exam): OMRLayout {
  return exam.layout || defaultLayout(exam);
}
export function pageCount(exam: Exam) {
  return Math.ceil(exam.questions / getLayout(exam).questionsPerPage);
}
/** Stable print-geometry identifier. Text, logos, OCR crops and thresholds can
 * change without invalidating a sheet; bubble coordinates/pagination cannot. */
export function sheetSignature(exam: Exam): string {
  const l = getLayout(exam);
  const geometry: unknown[] = [
    !!exam.layout ||
      (exam.optionCount || 4) !== 4 ||
      exam.questions > 100 ||
      !!exam.questionTypes?.includes("integer3"),
    exam.questions,
    exam.optionCount || 4,
    l.questionsPerPage,
    l.columns,
    l.startX,
    l.startY,
    l.columnGap,
    l.rowGap,
    l.optionGap,
    l.radius,
    l.bubbleShape,
    l.anchorMode,
    l.anchors.map(({ x, y }) => ({ x, y })),
  ];
  // Append only for new geometry: preserve every historical MCQ signature.
  if (exam.questionTypes?.includes("integer3") || l.questionRegions?.length)
    geometry.push(
      Array.from({ length: exam.questions }, (_, q) => questionType(exam, q)),
      [...(l.questionRegions || [])]
        .sort((a, b) => a.question - b.question)
        .map((r) => [r.question, r.radius, r.points.map((p) => [p.x, p.y])]),
    );
  const value = JSON.stringify(geometry);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function pageQuestionCount(exam: Exam, page = 0) {
  const per = getLayout(exam).questionsPerPage;
  return Math.max(0, Math.min(per, exam.questions - page * per));
}
export function layoutBubble(
  questionOnPage: number,
  exam: Exam,
  optionCount = exam.optionCount || 4,
) {
  const l = getLayout(exam),
    rows = Math.ceil(l.questionsPerPage / l.columns);
  const col = Math.floor(questionOnPage / rows),
    row = questionOnPage % rows;
  return {
    y: l.startY + row * l.rowGap,
    labelX: l.startX + col * l.columnGap - l.labelOffset,
    radius: l.radius,
    xs: Array.from(
      { length: optionCount },
      (_, i) => l.startX + col * l.columnGap + i * l.optionGap,
    ),
  };
}
/** Canonical geometry used by print, measurement, overlays and imported layouts. */
export function layoutQuestionPoints(
  questionOnPage: number,
  exam: Exam,
  page = 0,
) {
  const l = getLayout(exam),
    q = page * l.questionsPerPage + questionOnPage;
  const region = l.questionRegions?.find((r) => r.question === q);
  const numeric = questionType(exam, q) === "integer3";
  const p = layoutBubble(questionOnPage, exam);
  const points =
    region?.points ||
    (numeric
      ? Array.from({ length: 30 }, (_, i) => ({
          x: p.xs[0] + Math.floor(i / 10) * l.optionGap,
          y: p.y + (i % 10) * 30,
        }))
      : p.xs.map((x) => ({ x, y: p.y })));
  return { points, radius: region?.radius ?? p.radius, numeric };
}
export function regularRegion(
  question: number,
  x: number,
  y: number,
  gap: number,
  rowGap: number,
  radius: number,
  numeric: boolean,
  options = 4,
): QuestionRegion {
  return {
    question,
    radius,
    points: Array.from({ length: numeric ? 30 : options }, (_, i) => ({
      x: x + (numeric ? Math.floor(i / 10) : i) * gap,
      y: y + (numeric ? i % 10 : 0) * rowGap,
    })),
  };
}
export function layoutErrors(exam: Exam): string[] {
  const l = getLayout(exam),
    errors: string[] = [];
  if (!l.name.trim()) errors.push("Give this layout a name.");
  if (
    ![
      l.startX,
      l.startY,
      l.columnGap,
      l.rowGap,
      l.optionGap,
      l.radius,
      l.threshold,
      l.labelOffset,
    ].every(Number.isFinite)
  )
    errors.push("Geometry values must be finite numbers.");
  const region = l.rollRegion;
  if (
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width < 1 ||
    region.height < 1 ||
    region.x + region.width > WIDTH ||
    region.y + region.height > HEIGHT
  )
    errors.push("Keep the roll-number OCR crop inside the page.");
  if (
    l.questionsPerPage < 1 ||
    l.questionsPerPage > 100 ||
    !Number.isInteger(l.questionsPerPage)
  )
    errors.push("Use 1–100 questions per printed page.");
  if (l.columns < 1 || l.columns > 5 || !Number.isInteger(l.columns))
    errors.push("Use 1–5 question columns.");
  if (
    l.radius < 5 ||
    l.radius > 25 ||
    (!l.questionRegions?.length && l.optionGap < l.radius * 2 + 2) ||
    (!l.questionRegions?.length && l.rowGap < l.radius * 2 + 2) ||
    (!l.questionRegions?.length &&
      l.columns > 1 &&
      l.columnGap <
        ((exam.optionCount || 4) - 1) * l.optionGap +
          l.radius * 2 +
          l.labelOffset +
          10)
  )
    errors.push("Bubbles overlap. Increase spacing or reduce their radius.");
  if (l.anchors.length !== 4)
    errors.push("Four registration points are required.");
  if (
    l.anchorMode !== "page" &&
    l.anchors.some(
      (p, i) =>
        p.x < 17 ||
        p.x > WIDTH - 17 ||
        p.y < 17 ||
        p.y > HEIGHT - 17 ||
        (i === 0 || i === 3 ? p.x > WIDTH * 0.24 : p.x < WIDTH * 0.76) ||
        (i < 2 ? p.y > HEIGHT * 0.24 : p.y < HEIGHT * 0.76),
    )
  )
    errors.push(
      "Keep registration squares in the four outer corner regions, ordered top-left, top-right, bottom-right, bottom-left. Use paper-edge mode for sheets without corner markers.",
    );
  if (
    l.questionRegions &&
    (l.questionRegions.length > 500 ||
      new Set(l.questionRegions.map((r) => r.question)).size !==
        l.questionRegions.length ||
      l.questionRegions.some(
        (r) =>
          !Number.isInteger(r.question) ||
          r.question < 0 ||
          r.question >= exam.questions,
      ))
  )
    errors.push(
      "Imported regions need unique question numbers inside this assessment.",
    );
  const regions: {
    page: number;
    q: number;
    points: Point[];
    radius: number;
  }[] = [];
  for (let q = 0; q < exam.questions; q++) {
    const page = Math.floor(q / l.questionsPerPage),
      p = layoutQuestionPoints(q % l.questionsPerPage, exam, page);
    if (
      p.points.length !== (p.numeric ? 30 : exam.optionCount || 4) ||
      !Number.isFinite(p.radius) ||
      p.radius < 5 ||
      p.radius > 25 ||
      p.points.some(
        (a) =>
          !Number.isFinite(a.x) ||
          !Number.isFinite(a.y) ||
          a.x - p.radius < 25 ||
          a.x + p.radius > WIDTH - 25 ||
          a.y - p.radius < 25 ||
          a.y + p.radius > HEIGHT - 70,
      )
    ) {
      errors.push(
        "The bubble grid extends beyond the printable area or has the wrong number of bubbles.",
      );
      break;
    }
    regions.push({ page, q, ...p });
  }
  // Check actual circles, not only their enclosing rectangles (mixed sections may interleave).
  const spatial = new Map<string, { x: number; y: number; radius: number }[]>();
  for (const r of regions)
    for (const p of r.points) {
      const cx = Math.floor(p.x / 52),
        cy = Math.floor(p.y / 52);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          if (
            (spatial.get(`${r.page}:${cx + dx}:${cy + dy}`) || []).some(
              (a) =>
                (l.bubbleShape === "square"
                  ? Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y))
                  : Math.hypot(a.x - p.x, a.y - p.y)) <
                a.radius + r.radius + 2,
            )
          )
            return [
              ...new Set([
                ...errors,
                "Bubbles overlap. Move the question regions or reduce their radius.",
              ]),
            ];
        }
      const key = `${r.page}:${cx}:${cy}`;
      spatial.set(key, [
        ...(spatial.get(key) || []),
        { ...p, radius: r.radius },
      ]);
    }
  if (
    l.fields.some(
      (f) =>
        (f.image !== undefined && !isEmbeddedRaster(f.image)) ||
        (f.type === "logo" && f.visible && !f.image),
    )
  )
    errors.push(
      "Upload a PNG, JPEG or WebP image for each visible logo, or hide/remove the field.",
    );
  if (new Set(l.fields.map((f) => f.id)).size !== l.fields.length)
    errors.push("Every field needs a unique identifier.");
  for (const f of l.fields)
    if (
      ![f.x, f.y, f.width, f.height, f.fontSize].every(Number.isFinite) ||
      f.width < 1 ||
      f.height < 1 ||
      f.fontSize < 1 ||
      f.fontSize > 120 ||
      f.x < 0 ||
      f.y < 0 ||
      f.x + f.width > WIDTH ||
      f.y + f.height > HEIGHT
    ) {
      errors.push(
        "A field is outside the printable page or has an invalid size.",
      );
      break;
    }
  return [...new Set(errors)];
}

/** Changing response type is deliberate and invalidates that key, not student data. */
export function changeQuestionTypes(exam: Exam, types: QuestionType[]): Exam {
  const next = {
    ...exam,
    questionTypes: types,
    answers: exam.answers.map((a, q) =>
      questionType(exam, q) === types[q] ? a : null,
    ),
    questionSets: exam.questionSets?.map((set) => ({
      ...set,
      answers: set.answers.map((a, q) =>
        questionType(exam, q) === types[q] ? a : null,
      ),
    })),
    published: false,
  };
  return { ...next, layout: defaultLayout(next) };
}
