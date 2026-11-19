import { describe, expect, it } from "vitest";
import {
  blankWorkspace,
  createDemoData,
  enrichWorkspace,
  getOptions,
  gradeResult,
  isValidWorkspace,
  mergeSchoolWorkspace,
  rankings,
  scopeWorkspace,
  studentValidation,
  subjectStats,
} from "./data";
import type { Exam, Result } from "./data";
import {
  defaultLayout,
  layoutBubble,
  layoutErrors,
  pageCount,
  pageQuestionCount,
  isEmbeddedRaster,
  sheetSignature,
} from "./layout";
import { parseCSV } from "./documents";
import { decodeBackup, encodeBackup } from "./storage";
const exam: Exam = {
  id: "advanced",
  title: "Advanced science",
  subject: "Science",
  date: "2026-11-17",
  questions: 4,
  marksCorrect: 2,
  negativeMarks: 0.5,
  passPercentage: 40,
  answers: ["A", "B", "C", "E"],
  optionCount: 5,
  published: true,
  subjects: [
    { name: "Physics", from: 1, to: 2 },
    { name: "Chemistry", from: 3, to: 4 },
  ],
};
function result(id: string, answers: Result["answers"]): Result {
  return {
    id,
    studentId: id,
    name: `Student ${id}`,
    roll: id,
    section: "12 A",
    examId: exam.id,
    answers,
    flagged: [],
    confirmed: false,
    createdAt: new Date().toISOString(),
    source: "scan",
  };
}
describe("advanced workspaces and backwards compatibility", () => {
  it("migrates the complete v1 result history into an independent register", () => {
    const old = createDemoData(),
      migrated = enrichWorkspace(old);
    expect(migrated.results).toHaveLength(old.results.length);
    expect(migrated.students).toHaveLength(248);
    expect(migrated.exams.every((e) => e.optionCount === 4)).toBe(true);
    expect(migrated.classes).toHaveLength(4);
    expect(isValidWorkspace(migrated)).toBe(true);
  });
  it("retains roster deletions instead of rebuilding them on reload", () => {
    const migrated = enrichWorkspace(createDemoData());
    migrated.students = [];
    expect(enrichWorkspace(migrated).students).toEqual([]);
  });
  it("keeps schools and their same-number rolls isolated when editing", () => {
    const first = enrichWorkspace(createDemoData()),
      second = blankWorkspace({
        id: "second",
        name: "Second school",
        code: "SS",
      });
    second.students = [
      {
        id: "other",
        schoolId: "second",
        roll: "12001",
        name: "Other student",
        section: "1 A",
        registeredAt: "2026-11-17",
      },
    ];
    const all = {
      ...first,
      schools: [...first.schools!, ...second.schools!],
      exams: [...first.exams, ...second.exams],
      students: [...first.students!, ...second.students!],
    };
    const scoped = scopeWorkspace(all, "second");
    expect(scoped.results).toHaveLength(0);
    expect(scoped.students).toHaveLength(1);
    const merged = mergeSchoolWorkspace(
      all,
      { ...scoped, school: "Renamed school", students: [] },
      "second",
    );
    expect(merged.results).toHaveLength(first.results.length);
    expect(merged.students).toHaveLength(248);
    expect(merged.schools!.find((s) => s.id === "second")?.name).toBe(
      "Renamed school",
    );
  });
  it("requires unique roll numbers per school but not across schools", () => {
    const students = enrichWorkspace(createDemoData()).students!;
    const s = students[0];
    expect(studentValidation({ ...s, name: "Another" }, students)).toContain(
      "already registered",
    );
    expect(
      studentValidation({ ...s, schoolId: "new-school" }, students),
    ).toBeNull();
    expect(studentValidation(s, students, s.id)).toBeNull();
  });
  it("rejects invalid option counts, E on A–D keys, and overlapping subjects", () => {
    const base = blankWorkspace({ id: "school", name: "Test", code: "T" });
    base.exams[0] = { ...exam, schoolId: "school" };
    expect(isValidWorkspace(base)).toBe(true);
    base.exams[0].optionCount = 4;
    expect(isValidWorkspace(base)).toBe(false);
    base.exams[0].optionCount = 5;
    base.exams[0].subjects = [
      { name: "One", from: 1, to: 3 },
      { name: "Two", from: 3, to: 4 },
    ];
    expect(isValidWorkspace(base)).toBe(false);
  });
});
describe("score, subject and ranking semantics", () => {
  it("grades E options and separates score percentage from accuracy", () => {
    const g = gradeResult(result("one", ["A", "B", "A", null]), exam);
    expect(g.correct).toBe(2);
    expect(g.wrong).toBe(1);
    expect(g.blank).toBe(1);
    expect(g.score).toBe(3.5);
    expect(g.percentage).toBe(43.75);
    expect(g.accuracy).toBe(50);
  });
  it("awards tied competition ranks and strictly-lower percentiles", () => {
    const rows = [
      result("1", ["A", "B", "C", "E"]),
      result("2", ["A", "B", "C", "E"]),
      result("3", ["A", "B", null, null]),
      result("4", [null, null, null, null]),
    ];
    const ranked = rankings(rows, exam);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3, 4]);
    expect(ranked.map((r) => r.percentile)).toEqual([50, 50, 25, 0]);
  });
  it("excludes unresolved identities and uncertain answers from rankings and subject averages", () => {
    const rows = [
      result("1", ["A", "B", "C", "E"]),
      { ...result("2", [null, null, null, null]), identityReview: true },
      { ...result("3", [null, null, null, null]), flagged: [0] },
    ];
    expect(rankings(rows, exam)).toHaveLength(1);
    expect(subjectStats(rows, exam)[0].average).toBe(100);
  });
  it("supports subject-only ranking with negative marking", () => {
    const rows = [
      result("1", ["A", "B", null, null]),
      result("2", [null, null, "C", "E"]),
    ];
    const physics = rankings(rows, exam, "Physics"),
      chemistry = rankings(rows, exam, "Chemistry");
    expect(physics[0].result.id).toBe("1");
    expect(chemistry[0].result.id).toBe("2");
    expect(physics[0].score).toBe(4);
  });
  it("keeps incomplete multipage results provisional until pages arrive or are explicitly accepted", () => {
    const e = {
        ...exam,
        questions: 500,
        answers: Array(500).fill("E") as Exam["answers"],
      },
      r = {
        ...result("1", Array(500).fill("E")),
        pageTotal: 5,
        pageIndices: [0, 1, 2, 3],
      };
    expect(gradeResult(r, e).missingPages).toBe(true);
    expect(
      gradeResult({ ...r, pageIndices: [0, 1, 2, 3, 4] }, e).needsReview,
    ).toBe(false);
    expect(
      gradeResult({ ...r, missingPagesAccepted: true }, e).needsReview,
    ).toBe(false);
  });
  it("does not let duplicate page numbers count as complete", () => {
    const e = {
      ...exam,
      questions: 200,
      answers: Array(200).fill("A") as Exam["answers"],
    };
    expect(
      gradeResult(
        { ...result("1", Array(200).fill("A")), pageIndices: [0, 0] },
        e,
      ).needsReview,
    ).toBe(true);
  });
  it("retains original scan pagination after a layout change", () => {
    const e = {
      ...exam,
      questions: 200,
      answers: Array(200).fill("A") as Exam["answers"],
    };
    e.layout = { ...defaultLayout(e), questionsPerPage: 50 };
    expect(
      gradeResult(
        {
          ...result("1", Array(200).fill("A")),
          pageIndices: [0, 1],
          pageTotal: 2,
        },
        e,
      ).needsReview,
    ).toBe(false);
  });
});
describe("500-question, A–E printable geometry", () => {
  it.each([1, 10, 60, 61, 100, 101, 250, 500])(
    "keeps a %i-question default template within printable bounds",
    (questions) => {
      const e = {
        ...exam,
        questions,
        answers: Array(questions).fill("E") as Exam["answers"],
      };
      e.layout = defaultLayout(e);
      expect(layoutErrors(e)).toEqual([]);
      expect(pageCount(e)).toBe(Math.ceil(questions / 100));
      const counts = Array.from({ length: pageCount(e) }, (_, p) =>
        pageQuestionCount(e, p),
      );
      expect(counts.reduce((s, n) => s + n, 0)).toBe(questions);
      for (let q = 0; q < pageQuestionCount(e); q++) {
        const p = layoutBubble(q, e);
        expect(p.xs).toHaveLength(5);
        expect(p.xs.at(-1)! + p.radius).toBeLessThan(1240);
      }
    },
  );
  it("recognises collisions and bubble grids off the page", () => {
    const e = { ...exam, layout: { ...defaultLayout(exam), optionGap: 5 } };
    expect(layoutErrors(e).join(" ")).toContain("overlap");
    e.layout = { ...e.layout, startX: 1200 };
    expect(layoutErrors(e).join(" ")).toContain("printable");
  });
  it("continues to restrict original A–D exams to four responses", () =>
    expect(getOptions({ ...exam, optionCount: 4 })).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]));
});
describe("portable backups and student imports", () => {
  it("parses quoted CSV cells, newlines, BOM, and escaped quotes", () =>
    expect(
      parseCSV(
        '\ufeffName,Roll,Class\r\n"Doe, Maya",001,"12 A"\r\n"A ""quoted"" name",002,"Two\nlines"',
      ),
    ).toEqual([
      ["Name", "Roll", "Class"],
      ["Doe, Maya", "001", "12 A"],
      ['A "quoted" name', "002", "Two\nlines"],
    ]));
  it("rejects broken CSV quoting", () =>
    expect(() => parseCSV('Name,Roll\n"unclosed,123')).toThrow("not closed"));
  it("round trips a genuine AES-GCM encrypted backup", async () => {
    const w = enrichWorkspace(createDemoData()),
      blob = await encodeBackup(w, "a long private passphrase"),
      file = new File([blob], "encrypted.json", { type: "application/json" });
    expect(await file.text()).not.toContain("Greenwood");
    const decoded = await decodeBackup(file, "a long private passphrase");
    expect(decoded.results).toHaveLength(w.results.length);
    expect(decoded.students).toHaveLength(248);
  });
  it("never accepts a wrong encryption passphrase", async () => {
    const blob = await encodeBackup(
      enrichWorkspace(createDemoData()),
      "a long private passphrase",
    );
    await expect(
      decodeBackup(new File([blob], "backup.json"), "wrong password"),
    ).rejects.toThrow("incorrect");
  });
  it("requires a strong backup passphrase", async () => {
    await expect(
      encodeBackup(enrichWorkspace(createDemoData()), "short"),
    ).rejects.toThrow("10 characters");
  });
  it("imports old unencrypted v1 backups without losing results", async () => {
    const original = createDemoData(),
      decoded = await decodeBackup(
        new File([JSON.stringify(original)], "v1.json"),
      );
    expect(decoded.results).toHaveLength(original.results.length);
    expect(decoded.students).toHaveLength(248);
  });
});

