from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import Settings
from .db import engine_for, migrate, sessions_for
from .models import ScanJob, StoredObject
from .object_store import ObjectStore
from .routes import auth, records, reports, scans, workspace
from .security import current_user

logger = logging.getLogger(__name__)


class BodyTooLarge(Exception):
    pass


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        limit = 52 * 1024 * 1024 if b"multipart/form-data" in headers.get(b"content-type", b"") else 30 * 1024 * 1024
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            length = limit + 1
        if length < 0 or length > limit:
            return await JSONResponse({"error": "The upload or request exceeds the server limit."}, status_code=413)(
                scope, receive, send
            )
        total = 0

        async def limited_receive():
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > limit:
                    raise BodyTooLarge()
            return message

        try:
            await self.app(scope, limited_receive, send)
        except BodyTooLarge:
            await JSONResponse({"error": "The upload or request exceeds the server limit."}, status_code=413)(
                scope, receive, send
            )


def create_app(settings: Settings | None = None):
    settings = settings or Settings()
    engine = engine_for(settings)
    if settings.auto_migrate:
        migrate(engine)
    store = ObjectStore(settings)

    @asynccontextmanager
    async def lifespan(app):
        task = None if settings.testing else asyncio.create_task(scans.worker_loop(app))
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        engine.dispose()

    app = FastAPI(
        title="ULTIMATE OMR CHECKER AI PRO",
        version="3.0.0",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings, app.state.engine, app.state.sessions, app.state.store = (
        settings,
        engine,
        sessions_for(engine),
        store,
    )
    app.add_middleware(BodyLimitMiddleware)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        origin = request.headers.get("origin", "")
        allowed = {str(request.base_url).rstrip("/"), settings.web_origin, settings.public_url.rstrip("/")}
        if not settings.production:
            # Development proxies can terminate TLS before reaching the local HTTP server.
            allowed.update({f"https://{request.headers.get('host', '')}", f"http://{request.headers.get('host', '')}"})
        if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
            if request.headers.get("x-markly-request") != "1" or (origin and origin not in allowed):
                return JSONResponse({"error": "This request or origin could not be verified."}, status_code=403)
        if request.method == "OPTIONS" and origin and origin == settings.web_origin:
            response = JSONResponse({"ok": True})
        else:
            response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; "
            "worker-src 'self' blob:; connect-src 'self' data: blob:"
            + (" " + settings.web_origin if settings.web_origin else "")
            + "; object-src 'none'; base-uri 'self'; form-action 'self'"
            + ("; frame-ancestors 'self'" if settings.production else "")
        )
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store, private"
        if settings.production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
            response.headers["X-Frame-Options"] = "SAMEORIGIN"
        if origin and origin == settings.web_origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Markly-Request"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            response.headers["Vary"] = "Origin"
        return response

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request, exc):
        detail = exc.detail
        return JSONResponse(
            {"error": detail.get("message", "The request failed."), **detail}
            if isinstance(detail, dict)
            else {"error": str(detail)},
            status_code=exc.status_code,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        issues = [{"path": ".".join(str(p) for p in e["loc"]), "message": e["msg"]} for e in exc.errors()[:20]]
        return JSONResponse(
            {"error": issues[0]["message"] if issues else "Invalid request.", "issues": issues}, status_code=422
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error(request, exc):
        logger.info("Constraint rejected %s %s", request.method, request.url.path)
        return JSONResponse(
            {
                "error": "This record conflicts with an existing record or a required reference. Reload before retrying; no partial changes were saved."
            },
            status_code=409,
        )

    @app.exception_handler(OperationalError)
    async def database_error(request, exc):
        logger.exception("Database operation failed")
        return JSONResponse(
            {
                "error": "The database is temporarily unavailable. Your request was not confirmed; retry with the same operation ID."
            },
            status_code=503,
        )

    @app.get("/api/health")
    def health():
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {
            "ok": True,
            "service": "markly-api",
            "product": "ULTIMATE OMR CHECKER AI PRO",
            "backend": "fastapi",
            "version": 3,
            "storage": engine.dialect.name,
            "capabilities": [
                "rbac",
                "student-portal",
                "opencv-python",
                "idempotent-sync",
                "encrypted-backups",
                "transactional-imports",
                "durable-batches",
            ],
        }

    @app.get("/api/system/health")
    def system_health(request: Request, user=Depends(current_user)):
        if not user.super_admin:
            raise HTTPException(403, "Only a super administrator can inspect system health.")
        import shutil

        with app.state.sessions() as db:
            pending = db.scalar(
                select(func.count()).select_from(ScanJob).where(ScanJob.status.in_(["queued", "processing"]))
            )
            objects = db.scalar(select(func.coalesce(func.sum(StoredObject.size), 0)))
        return {
            "database": engine.dialect.name,
            "databaseConnected": True,
            "objectStorage": "s3" if store.s3 else "encrypted-local",
            "imageBytes": objects,
            "pendingJobs": pending,
            "serverOCR": bool(shutil.which("tesseract")),
            "emailConfigured": bool(settings.smtp_host),
            "environment": settings.environment,
            "permanentCloudDeployment": bool(settings.production),
        }

    for router in (auth.router, workspace.router, records.router, scans.router, reports.router):
        app.include_router(router)

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    def unknown_api(path: str):
        raise HTTPException(404, "API endpoint not found.")

    if settings.static_dir.exists():
        # StaticFiles safely rejects path traversal. The SPA is the final fallback only.
        assets = settings.static_dir / "assets"
        if assets.exists():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{path:path}")
        def frontend(path: str):
            candidate = (settings.static_dir / path).resolve()
            if candidate.is_relative_to(settings.static_dir) and candidate.is_file():
                headers = (
                    {"Cache-Control": "no-cache"} if path in ("sw.js", "manifest.webmanifest", "index.html") else {}
                )
                return FileResponse(candidate, headers=headers)
            if Path(path).suffix:
                raise HTTPException(404, "File not found.")
            return FileResponse(settings.static_dir / "index.html", headers={"Cache-Control": "no-cache"})

    return app


# Factory invocation keeps unit tests and CLI imports free from accidental database writes.
# Run: uvicorn backend.main:create_app --factory --host 0.0.0.0 --port 3001
