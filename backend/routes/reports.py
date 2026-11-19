from __future__ import annotations

import base64
import csv
import io
from html import escape

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from reportlab.lib import colors, pagesizes
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image as ReportImage
from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer, TableStyle
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from ..config import ROOT
from ..scoring import analytics, evaluate
from ..security import allowed_exam, allowed_student, audit, current_user, db_session, membership
from ..workspaces import load_workspace

router = APIRouter(prefix="/api")
FONT = ROOT / "public/fonts/NotoSans-Regular.ttf"
if FONT.exists():
    pdfmetrics.registerFont(TTFont("NotoOMR", str(FONT)))


def safe_cell(value):
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + value
    return value


def render_report(rows, title, school, format):
    safe = [[safe_cell(x) for x in row] for row in rows]
    if format == "csv":
        stream = io.StringIO(newline="")
        csv.writer(stream, lineterminator="\r\n").writerows(safe)
        return ("\ufeff" + stream.getvalue()).encode(), "text/csv; charset=utf-8"
    if format == "xlsx":
        book = Workbook()
        sheet = book.active
        sheet.title = "Report"
        for row in safe:
            sheet.append(row)
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for cell in sheet[1]:
            cell.fill, cell.font = PatternFill("solid", fgColor="152B50"), Font(color="FFFFFF", bold=True)
        for cells in sheet.columns:
            sheet.column_dimensions[cells[0].column_letter].width = min(
                44, max(14, max(len(str(c.value or "")) for c in cells[:100]) + 2)
            )
        output = io.BytesIO()
        book.save(output)
        return output.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    if format == "pdf":
        output = io.BytesIO()
        page = pagesizes.landscape(pagesizes.A4) if len(rows[0]) > 7 else pagesizes.A4
        doc = SimpleDocTemplate(
            output,
            pagesize=page,
            leftMargin=30,
            rightMargin=30,
            topMargin=34,
            bottomMargin=35,
            title=title,
            author=school.name,
        )
        styles = getSampleStyleSheet()
        font = "NotoOMR" if FONT.exists() else "Helvetica"
        for style in styles.byName.values():
            style.fontName = font
        styles["Normal"].fontSize, styles["Normal"].leading = 8, 11
        available = page[0] - 60
        data = [[Paragraph(escape(str(x if x is not None else "")), styles["Normal"]) for x in row] for row in rows]
        table = LongTable(data, colWidths=[available / len(rows[0])] * len(rows[0]), repeatRows=1, hAlign="LEFT")
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dce8fb")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f7fb")]),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                ]
            )
        )

        def footer(canvas, document):
            canvas.setFont(font, 8)
            canvas.setFillColor(colors.HexColor("#526783"))
            canvas.drawString(30, 18, f"{school.name} · Confidential assessment report")
            canvas.drawRightString(page[0] - 30, 18, f"Page {document.page}")

        doc.build(
            [
                *(
                    [
                        ReportImage(
                            io.BytesIO(base64.b64decode(school.settings["logo"].split(",", 1)[1])),
                            width=90,
                            height=45,
                            kind="proportional",
                        )
                    ]
                    if school.settings.get("logo")
                    else []
                ),
                Paragraph(escape(school.name), styles["Title"]),
                Paragraph(escape(school.address or ""), styles["Normal"]),
                Paragraph(
                    escape(
                        " · ".join(
                            str(school.settings.get(k, ""))
                            for k in ("academicSession", "contactEmail", "contactPhone")
                            if school.settings.get(k)
                        )
                    ),
                    styles["Normal"],
                ),
                Spacer(1, 12),
                Paragraph(escape(title), styles["Heading2"]),
                Paragraph(
                    "Generated "
                    + m.now().strftime("%Y-%m-%d %H:%M UTC")
                    + " · Only evaluated records enter merit and aggregate reports.",
                    styles["Normal"],
                ),
                Spacer(1, 14),
                table,
            ],
            onFirstPage=footer,
            onLaterPages=footer,
        )
        return output.getvalue(), "application/pdf"
    raise HTTPException(400, "Choose csv, xlsx or pdf.")


