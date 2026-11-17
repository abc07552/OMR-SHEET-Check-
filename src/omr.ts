import { OPTIONS } from "./data";
import type { Exam, Option } from "./data";

export const SHEET_WIDTH = 1240;
export const SHEET_HEIGHT = 1754;
export const MARKERS = [
  { x: 55, y: 55 },
  { x: 1185, y: 55 },
  { x: 1185, y: 1699 },
  { x: 55, y: 1699 },
];
export function bubbleLayout(question: number, count: number) {
  const columns = count > 60 ? 4 : 2;
  const rows = Math.ceil(count / columns);
  const column = Math.floor(question / rows);
  const row = question % rows;
  const columnWidth = 1100 / columns;
  const y = 400 + row * Math.min(46, 1160 / Math.max(1, rows - 1));
  const start = 80 + columnWidth * column;
  return {
    y,
    labelX: start + 10,
    radius: columns === 4 ? 11 : 15,
    xs: OPTIONS.map(
      (_, i) =>
        start + (columns === 4 ? 76 : 130) + i * (columns === 4 ? 42 : 79),
    ),
  };
}
export function createSheet(
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
    OPTIONS.forEach((opt, i) => {
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
export function downloadTemplate(exam: Exam) {
  const link = document.createElement("a");
  link.download = `markly-${exam.questions}q-${exam.id}.png`;
  link.href = createSheet(exam).toDataURL("image/png");
  link.click();
}
interface Point {
  x: number;
  y: number;
}
// Four dark registration squares make scale and perspective independent of camera resolution.
export function findMarkers(data: ImageData): Point[] {
  const { width, height } = data;
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
  return regions.map(([rx, ry]) => {
    const x0 = Math.floor(rx * width),
      x1 = Math.min(width, x0 + Math.ceil(0.24 * width));
    const y0 = Math.floor(ry * height),
      y1 = Math.min(height, y0 + Math.ceil(0.24 * height));
    const visited = new Uint8Array((x1 - x0) * (y1 - y0));
    const rw = x1 - x0;
    let best: { point: Point; size: number } | null = null;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const idx = (y - y0) * rw + x - x0;
        if (visited[idx] || gray(x, y) > 90) continue;
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
            if (!visited[ni] && gray(nx, ny) < 90) {
              visited[ni] = 1;
              queue.push(nx, ny);
            }
          }
        }
        const w = maxX - minX + 1,
          h = maxY - minY + 1;
        if (
          n > 35 &&
          w / h > 0.6 &&
          w / h < 1.65 &&
          n / (w * h) > 0.75 &&
          (!best || n > best.size)
        )
          best = { point: { x: sx / n, y: sy / n }, size: n };
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
export function analyzeImageData(data: ImageData, exam: Exam) {
  const markers = findMarkers(data);
  const map = perspectiveTransform(MARKERS, markers);
  const answers: (Option | null)[] = [],
    flagged: number[] = [];
  for (let q = 0; q < exam.questions; q++) {
    const l = bubbleLayout(q, exam.questions);
    const darkness = l.xs.map((x) => {
      let dark = 0,
        total = 0;
      const r = l.radius * 0.58;
      for (let sy = -r; sy <= r; sy += 1.5)
        for (let sx = -r; sx <= r; sx += 1.5) {
          if (sx * sx + sy * sy > r * r) continue;
          const p = map(x + sx, l.y + sy);
          const px = Math.round(p.x),
            py = Math.round(p.y);
          if (px < 0 || py < 0 || px >= data.width || py >= data.height)
            continue;
          const i = (py * data.width + px) * 4;
          if ((data.data[i] + data.data[i + 1] + data.data[i + 2]) / 3 < 155)
            dark++;
          total++;
        }
      return total ? dark / total : 0;
    });
    const filled = darkness
      .map((v, i) => ({ v, i }))
      .filter((a) => a.v >= 0.52);
    if (filled.length === 1) answers.push(OPTIONS[filled[0].i]);
    else {
      answers.push(null);
      if (filled.length > 1 || darkness.some((v) => v > 0.22)) flagged.push(q);
    }
  }
  return { answers, flagged };
}
export async function scanFile(file: File, exam: Exam) {
  if (file.size > 20 * 1024 * 1024)
    throw new Error(
      "This image is larger than 20 MB. Please resize it and try again.",
    );
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return analyzeImageData(
      ctx.getImageData(0, 0, canvas.width, canvas.height),
      exam,
    );
  } finally {
    image.close();
  }
}
