"""Google identities, verified public signup, one-use OAuth flows and Drive backups.

Revision ID: a37e42b5f901
Revises: 407c9088532a
"""

from alembic import op
import sqlalchemy as sa

revision = "a37e42b5f901"
down_revision = "407c9088532a"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("has_password", sa.Boolean(), server_default=sa.true(), nullable=False))
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(), nullable=True))
    op.add_column("sessions", sa.Column("auth_method", sa.String(16), server_default="password", nullable=False))
    op.add_column("sessions", sa.Column("created_at", sa.DateTime(), nullable=True))
    op.create_table(
        "pending_signups",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("email", sa.String(200), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("school_name", sa.String(120), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_pending_signups_expires_at", "pending_signups", ["expires_at"])
    op.create_table(
        "google_identities",
        sa.Column("subject", sa.String(255), primary_key=True),
        sa.Column(
            "user_id", sa.String(120), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
        ),
        sa.Column("email", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "google_oauth_flows",
        sa.Column("id", sa.String(120), primary_key=True),
        sa.Column("state_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("browser_hash", sa.String(64), nullable=True),
        sa.Column("nonce_hash", sa.String(64), nullable=False),
        sa.Column("verifier_encrypted", sa.Text(), nullable=False),
        sa.Column("intent", sa.String(16), nullable=False),
        sa.Column("client_mode", sa.String(10), nullable=False),
        sa.Column("app_id", sa.String(80), nullable=True),
        sa.Column("native_challenge", sa.String(64), nullable=True),
        sa.Column("user_id", sa.String(120), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("session_hash", sa.String(64), nullable=True),
        sa.Column("school_id", sa.String(120), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=True),
        sa.Column("extra", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("result_encrypted", sa.Text(), nullable=True),
        sa.Column("ticket_hash", sa.String(64), nullable=True, unique=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_google_oauth_flows_expires_at", "google_oauth_flows", ["expires_at"])
    op.create_table(
        "google_drive_connections",
        sa.Column("id", sa.String(120), primary_key=True),
        sa.Column("user_id", sa.String(120), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("school_id", sa.String(120), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("email", sa.String(200), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("credentials_encrypted", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "school_id", "subject", name="drive_connection_subject_unique"),
    )
    op.create_index("ix_google_drive_connections_user_id", "google_drive_connections", ["user_id"])
    op.create_index("ix_google_drive_connections_school_id", "google_drive_connections", ["school_id"])
    op.create_index(
        "uq_active_drive_connection",
        "google_drive_connections",
        ["user_id", "school_id"],
        unique=True,
        sqlite_where=sa.text("active = true"),
        postgresql_where=sa.text("active = true"),
    )
    op.create_table(
        "google_drive_backups",
        sa.Column("id", sa.String(120), primary_key=True),
        sa.Column("connection_id", sa.String(120), sa.ForeignKey("google_drive_connections.id"), nullable=False),
        sa.Column("operation_id", sa.String(120), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(500), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("file_id", sa.String(200), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("error", sa.String(500), nullable=False),
        sa.Column("lease_token", sa.String(64), nullable=True),
        sa.Column("lease_until", sa.DateTime(), nullable=True),
        sa.Column("recovery_id", sa.String(120), sa.ForeignKey("recovery_points.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("connection_id", "operation_id", name="drive_backup_operation_unique"),
    )
    op.create_index("ix_google_drive_backups_connection_id", "google_drive_backups", ["connection_id"])


def downgrade():
    # Destructive downgrade is an explicit operator action; never run on live data.
    op.drop_table("google_drive_backups")
    op.drop_table("google_drive_connections")
    op.drop_table("google_oauth_flows")
    op.drop_table("google_identities")
    op.drop_table("pending_signups")
    with op.batch_alter_table("sessions") as batch:
        batch.drop_column("created_at")
        batch.drop_column("auth_method")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("email_verified_at")
        batch.drop_column("has_password")
