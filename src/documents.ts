import type { Exam, Result, Student, Workspace } from "./data";
import {
  downloadFile,
  formatDate,
  gradeResult,
  getStats,
  getOptions,
  questionStats,
  rankings,
  subjectStats,
} from "./data";

const safeCell = (s: string) => (/^\s*[=+@-]/.test(s) ? `'${s}` : s);
export async function exportExcel(
  workspace: Workspace,
  exam: Exam,
  results: Result[],
) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "Markly";
  book.created = new Date();
  const sheet = book.addWorksheet("Student results");
  sheet.addRow([
    "Roll number",
    "Student name",
    "Class",
    "Rank",
    "Percentile",
    "Score",
    "Maximum",
    "Score (%)",
    "Accuracy (%)",
    "Correct",
    "Incorrect",
    "Unanswered",
    "Status",
  ]);
  const ranked = rankings(results, exam);
  results.forEach((r) => {
    const g = gradeResult(r, exam),
      rank = ranked.find((a) => a.result.id === r.id);
    sheet.addRow([
      safeCell(r.roll),
      safeCell(r.name),
      safeCell(r.section),
      rank?.rank || "",
      rank ? +rank.percentile.toFixed(2) : "",
      g.score,
      g.maximum,
      +g.percentage.toFixed(2),
      +g.accuracy.toFixed(2),
      g.correct,
      g.wrong,
      g.blank,
      g.status,
    ]);
  });
  const questions = book.addWorksheet("Question analysis");
  questions.addRow([
    "Question",
    "Subject",
    "Correct answer",
    "Correct responses",
    "Evaluated",
    "Correct (%)",
    ...getOptions(exam),
    "Unanswered",
  ]);
  questionStats(results, exam).forEach((q) => {
    const subject =
      exam.subjects?.find((s) => q.number >= s.from && q.number <= s.to)
        ?.name || exam.subject;
    questions.addRow([
      q.number,
      safeCell(subject),
      q.answer,
      q.correct,
      q.total,
      +q.percentage.toFixed(2),
      ...q.counts.map((c) => c.count),
      q.blank,
    ]);
  });
  const subjects = book.addWorksheet("Subject rankings");
  subjects.addRow([
    "Subject",
    "Roll number",
    "Student",
    "Rank",
    "Percentile",
    "Score",
    "Score (%)",
  ]);
  subjectStats(results, exam).forEach((s) =>
    rankings(results, exam, s.name).forEach((r) =>
      subjects.addRow([
        safeCell(s.name),
        safeCell(r.result.roll),
        safeCell(r.result.name),
        r.rank,
        +r.percentile.toFixed(2),
        r.score,
        +r.percentage.toFixed(2),
      ]),
    ),
  );
  const summary = book.addWorksheet("Summary"),
    stats = getStats(results, exam);
  summary.addRows([
    ["School", safeCell(workspace.school)],
    ["Assessment", safeCell(exam.title)],
    ["Date", exam.date],
    ["Students", stats.total],
    ["Evaluated", stats.evaluated],
    ["Awaiting review", stats.review],
    ["Average score (%)", +stats.average.toFixed(2)],
    ["Pass rate (%)", +stats.passRate.toFixed(2)],
  ]);
  book.eachSheet((s) => {
    s.views = [{ state: "frozen", ySplit: 1 }];
    s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    s.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF284B3B" },
    };
    s.columns.forEach((c) => {
      c.width = 20;
    });
    s.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: s.rowCount, column: s.columnCount },
    };
  });
  downloadFile(
    `markly-${exam.id}.xlsx`,
    new Blob([(await book.xlsx.writeBuffer()) as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
}
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell.length)
        throw new Error("Unexpected quote in CSV.");
      else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("An opening quote in this CSV was not closed.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export async function importStudents(
  file: File,
  schoolId: string,
): Promise<{ students: Student[]; errors: string[] }> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Student imports must be smaller than 10 MB.");
  let rows: string[][];
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await file.arrayBuffer());
    const sheet = book.worksheets[0];
    if (!sheet) throw new Error("This workbook has no sheets.");
    if (sheet.rowCount > 10001)
      throw new Error("Import up to 10,000 students at a time.");
    rows = [];
    sheet.eachRow((row) => {
      const cells: string[] = [];
      for (let c = 1; c <= Math.min(sheet.columnCount, 30); c++) {
        const value = row.getCell(c).value;
        if (value && typeof value === "object" && "formula" in value)
          throw new Error("Remove formulas from student import files.");
        cells.push(row.getCell(c).text);
      }
      rows.push(cells);
    });
  } else if (file.name.toLowerCase().endsWith(".csv"))
    rows = parseCSV(await file.text());
  else throw new Error("Choose a CSV or XLSX file.");
  if (rows.length < 2)
    throw new Error("Add a header row and at least one student.");
  if (rows.length > 10001)
    throw new Error("Import up to 10,000 students per file.");
  const headers = rows[0].map((s) =>
    s.trim().toLowerCase().replace(/[ _-]/g, ""),
  );
  const find = (...keys: string[]) =>
    headers.findIndex((h) => keys.includes(h));
  const ni = find("name", "student", "studentname"),
    ri = find("roll", "rollnumber", "rollno"),
    ci = find("class", "section", "classname"),
    ei = find("email"),
    pi = find("phone", "mobile"),
    gi = find("guardian", "parent");
  if (ni < 0 || ri < 0 || ci < 0)
    throw new Error(
      "Required columns: Name, Roll number, Class. Optional: Email, Phone, Guardian.",
    );
  const students: Student[] = [],
    errors: string[] = [],
    seen = new Set<string>();
  rows.slice(1).forEach((row, index) => {
    const name = row[ni]?.trim() || "",
      roll = row[ri]?.trim() || "",
      section = row[ci]?.trim() || "";
    if (!name || !roll || !section) {
      errors.push(
        `Row ${index + 2}: name, roll number and class are required.`,
      );
      return;
    }
    if (name.length > 120 || roll.length > 40 || section.length > 60) {
      errors.push(`Row ${index + 2}: a value is too long.`);
      return;
    }
    if (seen.has(roll.toLowerCase())) {
      errors.push(`Row ${index + 2}: duplicate roll number ${roll}.`);
      return;
    }
    seen.add(roll.toLowerCase());
    students.push({
      id: crypto.randomUUID(),
      schoolId,
      name,
      roll,
      section,
      email: ei >= 0 ? row[ei]?.trim() : undefined,
      phone: pi >= 0 ? row[pi]?.trim() : undefined,
      guardian: gi >= 0 ? row[gi]?.trim() : undefined,
      registeredAt: new Date().toISOString(),
    });
  });
  return { students, errors };
}
export function studentImportTemplate() {
  downloadFile(
    "markly-student-import.csv",
    "Name,Roll number,Class,Email,Phone,Guardian\r\nMaya Verma,13001,12 A,,,\r\nNeel Bose,13002,12 B,,,",
  );
}

