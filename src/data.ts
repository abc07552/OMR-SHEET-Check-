import { isEmbeddedRaster, layoutErrors } from "./layout";
import type { OMRLayout } from "./layout";
import { scoreLocally, ScoringDecimal } from "./scoring";

export type Option = "A" | "B" | "C" | "D" | "E";
export const OPTIONS: Option[] = ["A", "B", "C", "D", "E"];
export const getOptions = (exam: Pick<Exam, "optionCount">): Option[] =>
  OPTIONS.slice(0, exam.optionCount || 4);
export type Page =
  | "overview"
  | "scanner"
  | "keys"
  | "students"
  | "analytics"
  | "reports"
  | "settings"
  | "templates"
  | "leaderboard"
  | "backups"
  | "administration"
  | "batches"
  | "evaluation"
  | "system";
export interface MarkingRules {
  version: number;
  partialMarks: number;
  unansweredMarks: number;
  multiplePolicy: "review" | "wrong" | "partial" | "exact";
  floorZero: boolean;
  grades: { name: string; min: number }[];
}
export interface AnswerDetection {
  question: number;
  selected: Option[];
  status:
    | "blank"
    | "filled"
    | "partial"
    | "erased"
    | "multiple"
    | "uncertain"
    | "invalid"
    | "manual";
  confidence?: number;
  coordinates: {
    option?: Option;
    x?: number;
    y?: number;
    alignedX?: number;
    alignedY?: number;
    radius?: number;
    inkRatio?: number;
  }[];
  verified: boolean;
}
export interface SubjectRange {
  name: string;
  from: number;
  to: number;
}
export interface School {
  id: string;
  name: string;
  code: string;
  address?: string;
}
export interface ClassRoom {
  id: string;
  schoolId: string;
  name: string;
  academicYear: string;
}
export interface Student {
  id: string;
  schoolId: string;
  classId?: string;
  section: string;
  name: string;
  roll: string;
  email?: string;
  phone?: string;
  guardian?: string;
  registeredAt: string;
  batch?: string;
  photo?: string;
}
export interface Exam {
  schoolId?: string;
  optionCount?: 2 | 3 | 4 | 5;
  code?: string;
  batch?: string;
  resultsPublished?: boolean;
  keyVersion?: number;
  markingRules?: MarkingRules;
  questionSets?: { code: string; answers: (Option[] | null)[] }[];
  subjects?: SubjectRange[];
  layout?: OMRLayout;
  duration?: number;
  classIds?: string[];
  id: string;
  title: string;
  subject: string;
  date: string;
  questions: number;
  marksCorrect: number;
  negativeMarks: number;
  passPercentage: number;
  answers: (Option | null)[];
  published: boolean;
}
export interface Result {
  id: string;
  studentId: string;
  name: string;
  roll: string;
  section: string;
  examId: string;
  answers: (Option | null)[];
  flagged: number[];
  confirmed: boolean;
  createdAt: string;
  source: "demo" | "scan";
  pageIndices?: number[];
  pageTotal?: number;
  layoutSignature?: string;
  identityReview?: boolean;
  missingPagesAccepted?: boolean;
  engine?: "opencv" | "canvas" | "opencv-python";
  scanConfidence?: number;
  questionSet?: string;
  detectedOptions?: Option[][];
  answerMeta?: AnswerDetection[];
  scanIds?: string[];
  sourceTransforms?: {
    objectId: string;
    pageIndex: number;
    sourceToAligned: number[][];
  }[];
}
export interface Workspace {
  version: 1;
  exams: Exam[];
  results: Result[];
  school: string;
  teacher: string;
  schools?: School[];
  classes?: ClassRoom[];
  students?: Student[];
  activeSchoolId?: string;
  institutionSettings?: {
    logo?: string;
    academicSession?: string;
    contactEmail?: string;
    contactPhone?: string;
    notifications?: boolean;
    defaultNegativeMarks?: number;
    defaultPassPercentage?: number;
    theme?: string;
  };
}

