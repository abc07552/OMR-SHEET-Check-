import { z } from "zod";
const id = z.string().min(1).max(120),
  label = z.string().trim().min(1).max(120),
  option = z.enum(["A", "B", "C", "D", "E"]).nullable();
const raster = (maxLength) =>
  z
    .string()
    .max(maxLength)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
const point = z.object({
  x: z.number().min(0).max(1240),
  y: z.number().min(0).max(1754),
});
const field = z.object({
  id,
  type: z.enum(["text", "student", "roll", "qr", "line", "logo"]),
  text: z.string().max(2000),
  x: z.number().min(0).max(1240),
  y: z.number().min(0).max(1754),
  width: z.number().positive().max(1240),
  height: z.number().positive().max(1754),
  fontSize: z.number().positive().max(120),
  bold: z.boolean(),
  visible: z.boolean(),
  image: raster(500000).optional(),
});
const layout = z.object({
  version: z.literal(2),
  name: label,
  questionsPerPage: z.number().int().min(1).max(100),
  columns: z.number().int().min(1).max(5),
  startX: z.number().min(0).max(1240),
  startY: z.number().min(0).max(1754),
  columnGap: z.number().positive().max(1240),
  rowGap: z.number().positive().max(1754),
  optionGap: z.number().positive().max(400),
  radius: z.number().min(5).max(25),
  labelOffset: z.number().min(0).max(500),
  bubbleShape: z.enum(["circle", "square"]),
  threshold: z.number().min(0.15).max(0.95),
  anchorMode: z.enum(["markers", "page"]),
  anchors: z.array(point).length(4),
  fields: z.array(field).max(40),
  referenceImage: raster(2000000).optional(),
  rollRegion: z.object({
    x: z.number().min(0).max(1240),
    y: z.number().min(0).max(1754),
    width: z.number().positive().max(1240),
    height: z.number().positive().max(1754),
  }),
});
const school = z.object({
  id,
  name: label,
  code: label,
  address: z.string().max(500).optional(),
});
const classroom = z.object({
  id,
  schoolId: id,
  name: label,
  academicYear: z.string().max(30),
});
const student = z.object({
  id,
  schoolId: id,
  classId: id.optional(),
  section: label,
  name: label,
  roll: z.string().trim().min(1).max(40),
  email: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  guardian: z.string().max(120).optional(),
  registeredAt: z.string().max(40),
});
const exam = z.object({
  id,
  schoolId: id,
  optionCount: z.union([z.literal(4), z.literal(5)]).optional(),
  subjects: z
    .array(
      z.object({
        name: label,
        from: z.number().int().positive(),
        to: z.number().int().positive(),
      }),
    )
    .max(30)
    .optional(),
  layout: layout.optional(),
  duration: z.number().int().min(1).max(1440).optional(),
  classIds: z.array(id).max(500).optional(),
  title: label,
  subject: label,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  questions: z.number().int().min(1).max(500),
  marksCorrect: z.number().positive().max(100),
  negativeMarks: z.number().min(0).max(100),
  passPercentage: z.number().min(1).max(100),
  answers: z.array(option).min(1).max(500),
  published: z.boolean(),
});
const result = z.object({
  id,
  studentId: id,
  name: label,
  roll: z.string().min(1).max(40),
  section: label,
  examId: id,
  answers: z.array(option).min(1).max(500),
  flagged: z.array(z.number().int().min(0).max(499)).max(500),
  confirmed: z.boolean(),
  createdAt: z.string().max(40),
  source: z.enum(["demo", "scan"]),
  pageIndices: z.array(z.number().int().min(0).max(499)).max(500).optional(),
  pageTotal: z.number().int().min(1).max(500).optional(),
  layoutSignature: z
    .string()
    .regex(/^[a-f0-9]{8}$/)
    .optional(),
  identityReview: z.boolean().optional(),
  missingPagesAccepted: z.boolean().optional(),
  engine: z.enum(["opencv", "canvas"]).optional(),
  scanConfidence: z.number().min(0).max(100).optional(),
});
export const workspaceSchema = z
  .object({
    version: z.literal(1),
    school: label,
    teacher: label,
    schools: z.array(school).min(1).max(1),
    classes: z.array(classroom).max(500),
    students: z.array(student).max(20000),
    activeSchoolId: id,
    exams: z.array(exam).min(1).max(1000),
    results: z.array(result).max(50000),
  })
  .superRefine((w, ctx) => {
    const issue = (message) => ctx.addIssue({ code: "custom", message });
    if (
      w.schools[0].id !== w.activeSchoolId ||
      w.exams.some((e) => e.schoolId !== w.activeSchoolId) ||
      w.students.some((s) => s.schoolId !== w.activeSchoolId) ||
      w.classes.some((c) => c.schoolId !== w.activeSchoolId)
    )
      issue("All records must belong to the selected school.");
    for (const list of [w.exams, w.students, w.classes, w.results])
      if (new Set(list.map((r) => r.id)).size !== list.length)
        issue("Duplicate record identifiers are not allowed.");
    if (
      new Set(w.results.map((r) => `${r.examId}:${r.studentId}`)).size !==
      w.results.length
    )
      issue(
        "A student can have only one result per assessment. Merge rescanned pages instead of adding duplicates.",
      );
    if (
      new Set(w.students.map((s) => s.roll.toLowerCase())).size !==
      w.students.length
    )
      issue("Roll numbers must be unique within a school.");
    for (const e of w.exams) {
      if (
        !Number.isFinite(Date.parse(e.date)) ||
        new Date(e.date).toISOString().slice(0, 10) !== e.date
      )
        issue("Use a valid assessment date.");
      if (
        e.answers.length !== e.questions ||
        ((!e.optionCount || e.optionCount === 4) && e.answers.includes("E")) ||
        (e.published && e.answers.some((a) => a === null))
      )
        issue("Question counts or answer options do not match.");
      if (
        e.subjects?.some(
          (s) => s.from < 1 || s.from > s.to || s.to > e.questions,
        )
      ) {
        issue("Subject question ranges are invalid.");
        continue; // Do not allocate a range from untrusted, out-of-bounds numbers.
      }
      if (e.layout) {
        const l = e.layout;
        if (
          l.fields.some((f) => f.x + f.width > 1240 || f.y + f.height > 1754) ||
          l.rollRegion.x + l.rollRegion.width > 1240 ||
          l.rollRegion.y + l.rollRegion.height > 1754
        )
          issue("Layout fields and OCR regions must stay inside the page.");
        if (l.fields.some((f) => f.type === "logo" && f.visible && !f.image))
          issue("Upload an image for every visible logo field.");
        if (new Set(l.fields.map((f) => f.id)).size !== l.fields.length)
          issue("Every layout field needs a unique identifier.");
        if (
          l.optionGap < l.radius * 2 + 2 ||
          l.rowGap < l.radius * 2 + 2 ||
          (l.columns > 1 &&
            l.columnGap <
              ((e.optionCount || 4) - 1) * l.optionGap +
                l.radius * 2 +
                l.labelOffset +
                10)
        )
          issue("Layout bubbles must not overlap.");
        if (
          l.anchorMode === "markers" &&
          l.anchors.some(
            (p, i) =>
              p.x < 17 ||
              p.x > 1223 ||
              p.y < 17 ||
              p.y > 1737 ||
              (i === 0 || i === 3 ? p.x > 1240 * 0.24 : p.x < 1240 * 0.76) ||
              (i < 2 ? p.y > 1754 * 0.24 : p.y < 1754 * 0.76),
          )
        )
          issue(
            "Registration squares must be ordered in the four outer corner regions.",
          );
        const rows = Math.ceil(l.questionsPerPage / l.columns);
        for (let q = 0; q < Math.min(l.questionsPerPage, e.questions); q++) {
          const x = l.startX + Math.floor(q / rows) * l.columnGap,
            y = l.startY + (q % rows) * l.rowGap;
          if (
            x - l.labelOffset < 25 ||
            x - l.radius < 25 ||
            x + ((e.optionCount || 4) - 1) * l.optionGap + l.radius > 1215 ||
            y - l.radius < 25 ||
            y + l.radius > 1684
          ) {
            issue("The bubble grid extends beyond the printable area.");
            break;
          }
        }
      }
      if (e.subjects?.length) {
        const covered = e.subjects.flatMap((s) =>
          Array.from({ length: s.to - s.from + 1 }, (_, i) => s.from + i),
        );
        if (new Set(covered).size !== covered.length)
          issue("Subject ranges must not overlap.");
      }
    }
    for (const r of w.results) {
      const e = w.exams.find((e) => e.id === r.examId);
      if (
        !e ||
        r.answers.length !== e.questions ||
        r.flagged.some((q) => q >= e.questions) ||
        ((e.optionCount || 4) === 4 && r.answers.includes("E")) ||
        (r.pageIndices &&
          (new Set(r.pageIndices).size !== r.pageIndices.length ||
            r.pageIndices.some(
              (p) =>
                p >=
                (r.pageTotal ||
                  Math.ceil(
                    e.questions /
                      (e.layout?.questionsPerPage ||
                        Math.min(100, e.questions)),
                  )),
            )))
      )
        issue("A result is not linked to a valid assessment.");
    }
  });
export const credentials = z.object({
  email: z
    .string()
    .email()
    .max(200)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(12).max(128),
});
export const userInput = credentials.extend({
  name: label,
  role: z.enum(["admin", "teacher"]),
});
export const schoolInput = z.object({
  name: label,
  code: z.string().trim().min(1).max(20),
  address: z.string().max(500).optional(),
});
export function emptyWorkspace(school, teacher) {
  return {
    version: 1,
    school: school.name,
    teacher,
    schools: [school],
    activeSchoolId: school.id,
    classes: [],
    students: [],
    results: [],
    exams: [
      {
        id: crypto.randomUUID(),
        schoolId: school.id,
        title: "My first assessment",
        subject: "General",
        date: new Date().toISOString().slice(0, 10),
        questions: 50,
        marksCorrect: 2,
        negativeMarks: 0,
        passPercentage: 40,
        answers: Array(50).fill(null),
        published: false,
        optionCount: 5,
      },
    ],
  };
}
