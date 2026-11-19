import type { Exam } from "./data";

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
  anchorMode: "markers" | "page";
  anchors: Point[];
  fields: SheetField[];
  referenceImage?: string;
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
  exam: Pick<Exam, "questions" | "optionCount">,
): OMRLayout {
  const perPage = Math.min(100, exam.questions),
    columns = perPage > 60 ? 4 : 2;
  return {
    version: 2,
    name: "Markly standard",
    questionsPerPage: perPage,
    columns,
    startX: columns === 4 ? 156 : 210,
    startY: 420,
    columnGap: 1100 / columns,
    rowGap: Math.min(44, 1120 / Math.max(1, Math.ceil(perPage / columns) - 1)),
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
  const value = JSON.stringify([
    !!exam.layout || (exam.optionCount || 4) !== 4 || exam.questions > 100,
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
    l.anchors,
  ]);
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
    l.optionGap < l.radius * 2 + 2 ||
    l.rowGap < l.radius * 2 + 2 ||
    (l.columns > 1 &&
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
    l.anchorMode === "markers" &&
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
  for (let q = 0; q < Math.min(l.questionsPerPage, exam.questions); q++) {
    const p = layoutBubble(q, exam);
    if (
      p.labelX < 25 ||
      p.xs.some((x) => x - p.radius < 25 || x + p.radius > WIDTH - 25) ||
      p.y - p.radius < 25 ||
      p.y + p.radius > HEIGHT - 70
    ) {
      errors.push("The bubble grid extends beyond the printable area.");
      break;
    }
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
