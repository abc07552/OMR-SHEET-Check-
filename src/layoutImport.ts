import type { Exam, Option, QuestionType } from "./data";
import {
  DEFAULT_ANCHORS,
  HEIGHT,
  WIDTH,
  defaultLayout,
  layoutErrors,
} from "./layout";
import type { Point, QuestionRegion } from "./layout";
import { questionType } from "./answers";
import { loadOpenCV, pageQuad } from "./scanEngine";
import {
  detectCircles,
  groupLayoutCircles,
  outerMarkerQuad,
} from "./layoutVision";
import type { Circle, DetectedBlock } from "./layoutVision";

export interface LayoutScan {
  referenceImage: string;
  circles: Circle[];
  blocks: DetectedBlock[];
  mode: "fiducials" | "page";
}
export interface BlockMapping {
  id: string;
  enabled: boolean;
  /** One-based, explicit assignment, never OCR-inferred. */
  question: number;
  firstColumn: number;
  firstRow: number;
  as?: "mcq" | "integer3";
}
export async function scanLayoutImage(
  file: File,
  mode: LayoutScan["mode"],
  onStage?: (message: string) => void,
): Promise<LayoutScan> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 10 * 1024 * 1024 ||
    !file.size
  )
    throw new Error("Choose a PNG, JPEG or WebP image up to 10 MB.");
  onStage?.("Opening the layout image…");
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  try {
    if (
      bitmap.width * bitmap.height > 30_000_000 ||
      bitmap.width < 300 ||
      bitmap.height < 300
    )
      throw new Error(
        "Use a clear image between 300 pixels and 30 megapixels.",
      );
    const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
  onStage?.("Finding registration and printed bubble outlines with OpenCV…");
  const { cv } = await loadOpenCV(),
    src = cv.imread(canvas),
    dest = new cv.Mat();
  try {
    const fromPoints =
      mode === "fiducials" ? outerMarkerQuad(cv, src) : pageQuad(cv, src, true);
    const target: Point[] =
      mode === "fiducials"
        ? DEFAULT_ANCHORS
        : [
            { x: 0, y: 0 },
            { x: WIDTH - 1, y: 0 },
            { x: WIDTH - 1, y: HEIGHT - 1 },
            { x: 0, y: HEIGHT - 1 },
          ];
    const from = cv.matFromArray(
        4,
        1,
        cv.CV_32FC2,
        fromPoints.flatMap((p) => [p.x, p.y]),
      ),
      to = cv.matFromArray(
        4,
        1,
        cv.CV_32FC2,
        target.flatMap((p) => [p.x, p.y]),
      );
    let matrix;
    try {
      matrix = cv.getPerspectiveTransform(from, to);
    } finally {
      from.delete();
      to.delete();
    }
    try {
      cv.warpPerspective(
        src,
        dest,
        matrix,
        new cv.Size(WIDTH, HEIGHT),
        cv.INTER_LINEAR,
        cv.BORDER_CONSTANT,
        new cv.Scalar(255, 255, 255, 255),
      );
    } finally {
      matrix.delete();
    }
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    cv.imshow(canvas, dest);
    const circles = detectCircles(cv, canvas),
      blocks = groupLayoutCircles(circles);
    if (!blocks.length)
      throw new Error(
        "No complete bubble rows or digit grids were detected. Try a sharper upright image, or upload it as a reference and calibrate manually. No questions have been changed.",
      );
    onStage?.(
      "Preparing an editable mapping. No answer marks or keys are imported.",
    );
    return {
      referenceImage: canvas.toDataURL("image/jpeg", 0.78),
      circles,
      blocks,
      mode,
    };
  } finally {
    src.delete();
    dest.delete();
    canvas.width = canvas.height = 0;
  }
}
export function initialMappings(scan: LayoutScan): BlockMapping[] {
  let q = 1;
  return scan.blocks.map((b) => {
    const possibleRoll = b.kind === "digits" && b.columns === 5;
    const mapping = {
      id: b.id,
      enabled: b.kind === "choice",
      question: q,
      firstColumn: 0,
      firstRow: b.rows === 11 ? 1 : 0,
      as: (b.kind === "choice" ? "mcq" : "integer3") as "mcq" | "integer3",
    };
    if (!possibleRoll) q++;
    return mapping;
  });
}
export function mappedRegion(
  block: DetectedBlock,
  mapping: BlockMapping,
): QuestionRegion {
  if (
    block.kind === "digits" &&
    (!Number.isInteger(mapping.firstColumn) ||
      mapping.firstColumn < 0 ||
      mapping.firstColumn > block.columns - 3 ||
      !Number.isInteger(mapping.firstRow) ||
      mapping.firstRow < 0 ||
      mapping.firstRow > block.rows - 10)
  )
    throw new Error(
      "Select three complete columns and exactly the ten 0–9 rows.",
    );
  const points =
    block.kind === "choice"
      ? block.points
      : Array.from(
          { length: 30 },
          (_, i) =>
            block.points[
              (mapping.firstColumn + Math.floor(i / 10)) * block.rows +
                mapping.firstRow +
                (i % 10)
            ],
        );
  if (points.some((p) => !p))
    throw new Error(
      "Select three complete columns and exactly the ten 0–9 rows.",
    );
  return {
    question: mapping.question - 1,
    radius: Math.max(5, Math.min(25, Math.round(block.radius * 10) / 10)),
    points: points.map((p) => ({
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
    })),
  };
}
export function mappedRegions(
  block: DetectedBlock,
  mapping: BlockMapping,
): QuestionRegion[] {
  if (block.kind === "digits" && mapping.as === "mcq")
    return Array.from({ length: block.rows }, (_, row) => ({
      question: mapping.question - 1 + row,
      radius: Math.max(5, Math.min(25, Math.round(block.radius * 10) / 10)),
      points: Array.from(
        { length: block.columns },
        (_, col) => block.points[col * block.rows + row],
      ).map((p) => ({ ...p })),
    }));
  return [mappedRegion(block, mapping)];
}
export function applyLayoutScan(
  exam: Exam,
  scan: LayoutScan,
  mappings: BlockMapping[],
  resize: boolean,
): Exam {
  const selected = mappings.filter((m) => m.enabled);
  if (!selected.length)
    throw new Error("Select at least one detected question to import.");
  if (
    selected.some(
      (m) =>
        !Number.isInteger(m.question) || m.question < 1 || m.question > 500,
    ) ||
    new Set(selected.map((m) => m.question)).size !== selected.length
  )
    throw new Error(
      "Assign each selected region a unique question number from 1 to 500.",
    );
  const mapped = selected.flatMap((m) => {
    const block = scan.blocks.find((b) => b.id === m.id);
    if (!block)
      throw new Error(
        "This detected region is no longer available. Rescan the layout.",
      );
    const numeric = block.kind === "digits" && m.as !== "mcq";
    return mappedRegions(block, m).map((region) => ({
      region,
      numeric,
      columns: block.columns,
    }));
  });
  const questions = resize
    ? Math.max(...mapped.map(({ region: r }) => r.question + 1))
    : exam.questions;
  if (questions > 100)
    throw new Error(
      "One imported image can map at most 100 questions. Use separate assessments/templates for larger externally printed pages.",
    );
  if (
    mapped.length !== questions ||
    new Set(mapped.map(({ region: r }) => r.question)).size !== mapped.length ||
    mapped.some(({ region: r }) => r.question < 0 || r.question >= questions)
  )
    throw new Error(
      `Map every question 1–${questions} exactly once, without overlapping question ranges. Use “Renumber selected regions” after choosing grid types.`,
    );
  const types: QuestionType[] = Array(questions).fill("choice");
  const regions = mapped
    .map(({ region, numeric }) => {
      types[region.question] = numeric ? "integer3" : "choice";
      return region;
    })
    .sort((a, b) => a.question - b.question);
  const choiceCounts = [
    ...new Set(
      mapped.flatMap(({ numeric, columns }) => (numeric ? [] : [columns])),
    ),
  ];
  if (choiceCounts.length > 1)
    throw new Error(
      "All MCQ rows must use the same option count. Exclude incomplete/spurious rows and calibrate missing bubbles manually.",
    );
  const optionCount = (choiceCounts[0] || exam.optionCount || 4) as
    2 | 3 | 4 | 5;
  const answers: (Option | null)[] = Array.from(
    { length: questions },
    (_, q) =>
      questionType(exam, q) === types[q] &&
      (types[q] === "integer3" || (exam.optionCount || 4) === optionCount)
        ? exam.answers[q] || null
        : null,
  );
  const layout = {
    ...defaultLayout({ ...exam, questions, questionTypes: types, optionCount }),
    name: "Scanned layout · review required",
    questionsPerPage: questions,
    anchorMode: scan.mode,
    anchors:
      scan.mode === "fiducials"
        ? DEFAULT_ANCHORS.map((p) => ({ ...p }))
        : [
            { x: 0, y: 0 },
            { x: WIDTH - 1, y: 0 },
            { x: WIDTH - 1, y: HEIGHT - 1 },
            { x: 0, y: HEIGHT - 1 },
          ],
    fields: [],
    ocrEnabled: false,
    questionRegions: regions,
    referenceImage: scan.referenceImage,
  };
  const result: Exam = {
    ...exam,
    questions,
    optionCount,
    questionTypes: types,
    answers,
    layout,
    questionSets: exam.questionSets?.map((set) => ({
      ...set,
      answers: Array.from({ length: questions }, (_, q) =>
        questionType(exam, q) === types[q] &&
        (types[q] === "integer3" || (exam.optionCount || 4) === optionCount)
          ? set.answers[q] || null
          : null,
      ),
    })),
    subjects: questions === exam.questions ? exam.subjects : [],
    published: exam.published && answers.every(Boolean),
  };
  const errors = layoutErrors(result);
  if (errors.length) throw new Error(errors[0]);
  return result;
}
