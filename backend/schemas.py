from __future__ import annotations

import base64
import re
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from .geometry import default_layout, valid_answer, valid_selection, validate_geometry

Identifier = Annotated[str, Field(min_length=1, max_length=120)]
Label = Annotated[str, Field(min_length=1, max_length=120)]
Option = Annotated[str, Field(pattern=r"^(?:[A-E]|[0-9]{3})$")]


class Document(BaseModel):
    model_config = ConfigDict(extra="allow", allow_inf_nan=False, str_strip_whitespace=False)


def raster(value, limit):
    if value is not None:
        if len(value) > limit or not re.fullmatch(r"data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}", value):
            raise ValueError("Use a bounded embedded PNG, JPEG or WebP image, not a remote URL or SVG.")
        try:
            base64.b64decode(value.split(",", 1)[1], validate=True)
        except ValueError as exc:
            raise ValueError("Invalid image data.") from exc
    return value


class Point(Document):
    x: float = Field(ge=0, le=1240)
    y: float = Field(ge=0, le=1754)


class Region(Point):
    width: float = Field(gt=0, le=1240)
    height: float = Field(gt=0, le=1754)

    @model_validator(mode="after")
    def bounds(self):
        if self.x + self.width > 1240 or self.y + self.height > 1754:
            raise ValueError("Keep fields and OCR regions inside the page.")
        return self


class SheetField(Region):
    id: Identifier
    type: Literal["text", "student", "roll", "qr", "line", "logo", "registration"]
    text: str = Field(max_length=2000)
    fontSize: float = Field(gt=0, le=120)
    bold: bool
    visible: bool
    image: str | None = None

    @model_validator(mode="after")
    def image_data(self):
        raster(self.image, 500000)
        if self.visible and self.type == "logo" and not self.image:
            raise ValueError("Upload an image for each visible logo field.")
        return self


class QuestionRegion(Document):
    question: int = Field(ge=0, le=499)
    radius: float = Field(ge=5, le=25)
    points: list[Point] = Field(min_length=2, max_length=30)


class Layout(Document):
    version: Literal[2]
    name: Label
    questionsPerPage: int = Field(ge=1, le=100)
    columns: int = Field(ge=1, le=5)
    startX: float = Field(ge=0, le=1240)
    startY: float = Field(ge=0, le=1754)
    columnGap: float = Field(gt=0, le=1240)
    rowGap: float = Field(gt=0, le=1754)
    optionGap: float = Field(gt=0, le=400)
    radius: float = Field(ge=5, le=25)
    labelOffset: float = Field(ge=0, le=500)
    bubbleShape: Literal["circle", "square"]
    threshold: float = Field(ge=0.15, le=0.95)
    anchorMode: Literal["markers", "page", "fiducials"]
    questionRegions: list[QuestionRegion] | None = Field(default=None, max_length=500)
    anchors: list[Point] = Field(min_length=4, max_length=4)
    fields: list[SheetField] = Field(max_length=40)
    referenceImage: str | None = None
    ocrEnabled: bool | None = None
    rollRegion: Region
    pageWidthMM: float = Field(default=210, ge=90, le=420)
    pageHeightMM: float = Field(default=297, ge=120, le=594)

    @model_validator(mode="after")
    def geometry(self):
        raster(self.referenceImage, 2000000)
        if not 0.5 <= self.pageWidthMM / self.pageHeightMM <= 1:
            raise ValueError("Use a portrait page with width/height between 0.5 and 1.")
        if not self.questionRegions and (self.rowGap < self.radius * 2 + 2 or self.optionGap < self.radius * 2 + 2):
            raise ValueError("Layout bubbles overlap.")
        if len({f.id for f in self.fields}) != len(self.fields):
            raise ValueError("Layout field IDs must be unique.")
        if self.anchorMode in ("markers", "fiducials"):
            for i, p in enumerate(self.anchors):
                if not (17 <= p.x <= 1223 and 17 <= p.y <= 1737):
                    raise ValueError("Keep registration squares fully inside the page.")
                if (p.x > 1240 * 0.24 if i in (0, 3) else p.x < 1240 * 0.76) or (
                    p.y > 1754 * 0.24 if i < 2 else p.y < 1754 * 0.76
                ):
                    raise ValueError("Order registration points in the four outer corners: TL, TR, BR, BL.")
        return self


