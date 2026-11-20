import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, workspaceSchema } from "./validation.mjs";

function fixture() {
  const w = emptyWorkspace(
    { id: "school", name: "School", code: "S" },
    "Teacher",
  );
  const e = w.exams[0];
  e.questions = 10;
  e.answers = Array(10).fill("E");
  e.published = true;
  e.layout = {
    version: 2,
    name: "Test",
    questionsPerPage: 10,
    columns: 2,
    startX: 210,
    startY: 420,
    columnGap: 550,
    rowGap: 44,
    optionGap: 63,
    radius: 14,
    labelOffset: 100,
    bubbleShape: "circle",
    threshold: 0.52,
    anchorMode: "markers",
    anchors: [
      { x: 55, y: 55 },
      { x: 1185, y: 55 },
      { x: 1185, y: 1699 },
      { x: 55, y: 1699 },
    ],
    fields: [],
    rollRegion: { x: 710, y: 248, width: 295, height: 58 },
  };
  return w;
}
test("workspace schema accepts a valid A–E calibrated template and leap date", () => {
  const w = fixture();
  w.exams[0].date = "2028-02-29";
  assert.equal(workspaceSchema.safeParse(w).success, true);
});
test("workspace schema rejects impossible calendar dates and unbounded subject ranges", () => {
  const w = fixture();
  w.exams[0].date = "2026-02-30";
  assert.equal(workspaceSchema.safeParse(w).success, false);
  w.exams[0].date = "2026-11-17";
  w.exams[0].subjects = [
    { name: "Malicious", from: 1, to: Number.MAX_SAFE_INTEGER },
  ];
  assert.equal(workspaceSchema.safeParse(w).success, false);
});
test("workspace schema rejects duplicate exam/student results, even with different record IDs", () => {
  const w = fixture();
  const r = {
    id: "first",
    studentId: "student",
    name: "Learner",
    roll: "001",
    section: "1 A",
    examId: w.exams[0].id,
    answers: Array(10).fill("E"),
    flagged: [],
    confirmed: true,
    createdAt: new Date().toISOString(),
    source: "scan",
    layoutSignature: "deadbeef",
  };
  w.results = [r, { ...r, id: "second" }];
  assert.equal(workspaceSchema.safeParse(w).success, false);
});
test("workspace schema rejects out-of-page fields, OCR crops, overlapping columns and invalid markers", () => {
  for (const modify of [
    (l) => (l.rollRegion.x = 1240),
    (l) => (l.columnGap = 40),
    (l) => (l.anchors[0] = { x: 500, y: 500 }),
    (l) =>
      l.fields.push({
        id: "overflow",
        type: "text",
        text: "Hello",
        x: 1200,
        y: 100,
        width: 200,
        height: 40,
        fontSize: 24,
        bold: false,
        visible: true,
      }),
  ]) {
    const w = fixture();
    modify(w.exams[0].layout);
    assert.equal(workspaceSchema.safeParse(w).success, false);
  }
});
test("workspace schema preserves embedded logos and rejects remote/SVG or missing logo data", () => {
  const w = fixture();
  const logo = {
    id: "logo",
    type: "logo",
    text: "School logo",
    x: 100,
    y: 100,
    width: 160,
    height: 100,
    fontSize: 24,
    bold: false,
    visible: true,
  };
  w.exams[0].layout.fields.push(logo);
  assert.equal(workspaceSchema.safeParse(w).success, false);
  for (const image of [
    "https://example.org/logo.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,<script>",
  ]) {
    logo.image = image;
    assert.equal(workspaceSchema.safeParse(w).success, false);
  }
  logo.image = "data:image/png;base64,aGVsbG8=";
  const parsed = workspaceSchema.safeParse(w);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.exams[0].layout.fields[0].image, logo.image);
});

test("mixed integer layout, zero-prefixed keys and 30 measured coordinates survive legacy serialization", async () => {
  const { readFile } = await import("node:fs/promises");
  const e = JSON.parse(
    await readFile(
      new URL("../test-fixtures/mixed-integer-layout.json", import.meta.url),
      "utf8",
    ),
  );
  const w = fixture();
  w.exams = [e];
  w.results = [
    {
      id: "integer-r",
      studentId: "s",
      name: "Synthetic Learner",
      roll: "10001",
      section: "10 A",
      examId: e.id,
      answers: [...e.answers],
      detectedOptions: e.answers.map((a) => [a]),
      answerMeta: [
        {
          question: 20,
          selected: ["007"],
          status: "filled",
          verified: false,
          coordinates: Array.from({ length: 30 }, (_, i) => ({
            digitColumn: Math.floor(i / 10),
            digit: i % 10,
            alignedX: 200,
            alignedY: 600,
            inkRatio: 0,
          })),
        },
      ],
      flagged: [],
      confirmed: true,
      createdAt: "2026-11-17",
      source: "scan",
    },
  ];
  const parsed = workspaceSchema.parse(w);
  assert.equal(parsed.exams[0].answers[20], "007");
  assert.equal(parsed.exams[0].questionTypes[20], "integer3");
  assert.equal(parsed.exams[0].layout.questionRegions[20].points.length, 30);
  assert.equal(parsed.results[0].answerMeta[0].coordinates.length, 30);
  assert.equal(parsed.results[0].detectedOptions[20][0], "007");
  w.results[0].answers[20] = "7";
  assert.equal(workspaceSchema.safeParse(w).success, false);
  w.results[0].answers[20] = "007";
  w.results[0].detectedOptions[20] = ["042"];
  assert.equal(workspaceSchema.safeParse(w).success, false);
});
test("legacy service rejects invalid integer types, duplicate geometry and integer multi-answer keys", async () => {
  const { readFile } = await import("node:fs/promises");
  const original = JSON.parse(
    await readFile(
      new URL("../test-fixtures/mixed-integer-layout.json", import.meta.url),
      "utf8",
    ),
  );
  for (const change of [
    (e) => (e.answers[20] = "A"),
    (e) => (e.answers[0] = "007"),
    (e) => e.questionTypes.pop(),
    (e) => e.layout.questionRegions.push(e.layout.questionRegions[0]),
    (e) => e.layout.questionRegions[20].points.pop(),
    (e) =>
      (e.questionSets = [
        {
          code: "A",
          answers: e.answers.map((a, q) => (q === 20 ? ["007", "042"] : [a])),
        },
      ]),
  ]) {
    const w = fixture(),
      e = structuredClone(original);
    change(e);
    w.exams = [e];
    assert.equal(workspaceSchema.safeParse(w).success, false);
  }
});
