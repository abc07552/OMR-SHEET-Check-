import { describe, expect, it } from "vitest";
import {
  analyzeImageData,
  bubbleLayout,
  findMarkers,
  MARKERS,
  perspectiveTransform,
  SHEET_HEIGHT,
  SHEET_WIDTH,
} from "./omr";
import { OPTIONS } from "./data";
import type { Exam } from "./data";

function syntheticSheet(count = 50) {
  const data = new Uint8ClampedArray(SHEET_WIDTH * SHEET_HEIGHT * 4).fill(255);
  const pixel = (x: number, y: number) => {
    const i = (y * SHEET_WIDTH + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 15;
  };
  MARKERS.forEach((p) => {
    for (let y = p.y - 17; y < p.y + 17; y++)
      for (let x = p.x - 17; x < p.x + 17; x++) pixel(x, y);
  });
  const fillBubble = (question: number, option: number, radiusFactor = 1) => {
    const l = bubbleLayout(question, count),
      r = l.radius * radiusFactor;
    for (let y = Math.floor(l.y - r); y <= l.y + r; y++)
      for (let x = Math.floor(l.xs[option] - r); x <= l.xs[option] + r; x++)
        if ((x - l.xs[option]) ** 2 + (y - l.y) ** 2 <= r * r) pixel(x, y);
  };
  return {
    image: {
      data,
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
      colorSpace: "srgb",
    } as ImageData,
    fillBubble,
  };
}
function makeExam(count: number): Exam {
  return {
    id: "scan-test",
    title: "Scan test",
    subject: "Science",
    date: "2026-11-17",
    questions: count,
    marksCorrect: 2,
    negativeMarks: 0,
    passPercentage: 40,
    answers: Array.from({ length: count }, (_, q) => OPTIONS[q % 4]),
    published: true,
  };
}

describe("registration and perspective", () => {
  it("finds all four reference squares", () => {
    const { image } = syntheticSheet();
    const found = findMarkers(image);
    found.forEach((p, i) => {
      expect(p.x).toBeCloseTo(MARKERS[i].x - 0.5, 3);
      expect(p.y).toBeCloseTo(MARKERS[i].y - 0.5, 3);
    });
  });
  it("does not mistake a larger square school logo for a registration marker", () => {
    const { image } = syntheticSheet();
    for (let y = 140; y < 280; y++)
      for (let x = 100; x < 240; x++) {
        const i = (y * image.width + x) * 4;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = 0;
      }
    expect(findMarkers(image)[0].x).toBeCloseTo(MARKERS[0].x - 0.5, 3);
  });
  it("rejects images that do not use the OMR template", () => {
    const { image } = syntheticSheet();
    image.data.fill(255);
    expect(() => findMarkers(image)).toThrow("Registration squares not found");
  });
  it("maps perspective-transformed corners accurately", () => {
    const target = [
      { x: 75, y: 41 },
      { x: 1100, y: 79 },
      { x: 1175, y: 1570 },
      { x: 115, y: 1665 },
    ];
    const transform = perspectiveTransform(MARKERS, target);
    MARKERS.forEach((p, i) => {
      const mapped = transform(p.x, p.y);
      expect(mapped.x).toBeCloseTo(target[i].x, 6);
      expect(mapped.y).toBeCloseTo(target[i].y, 6);
    });
  });
  it("reports a degenerate alignment rather than returning invalid coordinates", () => {
    expect(() =>
      perspectiveTransform(MARKERS, Array(4).fill({ x: 0, y: 0 })),
    ).toThrow("alignment failed");
  });
});
describe("automatic bubble recognition", () => {
  it.each([10, 20, 50, 60, 100])(
    "reads every filled bubble in a %i-question sheet",
    (count) => {
      const { image, fillBubble } = syntheticSheet(count);
      const exam = makeExam(count);
      for (let q = 0; q < count; q++) fillBubble(q, q % 4);
      expect(analyzeImageData(image, exam)).toEqual({
        answers: exam.answers,
        flagged: [],
      });
    },
  );
  it("leaves empty answers blank instead of inventing marks", () => {
    const { image } = syntheticSheet();
    const scanned = analyzeImageData(image, makeExam(50));
    expect(scanned.answers.every((a) => a === null)).toBe(true);
    expect(scanned.flagged).toEqual([]);
  });
  it("flags double marks and faint marks for a human review", () => {
    const { image, fillBubble } = syntheticSheet();
    fillBubble(0, 0);
    fillBubble(0, 1);
    fillBubble(1, 2, 0.35);
    const scanned = analyzeImageData(image, makeExam(50));
    expect(scanned.answers[0]).toBe(null);
    expect(scanned.flagged).toContain(0);
    expect(scanned.flagged).toContain(1);
  });
});
