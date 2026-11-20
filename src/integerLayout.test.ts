import { describe, expect, it } from "vitest";
import rawFixture from "../test-fixtures/mixed-integer-layout.json";
import type { Exam, Option, Result } from "./data";
import {
  blankWorkspace,
  isValidWorkspace,
  gradeResult,
  questionStats,
} from "./data";
import { questionCSV } from "./reportData";
import { outlineReadability } from "./omrQuality";
import {
  classifyInteger,
  isIntegerAnswer,
  normaliseInteger,
  validAnswer,
  validSelection,
} from "./answers";
import {
  changeQuestionTypes,
  defaultLayout,
  getLayout,
  layoutErrors,
  layoutQuestionPoints,
  pageCount,
  sheetSignature,
} from "./layout";
import { analyzeAlignedImageData, questionBubbles } from "./omr";
import { applyLayoutScan, initialMappings, mappedRegion } from "./layoutImport";
import type { LayoutScan } from "./layoutImport";
import { groupLayoutCircles } from "./layoutVision";
import type { Circle } from "./layoutVision";
import { verifyResponse } from "./verification";

const fixture = () => structuredClone(rawFixture) as Exam;
const record = (exam: Exam): Result => ({
  id: "result",
  studentId: "student",
  name: "Learner",
  roll: "10001",
  section: "10 A",
  examId: exam.id,
  answers: [...exam.answers],
  detectedOptions: exam.answers.map((a) => (a ? [a] : [])),
  flagged: [],
  confirmed: true,
  createdAt: "2026-11-17",
  source: "scan",
});
function pixels(exam: Exam) {
  const data = new Uint8ClampedArray(1240 * 1754 * 4).fill(255);
  const paint = (
    x: number,
    y: number,
    radius: number,
    colour: number,
    ring = false,
  ) => {
    for (let yy = Math.floor(y - radius - 2); yy <= y + radius + 2; yy++)
      for (let xx = Math.floor(x - radius - 2); xx <= x + radius + 2; xx++) {
        const d = Math.hypot(xx - x, yy - y);
        if (
          xx < 0 ||
          yy < 0 ||
          xx >= 1240 ||
          yy >= 1754 ||
          (ring ? Math.abs(d - radius) > 1 : d > radius)
        )
          continue;
        const i = (yy * 1240 + xx) * 4;
        data[i] = data[i + 1] = data[i + 2] = colour;
      }
  };
  for (let q = 0; q < exam.questions; q++) {
    const p = questionBubbles(q, exam);
    p.points.forEach((pnt) => paint(pnt.x, pnt.y, p.radius, 65, true));
  }
  const mark = (q: number, point: number, factor = 0.9) => {
    const p = questionBubbles(q, exam),
      pnt = p.points[point];
    paint(pnt.x, pnt.y, p.radius * factor, 12);
  };
  return {
    image: { data, width: 1240, height: 1754, colorSpace: "srgb" } as ImageData,
    mark,
  };
}
function scanFixture(): LayoutScan {
  const e = fixture(),
    circles: Circle[] = [];
  for (const region of e.layout!.questionRegions!) {
    const numeric = region.question >= 20;
    if (numeric) {
      const first = region.points[0];
      for (let col = 0; col < 4; col++)
        for (let row = 0; row < 11; row++)
          circles.push({
            x: first.x + col * 45,
            y: first.y - 42 + row * 42,
            radius: 12,
          });
    } else region.points.forEach((p) => circles.push({ ...p, radius: 12 }));
  }
  for (let col = 0; col < 5; col++)
    for (let row = 0; row < 10; row++)
      circles.push({ x: 175 + col * 45, y: 130 + row * 35, radius: 12 });
  return {
    referenceImage: "data:image/jpeg;base64,AAAA",
    circles,
    blocks: groupLayoutCircles(circles),
    mode: "fiducials",
  };
}

