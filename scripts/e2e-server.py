"""Disposable browser-QA server. Never reuses an existing school database.

Run with the project venv from the repository root. OMR_TEST_POSTGRES_URL may
point at a DEDICATED QA PostgreSQL database; a random isolated schema is created
and removed on normal shutdown. Otherwise a fresh, separate SQLite file is used.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main():
    import uvicorn

    from backend.config import Settings
    from backend.main import create_app

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8010)
    args = parser.parse_args()
    os.umask(0o077)
    parent = ROOT / ".cache" / "e2e"
    parent.mkdir(parents=True, exist_ok=True)
    data = Path(tempfile.mkdtemp(prefix="server-", dir=parent))
    uri = os.getenv("OMR_TEST_POSTGRES_URL", "")
    connection = None
    schema = "omr_e2e_" + uuid.uuid4().hex

    def cleanup_schema():
        nonlocal connection
        if connection:
            from psycopg import sql

            try:
                connection.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
                print(f"Removed disposable PostgreSQL schema {schema}", flush=True)
            finally:
                connection.close()
                connection = None

    try:
        if uri:
            import psycopg
            from psycopg import sql

            raw = uri.replace("postgresql+psycopg://", "postgresql://", 1)
            connection = psycopg.connect(raw, autocommit=True)
            connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
            parsed = urlsplit(raw)
            query = dict(parse_qsl(parsed.query))
            query["options"] = f"-c search_path={schema}"
            uri = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), ""))
        settings = Settings(
            data_dir=data,
            database_url=uri,
            environment="development",
            setup_token="",
            backup_key="",
            smtp_host="",
            s3_bucket="",
            static_dir=ROOT / "dist",
            auto_migrate=True,
        )
        if not (settings.static_dir / "index.html").is_file():
            raise RuntimeError("Run npm run build before browser QA.")
        print(
            f"Disposable browser QA: {'PostgreSQL schema ' + schema if connection else 'fresh SQLite'}; artifacts in {data}",
            flush=True,
        )
        application = create_app(settings)
        lifespan = application.router.lifespan_context

        @asynccontextmanager
        async def qa_lifespan(app):
            try:
                async with lifespan(app):
                    yield
            finally:
                # Uvicorn re-raises SIGTERM AFTER its lifespan exits. A Python
                # finally around uvicorn.run alone is therefore not sufficient.
                cleanup_schema()

        application.router.lifespan_context = qa_lifespan
        uvicorn.run(application, host="0.0.0.0", port=args.port, access_log=False)
    finally:
        cleanup_schema()


if __name__ == "__main__":
    main()