describe("workspace import and layout safeguards", () => {
  const workspace = () => {
    const w = blankWorkspace({ id: "school", name: "Test", code: "T" });
    w.exams[0] = { ...exam, schoolId: "school" };
    return w;
  };
  it("rejects impossible dates but accepts a valid leap day", () => {
    const w = workspace();
    w.exams[0].date = "2026-02-30";
    expect(isValidWorkspace(w)).toBe(false);
    w.exams[0].date = "2028-02-29";
    expect(isValidWorkspace(w)).toBe(true);
  });
  it("rejects two results linked to the same student and exam", () => {
    const w = workspace();
    const r = result("one", ["A", "B", "C", "E"]);
    w.results = [r, { ...r, id: "another" }];
    expect(isValidWorkspace(w)).toBe(false);
  });
  it("keeps draft keys in review even when their partial answers are correct", () => {
    const draft = {
      ...exam,
      published: false,
      answers: ["A", null, null, null] as Exam["answers"],
    };
    expect(
      gradeResult(result("one", ["A", null, null, null]), draft).status,
    ).toBe("Review");
    expect(rankings([result("one", ["A", null, null, null])], draft)).toEqual(
      [],
    );
  });
  it("accepts only bounded embedded raster assets, not remote URLs or SVG", () => {
    expect(isEmbeddedRaster("data:image/png;base64,aGVsbG8=")).toBe(true);
    expect(isEmbeddedRaster("https://example.org/logo.png")).toBe(false);
    expect(isEmbeddedRaster("data:image/svg+xml;base64,aGVsbG8=")).toBe(false);
    expect(isEmbeddedRaster("data:image/png;base64,<script>")).toBe(false);
    expect(
      isEmbeddedRaster(`data:image/png;base64,${"A".repeat(500000)}`),
    ).toBe(false);
  });
  it("requires visible logos to have an embedded image and preserves it through validation", () => {
    const w = workspace();
    const l = defaultLayout(w.exams[0]);
    const logo = {
      ...l.fields[0],
      id: "school-logo",
      type: "logo" as const,
      width: 160,
      height: 100,
    };
    l.fields.push(logo);
    w.exams[0].layout = l;
    expect(isValidWorkspace(w)).toBe(false);
    l.fields.at(-1)!.image = "data:image/png;base64,aGVsbG8=";
    expect(isValidWorkspace(w)).toBe(true);
    l.fields.at(-1)!.image = "https://example.org/logo.png";
    expect(isValidWorkspace(w)).toBe(false);
  });
  it("rejects field/crop overflow, ambiguous markers, and overlapping columns", () => {
    const e = { ...exam, layout: defaultLayout(exam) };
    e.layout.rollRegion.x = 1240;
    expect(layoutErrors(e).join(" ")).toContain("OCR");
    e.layout = defaultLayout(e);
    e.layout.anchors[0] = { x: 600, y: 600 };
    expect(layoutErrors(e).join(" ")).toContain("corner");
    e.layout = { ...defaultLayout(e), columnGap: 40 };
    expect(layoutErrors(e).join(" ")).toContain("overlap");
    e.layout = defaultLayout(e);
    e.layout.fields[0].x = 1240;
    expect(layoutErrors(e).join(" ")).toContain("outside");
  });
  it("identifies changed print geometry but not a logo, OCR crop or threshold change", () => {
    const e = { ...exam, layout: defaultLayout(exam) };
    const signature = sheetSignature(e);
    expect(signature).toMatch(/^[a-f0-9]{8}$/);
    e.layout.threshold = 0.75;
    e.layout.rollRegion.x += 1;
    e.layout.fields[0].text = "Other institution";
    expect(sheetSignature(e)).toBe(signature);
    e.layout.startX += 1;
    expect(sheetSignature(e)).not.toBe(signature);
  });
  it("rejects an unbounded subject range without trying to allocate it", () => {
    const w = workspace();
    w.exams[0].subjects = [
      { name: "Bad", from: 1, to: Number.MAX_SAFE_INTEGER },
    ];
    expect(isValidWorkspace(w)).toBe(false);
  });
});