let fontPromise: Promise<string | null> | undefined;
async function pdfFont() {
  return (fontPromise ||= (async () => {
    try {
      const r = await fetch(
        `${import.meta.env.BASE_URL}fonts/NotoSans-Regular.ttf`,
      );
      if (!r.ok) return null;
      const bytes = new Uint8Array(await r.arrayBuffer());
      let text = "";
      for (let i = 0; i < bytes.length; i += 8192)
        text += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(text);
    } catch {
      return null;
    }
  })());
}
async function makePDF() {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  const font = await pdfFont();
  if (font) {
    doc.addFileToVFS("NotoSans.ttf", font);
    doc.addFont("NotoSans.ttf", "NotoSans", "normal");
    doc.setFont("NotoSans");
  }
  return doc;
}
export async function studentPDF(
  workspace: Workspace,
  exam: Exam,
  result: Result,
  results: Result[],
) {
  const doc = await makePDF(),
    { default: autoTable } = await import("jspdf-autotable"),
    g = gradeResult(result, exam),
    ranking = rankings(results, exam).find((r) => r.result.id === result.id),
    font = doc.getFont().fontName;
  doc.setFillColor("#15251f");
  doc.rect(0, 0, 210, 49, "F");
  doc.setTextColor("#c6ed96");
  doc.setFontSize(22);
  doc.text("markly.", 15, 17);
  doc.setTextColor("#ffffff");
  doc.setFontSize(10);
  doc.text(workspace.school, 15, 27);
  doc.setFontSize(8);
  doc.text("INDIVIDUAL STUDENT REPORT CARD", 15, 38);
  doc.setTextColor("#263b2f");
  doc.setFontSize(20);
  doc.text(result.name, 15, 65);
  doc.setFontSize(9);
  doc.text(
    `Roll ${result.roll}  |  Class ${result.section}  |  ${formatDate(exam.date)}`,
    15,
    74,
  );
  doc.text(exam.title, 15, 82);
  const boxes = [
    ["SCORE", `${g.score} / ${g.maximum}`],
    ["ACCURACY", `${g.accuracy.toFixed(1)}%`],
    [
      "RANK",
      ranking
        ? `${ranking.rank} / ${rankings(results, exam).length}`
        : "Under review",
    ],
    ["PERCENTILE", ranking ? ranking.percentile.toFixed(2) : "Under review"],
  ];
  boxes.forEach(([label, value], i) => {
    const x = 15 + i * 47;
    doc.setFillColor("#f0f5e9");
    doc.roundedRect(x, 91, 43, 25, 2, 2, "F");
    doc.setFontSize(6.8);
    doc.setTextColor("#81926b");
    doc.text(label, x + 4, 99);
    doc.setFontSize(11);
    doc.setTextColor("#385631");
    doc.text(value, x + 4, 109);
  });
  doc.setFontSize(9);
  doc.text(
    `Status: ${g.status}${g.needsReview ? " — provisional, review required" : ""}     Correct: ${g.correct}     Incorrect: ${g.wrong}     Unanswered: ${g.blank}`,
    15,
    127,
  );
  const subjects = subjectStats([result], exam);
  autoTable(doc, {
    startY: 136,
    head: [["Subject", "Questions", "Score", "Score (%)"]],
    body: subjects.map((s) => [
      s.name,
      `${s.from}–${s.to}`,
      `${s.students[0]?.score || 0}/${s.maximum}`,
      `${(s.students[0]?.percentage || 0).toFixed(1)}%`,
    ]),
    styles: { font, fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [47, 76, 56] },
    margin: { left: 15, right: 15 },
  });
  const nextY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY + 12;
  doc.setFontSize(11);
  doc.text("Question-by-question responses", 15, nextY);
  autoTable(doc, {
    startY: nextY + 5,
    head: [
      ["Question", "Subject", "Correct option", "Student answer", "Outcome"],
    ],
    body: exam.answers.map((a, q) => [
      q + 1,
      exam.subjects?.find((s) => q + 1 >= s.from && q + 1 <= s.to)?.name ||
        exam.subject,
      a || "Not set",
      result.answers[q] || "Unanswered",
      result.flagged.includes(q)
        ? "Review"
        : !result.answers[q]
          ? "Unanswered"
          : result.answers[q] === a
            ? "Correct"
            : "Incorrect",
    ]),
    styles: { font, fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [47, 76, 56] },
    margin: { left: 15, right: 15, bottom: 18 },
  });
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(6.5);
    doc.setTextColor("#8b987f");
    doc.text(
      `Markly | ${result.roll} | Page ${p} of ${pages} | Percentile: percentage of evaluated students with a strictly lower score.`,
      15,
      289,
    );
  }
  doc.save(`markly-report-${result.roll.replace(/[^a-z0-9_-]/gi, "_")}.pdf`);
}
export async function examPDF(
  workspace: Workspace,
  exam: Exam,
  results: Result[],
) {
  const doc = await makePDF(),
    { default: autoTable } = await import("jspdf-autotable"),
    font = doc.getFont().fontName,
    s = getStats(results, exam);
  doc.setFontSize(23);
  doc.setTextColor("#305739");
  doc.text("markly. / Examination report", 15, 23);
  doc.setFontSize(10);
  doc.text(workspace.school, 15, 33);
  doc.text(`${exam.title} · ${formatDate(exam.date)}`, 15, 42);
  doc.text(
    `Students ${s.total}   Evaluated ${s.evaluated}   Average ${s.average.toFixed(1)}%   Pass rate ${s.passRate.toFixed(1)}%`,
    15,
    53,
  );
  const rank = rankings(results, exam);
  autoTable(doc, {
    startY: 62,
    head: [
      ["Rank", "Roll", "Student", "Class", "Score", "Percentile", "Status"],
    ],
    body: results.map((r) => {
      const g = gradeResult(r, exam),
        p = rank.find((a) => a.result.id === r.id);
      return [
        p?.rank || "—",
        r.roll,
        r.name,
        r.section,
        `${g.score}/${g.maximum}`,
        p?.percentile.toFixed(2) || "—",
        g.status,
      ];
    }),
    styles: { font, fontSize: 7, cellPadding: 2.5 },
    headStyles: { fillColor: [47, 76, 56] },
    margin: { left: 15, right: 15 },
  });
  doc.save(`markly-exam-${exam.id}.pdf`);
}
