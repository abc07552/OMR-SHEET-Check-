import QRCode from "qrcode";
import { OPTIONS, getOptions } from "./data";
import type { AnswerDetection, Exam, Option } from "./data";
import {
  DEFAULT_ANCHORS,
  getLayout,
  layoutBubble,
  pageCount,
  pageQuestionCount,
  sheetSignature,
  WIDTH,
  HEIGHT,
} from "./layout";

import { loadSheetImage } from "./sheetImages";

export const SHEET_WIDTH = WIDTH,
  SHEET_HEIGHT = HEIGHT;
export const MARKERS = DEFAULT_ANCHORS;
export function bubbleLayout(question: number, count: number, optionCount = 4) {
  const columns = count > 60 ? 4 : 2,
    rows = Math.ceil(count / columns),
    column = Math.floor(question / rows),
    row = question % rows,
    columnWidth = 1100 / columns;
  const y = 400 + row * Math.min(46, 1160 / Math.max(1, rows - 1)),
    start = 80 + columnWidth * column;
  return {
    y,
    labelX: start + 10,
    radius: columns === 4 ? 11 : 15,
    xs: Array.from(
      { length: optionCount },
      (_, i) =>
        start +
        (columns === 4 ? 76 : 130) +
        i *
          (columns === 4
            ? optionCount === 5
              ? 34
              : 42
            : optionCount === 5
              ? 63
              : 79),
    ),
  };
}
const isModern = (exam: Exam) =>
  !!exam.layout || (exam.optionCount || 4) !== 4 || exam.questions > 100;
export function questionPosition(q: number, exam: Exam, page = 0) {
  return isModern(exam)
    ? layoutBubble(q, exam)
    : bubbleLayout(q, pageQuestionCount(exam, page), getOptions(exam).length);
}
function legacySheet(
  exam: Exam,
  answers?: (Option | null)[],
  name = "",
  roll = "",
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SHEET_WIDTH;
  canvas.height = SHEET_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111";
  MARKERS.forEach((p) => ctx.fillRect(p.x - 17, p.y - 17, 34, 34));
  ctx.font = "bold 45px sans-serif";
  ctx.fillText("markly.", 85, 136);
  ctx.font = "18px sans-serif";
  ctx.fillStyle = "#555";
  ctx.fillText("LESS MARKING. MORE MEANING.", 86, 170);
  ctx.textAlign = "right";
  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = "#111";
  ctx.fillText("OMR ANSWER SHEET", 1155, 128);
  ctx.font = "18px sans-serif";
  ctx.fillStyle = "#555";
  ctx.fillText(`${exam.questions} questions · ${exam.subject}`, 1155, 162);
  ctx.textAlign = "left";
  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(85, 198);
  ctx.lineTo(1155, 198);
  ctx.stroke();
  ctx.fillStyle = "#111";
  ctx.font = "bold 25px sans-serif";
  ctx.fillText(exam.title, 85, 244);
  ctx.font = "19px sans-serif";
  ctx.fillText(
    `Student name:  ${name || "________________________________"}`,
    85,
    294,
  );
  ctx.fillText(`Roll number:  ${roll || "___________________"}`, 760, 294);
  ctx.font = "17px sans-serif";
  ctx.fillStyle = "#666";
  ctx.fillText(
    "Fill one bubble completely using a dark pen. Keep all four corner squares visible.",
    85,
    337,
  );
  const columns = exam.questions > 60 ? 4 : 2;
  const rows = Math.ceil(exam.questions / columns);
  for (let col = 0; col < columns; col++) {
    const l = bubbleLayout(col * rows, exam.questions);
    ctx.font = "bold 17px sans-serif";
    ctx.fillStyle = "#444";
    getOptions(exam).forEach((opt, i) => {
      ctx.textAlign = "center";
      ctx.fillText(opt, l.xs[i], 369);
    });
    ctx.textAlign = "left";
  }
  for (let q = 0; q < exam.questions; q++) {
    const l = bubbleLayout(q, exam.questions);
    ctx.fillStyle = "#222";
    ctx.font = "18px sans-serif";
    ctx.fillText(String(q + 1).padStart(2, "0"), l.labelX, l.y + 6);
    l.xs.forEach((x, i) => {
      ctx.beginPath();
      ctx.arc(x, l.y, l.radius, 0, Math.PI * 2);
      ctx.strokeStyle = "#444";
      ctx.lineWidth = 1.7;
      ctx.stroke();
      if (answers?.[q] === OPTIONS[i]) {
        ctx.fillStyle = "#181818";
        ctx.fill();
      }
    });
  }
  ctx.strokeStyle = "#ddd";
  ctx.beginPath();
  ctx.moveTo(85, 1609);
  ctx.lineTo(1155, 1609);
  ctx.stroke();
  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#777";
  ctx.fillText(
    "Do not fold or write over the registration squares. Scan upright in even lighting.",
    85,
    1645,
  );
  ctx.textAlign = "right";
  ctx.fillText(`MARKLY · ${exam.id.toUpperCase()}`, 1155, 1681);
  return canvas;
}