describe("three-digit integer answers and deterministic marking", () => {
  it.each(["000", "007", "042", "105", "999"])(
    "retains canonical answer %s",
    (value) => {
      expect(isIntegerAnswer(value)).toBe(true);
      expect(normaliseInteger(value)).toBe(value);
    },
  );
  it.each(["-1", "1000", "1.5", "1e2", " 2", "１２３", "١٢٣", ""])(
    "rejects unsupported input %s",
    (value) => expect(normaliseInteger(value)).toBeNull(),
  );
  it("pads short keys, never interprets a float or a sign", () => {
    expect(normaliseInteger("7")).toBe("007");
    expect(normaliseInteger("42")).toBe("042");
    expect(normaliseInteger("0")).toBe("000");
  });
  it("validates MCQ and numeric questions independently", () => {
    const e = fixture();
    expect(validAnswer(e, 0, "007")).toBe(false);
    expect(validAnswer(e, 20, "A")).toBe(false);
    expect(validAnswer(e, 20, "007")).toBe(true);
    expect(validSelection(e, 20, ["007", "042"])).toBe(false);
  });
  it("scores exact integer values, not matching individual digits", () => {
    const e = fixture(),
      r = record(e);
    expect(gradeResult(r, e).score).toBe(50);
    r.answers[20] = "008";
    r.detectedOptions![20] = ["008"];
    expect(gradeResult(r, e)).toMatchObject({
      score: 47.5,
      wrong: 1,
      partial: 0,
    });
  });
  it("keeps malformed multiple-integer evidence under review with no partial credit", () => {
    const e = fixture(),
      r = record(e);
    r.detectedOptions![20] = ["007", "042"];
    r.answers[20] = null;
    expect(gradeResult(r, e)).toMatchObject({
      status: "Review",
      partial: 0,
      score: 48,
    });
  });
  it("supports integer question sets and regrading without changing measurements", () => {
    const e = fixture(),
      r = record(e);
    e.questionSets = [
      { code: "B", answers: e.answers.map((a) => (a ? [a] : null)) },
    ];
    r.questionSet = "B";
    expect(gradeResult(r, e).score).toBe(50);
    e.questionSets[0].answers[20] = ["008"];
    expect(gradeResult(r, e).score).toBe(47.5);
  });
  it("persists mixed keys/evidence in a validated backup without truncating zeros", () => {
    const e = fixture(),
      w = blankWorkspace({ id: "school", name: "School", code: "S" });
    w.exams = [e];
    w.results = [record(e)];
    expect(isValidWorkspace(JSON.parse(JSON.stringify(w)))).toBe(true);
    w.results[0].answers[20] = "7" as Option;
    expect(isValidWorkspace(w)).toBe(false);
  });
  it("keeps old MCQ keys valid without a questionTypes migration", () => {
    const w = blankWorkspace({ id: "school", name: "School", code: "S" });
    expect(w.exams[0].questionTypes).toBeUndefined();
    expect(isValidWorkspace(w)).toBe(true);
  });
  it("clears only changed keys/sets and deliberately regenerates geometry", () => {
    const e = fixture();
    e.questionSets = [
      { code: "A", answers: e.answers.map((a) => (a ? [a] : null)) },
    ];
    const types = [...e.questionTypes!];
    types[0] = "integer3";
    const next = changeQuestionTypes(e, types);
    expect(next.answers[0]).toBeNull();
    expect(next.questionSets![0].answers[0]).toBeNull();
    expect(next.answers[20]).toBe("007");
    expect(next.layout?.questionRegions).toBeUndefined();
    expect(next.published).toBe(false);
    expect(layoutErrors(next)).toEqual([]);
  });
});

