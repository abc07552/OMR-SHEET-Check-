import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createDemoData,
  getDistribution,
  getStats,
  gradeResult,
  isValidWorkspace,
  loadWorkspace,
  questionStats,
  resultsCSV,
} from "./data";
import type { Exam, Result } from "./data";

const exam: Exam = {
  id: "test",
  title: "Test",
  subject: "Science",
  date: "2026-11-17",
  questions: 4,
  marksCorrect: 2,
  negativeMarks: 0.5,
  passPercentage: 40,
  answers: ["A", "B", "C", "D"],
  published: true,
};
const result: Result = {
  id: "r1",
  studentId: "s1",
  name: "Aarav Mehta",
  roll: "101",
  section: "12 A",
  examId: "test",
  answers: ["A", "D", null, "D"],
  flagged: [],
  confirmed: false,
  createdAt: "2026-11-17T10:00:00",
  source: "scan",
};
afterEach(() => vi.unstubAllGlobals());

describe("grading and analytics", () => {
  it("scores correct, incorrect, and blank answers with negative marking", () => {
    expect(gradeResult(result, exam)).toMatchObject({
      correct: 2,
      wrong: 1,
      blank: 1,
      score: 3.5,
      maximum: 8,
      percentage: 43.75,
      accuracy: 50,
      status: "Passed",
    });
  });
  it("never returns a negative score", () => {
    expect(
      gradeResult({ ...result, answers: ["D", "D", "D", "A"] }, exam).score,
    ).toBe(0);
  });
  it("excludes unreviewed sheets from averages, pass rates, and distribution", () => {
    const flagged = {
      ...result,
      id: "r2",
      answers: [...exam.answers],
      flagged: [1],
    };
    const stats = getStats([result, flagged], exam);
    expect(stats).toMatchObject({
      total: 2,
      evaluated: 1,
      review: 1,
      average: 43.75,
      passRate: 100,
    });
    expect(
      getDistribution([result, flagged], exam).reduce((s, b) => s + b.value, 0),
    ).toBe(1);
    expect(questionStats([result, flagged], exam)[1]).toMatchObject({
      total: 1,
      correct: 0,
      percentage: 0,
    });
  });
  it("regrades results immediately when the key changes", () => {
    const changed = {
      ...exam,
      answers: ["A", "D", "C", "D"] as Exam["answers"],
    };
    expect(gradeResult(result, changed).score).toBe(6);
  });
  it("handles an empty classroom and a draft key", () => {
    expect(getStats([], exam)).toMatchObject({
      total: 0,
      average: 0,
      passRate: 0,
      highest: 0,
    });
    expect(
      gradeResult(result, { ...exam, answers: [null, null, null, null] })
        .percentage,
    ).toBe(0);
  });
  it("uses inclusive pass marks and correct distribution boundaries", () => {
    const e = { ...exam, negativeMarks: 0, passPercentage: 50 };
    expect(gradeResult(result, e).status).toBe("Passed");
    expect(
      getDistribution([result], e).find((b) => b.name === "Developing")?.value,
    ).toBe(1);
  });
  it("escapes CSV quotes, new lines, and spreadsheet formulas", () => {
    const csv = resultsCSV([{ ...result, name: '=HYPERLINK("bad")' }], exam);
    expect(csv).toContain(`"'=HYPERLINK(""bad"")"`);
    expect(csv).toContain('"43.8"');
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });
});

describe("workspace persistence", () => {
  it("generates deterministic, internally consistent fictional data", () => {
    const data = createDemoData();
    expect(data).toEqual(createDemoData());
    expect(isValidWorkspace(data)).toBe(true);
    const current = data.exams.at(-1)!;
    expect(data.results.filter((r) => r.examId === current.id)).toHaveLength(
      248,
    );
    expect(
      new Set(
        data.results.filter((r) => r.examId === current.id).map((r) => r.name),
      ).size,
    ).toBe(248);
  });
  it("rejects invalid, empty, and malformed backups without throwing", () => {
    expect(isValidWorkspace(null)).toBe(false);
    expect(isValidWorkspace({ ...createDemoData(), exams: [] })).toBe(false);
    expect(isValidWorkspace({ ...createDemoData(), exams: [null] })).toBe(
      false,
    );
    expect(isValidWorkspace({ ...createDemoData(), results: [null] })).toBe(
      false,
    );
    const data = createDemoData();
    data.results[0].answers = ["A"];
    expect(isValidWorkspace(data)).toBe(false);
  });
  it("recovers gracefully from corrupt or unavailable local storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => '{"version":1,"exams":[],"results":[]}',
    });
    expect(loadWorkspace().exams).toHaveLength(6);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Denied");
      },
    });
    expect(loadWorkspace().exams).toHaveLength(6);
  });
});