export async function createSheet(
  exam: Exam,
  answers?: (Option | null)[],
  name = "",
  roll = "",
  page = 0,
): Promise<HTMLCanvasElement> {
  if (!isModern(exam)) return legacySheet(exam, answers, name, roll);
  const l = getLayout(exam),
    canvas = document.createElement("canvas");
  const logos = new Map(
    await Promise.all(
      l.fields
        .filter((f) => f.visible && f.type === "logo" && f.image)
        .map(async (f) => [f.id, await loadSheetImage(f.image!)] as const),
    ),
  );
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#111";
  if (l.anchorMode === "markers")
    l.anchors.forEach((p) => ctx.fillRect(p.x - 17, p.y - 17, 34, 34));
  const vars: Record<string, string> = {
    exam: exam.title,
    subject: exam.subject,
    name: name || "________________________________",
    roll: roll || "____________",
    questions: String(exam.questions),
    page: String(page + 1),
    pages: String(pageCount(exam)),
  };
  l.fields
    .filter((f) => f.visible)
    .forEach((f) => {
      ctx.save();
      ctx.fillStyle = "#111";
      ctx.strokeStyle = "#bbb";
      if (f.type === "line") {
        ctx.fillStyle = "#bbb";
        ctx.fillRect(f.x, f.y, f.width, Math.max(1, f.height));
      } else if (f.type === "qr") {
        const qr = QRCode.create(
            JSON.stringify({
              m: 2,
              e: exam.id,
              p: page,
              n: pageCount(exam),
              q: exam.questions,
              o: getOptions(exam).length,
              l: sheetSignature(exam),
              r: roll,
            }),
            { errorCorrectionLevel: "M" },
          ),
          size = qr.modules.size,
          unit = Math.min(f.width, f.height) / (size + 8);
        ctx.fillStyle = "#fff";
        ctx.fillRect(f.x, f.y, f.width, f.height);
        ctx.fillStyle = "#000";
        for (let r = 0; r < size; r++)
          for (let c = 0; c < size; c++)
            if (qr.modules.get(r, c))
              ctx.fillRect(
                f.x + (c + 4) * unit,
                f.y + (r + 4) * unit,
                unit + 0.15,
                unit + 0.15,
              );
      } else if (f.type === "logo") {
        const image = logos.get(f.id);
        if (image) {
          const scale = Math.min(
              f.width / image.naturalWidth,
              f.height / image.naturalHeight,
            ),
            width = image.naturalWidth * scale,
            height = image.naturalHeight * scale;
          ctx.drawImage(
            image,
            f.x + (f.width - width) / 2,
            f.y + (f.height - height) / 2,
            width,
            height,
          );
        }
      } else {
        ctx.font = `${f.bold ? "bold " : ""}${f.fontSize}px sans-serif`;
        ctx.textBaseline = "top";
        const text = f.text.replace(/\{(\w+)\}/g, (_, key) => vars[key] || "");
        const lines = text.split("\n");
        lines.forEach((line, i) => {
          if (i * f.fontSize * 1.25 < f.height)
            ctx.fillText(line, f.x, f.y + i * f.fontSize * 1.25, f.width);
        });
      }
      ctx.restore();
    });
  const count = pageQuestionCount(exam, page),
    options = getOptions(exam),
    rows = Math.ceil(l.questionsPerPage / l.columns);
  for (let col = 0; col < l.columns; col++) {
    const p = layoutBubble(col * rows, exam);
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    options.forEach((o, i) => ctx.fillText(o, p.xs[i], l.startY - 31));
  }
  ctx.textAlign = "left";
  for (let q = 0; q < count; q++) {
    const p = layoutBubble(q, exam);
    ctx.font = "17px sans-serif";
    ctx.fillStyle = "#222";
    ctx.fillText(
      String(page * l.questionsPerPage + q + 1).padStart(2, "0"),
      p.labelX,
      p.y + 5,
    );
    p.xs.forEach((x, i) => {
      ctx.beginPath();
      if (l.bubbleShape === "square")
        ctx.rect(x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2);
      else ctx.arc(x, p.y, p.radius, 0, Math.PI * 2);
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (answers?.[page * l.questionsPerPage + q] === options[i]) {
        ctx.fillStyle = "#111";
        ctx.fill();
      }
    });
  }
  return canvas;
}
export async function downloadTemplate(exam: Exam, page = 0) {
  const a = document.createElement("a");
  a.download = `markly-${exam.id}-page-${page + 1}.png`;
  a.href = (await createSheet(exam, undefined, "", "", page)).toDataURL(
    "image/png",
  );
  a.click();
}
export async function templatePDF(
  exam: Exam,
  student?: { name: string; roll: string },
  answers?: (Option | null)[],
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  for (let p = 0; p < pageCount(exam); p++) {
    if (p) doc.addPage();
    const canvas = await createSheet(
      exam,
      answers,
      student?.name || "",
      student?.roll || "",
      p,
    );
    doc.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      0,
      0,
      210,
      297,
      undefined,
      "FAST",
    );
  }
  return doc;
}
export async function downloadTemplatePDF(
  exam: Exam,
  student?: { name: string; roll: string },
) {
  const doc = await templatePDF(exam, student);
  doc.save(`markly-omr-${exam.id}${student ? `-${student.roll}` : ""}.pdf`);
}
interface Point {
  x: number;
  y: number;
}
// Four dark registration squares make scale and perspective independent of camera resolution.
export function findMarkers(
  data: ImageData,
  reference: Point[] = MARKERS,
): Point[] {
  const { width, height } = data;
  const expectedArea = (34 * 34 * width * height) / (WIDTH * HEIGHT);
  const gray = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return (data.data[i] + data.data[i + 1] + data.data[i + 2]) / 3;
  };
  const regions = [
    [0, 0],
    [0.76, 0],
    [0.76, 0.76],
    [0, 0.76],
  ];
  return regions.map(([rx, ry], corner) => {
    const x0 = Math.floor(rx * width),
      x1 = Math.min(width, x0 + Math.ceil(0.24 * width));
    const y0 = Math.floor(ry * height),
      y1 = Math.min(height, y0 + Math.ceil(0.24 * height));
    const rw = x1 - x0,
      rh = y1 - y0,
      stride = rw + 1,
      integral = new Float64Array(stride * (rh + 1)),
      ink = new Uint8Array(rw * rh),
      visited = new Uint8Array(rw * rh),
      radius = Math.max(6, Math.round((30 * width) / WIDTH));
    for (let y = 0; y < rh; y++) {
      let row = 0;
      for (let x = 0; x < rw; x++) {
        row += gray(x0 + x, y0 + y);
        integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
      }
    }
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++) {
        const left = Math.max(0, x - radius),
          right = Math.min(rw, x + radius + 1),
          top = Math.max(0, y - radius),
          bottom = Math.min(rh, y + radius + 1),
          sum =
            integral[bottom * stride + right] -
            integral[top * stride + right] -
            integral[bottom * stride + left] +
            integral[top * stride + left],
          localPaper = sum / ((right - left) * (bottom - top));
        ink[y * rw + x] = gray(x0 + x, y0 + y) < localPaper - 12 ? 1 : 0;
      }
    let best: { point: Point; score: number } | null = null;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const idx = (y - y0) * rw + x - x0;
        if (visited[idx] || !ink[idx]) continue;
        const queue: number[] = [x, y];
        visited[idx] = 1;
        let head = 0,
          n = 0,
          minX = x,
          maxX = x,
          minY = y,
          maxY = y,
          sx = 0,
          sy = 0;
        while (head < queue.length) {
          const px = queue[head++],
            py = queue[head++];
          n++;
          sx += px;
          sy += py;
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
          for (const [nx, ny] of [
            [px - 1, py],
            [px + 1, py],
            [px, py - 1],
            [px, py + 1],
          ]) {
            if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
            const ni = (ny - y0) * rw + nx - x0;
            if (!visited[ni] && ink[ni]) {
              visited[ni] = 1;
              queue.push(nx, ny);
            }
          }
        }
        const w = maxX - minX + 1,
          h = maxY - minY + 1;
        const score =
          Math.abs(Math.log(n / expectedArea)) +
          5 *
            Math.hypot(
              sx / n / width - reference[corner].x / WIDTH,
              sy / n / height - reference[corner].y / HEIGHT,
            );
        if (
          n > 35 &&
          n < expectedArea * 4 &&
          w / h > 0.6 &&
          w / h < 1.65 &&
          n / (w * h) > 0.75 &&
          (!best || score < best.score)
        )
          best = { point: { x: sx / n, y: sy / n }, score };
      }
    if (!best)
      throw new Error(
        "Registration squares not found. Use the Markly template and keep all four corners visible.",
      );
    return best.point;
  });
}
// Solve an eight-parameter projective transform from the sheet to the uploaded photograph.
export function perspectiveTransform(from: Point[], to: Point[]) {
  const m: number[][] = [];
  from.forEach((p, i) => {
    const t = to[i];
    m.push([p.x, p.y, 1, 0, 0, 0, -t.x * p.x, -t.x * p.y, t.x]);
    m.push([0, 0, 0, p.x, p.y, 1, -t.y * p.x, -t.y * p.y, t.y]);
  });
  for (let i = 0; i < 8; i++) {
    let pivot = i;
    for (let j = i + 1; j < 8; j++)
      if (Math.abs(m[j][i]) > Math.abs(m[pivot][i])) pivot = j;
    [m[i], m[pivot]] = [m[pivot], m[i]];
    if (Math.abs(m[i][i]) < 1e-10)
      throw new Error(
        "Sheet alignment failed. Please upload a clearer, upright image.",
      );
    const d = m[i][i];
    for (let k = i; k <= 8; k++) m[i][k] /= d;
    for (let j = 0; j < 8; j++)
      if (j !== i) {
        const f = m[j][i];
        for (let k = i; k <= 8; k++) m[j][k] -= f * m[i][k];
      }
  }
  const h = m.map((row) => row[8]);
  return (x: number, y: number): Point => {
    const d = h[6] * x + h[7] * y + 1;
    return {
      x: (h[0] * x + h[1] * y + h[2]) / d,
      y: (h[3] * x + h[4] * y + h[5]) / d,
    };
  };
}

