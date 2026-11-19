from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env", override=False)


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", ROOT / ".data")).resolve())
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", ""))
    environment: str = field(default_factory=lambda: os.getenv("APP_ENV", "development"))
    setup_token: str = field(default_factory=lambda: os.getenv("SETUP_TOKEN", ""))
    web_origin: str = field(default_factory=lambda: os.getenv("PUBLIC_WEB_ORIGIN", "").rstrip("/"))
    backup_key: str = field(default_factory=lambda: os.getenv("BACKUP_KEY", ""))
    static_dir: Path = field(default_factory=lambda: Path(os.getenv("STATIC_DIR", ROOT / "dist")).resolve())
    smtp_host: str = field(default_factory=lambda: os.getenv("SMTP_HOST", ""))
    smtp_port: int = field(default_factory=lambda: int(os.getenv("SMTP_PORT", "587")))
    smtp_user: str = field(default_factory=lambda: os.getenv("SMTP_USER", ""))
    smtp_password: str = field(default_factory=lambda: os.getenv("SMTP_PASSWORD", ""))
    smtp_from: str = field(default_factory=lambda: os.getenv("SMTP_FROM", ""))
    public_url: str = field(default_factory=lambda: os.getenv("PUBLIC_APP_URL", ""))
    s3_bucket: str = field(default_factory=lambda: os.getenv("S3_BUCKET", ""))
    s3_endpoint: str | None = field(default_factory=lambda: os.getenv("S3_ENDPOINT_URL") or None)
    s3_region: str = field(default_factory=lambda: os.getenv("AWS_REGION", "ap-south-1"))
    auto_migrate: bool = field(default_factory=lambda: os.getenv("AUTO_MIGRATE", "true").lower() == "true")
    testing: bool = False
    public_signup: bool = field(default_factory=lambda: os.getenv("PUBLIC_SIGNUP_ENABLED", "false").lower() == "true")
    google_client_id: str = field(default_factory=lambda: os.getenv("GOOGLE_CLIENT_ID", ""))
    google_client_secret: str = field(default_factory=lambda: os.getenv("GOOGLE_CLIENT_SECRET", ""))

    def __post_init__(self):
        self.data_dir = Path(self.data_dir).resolve()
        if not self.database_url:
            self.database_url = f"sqlite:///{self.data_dir / 'enterprise.sqlite'}"
        if self.database_url.startswith("postgres://"):
            self.database_url = self.database_url.replace("postgres://", "postgresql+psycopg://", 1)
        elif self.database_url.startswith("postgresql://"):
            self.database_url = self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        if self.production and not self.testing:
            if not self.database_url.startswith("postgresql+"):
                raise ValueError("Production requires DATABASE_URL pointing to PostgreSQL.")
            if not self.backup_key or not self.public_url.startswith("https://"):
                raise ValueError("Production requires BACKUP_KEY and an HTTPS PUBLIC_APP_URL.")

    @property
    def production(self):
        return self.environment == "production"
