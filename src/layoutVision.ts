import type { Point } from "./layout";

// OpenCV.js has no complete maintained TypeScript declarations.
// All allocated Mats are explicitly released in finally blocks.
type CV = any;
export interface Circle extends Point {
  radius: number;
}
export interface DetectedBlock {
  id: string;
  kind: "choice" | "digits";
  columns: number;
  rows: number;
  /** Column-major order for grids; left-to-right for MCQ rows. */
  points: Point[];
  radius: number;
}
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;

/** Real convex, solid four-sided components only; circles/answers are never fiducials. */
export function outerMarkerQuad(cv: CV, src: CV): Point[] {
  const gray = new cv.Mat(),
    binary = new cv.Mat(),
    contours = new cv.MatVector(),
    hierarchy = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(
      gray,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      61,
      12,
    );
    cv.findContours(
      binary,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );
    if (contours.size() > 12000)
      throw new Error(
        "Too many outlines. Use a clean, sharper single-page OMR image.",
      );
    const candidates: { point: Point; area: number }[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i),
        approx = new cv.Mat();
      try {
        const r = cv.boundingRect(c),
          area = cv.contourArea(c);
        cv.approxPolyDP(c, approx, cv.arcLength(c, true) * 0.035, true);
        if (
          approx.rows === 4 &&
          cv.isContourConvex(approx) &&
          area > 45 &&
          area < src.rows * src.cols * 0.003 &&
          r.width / r.height > 0.65 &&
          r.width / r.height < 1.5 &&
          area / (r.width * r.height) > 0.78
        )
          candidates.push({
            point: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
            area,
          });
      } finally {
        approx.delete();
        c.delete();
      }
    }
    if (candidates.length < 4)
      throw new Error(
        "Four outer registration squares were not found. Include the whole marker grid, or choose paper-edge alignment.",
      );
    // Use the dominant square size, excluding text boxes and QR finder patterns.
    const bins = new Map<number, number>();
    for (const c of candidates) {
      const bin = Math.round(Math.log(c.area) / 0.3);
      bins.set(bin, (bins.get(bin) || 0) + 1);
    }
    const mode = [...bins].sort((a, b) => b[1] - a[1])[0][0];
    const matching = candidates.filter(
      (c) => Math.abs(Math.log(c.area) / 0.3 - mode) < 1.7,
    );
    const scores = [
      (p: Point) => p.x / src.cols + p.y / src.rows,
      (p: Point) => -p.x / src.cols + p.y / src.rows,
      (p: Point) => -p.x / src.cols - p.y / src.rows,
      (p: Point) => p.x / src.cols - p.y / src.rows,
    ];
    const quad = scores.map(
      (score) =>
        [...matching].sort((a, b) => score(a.point) - score(b.point))[0].point,
    );
    const area =
      Math.abs(
        quad.reduce((sum, p, i) => {
          const n = quad[(i + 1) % 4];
          return sum + p.x * n.y - n.x * p.y;
        }, 0),
      ) / 2;
    if (
      new Set(quad.map((p) => `${p.x},${p.y}`)).size !== 4 ||
      area < src.cols * src.rows * 0.2 ||
      Math.min(quad[1].x - quad[0].x, quad[2].x - quad[3].x) <
        src.cols * 0.25 ||
      Math.min(quad[3].y - quad[0].y, quad[2].y - quad[1].y) < src.rows * 0.3
    )
      throw new Error(
        "The outer square grid is incomplete or too small to align safely. Retake with every outer square visible.",
      );
    return quad;
  } finally {
    gray.delete();
    binary.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/** Printed circular contours. Uses no key, OCR guess or sample answer inference. */
export function detectCircles(cv: CV, canvas: HTMLCanvasElement): Circle[] {
  const src = cv.imread(canvas),
    gray = new cv.Mat(),
    binary = new cv.Mat(),
    contours = new cv.MatVector(),
    hierarchy = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(
      gray,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      41,
      10,
    );
    cv.findContours(
      binary,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );
    if (contours.size() > 12000)
      throw new Error(
        "Too many outlines. Use a clean, sharper single-page OMR image.",
      );
    const candidates: Circle[] = [],
      squares: Circle[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i),
        approx = new cv.Mat();
      try {
        const r = cv.boundingRect(c),
          area = cv.contourArea(c),
          perimeter = cv.arcLength(c, true);
        cv.approxPolyDP(c, approx, perimeter * 0.028, true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          if (r.width >= 11 && r.height >= 11 && r.width < 55 && r.height < 55)
            squares.push({
              x: r.x + r.width / 2,
              y: r.y + r.height / 2,
              radius: Math.max(r.width, r.height) / 2,
            });
          continue;
        }
        const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
        if (
          r.width >= 11 &&
          r.height >= 11 &&
          r.width <= 51 &&
          r.height <= 51 &&
          r.width / r.height > 0.67 &&
          r.width / r.height < 1.48 &&
          circularity > 0.62 &&
          area / (r.width * r.height) > 0.5
        ) {
          candidates.push({
            x: r.x + (r.width - 1) / 2,
            y: r.y + (r.height - 1) / 2,
            radius: (r.width + r.height) / 4,
          });
        }
      } finally {
        approx.delete();
        c.delete();
      }
    }
    // Hough-gradient evidence can recover broken/filled outlines that are not closed contours.
    // Only edge-voted circles near the dominant measured size are admitted.
    const measuredRadius = median(candidates.map((p) => p.radius));
    if (measuredRadius >= 6) {
      const hough = new cv.Mat(),
        blurred = new cv.Mat();
      try {
        cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0.8);
        cv.HoughCircles(
          blurred,
          hough,
          cv.HOUGH_GRADIENT,
          1,
          measuredRadius * 1.4,
          120,
          17,
          Math.max(5, Math.floor(measuredRadius - 4)),
          Math.ceil(measuredRadius + 3),
        );
        for (let i = 0; i < hough.cols; i++) {
          const x = hough.data32F[i * 3],
            y = hough.data32F[i * 3 + 1],
            radius = hough.data32F[i * 3 + 2];
          if (!squares.some((p) => Math.hypot(p.x - x, p.y - y) < p.radius))
            candidates.push({ x, y, radius });
        }
      } finally {
        hough.delete();
        blurred.delete();
      }
    }
    candidates.sort((a, b) => b.radius - a.radius);
    const unique: Circle[] = [];
    for (const p of candidates)
      if (
        !unique.some(
          (a) =>
            Math.hypot(a.x - p.x, a.y - p.y) < Math.max(a.radius, p.radius),
        )
      )
        unique.push(p);
    if (unique.length > 4000)
      throw new Error(
        "Too many contours. Use a clean, sharper single-page OMR image.",
      );
    const bins = new Map<number, number>();
    for (const p of unique) {
      const b = Math.round(p.radius / 2);
      bins.set(b, (bins.get(b) || 0) + 1);
    }
    const mode = [...bins].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
    return unique.filter(
      (p) => Math.abs(p.radius - mode * 2) < Math.max(3.5, mode * 0.6),
    );
  } finally {
    src.delete();
    gray.delete();
    binary.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/** Conservative lattice grouping: a missing outline is not invented. Unmatched
 * circles remain visible and can be calibrated manually in Layout Studio. */
export function groupLayoutCircles(circles: Circle[]): DetectedBlock[] {
  if (circles.length < 4) return [];
  const radius = median(circles.map((p) => p.radius)),
    tolerance = Math.max(4, radius * 0.7);
  const xBuckets: Circle[][] = [];
  for (const p of [...circles].sort((a, b) => a.x - b.x)) {
    const bucket = xBuckets.find(
      (b) => Math.abs(median(b.map((v) => v.x)) - p.x) < tolerance,
    );
    if (bucket) bucket.push(p);
    else xBuckets.push([p]);
  }
  const runs: { points: Circle[]; x: number }[] = [];
  for (const bucket of xBuckets) {
    const sorted = bucket.sort((a, b) => a.y - b.y);
    let start = 0;
    while (start < sorted.length) {
      let end = start + 1;
      const firstGap = sorted[end]?.y - sorted[start].y;
      if (firstGap < radius * 1.65 || firstGap > radius * 5) {
        start++;
        continue;
      }
      while (
        end + 1 < sorted.length &&
        Math.abs(sorted[end + 1].y - sorted[end].y - firstGap) <
          Math.max(4, firstGap * 0.23)
      )
        end++;
      if (end - start + 1 > 11) {
        start = end + 1;
        continue;
      }
      if (end - start + 1 >= 10 && end - start + 1 <= 11) {
        const points = sorted.slice(start, end + 1);
        runs.push({ points, x: median(points.map((p) => p.x)) });
        start = end + 1;
      } else start++;
    }
  }
  const blocks: DetectedBlock[] = [],
    used = new Set<Circle>(),
    usedRuns = new Set<number>();
  runs.sort((a, b) => a.x - b.x);
  for (let i = 0; i < runs.length; i++) {
    if (usedRuns.has(i)) continue;
    const columns = [i];
    for (let j = i + 1; j < runs.length; j++) {
      if (usedRuns.has(j)) continue;
      const first = runs[i],
        last = runs[columns.at(-1)!],
        next = runs[j];
      if (next.x - last.x < radius * 1.7) continue;
      if (next.x - last.x > radius * 5) continue;
      if (
        next.points.length === first.points.length &&
        next.points.every(
          (p, k) => Math.abs(p.y - first.points[k].y) < tolerance,
        )
      )
        columns.push(j);
    }
    if (columns.length < 3 || columns.length > 5) continue;
    const gap = median(
      columns.slice(1).map((v, k) => runs[v].x - runs[columns[k]].x),
    );
    if (
      columns
        .slice(1)
        .some(
          (v, k) => Math.abs(runs[v].x - runs[columns[k]].x - gap) > tolerance,
        )
    )
      continue;
    const points = columns.flatMap((j) => {
      usedRuns.add(j);
      return runs[j].points;
    });
    points.forEach((p) => used.add(p));
    blocks.push({
      id: `grid-${blocks.length}`,
      kind: "digits",
      columns: columns.length,
      rows: runs[i].points.length,
      points: points.map(({ x, y }) => ({ x, y })),
      radius: Math.min(25, median(points.map((p) => p.radius))),
    });
  }
  const rows: Circle[][] = [];
  for (const p of circles
    .filter((p) => !used.has(p))
    .sort((a, b) => a.y - b.y)) {
    const row = rows.find(
      (r) => Math.abs(median(r.map((v) => v.y)) - p.y) < tolerance,
    );
    if (row) row.push(p);
    else rows.push([p]);
  }
  for (const row of rows) {
    const ordered = row.sort((a, b) => a.x - b.x);
    let group: Circle[] = [];
    const flush = () => {
      if (group.length >= 2 && group.length <= 5) {
        const gaps = group.slice(1).map((p, i) => p.x - group[i].x),
          gap = median(gaps);
        if (
          gap > radius * 1.7 &&
          gaps.every((g) => Math.abs(g - gap) < tolerance)
        )
          blocks.push({
            id: `row-${blocks.length}`,
            kind: "choice",
            columns: group.length,
            rows: 1,
            points: group.map(({ x, y }) => ({ x, y })),
            radius: Math.min(25, median(group.map((p) => p.radius))),
          });
      }
      group = [];
    };
    for (const p of ordered) {
      if (group.length && p.x - group.at(-1)!.x > radius * 5) flush();
      group.push(p);
    }
    flush();
  }
  return blocks.sort((a, b) =>
    Math.abs(a.points[0].x - b.points[0].x) > radius * 4
      ? a.points[0].x - b.points[0].x
      : a.points[0].y - b.points[0].y,
  );
}
