from __future__ import annotations

import re
import shlex
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from backend.config import Settings
from backend.db import engine_for, migrate, require_current_schema
from backend.main import create_app
from backend.tests.conftest import PASSWORD


def test_explicit_migration_mode_refuses_empty_or_stale_schema_without_schema_changes(tmp_path):
    settings = Settings(data_dir=tmp_path, auto_migrate=False, testing=True)
    with pytest.raises(RuntimeError, match="alembic upgrade head"):
        create_app(settings)
    engine = engine_for(settings)
    try:
        migrate(engine, "568b4f7247ab")
        with pytest.raises(RuntimeError, match="pending or incompatible"):
            create_app(settings)
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "568b4f7247ab"
        migrate(engine)
        require_current_schema(engine)
        with TestClient(create_app(settings)) as client:
            assert client.get("/api/health").status_code == 200
    finally:
        engine.dispose()


def test_schema_guard_detects_mismatched_head_on_each_database_engine(app):
    require_current_schema(app.state.engine)
    with app.state.engine.begin() as connection:
        connection.execute(text("UPDATE alembic_version SET version_num='incompatible-head'"))
    with pytest.raises(RuntimeError, match="pending or incompatible"):
        create_app(replace(app.state.settings, auto_migrate=False))
    with app.state.engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "incompatible-head"


def test_production_cookie_bootstrap_origin_headers_and_minimal_public_health(app):
    settings = app.state.settings
    settings.environment = "production"
    settings.setup_token = "synthetic-bootstrap-secret-2026"
    settings.public_url = "https://school.example"
    headers = {"X-Markly-Request": "1", "Origin": settings.public_url}
    data = {
        "name": "Production Mode QA",
        "email": "production-qa@school.edu",
        "password": PASSWORD,
        "school": {"name": "Synthetic production-mode school"},
    }
    with TestClient(app, base_url=settings.public_url, headers=headers) as client:
        assert client.post("/api/setup", json=data).status_code == 403
        response = client.post("/api/setup", json=dict(data, setupToken=settings.setup_token))
        assert response.status_code == 201, response.text
        cookie = response.headers["set-cookie"]
        assert "Secure" in cookie and "HttpOnly" in cookie and "SameSite=strict" in cookie
        assert client.get("/api/auth/me").status_code == 200
        assert client.post("/api/auth/logout", headers={"Origin": "https://evil.example"}).status_code == 403
        response = client.get("/api/health")
        assert response.headers["strict-transport-security"].startswith("max-age=31536000")
        assert response.headers["x-frame-options"] == "SAMEORIGIN"
        assert "no-store" in response.headers["cache-control"]
        assert "frame-ancestors 'self'" in response.headers["content-security-policy"]
        assert settings.setup_token not in response.text and "DATABASE_URL" not in response.text
        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/auth/me").status_code == 401


def test_production_configuration_rejects_local_database_or_missing_https_and_key(tmp_path):
    with pytest.raises(ValueError, match="PostgreSQL"):
        Settings(data_dir=tmp_path, environment="production", database_url="sqlite:///:memory:")
    with pytest.raises(ValueError, match="BACKUP_KEY"):
        Settings(data_dir=tmp_path, environment="production", database_url="postgresql://host/test", backup_key="")
    with pytest.raises(ValueError, match="HTTPS"):
        Settings(
            data_dir=tmp_path,
            environment="production",
            database_url="postgresql://host/test",
            backup_key="not-used-before-connection",
            public_url="http://insecure.example",
        )


@pytest.mark.parametrize("definition", ["Dockerfile", "deployment/Dockerfile.node"])
def test_container_builder_copies_local_json_imports_in_typechecked_client(definition):
    """The builder runs strict tsc on tests too; COPY must include their fixtures."""
    root = Path(__file__).resolve().parents[2]
    builder = (root / definition).read_text().split("RUN npm run build", 1)[0]
    copies = []
    for line in builder.splitlines():
        parts = shlex.split(line)
        if parts and parts[0] == "COPY":
            for pattern in parts[1:-1]:
                copies.extend((p, Path(parts[-1])) for p in root.glob(pattern))
    imports = []
    for source in (root / "src").rglob("*"):
        if source.suffix not in (".ts", ".tsx"):
            continue
        for name in re.findall(r"(?:from\s+|import\s*)[\"\'](\.\.?/[^\"\']+\.json)[\"\']", source.read_text()):
            imports.append((source.parent / name).resolve())
    assert imports, "Keep the shared real build-input fixture in this regression."
    for fixture in imports:
        assert fixture.is_file()
        expected = fixture.relative_to(root)
        assert any(
            (
                source.is_dir()
                and fixture.is_relative_to(source)
                and destination / fixture.relative_to(source) == expected
            )
            or (source == fixture and destination / fixture.name == expected)
            for source, destination in copies
        ), f"{definition} omits {expected} required by the strict client build"
