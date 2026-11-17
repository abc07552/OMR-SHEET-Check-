export type Option = "A" | "B" | "C" | "D";
export const OPTIONS: Option[] = ["A", "B", "C", "D"];
export type Page =
  | "overview"
  | "scanner"
  | "keys"
  | "students"
  | "analytics"
  | "reports"
  | "settings";
export interface Exam {
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
}
export interface Workspace {
  version: 1;
  exams: Exam[];
  results: Result[];
  school: string;
  teacher: string;
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
          : OPTIONS.filter((a) => a !== correct)[Math.floor(random() * 3)];
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
    !v.exams.length ||
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
        Number.isInteger(e.questions) &&
        e.questions > 0 &&
        e.questions <= 100 &&
        validAnswers(e.answers, e.questions) &&
        Number.isFinite(e.marksCorrect) &&
        e.marksCorrect > 0 &&
        Number.isFinite(e.negativeMarks) &&
        e.negativeMarks >= 0 &&
        Number.isFinite(e.passPercentage) &&
        e.passPercentage >= 1 &&
        e.passPercentage <= 100 &&
        typeof e.published === "boolean" &&
        (!e.published || e.answers.every(Boolean)),
    )
  )
    return false;
  if (new Set(v.exams.map((e) => e.id)).size !== v.exams.length) return false;
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
      if (isValidWorkspace(saved)) return saved;
    }
  } catch {
    /* Private browsing or an old workspace: use a fresh demo. */
  }
  return createDemoData();
}
export function gradeResult(result: Result, exam: Exam) {
  let correct = 0,
    wrong = 0,
    blank = 0;
  exam.answers.forEach((key, i) => {
    if (!key) return;
    if (!result.answers[i]) blank++;
    else if (result.answers[i] === key) correct++;
    else wrong++;
  });
  const maximum = exam.answers.filter(Boolean).length * exam.marksCorrect;
  const score = Math.max(
    0,
    correct * exam.marksCorrect - wrong * exam.negativeMarks,
  );
  const percentage = maximum ? (score / maximum) * 100 : 0;
  const accuracy =
    correct + wrong + blank ? (correct / (correct + wrong + blank)) * 100 : 0;
  const needsReview = result.flagged.length > 0 && !result.confirmed;
  const status: "Review" | "Passed" | "Failed" = needsReview
    ? "Review"
    : percentage >= exam.passPercentage
      ? "Passed"
      : "Failed";
  return {
    correct,
    wrong,
    blank,
    maximum,
    score,
    percentage,
    accuracy,
    status,
    needsReview,
  };
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
  const valid = results.filter((r) => !gradeResult(r, exam).needsReview);
  return exam.answers.map((answer, i) => {
    const counts = OPTIONS.map((option) => ({
      option,
      count: valid.filter((r) => r.answers[i] === option).length,
    }));
    const correct = valid.filter((r) => r.answers[i] === answer).length;
    return {
      number: i + 1,
      answer,
      counts,
      correct,
      total: valid.length,
      percentage: valid.length ? (correct / valid.length) * 100 : 0,
      blank: valid.filter((r) => !r.answers[i]).length,
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