function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const firstNames = [
  "Aarav",
  "Ananya",
  "Rohan",
  "Ishita",
  "Arjun",
  "Saanvi",
  "Aditya",
  "Diya",
  "Vihaan",
  "Meera",
  "Kabir",
  "Aisha",
  "Vivaan",
  "Riya",
  "Reyansh",
  "Avni",
  "Krish",
  "Tara",
  "Dev",
  "Nisha",
  "Ishan",
  "Kavya",
  "Shaurya",
  "Myra",
  "Atharv",
  "Siya",
  "Dhruv",
  "Sara",
  "Ved",
  "Anika",
  "Ayaan",
];
const lastNames = [
  "Mehta",
  "Sharma",
  "Gupta",
  "Das",
  "Patel",
  "Roy",
  "Sen",
  "Kapoor",
];
const demoTitles = [
  "Unit test 01",
  "Unit test 02",
  "Practice test",
  "Unit test 03",
  "Mock assessment",
  "Mid-term assessment",
];
const demoDates = [
  "2026-08-12",
  "2026-08-28",
  "2026-09-15",
  "2026-10-02",
  "2026-10-23",
  "2026-11-17",
];

export function createDemoData(): Workspace {
  const exams: Exam[] = demoTitles.map((title, i) => {
    const random = seeded(71 + i * 100);
    return {
      id: `physics-${i}`,
      title,
      subject: "Physics",
      date: demoDates[i],
      questions: 50,
      marksCorrect: 2,
      negativeMarks: 0,
      passPercentage: 40,
      answers: Array.from(
        { length: 50 },
        () => OPTIONS[Math.floor(random() * 4)],
      ),
      published: true,
    };
  });
  const results: Result[] = [];
  exams.forEach((exam, ei) => {
    const random = seeded(ei * 413 + 729);
    const count = 188 + ei * 12;
    for (let i = 0; i < count; i++) {
      const abilityRandom = seeded(i * 17 + 301);
      const band = abilityRandom();
      let ability =
        band < 0.07
          ? 0.25 + abilityRandom() * 0.16
          : band < 0.2
            ? 0.45 + abilityRandom() * 0.17
            : band < 0.6
              ? 0.67 + abilityRandom() * 0.15
              : 0.85 + abilityRandom() * 0.14;
      if (i < 6) ability = [0.95, 0.89, 0.81, 0.77, 0.98, 0.67][i];
      ability -= [0.16, 0.065, 0.13, 0.015, 0.06, 0][ei];
      ability +=
        Math.floor(i / 62) === 0
          ? 0.035
          : Math.floor(i / 62) === 3
            ? -0.035
            : 0;
      const answers = exam.answers.map((correct, q) => {
        const chance = ability - (q === 11 ? 0.32 : q === 27 ? 0.2 : 0);
        if (random() < 0.009) return null;
        return random() < chance
          ? correct
          : OPTIONS.slice(0, 4).filter((a) => a !== correct)[
              Math.floor(random() * 3)
            ];
      });
      results.push({
        id: `${exam.id}-student-${i}`,
        studentId: `student-${i}`,
        name: `${firstNames[i % firstNames.length]} ${lastNames[(Math.floor(i / firstNames.length) + (i % firstNames.length)) % lastNames.length]}`,
        roll: `${12001 + i}`,
        section: `12 ${["A", "B", "C", "D"][Math.floor(i / 62)]}`,
        examId: exam.id,
        answers,
        flagged: ei === 5 && i >= count - 6 ? [7, 19] : [],
        confirmed: false,
        createdAt: `${exam.date}T${String(10 + Math.floor(i / 120)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`,
        source: "demo",
      });
    }
  });
  return {
    version: 1,
    exams,
    results,
    school: "Greenwood Academy",
    teacher: "Alex Morgan",
  };
}
/** Validate both on-disk state and backups before allowing them into the UI. */
export function isValidWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== "object") return false;
  const v = value as Workspace;
  const validAnswers = (answers: unknown, count: number) =>
    Array.isArray(answers) &&
    answers.length === count &&
    answers.every((a) => a === null || OPTIONS.includes(a));
  if (
    v.version !== 1 ||
    typeof v.school !== "string" ||
    typeof v.teacher !== "string" ||
    !Array.isArray(v.exams) ||
    !Array.isArray(v.results)
  )
    return false;
  if (
    !v.exams.every(
      (e) =>
        e &&
        typeof e === "object" &&
        typeof e.id === "string" &&
        typeof e.title === "string" &&
        typeof e.subject === "string" &&
        typeof e.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
        Number.isFinite(Date.parse(e.date)) &&
        new Date(e.date).toISOString().slice(0, 10) === e.date &&
        Number.isInteger(e.questions) &&
        e.questions > 0 &&
        e.questions <= 500 &&
        validAnswers(e.answers, e.questions) &&
        Number.isFinite(e.marksCorrect) &&
        e.marksCorrect > 0 &&
        e.marksCorrect <= 100 &&
        Number.isFinite(e.negativeMarks) &&
        e.negativeMarks >= 0 &&
        e.negativeMarks <= 100 &&
        Number.isFinite(e.passPercentage) &&
        e.passPercentage >= 1 &&
        e.passPercentage <= 100 &&
        typeof e.published === "boolean" &&
        (!e.published || e.answers.every(Boolean)),
    )
  )
    return false;
  if (new Set(v.exams.map((e) => e.id)).size !== v.exams.length) return false;
  if (
    v.exams.some(
      (e) =>
        e.optionCount !== undefined && ![2, 3, 4, 5].includes(e.optionCount),
    )
  )
    return false;
  if (
    v.exams.some((e) => e.answers.some((a) => a && !getOptions(e).includes(a)))
  )
    return false;
  if (
    v.exams.some(
      (e) =>
        e.subjects &&
        (!Array.isArray(e.subjects) ||
          e.subjects.some(
            (s) =>
              !s ||
              typeof s.name !== "string" ||
              !Number.isInteger(s.from) ||
              !Number.isInteger(s.to) ||
              s.from < 1 ||
              s.to < s.from ||
              s.to > e.questions,
          )),
    )
  )
    return false;
  if (
    v.exams.some(
      (e) => e.layout && (!validLayout(e.layout) || layoutErrors(e).length > 0),
    )
  )
    return false;
  if (
    v.exams.some((e) => {
      const covered = (e.subjects || []).flatMap((s) =>
        Array.from({ length: s.to - s.from + 1 }, (_, i) => s.from + i),
      );
      return new Set(covered).size !== covered.length;
    })
  )
    return false;
  if (
    v.students !== undefined &&
    (!Array.isArray(v.students) ||
      v.students.some(
        (s) =>
          !s ||
          ![s.id, s.schoolId, s.section, s.name, s.roll, s.registeredAt].every(
            (x) => typeof x === "string",
          ) ||
          !s.name.trim() ||
          !s.roll.trim(),
      ) ||
      new Set(v.students.map((s) => s.id)).size !== v.students.length)
  )
    return false;
  if (
    v.schools !== undefined &&
    (!Array.isArray(v.schools) ||
      !v.schools.length ||
      v.schools.some(
        (s) =>
          !s || ![s.id, s.name, s.code].every((x) => typeof x === "string"),
      ))
  )
    return false;
  if (
    v.classes !== undefined &&
    (!Array.isArray(v.classes) ||
      v.classes.some(
        (c) =>
          !c ||
          ![c.id, c.schoolId, c.name, c.academicYear].every(
            (x) => typeof x === "string",
          ),
      ))
  )
    return false;
  if (v.schools) {
    const ids = new Set(v.schools.map((s) => s.id));
    if (
      ids.size !== v.schools.length ||
      (v.activeSchoolId !== undefined && !ids.has(v.activeSchoolId)) ||
      v.exams.some((e) => e.schoolId !== undefined && !ids.has(e.schoolId)) ||
      v.students?.some((s) => !ids.has(s.schoolId)) ||
      v.classes?.some((c) => !ids.has(c.schoolId))
    )
      return false;
    const rolls = (v.students || []).map(
      (s) => `${s.schoolId}:${s.roll.trim().toLowerCase()}`,
    );
    if (new Set(rolls).size !== rolls.length) return false;
  }
  if (
    new Set(v.results.map((r) => `${r?.examId}:${r?.studentId}`)).size !==
    v.results.length
  )
    return false;
  return (
    v.results.every((r) => {
      if (!r || typeof r !== "object") return false;
      const exam = v.exams.find((e) => e.id === r.examId);
      return (
        !!exam &&
        typeof r.id === "string" &&
        typeof r.studentId === "string" &&
        typeof r.name === "string" &&
        typeof r.roll === "string" &&
        typeof r.section === "string" &&
        validAnswers(r.answers, exam.questions) &&
        !r.answers.some((a) => a && !getOptions(exam).includes(a)) &&
        (r.pageTotal === undefined ||
          (Number.isInteger(r.pageTotal) &&
            r.pageTotal >= 1 &&
            r.pageTotal <= 500)) &&
        (r.pageIndices === undefined ||
          (Array.isArray(r.pageIndices) &&
            new Set(r.pageIndices).size === r.pageIndices.length &&
            r.pageIndices.every(
              (p) =>
                Number.isInteger(p) &&
                p >= 0 &&
                p <
                  (r.pageTotal ||
                    Math.ceil(
                      exam.questions /
                        (exam.layout?.questionsPerPage ||
                          Math.min(100, exam.questions)),
                    )),
            ))) &&
        (r.layoutSignature === undefined ||
          (typeof r.layoutSignature === "string" &&
            /^[a-f0-9]{8}$/.test(r.layoutSignature))) &&
        (r.identityReview === undefined ||
          typeof r.identityReview === "boolean") &&
        (r.missingPagesAccepted === undefined ||
          typeof r.missingPagesAccepted === "boolean") &&
        Array.isArray(r.flagged) &&
        r.flagged.every(
          (q) => Number.isInteger(q) && q >= 0 && q < exam.questions,
        ) &&
        typeof r.confirmed === "boolean" &&
        typeof r.createdAt === "string" &&
        ["demo", "scan"].includes(r.source)
      );
    }) && new Set(v.results.map((r) => r.id)).size === v.results.length
  );
}
export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem("markly-workspace-v1");
    if (raw) {
      const saved = JSON.parse(raw);
      if (isValidWorkspace(saved)) return enrichWorkspace(saved);
    }
  } catch {
    /* Private browsing or an old workspace: use a fresh demo. */
  }
  return createAdvancedDemo();
}
export function gradeResult(result: Result, exam: Exam) {
  return scoreLocally(result, exam);
}
export function getStats(results: Result[], exam: Exam) {
  const scored = results.map((r) => gradeResult(r, exam));
  const evaluated = scored.filter((r) => !r.needsReview);
  const average = evaluated.length
    ? evaluated.reduce((sum, r) => sum + r.percentage, 0) / evaluated.length
    : 0;
  const passRate = evaluated.length
    ? (evaluated.filter((r) => r.status === "Passed").length /
        evaluated.length) *
      100
    : 0;
  return {
    total: results.length,
    evaluated: evaluated.length,
    review: scored.length - evaluated.length,
    average,
    passRate,
    highest: evaluated.reduce((highest, r) => Math.max(highest, r.score), 0),
    scored,
  };
}
export const DISTRIBUTION = [
  { name: "Excellent", range: "80–100%", min: 80, max: 101, color: "#35634b" },
  { name: "Good", range: "60–79%", min: 60, max: 80, color: "#bce37b" },
  { name: "Developing", range: "40–59%", min: 40, max: 60, color: "#e7dca7" },
  {
    name: "Needs support",
    range: "Below 40%",
    min: 0,
    max: 40,
    color: "#e7a995",
  },
];
export function getDistribution(results: Result[], exam: Exam) {
  const graded = results
    .map((r) => gradeResult(r, exam))
    .filter((r) => !r.needsReview);
  return DISTRIBUTION.map((b) => ({
    ...b,
    value: graded.filter((g) => g.percentage >= b.min && g.percentage < b.max)
      .length,
  }));
}
export function questionStats(results: Result[], exam: Exam) {
  const valid = results
    .map((r) => gradeResult(r, exam))
    .filter((g) => !g.needsReview);
  return exam.answers.map((answer, i) => {
    const counts = getOptions(exam).map((option) => ({
      option,
      count: valid.filter((g) => g.questions[i]?.selected.includes(option))
        .length,
    }));
    const correct = valid.filter(
      (g) => g.questions[i]?.status === "correct",
    ).length;
    return {
      number: i + 1,
      answer,
      counts,
      correct,
      total: valid.length,
      percentage: valid.length ? (correct / valid.length) * 100 : 0,
      blank: valid.filter((g) => !g.questions[i]?.selected.length).length,
    };
  });
}
export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
}
export function formatNumber(n: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}
export function formatDate(date: string) {
  return new Date(date + "T12:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
export function downloadFile(
  name: string,
  data: string | Blob,
  type = "text/csv;charset=utf-8",
) {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function resultsCSV(results: Result[], exam: Exam) {
  const escape = (v: unknown) => {
    const text = String(v);
    return (
      '"' +
      (/^\s*[=+@-]|^[\t\r]/.test(text) ? "'" + text : text).replaceAll(
        '"',
        '""',
      ) +
      '"'
    );
  };
  const rows: unknown[][] = [
    [
      "Student",
      "Roll number",
      "Class",
      "Exam",
      "Correct",
      "Incorrect",
      "Unanswered",
      "Score",
      "Maximum",
      "Score (%)",
      "Accuracy (%)",
      "Status",
    ],
  ];
  results.forEach((r) => {
    const g = gradeResult(r, exam);
    rows.push([
      r.name,
      r.roll,
      r.section,
      exam.title,
      g.correct,
      g.wrong,
      g.blank,
      g.score,
      g.maximum,
      g.percentage.toFixed(1),
      g.accuracy.toFixed(1),
      g.status,
    ]);
  });
  return "\uFEFF" + rows.map((row) => row.map(escape).join(",")).join("\r\n");
}

function validLayout(l: OMRLayout): boolean {
  return (
    l.version === 2 &&
    typeof l.name === "string" &&
    Number.isInteger(l.questionsPerPage) &&
    l.questionsPerPage >= 1 &&
    l.questionsPerPage <= 100 &&
    Number.isInteger(l.columns) &&
    l.columns >= 1 &&
    l.columns <= 5 &&
    [
      l.startX,
      l.startY,
      l.columnGap,
      l.rowGap,
      l.optionGap,
      l.radius,
      l.labelOffset,
      l.threshold,
    ].every(Number.isFinite) &&
    l.radius >= 5 &&
    l.radius <= 25 &&
    l.threshold >= 0.15 &&
    l.threshold <= 0.95 &&
    ["circle", "square"].includes(l.bubbleShape) &&
    ["markers", "page"].includes(l.anchorMode) &&
    Array.isArray(l.anchors) &&
    l.anchors.length === 4 &&
    l.anchors.every(
      (p) =>
        p &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        p.x >= 0 &&
        p.x <= 1240 &&
        p.y >= 0 &&
        p.y <= 1754,
    ) &&
    Array.isArray(l.fields) &&
    l.fields.length <= 40 &&
    l.fields.every(
      (f) =>
        f &&
        typeof f.id === "string" &&
        typeof f.text === "string" &&
        ["text", "student", "roll", "qr", "line", "logo"].includes(f.type) &&
        [f.x, f.y, f.width, f.height, f.fontSize].every(Number.isFinite) &&
        f.width > 0 &&
        f.height > 0 &&
        f.fontSize > 0 &&
        typeof f.visible === "boolean" &&
        typeof f.bold === "boolean" &&
        (f.image === undefined || isEmbeddedRaster(f.image)),
    ) &&
    !!l.rollRegion &&
    Object.values(l.rollRegion).every(Number.isFinite) &&
    (l.referenceImage === undefined ||
      isEmbeddedRaster(l.referenceImage, 2000000))
  );
}
export function enrichWorkspace(input: Workspace): Workspace {
  const id =
    input.activeSchoolId || input.schools?.[0]?.id || "school-greenwood";
  const schools = input.schools?.length
    ? input.schools
    : [{ id, name: input.school, code: "GW" }];
  const exams = input.exams.map((e) => ({
    ...e,
    schoolId: e.schoolId || id,
    optionCount:
      e.optionCount || ((e.answers.includes("E") ? 5 : 4) as 2 | 3 | 4 | 5),
  }));
  const classes =
    input.classes ||
    [...new Set(input.results.map((r) => r.section))].map((name, i) => ({
      id: `class-${i}`,
      schoolId: id,
      name,
      academicYear: "2026–27",
    }));
  const byId = new Map<string, Student>();
  input.results.forEach((r) => {
    if (!byId.has(r.studentId))
      byId.set(r.studentId, {
        id: r.studentId,
        schoolId: exams.find((e) => e.id === r.examId)?.schoolId || id,
        section: r.section,
        classId: classes.find((c) => c.name === r.section)?.id,
        name: r.name,
        roll: r.roll,
        registeredAt: r.createdAt,
      });
  });
  return {
    ...input,
    exams,
    schools,
    classes,
    students: input.students || [...byId.values()],
    activeSchoolId: id,
  };
}
export function createAdvancedDemo(): Workspace {
  const data = enrichWorkspace(createDemoData());
  const latest = data.exams.at(-1)!;
  latest.subject = "Science";
  latest.subjects = [
    { name: "Physics", from: 1, to: 17 },
    { name: "Chemistry", from: 18, to: 34 },
    { name: "Mathematics", from: 35, to: 50 },
  ];
  return data;
}
export function blankWorkspace(
  school: School,
  teacher = "Educator",
): Workspace {
  return {
    version: 1,
    school: school.name,
    teacher,
    schools: [school],
    classes: [],
    students: [],
    activeSchoolId: school.id,
    results: [],
    exams: [
      {
        id: `exam-${crypto.randomUUID().slice(0, 8)}`,
        schoolId: school.id,
        title: "My first assessment",
        subject: "General",
        date: new Date().toISOString().slice(0, 10),
        questions: 50,
        marksCorrect: 2,
        negativeMarks: 0,
        passPercentage: 40,
        answers: Array(50).fill(null),
        optionCount: 5,
        published: false,
      },
    ],
  };
}
export function scopeWorkspace(
  workspace: Workspace,
  schoolId: string,
): Workspace {
  const data = enrichWorkspace(workspace),
    school = data.schools!.find((s) => s.id === schoolId) || data.schools![0];
  const exams = data.exams.filter((e) => e.schoolId === school.id),
    examIds = new Set(exams.map((e) => e.id));
  return {
    ...data,
    school: school.name,
    activeSchoolId: school.id,
    exams,
    classes: data.classes!.filter((c) => c.schoolId === school.id),
    students: data.students!.filter((s) => s.schoolId === school.id),
    results: data.results.filter((r) => examIds.has(r.examId)),
  };
}
export function mergeSchoolWorkspace(
  all: Workspace,
  changed: Workspace,
  schoolId: string,
): Workspace {
  const scoped = enrichWorkspace({ ...changed, activeSchoolId: schoolId }),
    oldIds = new Set(
      all.exams
        .filter((e) => (e.schoolId || all.activeSchoolId) === schoolId)
        .map((e) => e.id),
    );
  return {
    ...all,
    school: scoped.school,
    teacher: scoped.teacher,
    activeSchoolId: schoolId,
    schools: all.schools!.map((s) =>
      s.id === schoolId ? { ...s, name: scoped.school } : s,
    ),
    exams: [
      ...all.exams.filter((e) => e.schoolId !== schoolId),
      ...scoped.exams.map((e) => ({ ...e, schoolId })),
    ],
    results: [
      ...all.results.filter((r) => !oldIds.has(r.examId)),
      ...scoped.results,
    ],
    students: [
      ...(all.students || []).filter((s) => s.schoolId !== schoolId),
      ...(scoped.students || []).map((s) => ({ ...s, schoolId })),
    ],
    classes: [
      ...(all.classes || []).filter((c) => c.schoolId !== schoolId),
      ...(scoped.classes || []).map((c) => ({ ...c, schoolId })),
    ],
  };
}
export function subjectStats(results: Result[], exam: Exam) {
  const subjects = exam.subjects?.length
    ? exam.subjects
    : [{ name: exam.subject, from: 1, to: exam.questions }];
  const valid = results
    .map((result) => ({ result, graded: gradeResult(result, exam) }))
    .filter((r) => !r.graded.needsReview);
  return subjects.map((subject) => {
    const students = valid.map(({ result, graded }) => {
      const qs = graded.questions.slice(subject.from - 1, subject.to),
        maximum = new ScoringDecimal(exam.marksCorrect)
          .times(qs.filter((q) => q.expected.length).length)
          .toNumber();
      const total = qs.reduce((n, q) => n.plus(q.marks), new ScoringDecimal(0));
      const score = total.toNumber();
      return {
        result,
        score,
        correct: qs.filter((q) => q.status === "correct").length,
        wrong: qs.filter((q) => q.status === "wrong").length,
        maximum,
        percentage: maximum ? total.div(maximum).times(100).toNumber() : 0,
      };
    });
    const key = (
      exam.questionSets?.[0]?.answers ||
      exam.answers.map((a) => (a ? [a] : null))
    ).slice(subject.from - 1, subject.to);
    const maximum = key.filter((a) => a?.length).length * exam.marksCorrect;
    return {
      ...subject,
      maximum,
      students,
      average: students.length
        ? students.reduce((n, r) => n + r.percentage, 0) / students.length
        : 0,
      accuracy: valid.length
        ? (students.reduce((n, r) => n + r.correct, 0) /
            (valid.length * (subject.to - subject.from + 1))) *
          100
        : 0,
    };
  });
}
export function rankings(results: Result[], exam: Exam, subject?: string) {
  const valid = results.filter((r) => !gradeResult(r, exam).needsReview);
  const subjectData = subject
    ? subjectStats(results, exam).find((s) => s.name === subject)
    : null;
  const items = valid
    .map((result) => {
      const grade = gradeResult(result, exam),
        sub = subjectData?.students.find((s) => s.result.id === result.id);
      return {
        result,
        grade,
        score: sub ? sub.score : grade.score,
        percentage: sub ? sub.percentage : grade.percentage,
      };
    })
    .sort(
      (a, b) => b.score - a.score || a.result.name.localeCompare(b.result.name),
    );
  const groups = new Map<number, number>();
  items.forEach((item, i) => {
    if (!groups.has(item.score)) groups.set(item.score, i + 1);
  });
  const percentages = items
    .map((item) => item.percentage)
    .sort((a, b) => a - b);
  const below = (percentage: number) => {
    let lo = 0,
      hi = percentages.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (percentages[mid] < percentage) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return items.map((item, i) => ({
    ...item,
    rank: groups.get(item.score)!,
    percentile: items.length
      ? (below(item.percentage) / items.length) * 100
      : 0,
    position: i + 1,
  }));
}
export function studentValidation(
  student: Pick<Student, "name" | "roll" | "section" | "schoolId">,
  students: Student[],
  excludeId?: string,
) {
  if (!student.name.trim() || !student.roll.trim() || !student.section.trim())
    return "Name, roll number and class are required.";
  if (
    student.name.length > 120 ||
    student.roll.length > 40 ||
    student.section.length > 120
  )
    return "Use at most 120 characters for name/class and 40 for the roll number.";
  if (
    students.some(
      (s) =>
        s.id !== excludeId &&
        s.schoolId === student.schoolId &&
        s.roll.toLowerCase() === student.roll.trim().toLowerCase(),
    )
  )
    return "That roll number is already registered in this school.";
  return null;
}