describe("measured digit columns, uncertainty and manual verification", () => {
  it("reads 000, 007, 042, 105 and 999 from genuine raster pixels without a key", () => {
    const e = fixture(),
      { image, mark } = pixels(e);
    for (let q = 0; q < e.questions; q++) {
      const answer = e.answers[q]!;
      if (q < 20) mark(q, "ABCD".indexOf(answer));
      else
        [...answer].forEach((digit, col) => mark(q, col * 10 + Number(digit)));
    }
    const out = analyzeAlignedImageData(image, e);
    expect(out.answers).toEqual(e.answers);
    expect(out.flagged).toEqual([]);
    expect(out.answerMeta[20].coordinates).toHaveLength(30);
    expect(out.answerMeta[20].coordinates[27]).toMatchObject({
      digitColumn: 2,
      digit: 7,
      inkRatio: 1,
    });
    e.answers = Array(25).fill(null);
    expect(analyzeAlignedImageData(image, e).answers).toEqual(out.answers);
  });
  it("leaves a wholly blank grid unanswered without inventing zero", () => {
    const e = fixture(),
      { image } = pixels(e);
    const out = analyzeAlignedImageData(image, e);
    expect(out.answers[20]).toBeNull();
    expect(out.answerMeta[20].status).toBe("blank");
    expect(out.detectedOptions[20]).toEqual([]);
  });
  it("flags two-of-three marked columns instead of padding missing digits", () => {
    const e = fixture(),
      { image, mark } = pixels(e);
    mark(20, 0);
    mark(20, 10);
    const out = analyzeAlignedImageData(image, e);
    expect(out.answers[20]).toBeNull();
    expect(out.detectedOptions[20]).toEqual([]);
    expect(out.flagged).toContain(20);
    expect(out.answerMeta[20].status).toBe("uncertain");
  });
  it("flags multiple digits in any one column and preserves every coordinate", () => {
    const e = fixture(),
      { image, mark } = pixels(e);
    [0, 2, 10, 27].forEach((i) => mark(20, i));
    const out = analyzeAlignedImageData(image, e);
    expect(out.answers[20]).toBeNull();
    expect(out.answerMeta[20].status).toBe("multiple");
    expect(out.answerMeta[20].coordinates).toHaveLength(30);
  });
  it("does not silently confirm partially filled or erased digits", () => {
    const ratios = Array(30).fill(0);
    ratios[0] = 1;
    ratios[10] = 1;
    ratios[27] = 0.35;
    expect(classifyInteger(ratios, 0.52)).toMatchObject({
      answer: null,
      status: "uncertain",
    });
  });
  it("updates scalar/code evidence atomically only on a human correction", () => {
    const e = fixture(),
      r = record(e);
    r.answers[20] = null;
    r.detectedOptions![20] = [];
    r.flagged = [20];
    r.answerMeta = [
      {
        question: 20,
        status: "uncertain",
        selected: [],
        verified: false,
        coordinates: Array.from({ length: 30 }, (_, i) => ({
          digitColumn: Math.floor(i / 10),
          digit: i % 10,
        })),
      },
    ];
    const corrected = verifyResponse(r, 20, ["007"]);
    expect(corrected.answers[20]).toBe("007");
    expect(corrected.detectedOptions![20]).toEqual(["007"]);
    expect(corrected.answerMeta![0]).toMatchObject({
      verified: true,
      status: "manual",
    });
    expect(corrected.answerMeta![0].coordinates).toHaveLength(30);
    expect(corrected.flagged).toEqual([]);
  });
});

