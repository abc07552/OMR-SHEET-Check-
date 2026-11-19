# Implementation and verification ledger

This ledger distinguishes implemented/tested work from the user's complete target specification. It is not a production certification.

## Checkpoint 1 — enterprise API foundation

Implemented: pinned Python runtime/development environments; FastAPI API; SQLAlchemy relational models; two Alembic migrations; SQLite local fallback and PostgreSQL dialect; secure first-admin bootstrap; Argon2id authentication and hashed expiring sessions; school roles and teacher class/feature permissions; student publication/privacy endpoints; settings and audit; atomic revision conflicts and operation receipts; answer-key/template/evaluation versions; deterministic decimal scoring and actual-record statistics; two-phase mapped CSV/XLSX import with transaction/idempotency; encrypted local/S3 object abstraction and application recovery points; genuine Python OpenCV engine; durable scan-batch job API/worker; private PDF/XLSX/CSV report endpoints; non-destructive Node migration/recovery CLI.

Executed at this checkpoint:

* **45 Python tests passed**, running authorization, transactional import, workspace/concurrency, publication, report and encrypted-restore tests against **both SQLite and a real isolated PostgreSQL 16.2 server**, plus scoring and synthetic-image OpenCV tests for 2–5 options, rotations/perspective, blank/multiple/partial marks and QR exam mismatch.
* **58 existing Vitest frontend tests passed**.
* **30 preserved Node backend tests passed**.
* Ruff checks passed before adding the maintenance CLI (rerun at each subsequent checkpoint).
* npm dependency audit: **0 vulnerabilities** after a compatible Workbox `glob` transitive override. This is an executed dependency check, not a claim of absence of all security defects.

The PostgreSQL QA binary is optional/local/test-only and not a production deployment. Browser/physical-camera accuracy is not established by synthetic-image unit tests. The original app remains running while enterprise UI integration is in progress.

## Remaining before final handoff

Connect and browser-test the enterprise UI (role/assignments, private student portal, server scanning/batches, import confirmation, scoring rules, settings/health, offline operation queue and report controls); complete PWA caching and permission-aware local persistence; test migration and database constraints directly; run security and dependency audits, production build, full regression and browser/performance checks; document Docker/PostgreSQL/S3/SMTP deployment. External cloud host/database/storage/email accounts and a physical Android device are not configured in this environment and cannot be claimed verified.
