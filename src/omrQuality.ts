import type { Exam } from "./data";
import { getLayout, HEIGHT, WIDTH } from "./layout";
import { questionPosition } from "./omr";

/** Printed-outline contrast only. QR contents and answer keys never raise it. */
export function outlineReadability(data: ImageData, exam: Exam): number {
  if (data.width !== WIDTH || data.height !== HEIGHT) return 0;
  const layout = getLayout(exam),
    values: number[] = [];
  for (
    let q = 0;
    q < Math.min(24, exam.questions, layout.questionsPerPage);
    q++
  ) {
    const p = questionPosition(q, exam);
    for (const x of p.xs) {
      let ring = 0,
        outside = 0,
        nr = 0,
        no = 0;
      const r = Math.ceil(p.radius + 4);
      for (let y = -r; y <= r; y += 2)
        for (let dx = -r; dx <= r; dx += 2) {
          const distance =
              layout.bubbleShape === "square"
                ? Math.max(Math.abs(dx), Math.abs(y))
                : Math.hypot(dx, y),
            px = Math.round(x + dx),
            py = Math.round(p.y + y);
          if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) continue;
          const i = (py * WIDTH + px) * 4,
            brightness =
              (data.data[i] + data.data[i + 1] + data.data[i + 2]) / 3;
          if (Math.abs(distance - p.radius) < 2) {
            ring += brightness;
            nr++;
          } else if (distance > p.radius + 2 && distance <= p.radius + 4) {
            outside += brightness;
            no++;
          }
        }
      if (nr && no) values.push(outside / no - ring / nr);
    }
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