describe("editable irregular geometry and real layout lattice grouping", () => {
  it("has a shared backend/frontend geometry signature", () => {
    expect(layoutErrors(fixture())).toEqual([]);
    expect(sheetSignature(fixture())).toBe("b6cec795");
  });
  it("includes types and measured coordinates, but not reference photo or key, in the signature", () => {
    const e = fixture(),
      before = sheetSignature(e);
    e.layout!.referenceImage = "data:image/jpeg;base64,AAAA";
    e.answers[20] = "100";
    expect(sheetSignature(e)).toBe(before);
    e.layout!.questionRegions![20].points[0].x += 1;
    expect(sheetSignature(e)).not.toBe(before);
  });
  it("checks duplicate question regions, missing digits, page bounds and cross-region overlaps", () => {
    const e = fixture();
    e.layout!.questionRegions!.push(e.layout!.questionRegions![0]);
    expect(layoutErrors(e).join(" ")).toMatch(/unique|overlap/);
    e.layout!.questionRegions!.pop();
    e.layout!.questionRegions![20].points.pop();
    expect(layoutErrors(e).join(" ")).toMatch(/wrong number/);
  });
  it("keeps 500-question integer layouts paginated and printable", () => {
    const e = {
      ...fixture(),
      layout: undefined,
      questions: 500,
      questionTypes: Array(500).fill("integer3"),
      answers: Array(500).fill("000"),
    } as Exam;
    expect(getLayout(e).questionsPerPage).toBe(12);
    expect(pageCount(e)).toBe(42);
    expect(layoutErrors(e)).toEqual([]);
    expect(layoutQuestionPoints(7, e, 41).points).toHaveLength(30);
  });
  it("groups 20 MCQ rows, five four-column grids and a separate roll grid", () => {
    const scan = scanFixture();
    expect(scan.blocks.filter((b) => b.kind === "choice")).toHaveLength(20);
    expect(
      scan.blocks.filter(
        (b) => b.kind === "digits" && b.columns === 4 && b.rows === 11,
      ),
    ).toHaveLength(5);
    expect(scan.blocks.filter((b) => b.columns === 5)).toHaveLength(1);
    expect(
      initialMappings(scan).find(
        (m) => m.id === scan.blocks.find((b) => b.columns === 5)!.id,
      )!.enabled,
    ).toBe(false);
  });
  it("requires deliberate digit-grid mapping, excluding dot rows and unused columns", () => {
    const scan = scanFixture(),
      mappings = initialMappings(scan);
    for (const m of mappings) {
      const b = scan.blocks.find((b) => b.id === m.id)!;
      if (b.kind === "digits" && b.columns === 4) {
        m.enabled = true;
        m.firstColumn = 1;
      }
    }
    const next = applyLayoutScan(
      { ...fixture(), answers: Array(25).fill(null), published: false },
      scan,
      mappings,
      true,
    );
    expect(next.questions).toBe(25);
    expect(next.questionTypes?.slice(20)).toEqual(Array(5).fill("integer3"));
    expect(next.answers.every((a) => a === null)).toBe(true);
    expect(next.layout?.ocrEnabled).toBe(false);
    expect(next.layout?.questionRegions?.[20].points).toHaveLength(30);
    expect(layoutErrors(next)).toEqual([]);
  });
  it("does not infer missing rows or automatically resolve duplicate question numbers", () => {
    const scan = scanFixture(),
      m = initialMappings(scan);
    m[2].question = 1;
    expect(() => applyLayoutScan(fixture(), scan, m, true)).toThrow(/unique/);
  });
  it("rejects an incomplete three-column selection instead of wrapping to the next column", () => {
    const scan = scanFixture(),
      b = scan.blocks.find((b) => b.kind === "digits" && b.columns === 4)!;
    expect(() =>
      mappedRegion(b, {
        id: b.id,
        enabled: true,
        question: 21,
        firstColumn: 3,
        firstRow: 1,
      }),
    ).toThrow(/complete/);
  });
  it("keeps the old default MCQ layout unchanged", () => {
    const l = defaultLayout({ questions: 50, optionCount: 4 });
    expect(l.questionsPerPage).toBe(50);
    expect(l.startY).toBe(420);
    expect(l.rowGap).toBe(44);
  });
});

