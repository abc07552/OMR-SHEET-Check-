from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
    true,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def uid():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class School(Base):
    __tablename__ = "schools"
    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    code: Mapped[str] = mapped_column(String(30))
    address: Mapped[str] = mapped_column(String(500), default="")
    teacher: Mapped[str] = mapped_column(String(120), default="Educator")
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(Text)
    has_password: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    super_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Membership(Base):
    __tablename__ = "memberships"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    school_id: Mapped[str] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(String(20))
    class_ids: Mapped[list] = mapped_column(JSON, default=list)
    student_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    permissions: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (
        CheckConstraint("role IN ('admin','teacher','student')", name="membership_role"),
        ForeignKeyConstraint(["school_id", "student_id"], ["students.school_id", "students.id"]),
    )


class Session(Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    auth_method: Mapped[str] = mapped_column(String(16), default="password", server_default="password")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=now, nullable=True)


class PasswordReset(Base):
    __tablename__ = "password_resets"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class Classroom(Base):
    __tablename__ = "classes"
    school_id: Mapped[str] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    academic_year: Mapped[str] = mapped_column(String(30), default="")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class Subject(Base):
    __tablename__ = "subjects"
    school_id: Mapped[str] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    code: Mapped[str] = mapped_column(String(30), default="")
    __table_args__ = (UniqueConstraint("school_id", "name", name="subject_name_unique"),)


class Student(Base):
    __tablename__ = "students"
    school_id: Mapped[str] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    class_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    roll: Mapped[str] = mapped_column(String(40))
    roll_key: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (
        ForeignKeyConstraint(["school_id", "class_id"], ["classes.school_id", "classes.id"]),
        Index(
            "uq_active_student_roll",
            "school_id",
            "roll_key",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class Examination(Base):
    __tablename__ = "examinations"
    school_id: Mapped[str] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    code: Mapped[str] = mapped_column(String(60), default="")
    date: Mapped[str] = mapped_column(String(10), index=True)
    subject: Mapped[str] = mapped_column(String(120))
    questions: Mapped[int] = mapped_column(Integer)
    class_ids: Mapped[list] = mapped_column(JSON, default=list)
    key_version: Mapped[int] = mapped_column(Integer, default=1)
    results_published: Mapped[bool] = mapped_column(Boolean, default=False)
    payload: Mapped[dict] = mapped_column(JSON)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Template(Base):
    __tablename__ = "templates"
    school_id: Mapped[str] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    geometry: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class TemplateVersion(Base):
    __tablename__ = "template_versions"
    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=uid)
    school_id: Mapped[str] = mapped_column(String(120))
    template_id: Mapped[str] = mapped_column(String(120))
    version: Mapped[int] = mapped_column(Integer)
    geometry: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    __table_args__ = (
        ForeignKeyConstraint(["school_id", "template_id"], ["templates.school_id", "templates.id"], ondelete="CASCADE"),
        UniqueConstraint("school_id", "template_id", "version", name="template_version_unique"),
    )


class ResultRecord(Base):
    __tablename__ = "results"
    school_id: Mapped[str] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    exam_id: Mapped[str] = mapped_column(String(120), index=True)
    student_key: Mapped[str] = mapped_column(String(120))
    student_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON)
    score: Mapped[float] = mapped_column(Float, default=0)
    percentage: Mapped[float] = mapped_column(Float, default=0)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (
        ForeignKeyConstraint(["school_id", "exam_id"], ["examinations.school_id", "examinations.id"]),
        ForeignKeyConstraint(["school_id", "student_ref"], ["students.school_id", "students.id"]),
        Index(
            "uq_active_result_student_exam",
            "school_id",
            "exam_id",
            "student_key",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class AnswerDetection(Base):
    __tablename__ = "answer_detections"
    school_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    result_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    question: Mapped[int] = mapped_column(Integer, primary_key=True)
    selected: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(30))
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    coordinates: Mapped[list] = mapped_column(JSON, default=list)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (
        ForeignKeyConstraint(["school_id", "result_id"], ["results.school_id", "results.id"], ondelete="CASCADE"),
    )


class Evaluation(Base):
    __tablename__ = "evaluations"
    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=uid)
    school_id: Mapped[str] = mapped_column(String(120), index=True)
    result_id: Mapped[str] = mapped_column(String(120))
    key_version: Mapped[int] = mapped_column(Integer)
    rule_version: Mapped[str] = mapped_column(String(64))
    fingerprint: Mapped[str] = mapped_column(String(64))
    answers: Mapped[dict] = mapped_column(JSON)
    marking_rules: Mapped[dict] = mapped_column(JSON)
    outcome: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    __table_args__ = (
        ForeignKeyConstraint(["school_id", "result_id"], ["results.school_id", "results.id"], ondelete="CASCADE"),
    )