function sampleBubbles(
  data: ImageData,
  exam: Exam,
  page: number,
  map: (x: number, y: number) => Point,
) {
  const answers: (Option | null)[] = [],
    flagged: number[] = [],
    confidences: number[] = [],
    answerMeta: AnswerDetection[] = [],
    detectedOptions: Option[][] = [];
  const square = getLayout(exam).bubbleShape === "square";
  const brightnessAt = (x: number, y: number) => {
    const p = map(x, y),
      px = Math.round(p.x),
      py = Math.round(p.y);
    if (
      !Number.isFinite(px) ||
      !Number.isFinite(py) ||
      px < 0 ||
      py < 0 ||
      px >= data.width ||
      py >= data.height
    )
      return undefined;
    const i = (py * data.width + px) * 4;
    return (data.data[i] + data.data[i + 1] + data.data[i + 2]) / 3;
  };
  for (let q = 0; q < pageQuestionCount(exam, page); q++) {
    const l = questionPosition(q, exam, page),
      measurements = l.xs.map((x) => {
        // Estimate nearby paper, not a fixed global brightness. The upper
        // quartile avoids an outline, adjacent mark or text darkening the baseline.
        const paper: number[] = [];
        for (let i = 0; i < 24; i++) {
          const angle = (i * Math.PI * 2) / 24,
            dx = Math.cos(angle),
            dy = Math.sin(angle),
            distance =
              (l.radius + 4) /
              (square ? Math.max(Math.abs(dx), Math.abs(dy)) : 1),
            value = brightnessAt(x + dx * distance, l.y + dy * distance);
          if (value !== undefined) paper.push(value);
        }
        paper.sort((a, b) => a - b);
        const background = paper[Math.floor(paper.length * 0.75)] || 0,
          cutoff = background - Math.max(12, background * 0.15);
        let dark = 0,
          total = 0,
          invalid = paper.length < 20 || background < 25;
        const r = l.radius * 0.58;
        for (let sy = -r; sy <= r; sy += 1.5)
          for (let sx = -r; sx <= r; sx += 1.5) {
            if (!square && sx * sx + sy * sy > r * r) continue;
            const value = brightnessAt(x + sx, l.y + sy);
            if (value === undefined) {
              invalid = true;
              continue;
            }
            if (value < cutoff) dark++;
            total++;
          }
        return { ratio: total ? dark / total : 0, invalid: invalid || !total };
      }),
      darkness = measurements.map((m) => m.ratio),
      invalid = measurements.some((m) => m.invalid);
    const threshold = exam.layout?.threshold || 0.52;
    const filled = invalid
      ? []
      : darkness.map((v, i) => ({ v, i })).filter((a) => a.v >= threshold);
    const selected = filled.map((f) => getOptions(exam)[f.i]);
    const maximum = Math.max(...darkness),
      others = darkness.filter((_, i) => i !== filled[0]?.i);
    let status: AnswerDetection["status"] = "blank";
    if (invalid) status = "invalid";
    else if (filled.length > 1) status = "multiple";
    else if (filled.length === 1)
      status =
        maximum < threshold + 0.12 || others.some((v) => v > 0.22)
          ? "uncertain"
          : "filled";
    else if (maximum > 0.32) status = "partial";
    else if (maximum > 0.22) status = "erased";
    if (status !== "blank" && status !== "filled") flagged.push(q);
    const confidence = invalid
      ? 0
      : filled.length === 1
        ? Math.max(0, maximum - Math.max(0, ...others))
        : filled.length
          ? 0
          : 1 - maximum;
    answers.push(filled.length === 1 ? selected[0] : null);
    confidences.push(confidence);
    detectedOptions.push(selected);
    answerMeta.push({
      question: q,
      selected,
      status,
      confidence: confidence * 100,
      verified: false,
      coordinates: l.xs.map((x, i) => ({
        ...map(x, l.y),
        alignedX: x,
        alignedY: l.y,
        radius: l.radius,
        option: getOptions(exam)[i],
        inkRatio: darkness[i],
      })),
    });
  }
  return {
    answers,
    flagged,
    answerMeta,
    detectedOptions,
    confidence: confidences.length
      ? (confidences.reduce((s, v) => s + v, 0) / confidences.length) * 100
      : 0,
  };
}
export function analyzeAlignedImageData(data: ImageData, exam: Exam, page = 0) {
  return sampleBubbles(data, exam, page, (x, y) => ({ x, y }));
}
export function analyzeImageEvidence(data: ImageData, exam: Exam, page = 0) {
  const markers = findMarkers(data, exam.layout?.anchors || MARKERS),
    map = perspectiveTransform(exam.layout?.anchors || MARKERS, markers);
  return sampleBubbles(data, exam, page, map);
}
export function analyzeImageData(data: ImageData, exam: Exam, page = 0) {
  const { answers, flagged } = analyzeImageEvidence(data, exam, page);
  return { answers, flagged };
}
export async function scanFile(file: File, exam: Exam, page = 0) {
  const { scanPageFile } = await import("./scanEngine");
  return scanPageFile(file, exam, { pageIndex: page, ocr: false });
}
