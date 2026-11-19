import type { Exam, Result, Workspace } from "./data";
import {
  downloadFile,
  getStats,
  gradeResult,
  questionStats,
  rankings,
  subjectStats,
} from "./data";
export const reportDefinitions = [
  {
    kind: "results",
    name: "Evaluated result sheet",
    note: "All verified results, grades and percentiles",
  },
  {
    kind: "merit",
    name: "Merit list",
    note: "Competition ranks; equal scores share a rank",
  },
  {
    kind: "toppers",
    name: "Top performers",
    note: "First ten evaluated records in rank order",
  },
  {
    kind: "class",
    name: "Class result sheet",
    note: "Use the class filter above to choose a cohort",
  },
  {
    kind: "subjects",
    name: "Subject performance",
    note: "Key-aware subject / section percentages",
  },
  {
    kind: "questions",
    name: "Question & option analysis",
    note: "Correct-response rate and measured option frequencies",
  },
  {
    kind: "performance",
    name: "Performance summary",
    note: "Real-record totals, mean, median and population deviation",
  },
  {
    kind: "errors",
    name: "Verification / scanning issues",
    note: "Flagged marks, identities and missing pages",
  },
] as const;
export type ReportKind = (typeof reportDefinitions)[number]["kind"];
export function reportRows(
  kind: ReportKind,
  exam: Exam,
  results: Result[],
): (string | number | boolean)[][] {
  if (kind === "questions")
    return [
      [
        "Question",
        "Correct",
        "Evaluated",
        "Correct %",
        "Blank",
        ..."ABCDE".slice(0, exam.optionCount || 4),
      ],
      ...questionStats(results, exam).map((q) => [
        q.number,
        q.correct,
        q.total,
        +q.percentage.toFixed(2),
        q.blank,
        ...q.counts.map((c) => c.count),
      ]),
    ];
  if (kind === "subjects")
    return [
      ["Subject", "Evaluated", "Average %"],
      ...subjectStats(results, exam).map((s) => [
        s.name,
        s.students.length,
        +s.average.toFixed(2),
      ]),
    ];
  if (kind === "errors")
    return [
      [
        "Student",
        "Roll",
        "Class",
        "Identity review",
        "Flagged questions",
        "Missing pages",
        "Engine",
      ],
      ...results
        .filter((r) => gradeResult(r, exam).needsReview)
        .map((r) => [
          r.name,
          r.roll,
          r.section,
          !!r.identityReview,
          r.flagged.map((q) => q + 1).join(", "),
          !!gradeResult(r, exam).missingPages,
          r.engine || "Imported / manual",
        ]),
    ];
  const ranked = rankings(results, exam);
  if (kind === "performance") {
    const g = getStats(results, exam),
      percentages = ranked.map((r) => r.percentage).sort((a, b) => a - b),
      mid = Math.floor(percentages.length / 2);
    const median = percentages.length
      ? percentages.length % 2
        ? percentages[mid]
        : (percentages[mid - 1] + percentages[mid]) / 2
      : 0;
    const sd = percentages.length
      ? Math.sqrt(
          percentages.reduce((n, p) => n + (p - g.average) ** 2, 0) /
            percentages.length,
        )
      : 0;
    return [
      ["Metric", "Value"],
      ["Submitted", g.total],
      ["Evaluated", g.evaluated],
      ["Review", g.review],
      ["Average %", g.average],
      ["Median %", median],
      ["Population standard deviation", sd],
      ["Pass rate %", g.passRate],
      ["Highest %", percentages.at(-1) || 0],
      ["Lowest %", percentages[0] || 0],
    ];
  }
  return [
    [
      "Rank",
      "Student",
      "Roll",
      "Class",
      "Score",
      "Maximum",
      "%",
      "Grade",
      "Status",
      "Percentile",
    ],
    ...(kind === "toppers" ? ranked.slice(0, 10) : ranked).map((r) => [
      r.rank,
      r.result.name,
      r.result.roll,
      r.result.section,
      r.score,
      r.grade.maximum,
      +r.percentage.toFixed(2),
      r.grade.grade,
      r.grade.status,
      +r.percentile.toFixed(2),
    ]),
  ];
}
const safeCell = (v: string | number | boolean) =>
  typeof v === "string" && /^\s*[=+@-]/.test(v) ? "'" + v : v;
export async function downloadTable(
  rows: (string | number | boolean)[][],
  title: string,
  filename: string,
  format: "csv" | "xlsx" | "pdf",
  workspace: Workspace,
) {
  const safe = rows.map((r) => r.map(safeCell));
  if (format === "csv") {
    await downloadFile(
      filename + ".csv",
      "\ufeff" +
        safe
          .map((r) =>
            r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
          )
          .join("\r\n"),
      "text/csv",
    );
    return;
  }
  if (format === "xlsx") {
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    book.creator = workspace.school;
    const sheet = book.addWorksheet("Report");
    sheet.addRows(safe);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF152B50" },
    };
    sheet.columns.forEach((c) => {
      c.width = 22;
    });
    await downloadFile(
      filename + ".xlsx",
      new Blob([(await book.xlsx.writeBuffer()) as BlobPart]),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    return;
  }
  const { makePDF } = await import("./documents"),
    { default: autoTable } = await import("jspdf-autotable");
  const doc = await makePDF(rows[0].length > 7 ? "landscape" : "portrait"),
    width = doc.internal.pageSize.getWidth(),
    font = doc.getFont().fontName;
  doc.setTextColor("#163055");
  doc.setFontSize(18);
  doc.text(workspace.school, 15, 20);
  doc.setFontSize(10);
  doc.text(title, 15, 30);
  const contact = [
    workspace.institutionSettings?.academicSession,
    workspace.institutionSettings?.contactEmail,
    workspace.institutionSettings?.contactPhone,
  ]
    .filter(Boolean)
    .join(" · ");
  doc.setFontSize(8);
  doc.text(contact, 15, 38);
  if (workspace.institutionSettings?.logo)
    doc.addImage(
      workspace.institutionSettings.logo,
      width - 45,
      9,
      28,
      20,
      undefined,
      "FAST",
    );
  autoTable(doc, {
    startY: 47,
    head: [safe[0]],
    body: safe
      .slice(1)
      .map((row) => row.map((v) => (typeof v === "boolean" ? String(v) : v))),
    styles: { font, fontSize: 7, cellPadding: 2.5 },
    headStyles: { fillColor: [21, 43, 80] },
    margin: { left: 15, right: 15, bottom: 18 },
    didDrawPage: () => {
      doc.setFontSize(7);
      doc.text(
        "OMR PRO · Confidential · Under-review sheets are excluded from merit and aggregates.",
        15,
        doc.internal.pageSize.getHeight() - 9,
      );
    },
  });
  await downloadFile(filename + ".pdf", doc.output("blob"));
}