class School(Document):
    id: Identifier
    name: Label
    code: str = Field(min_length=1, max_length=30)
    address: str = Field(default="", max_length=500)


class Classroom(Document):
    id: Identifier
    schoolId: Identifier
    name: Label
    academicYear: str = Field(max_length=30)


class Student(Document):
    id: Identifier
    schoolId: Identifier
    classId: Identifier | None = None
    section: Label
    name: Label
    roll: str = Field(min_length=1, max_length=40)
    registeredAt: str = Field(max_length=40)
    email: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=40)
    guardian: str = Field(default="", max_length=120)
    batch: str = Field(default="", max_length=80)
    photo: str | None = None

    @model_validator(mode="after")
    def valid_student(self):
        if not self.name.strip() or not self.roll.strip():
            raise ValueError("Student name and roll are required.")
        raster(self.photo, 300000)
        return self


class SubjectRange(Document):
    name: Label
    from_: int = Field(alias="from", ge=1, le=500)
    to: int = Field(ge=1, le=500)


class GradeBand(Document):
    name: str = Field(min_length=1, max_length=20)
    min: float = Field(ge=0, le=100)


class MarkingRules(Document):
    version: int = Field(default=1, ge=1)
    partialMarks: float = Field(default=0, ge=0, le=100)
    unansweredMarks: float = Field(default=0, ge=-100, le=100)
    multiplePolicy: Literal["review", "wrong", "partial", "exact"] = "review"
    floorZero: bool = True
    grades: list[GradeBand] = Field(
        default_factory=lambda: [
            GradeBand(name="A+", min=90),
            GradeBand(name="A", min=80),
            GradeBand(name="B", min=60),
            GradeBand(name="C", min=40),
            GradeBand(name="F", min=0),
        ],
        min_length=1,
        max_length=20,
    )


class QuestionSet(Document):
    code: str = Field(min_length=1, max_length=20)
    answers: list[list[Option] | None] = Field(min_length=1, max_length=500)