@router.get("/schools/{school_id}/reports/{kind}")
def report(
    school_id: str,
    kind: str,
    examId: str,
    format: str = Query(default="pdf", pattern="^(csv|xlsx|pdf)$"),
    resultId: str | None = None,
    section: str | None = Query(default=None, max_length=120),
    user: m.User = Depends(current_user),
    db: Session = Depends(db_session),
):
    member = membership(db, user, school_id)
    school = db.get(m.School, school_id)
    exam = db.get(m.Examination, (school_id, examId))
    if not exam or exam.deleted_at:
        raise HTTPException(404, "Examination not found.")
    if member.role == "student":
        if kind != "student" or not resultId:
            raise HTTPException(403, "Students can download only their own published report cards.")
        result = db.get(m.ResultRecord, (school_id, resultId))
        if not result or result.deleted_at or result.exam_id != examId:
            raise HTTPException(404, "Result not found.")
        allowed_student(db, school_id, member, result.student_ref or "")
        if not exam.results_published or result.needs_review:
            raise HTTPException(403, "This result is not published.")
        records = [result.payload]
    else:
        membership(db, user, school_id, "staff", "reports")
        allowed_exam(db, school_id, member, examId)
        records = [r for r in load_workspace(db, school_id, member)["results"] if r["examId"] == examId]
    if section:
        records = [r for r in records if r["section"] == section]
    summary = analytics(records, exam.payload)
    title = f"{exam.title} — {kind.replace('-', ' ').title()}"
    if kind in ("results", "merit", "toppers", "class"):
        rows = [["Rank", "Student", "Roll", "Class", "Score", "Maximum", "%", "Grade", "Status", "Percentile"]]
        ranked = summary["rankings"][:10] if kind == "toppers" else summary["rankings"]
        for r in ranked:
            rows.append(
                [
                    r["rank"],
                    r["name"],
                    r["roll"],
                    r["section"],
                    r["score"],
                    r["maximum"],
                    round(r["percentage"], 2),
                    r["grade"],
                    r["status"],
                    round(r["percentile"], 2),
                ]
            )
    elif kind == "questions":
        rows = [
            [
                "Question",
                "Correct",
                "Evaluated",
                "Correct %",
                "Blank",
                *list("ABCDE"[: exam.payload.get("optionCount", 4)]),
            ]
        ]
        for q in summary["questions"]:
            rows.append(
                [q["question"], q["correct"], q["total"], round(q["difficulty"], 2), q["blank"], *q["options"].values()]
            )
    elif kind == "subjects":
        rows = [["Subject", "Evaluated", "Average %"]]
        groups = {}
        for r in summary["rankings"]:
            for s in r["subjects"]:
                groups.setdefault(s["name"], []).append(s["percentage"])
        for name, values in groups.items():
            rows.append([name, len(values), round(sum(values) / len(values), 2)])
    elif kind == "errors":
        rows = [["Student", "Roll", "Class", "Identity review", "Flagged questions", "Missing pages", "Engine"]]
        for r in records:
            g = evaluate(r, exam.payload)
            if g["needsReview"]:
                rows.append(
                    [
                        r["name"],
                        r["roll"],
                        r["section"],
                        bool(r.get("identityReview")),
                        ", ".join(str(i + 1) for i in r["flagged"]),
                        g["missingPages"],
                        r.get("engine", ""),
                    ]
                )
    elif kind == "performance":
        rows = [["Metric", "Value"]] + [
            [k, round(v, 3) if isinstance(v, float) else v] for k, v in summary.items() if isinstance(v, (int, float))
        ]
    elif kind == "student":
        r = next((r for r in records if r["id"] == resultId), None)
        if not r:
            raise HTTPException(404, "Student result is outside your authorized records.")
        g = evaluate(r, exam.payload)
        title = f"{r['name']} · Roll {r['roll']} · {exam.title} · {g['score']}/{g['maximum']} · {g['status']}"
        rows = [["Question", "Selected", "Correct answer", "Status", "Marks"]]
        rows.extend(
            [
                [q["question"], ", ".join(q["selected"]) or "—", ", ".join(q["expected"]), q["status"], q["marks"]]
                for q in g["questions"]
            ]
        )
    else:
        raise HTTPException(404, "Unknown report type.")
    content, media = render_report(rows, title, school, format)
    audit(db, school_id, user.id, "Exported assessment report", kind=kind, examId=examId, format=format)
    db.commit()
    return Response(
        content,
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="omr-{kind}.{format}"',
            "Cache-Control": "private, no-store",
        },
    )


@router.get("/schools/{school_id}/templates/{template_id}/versions")
def template_history(
    school_id: str, template_id: str, user: m.User = Depends(current_user), db: Session = Depends(db_session)
):
    member = membership(db, user, school_id, "staff")
    allowed_exam(db, school_id, member, template_id)
    versions = db.scalars(
        select(m.TemplateVersion)
        .where(m.TemplateVersion.school_id == school_id, m.TemplateVersion.template_id == template_id)
        .order_by(m.TemplateVersion.version.desc())
        .limit(100)
    )
    return {
        "versions": [
            {"version": v.version, "geometry": v.geometry, "createdAt": v.created_at.isoformat() + "Z"}
            for v in versions
        ]
    }