class Operation(Base):
    __tablename__ = "operations"
    school_id: Mapped[str] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    request_hash: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class Audit(Base):
    __tablename__ = "audit"
    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=uid)
    school_id: Mapped[str | None] = mapped_column(ForeignKey("schools.id"), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(500))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class StoredObject(Base):
    __tablename__ = "stored_objects"
    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=uid)
    school_id: Mapped[str] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    key: Mapped[str] = mapped_column(String(500), unique=True)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    media_type: Mapped[str] = mapped_column(String(80))
    size: Mapped[int] = mapped_column(Integer)
    purpose: Mapped[str] = mapped_column(String(40), default="scan")
    exam_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    student_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class RecoveryPoint(Base):
    __tablename__ = "recovery_points"
    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=uid)
    school_id: Mapped[str] = mapped_column(ForeignKey("schools.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    key: Mapped[str] = mapped_column(String(500))
    automatic: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ScanBatch(Base):
    __tablename__ = "scan_batches"
    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=uid)
    school_id: Mapped[str] = mapped_column(ForeignKey("schools.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    exam_id: Mapped[str] = mapped_column(String(120))
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ScanJob(Base):
    __tablename__ = "scan_jobs"
    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=uid)
    batch_id: Mapped[str] = mapped_column(ForeignKey("scan_batches.id", ondelete="CASCADE"), index=True)
    object_id: Mapped[str] = mapped_column(ForeignKey("stored_objects.id"))
    operation_id: Mapped[str] = mapped_column(String(120), unique=True)
    sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    output: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(String(1000), default="")
    error_category: Mapped[str] = mapped_column(String(40), default="")
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    __table_args__ = (UniqueConstraint("batch_id", "sha256", name="unique_batch_image"),)


class RateBucket(Base):
    __tablename__ = "rate_buckets"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=1)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class SystemState(Base):
    __tablename__ = "system_state"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class PendingSignup(Base):
    __tablename__ = "pending_signups"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    school_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class GoogleIdentity(Base):
    __tablename__ = "google_identities"
    subject: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    email: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class GoogleOAuthFlow(Base):
    __tablename__ = "google_oauth_flows"
    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=uid)
    state_hash: Mapped[str] = mapped_column(String(64), unique=True)
    browser_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    nonce_hash: Mapped[str] = mapped_column(String(64))
    verifier_encrypted: Mapped[str] = mapped_column(Text)
    intent: Mapped[str] = mapped_column(String(16))
    client_mode: Mapped[str] = mapped_column(String(10))
    app_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    native_challenge: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    session_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    school_id: Mapped[str | None] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), nullable=True)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    result_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    ticket_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class GoogleDriveConnection(Base):
    __tablename__ = "google_drive_connections"
    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    school_id: Mapped[str] = mapped_column(ForeignKey("schools.id", ondelete="CASCADE"), index=True)
    subject: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    credentials_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    __table_args__ = (
        UniqueConstraint("user_id", "school_id", "subject", name="drive_connection_subject_unique"),
        Index(
            "uq_active_drive_connection",
            "user_id",
            "school_id",
            unique=True,
            sqlite_where=text("active = true"),
            postgresql_where=text("active = true"),
        ),
    )


class GoogleDriveBackup(Base):
    __tablename__ = "google_drive_backups"
    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=uid)
    connection_id: Mapped[str] = mapped_column(ForeignKey("google_drive_connections.id"), index=True)
    operation_id: Mapped[str] = mapped_column(String(120))
    revision: Mapped[int] = mapped_column(Integer)
    key: Mapped[str] = mapped_column(String(500))
    sha256: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer)
    file_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    error: Mapped[str] = mapped_column(String(500), default="")
    lease_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    recovery_id: Mapped[str | None] = mapped_column(ForeignKey("recovery_points.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (UniqueConstraint("connection_id", "operation_id", name="drive_backup_operation_unique"),)