it("does not silently reinterpret a regular 10-row MCQ grid as an integer", () => {
  const circles = Array.from({ length: 40 }, (_, i) => ({
    x: 180 + Math.floor(i / 10) * 45,
    y: 650 + (i % 10) * 40,
    radius: 12,
  }));
  const blocks = groupLayoutCircles(circles),
    scan: LayoutScan = {
      referenceImage: "data:image/jpeg;base64,AAAA",
      circles,
      blocks,
      mode: "fiducials",
    };
  expect(blocks).toHaveLength(1);
  const mappings = initialMappings(scan);
  expect(mappings[0].enabled).toBe(false);
  mappings[0] = { ...mappings[0], enabled: true, as: "mcq" };
  const next = applyLayoutScan(fixture(), scan, mappings, true);
  expect(next.questions).toBe(10);
  expect(next.questionTypes).toEqual(Array(10).fill("choice"));
  expect(next.layout?.questionRegions).toHaveLength(10);
});
it("does not misclassify the tail of a long regular MCQ column as a digit grid", () => {
  const circles = Array.from({ length: 100 }, (_, i) => ({
    x: 180 + Math.floor(i / 25) * 45,
    y: 420 + (i % 25) * 40,
    radius: 12,
  }));
  const blocks = groupLayoutCircles(circles);
  expect(blocks).toHaveLength(25);
  expect(blocks.every((b) => b.kind === "choice")).toBe(true);
});

it("counts whole numeric responses and keeps mixed question CSV columns aligned", () => {
  const e = fixture(),
    first = record(e),
    second = record(e);
  second.id = "second";
  second.studentId = "second";
  second.answers[20] = "008";
  second.detectedOptions![20] = ["008"];
  const stats = questionStats([first, second], e);
  expect(stats[20].counts).toEqual([
    { option: "007", count: 1 },
    { option: "008", count: 1 },
  ]);
  expect(stats[20].correct).toBe(1);
  expect(stats[21].counts).toEqual([{ option: "042", count: 2 }]);
  const rows = questionCSV([first, second], e)
    .split("\r\n")
    .map((r) => r.split(","));
  expect(rows.every((r) => r.length === rows[0].length)).toBe(true);
  expect(rows[21].at(-1)).toBe("007: 1; 008: 1");
  expect(rows[21].slice(5, 9)).toEqual(["0", "0", "0", "0"]);
  expect(rows[1].at(-1)).toBe("");
});
it("rejects a zero-row mapping that would otherwise wrap into the next digit column", () => {
  const scan = scanFixture(),
    b = scan.blocks.find((b) => b.kind === "digits" && b.columns === 4)!;
  expect(() =>
    mappedRegion(b, {
      id: b.id,
      enabled: true,
      question: 21,
      firstColumn: 0,
      firstRow: 2,
    }),
  ).toThrow(/complete/);
});
it("checks page-specific numeric outlines, not the first page's unrelated regions", () => {
  const e = fixture(),
    { image } = pixels(e);
  // The raster has the original page's grid, now assigned to page 2.
  e.layout!.questionsPerPage = 25;
  e.layout!.questionRegions = [
    ...e.layout!.questionRegions!.map((r) => ({
      ...r,
      points: r.points.map((p) => ({ x: p.x, y: p.y + 300 })),
    })),
    ...e.layout!.questionRegions!.map((r) => ({
      ...r,
      question: r.question + 25,
    })),
  ];
  e.questions = 50;
  e.answers = [...e.answers, ...e.answers];
  e.questionTypes = [...e.questionTypes!, ...e.questionTypes!];
  expect(outlineReadability(image, e, 1)).toBeGreaterThan(60);
  expect(outlineReadability(image, e, 0)).toBeLessThan(9);
});
it("rejects malformed restored metadata without throwing or accepting invalid digit coordinates", () => {
  const w = blankWorkspace({ id: "school", name: "School", code: "S" }),
    e = fixture();
  w.exams = [e];
  w.results = [record(e)];
  (w.results[0] as any).answerMeta = [null];
  expect(isValidWorkspace(w)).toBe(false);
  w.results[0].answerMeta = [
    {
      question: 20,
      selected: ["007"],
      status: "filled",
      verified: false,
      coordinates: [{ digitColumn: 3, digit: 7 }],
    },
  ];
  expect(isValidWorkspace(w)).toBe(false);
});
