import { describe, expect, it } from "vitest";
import type { Exam } from "./data";
import { defaultLayout, HEIGHT, WIDTH } from "./layout";
import { questionPosition } from "./omr";
import { outlineReadability } from "./omrQuality";

function fixture(shape: "circle" | "square" = "circle") {
  const layout = {
    ...defaultLayout({ questions: 20, optionCount: 5 }),
    bubbleShape: shape,
  };
  const exam: Exam = {
    id: "outline-qa",
    title: "Measured outlines",
    subject: "Science",
    date: "2026-11-17",
    questions: 20,
    optionCount: 5,
    layout,
    marksCorrect: 1,
    negativeMarks: 0,
    passPercentage: 40,
    published: true,
    answers: Array(20).fill("A"),
  };
  const image = {
    width: WIDTH,
    height: HEIGHT,
    colorSpace: "srgb",
    data: new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255),
  } as ImageData;
  const ring = (q: number, option: number) => {
    const p = questionPosition(q, exam),
      x = p.xs[option];
    for (let dy = -p.radius - 2; dy <= p.radius + 2; dy++)
      for (let dx = -p.radius - 2; dx <= p.radius + 2; dx++) {
        const distance =
          shape === "square"
            ? Math.max(Math.abs(dx), Math.abs(dy))
            : Math.hypot(dx, dy);
        if (Math.abs(distance - p.radius) > 1) continue;
        const i = (Math.round(p.y + dy) * WIDTH + Math.round(x + dx)) * 4;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = 65;
      }
  };
  return { exam, image, ring };
}

describe("answer-independent printed-grid readability", () => {
  it.each(["circle", "square"] as const)(
    "measures the configured %s outline geometry",
    (shape) => {
      const { exam, image, ring } = fixture(shape);
      for (let q = 0; q < 20; q++)
        for (let option = 0; option < 5; option++) ring(q, option);
      expect(outlineReadability(image, exam)).toBeGreaterThan(80);
      exam.answers.fill("E");
      expect(outlineReadability(image, exam)).toBeGreaterThan(80);
    },
  );
  it("cannot let a few coincidental outlines certify a missing grid", () => {
    const { exam, image, ring } = fixture();
    ring(0, 0);
    expect(outlineReadability(image, exam)).toBeLessThan(9);
  });
  it("does not treat a sharp identity-code region as bubble-grid evidence", () => {
    const { exam, image } = fixture();
    for (let y = 210; y < 330; y++)
      for (let x = 1030; x < 1150; x++) {
        const i = (y * WIDTH + x) * 4;
        const value = (Math.floor(x / 5) + Math.floor(y / 5)) % 2 ? 0 : 255;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
      }
    expect(outlineReadability(image, exam)).toBe(0);
  });
});