class Exam(Document):
    id: Identifier
    schoolId: Identifier
    title: Label
    code: str = Field(default="", max_length=60)
    subject: Label
    date: str
    questions: int = Field(ge=1, le=500)
    optionCount: Literal[2, 3, 4, 5] = 4
    questionTypes: list[Literal["choice", "integer3"]] | None = Field(default=None, min_length=1, max_length=500)
    marksCorrect: float = Field(gt=0, le=100)
    negativeMarks: float = Field(ge=0, le=100)
    passPercentage: float = Field(ge=1, le=100)
    answers: list[Option | None] = Field(min_length=1, max_length=500)
    published: bool
    resultsPublished: bool = False
    duration: int = Field(default=60, ge=1, le=1440)
    classIds: list[Identifier] = Field(default_factory=list, max_length=500)
    batch: str = Field(default="", max_length=80)
    subjects: list[SubjectRange] = Field(default_factory=list, max_length=30)
    layout: Layout | None = None
    markingRules: MarkingRules = Field(default_factory=MarkingRules)
    questionSets: list[QuestionSet] = Field(default_factory=list, max_length=26)

    @model_validator(mode="after")
    def valid_exam(self):
        try:
            if date.fromisoformat(self.date).isoformat() != self.date:
                raise ValueError()
        except ValueError as exc:
            raise ValueError("Use a valid YYYY-MM-DD examination date.") from exc
        if self.questionTypes is not None and len(self.questionTypes) != self.questions:
            raise ValueError("Question type count must match the examination.")
        payload = self.model_dump(mode="json", by_alias=True, exclude_none=True)
        if (
            len(self.answers) != self.questions
            or any(not valid_answer(payload, q, a) for q, a in enumerate(self.answers))
            or (self.published and not all(self.answers))
        ):
            raise ValueError("Answer key length, completeness or option count is invalid.")
        if len({s.code.casefold() for s in self.questionSets}) != len(self.questionSets):
            raise ValueError("Question set codes must be unique.")
        for s in self.questionSets:
            if len(s.answers) != self.questions or any(
                a is not None and (not a or not valid_selection(payload, q, a)) for q, a in enumerate(s.answers)
            ):
                raise ValueError("Question set answers must match the examination's question and option counts.")
        covered = set()
        for s in self.subjects:
            if s.from_ > s.to or s.to > self.questions:
                raise ValueError("Subject question range is invalid.")
            for q in range(s.from_, s.to + 1):
                if q in covered:
                    raise ValueError("Subject question ranges overlap.")
                covered.add(q)
        if self.layout:
            layout = self.layout
            if (
                not layout.questionRegions
                and layout.columns > 1
                and layout.columnGap
                < (self.optionCount - 1) * layout.optionGap + 2 * layout.radius + layout.labelOffset + 10
            ):
                raise ValueError("Question columns overlap.")
            rows = -(-layout.questionsPerPage // layout.columns)
            for q in range(
                0
                if layout.questionRegions or self.questionTypes and "integer3" in self.questionTypes
                else min(self.questions, layout.questionsPerPage)
            ):
                x, y = layout.startX + (q // rows) * layout.columnGap, layout.startY + (q % rows) * layout.rowGap
                if (
                    x - layout.labelOffset < 25
                    or x - layout.radius < 25
                    or x + (self.optionCount - 1) * layout.optionGap + layout.radius > 1215
                    or y - layout.radius < 25
                    or y + layout.radius > 1684
                ):
                    raise ValueError("Bubble grid extends outside the printable page.")
        if self.layout or self.questionTypes and "integer3" in self.questionTypes:
            validate_geometry(payload)
        return self


class Detection(Document):
    question: int = Field(ge=0, le=499)
    selected: list[Option] = Field(max_length=5)
    status: Literal["blank", "filled", "partial", "erased", "multiple", "uncertain", "invalid", "manual"]
    confidence: float | None = Field(default=None, ge=0, le=100)
    coordinates: list[dict] = Field(default_factory=list, max_length=30)
    verified: bool = False


class SourceTransform(Document):
    objectId: Identifier
    pageIndex: int = Field(ge=0, le=499)
    sourceToAligned: list[list[float]] = Field(min_length=3, max_length=3)

    @model_validator(mode="after")
    def valid_matrix(self):
        import math

        if any(len(row) != 3 or any(not math.isfinite(v) or abs(v) > 1e8 for v in row) for row in self.sourceToAligned):
            raise ValueError("Invalid original-image coordinate transform.")
        return self


class Result(Document):
    id: Identifier
    studentId: Identifier
    name: Label
    roll: str = Field(min_length=1, max_length=40)
    section: Label
    examId: Identifier
    answers: list[Option | None] = Field(min_length=1, max_length=500)
    flagged: list[int] = Field(max_length=500)
    confirmed: bool
    createdAt: str = Field(max_length=40)
    source: Literal["demo", "scan"]
    pageIndices: list[int] | None = None
    pageTotal: int | None = Field(default=None, ge=1, le=500)
    identityReview: bool = False
    missingPagesAccepted: bool = False
    layoutSignature: str | None = Field(default=None, pattern=r"^[a-f0-9]{8}$")
    engine: Literal["opencv", "canvas", "opencv-python"] | None = None
    scanConfidence: float | None = Field(default=None, ge=0, le=100)
    questionSet: str = Field(default="A", min_length=1, max_length=20)
    detectedOptions: list[list[Option]] | None = Field(default=None, max_length=500)
    answerMeta: list[Detection] = Field(default_factory=list, max_length=500)
    scanIds: list[Identifier] = Field(default_factory=list, max_length=500)
    sourceTransforms: list[SourceTransform] = Field(default_factory=list, max_length=500)


class Workspace(Document):
    version: Literal[1]
    school: Label
    teacher: Label
    schools: list[School] = Field(min_length=1, max_length=1)
    activeSchoolId: Identifier
    classes: list[Classroom] = Field(default_factory=list, max_length=500)
    students: list[Student] = Field(default_factory=list, max_length=20000)
    exams: list[Exam] = Field(default_factory=list, max_length=5000)
    results: list[Result] = Field(default_factory=list, max_length=50000)

    @model_validator(mode="after")
    def coherent(self):
        if self.schools[0].id != self.activeSchoolId or any(
            x.schoolId != self.activeSchoolId for xs in (self.classes, self.students, self.exams) for x in xs
        ):
            raise ValueError("Every workspace record must belong to this school.")
        for xs in (self.classes, self.students, self.exams, self.results):
            if len({x.id for x in xs}) != len(xs):
                raise ValueError("Duplicate record identifiers.")
        if len({s.roll.strip().casefold() for s in self.students}) != len(self.students):
            raise ValueError("Roll numbers must be unique in a school.")
        class_ids = {c.id for c in self.classes}
        if any(s.classId and s.classId not in class_ids for s in self.students):
            raise ValueError("Student class reference is invalid.")
        keys = set()
        exams = {e.id: e for e in self.exams}
        contexts = {
            e.id: {"questions": e.questions, "optionCount": e.optionCount, "questionTypes": e.questionTypes}
            for e in self.exams
        }
        for r in self.results:
            context = contexts.get(r.examId, {})
            e = exams.get(r.examId)
            if (
                not e
                or len(r.answers) != e.questions
                or any(not valid_answer(context, q, a) for q, a in enumerate(r.answers))
                or any(q < 0 or q >= e.questions for q in r.flagged)
            ):
                raise ValueError("Result question or examination reference is invalid.")
            if (r.examId, r.studentId) in keys:
                raise ValueError("A student can have only one active result per examination.")
            keys.add((r.examId, r.studentId))
            if r.pageIndices is not None and (
                len(set(r.pageIndices)) != len(r.pageIndices)
                or any(
                    p < 0
                    or p
                    >= (
                        r.pageTotal
                        or -(
                            -e.questions
                            // (
                                e.layout.questionsPerPage
                                if e.layout
                                else default_layout(e.model_dump(exclude_none=True))["questionsPerPage"]
                            )
                        )
                    )
                    for p in r.pageIndices
                )
            ):
                raise ValueError("Invalid or duplicate scan page numbers.")
            if r.detectedOptions is not None and (
                len(r.detectedOptions) != e.questions
                or any(not valid_selection(context, q, a) for q, a in enumerate(r.detectedOptions))
            ):
                raise ValueError("Invalid multi-answer response data.")
            if r.detectedOptions is not None and any(
                a != (selected[0] if len(selected) == 1 else None)
                for a, selected in zip(r.answers, r.detectedOptions, strict=True)
            ):
                raise ValueError(
                    "Scalar responses and selected-option evidence disagree. Verify the correction explicitly."
                )
            if any(
                not valid_selection(context, a.question, a.selected)
                or (r.detectedOptions is not None and a.selected != r.detectedOptions[a.question])
                for a in r.answerMeta
                if a.question < e.questions
            ):
                raise ValueError("Answer evidence must match the selected response and available options.")
            if any(t.objectId not in r.scanIds for t in r.sourceTransforms):
                raise ValueError("A page transform must refer to a linked original image.")
            if len({a.question for a in r.answerMeta}) != len(r.answerMeta) or any(
                a.question >= e.questions for a in r.answerMeta
            ):
                raise ValueError("Invalid answer detection metadata.")
        return self


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class SchoolInput(BaseModel):
    name: Label
    code: str = Field(default="SCH", min_length=1, max_length=30)
    address: str = Field(default="", max_length=500)


class Setup(Credentials):
    name: Label
    school: SchoolInput
    setupToken: str = Field(default="", max_length=500)


class MemberInput(Credentials):
    name: Label
    role: Literal["admin", "teacher", "student"]
    classIds: list[Identifier] = Field(default_factory=list, max_length=500)
    studentId: Identifier | None = None
    permissions: dict[str, bool] = Field(default_factory=lambda: {"createExams": True, "scan": True, "reports": True})


class WorkspaceWrite(BaseModel):
    workspace: Workspace
    revision: int = Field(ge=1)
    operationId: str | None = Field(default=None, min_length=8, max_length=120)
