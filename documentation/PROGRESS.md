# Implementation and verification ledger

This ledger distinguishes implemented/tested work from the full target specification. It is not production certification or a claim that all bugs are fixed. The active review checkpoint is [draft PR #1](https://github.com/abc07552/OMR-SHEET-Check-/pull/1); the existing Markly application/data are preserved.

## Preserved checkpoints

- `8b5360f`: verified Markly React/OpenCV.js application and Node/SQLite service, existing functionality/data retained.
- `eea3ae5`: enterprise API foundation: FastAPI/Pydantic/SQLAlchemy/Alembic, PostgreSQL/SQLite, RBAC, scoring/history, genuine native OpenCV, mapped imports, object storage/recovery, reports and maintenance CLI. At that checkpoint: 45 Python, 58 frontend and 30 Node tests passed.
- `cb6ad12`: integrated enterprise client, encrypted offline queues, evidence review, private student portal, assignments/settings/report catalogue, deterministic decimal scoring and lifecycle/ownership guards. At that checkpoint: 92 frontend, 30 Node and 65 Python tests passed; authenticated enterprise browser coverage was still pending.

## Enterprise browser, synchronization and deployment continuation

Implemented and regression-tested since `cb6ad12`:

- A committed real-server Playwright workflow for setup, mapped imports, teacher/student creation, native OpenCV batches, explicit identity/answer verification, original evidence, PDF/XLSX/CSV exports, publication/privacy, encrypted offline reload, disconnected PDF/OpenCV.js scanning, retained-original upload and responsive themes.
- A disposable browser server with a fresh SQLite database or randomly isolated PostgreSQL schema; existing institutions are never reset. Playwright starts/stops it automatically. Schema cleanup now runs inside the ASGI shutdown lifespan, before Uvicorn re-raises SIGTERM. Catalog checks and three managed runs confirmed cleanup on normal termination.
- Assessment selection is retained after batch application/workspace reload, while a changed school or removed examination still selects a valid replacement. A real browser failure reproduced the old unintended assessment switch; the workflow now asserts against it.
- Accessible initial-password guidance and new-member action; modal padding/mobile spacing, portal statistic-card alignment and current product home/footer branding.
- A repeated browser run exposed a **one-render false "saved" state before acknowledgment**. New layout-effect tests also reproduced stale debounced submission after undo and an outdated encrypted offline draft after undo. These three tests failed before the fix and passed afterward. Status now reflects unacknowledged edits immediately; "queued" waits for the current encrypted write; undo cancels unsubmitted work without dropping an operation already materializing originals. Five additional hook regressions cover these cases, including delayed encryption and undo during upload. Existing stable-operation-ID/conflict/auth tests still pass.
- History/audit queries refresh after successful saves; newly scanned pages invalidate earlier missing-page acceptance. No uncertain mark is automatically verified.
- Source-preserving migration now imports from its retained consistent SQLite snapshot, preserves validated institution preferences, reports actual imported counts and reliably closes its source/database resources. Trusted recovery also disposes connections on failure.
- Database startup with `AUTO_MIGRATE=false` fails clearly on a missing/stale/incompatible migration head instead of appearing healthy against an unprepared schema. Production-mode tests cover bootstrap token, Secure/HttpOnly cookies, origin rejection, headers and minimal public health.
- Enterprise non-root Python/native-OCR Dockerfile, preserved Node Dockerfile, PostgreSQL non-superuser initialization, private Compose network, explicit migration service, Caddy HTTPS ingress, server-only environment example, and backup/upgrade/restore documentation.
- SHA-pinned GitHub Actions definition for locked dependencies, formatting/lint, frontend/Node/Python/PostgreSQL/native-CV/browser tests, advisory scans and a separate container/Compose/migration/health/encryption smoke job. **Workflow definition is not a passed CI run.**
- ZXing fixtures use the maintained barcode-creation API; the previous nine deprecation warnings are gone.

### Executed verification — 2026-11-17

Local runtime inspected: **Node 22.22.3 / npm 10.9.8, CPython 3.11.2, PostgreSQL 16.2 QA**, Chromium 153 from the sandbox. CI/container definitions target Node 24/Python 3.11/PostgreSQL 17; those targets must be judged by their actual CI/container results, not inferred from local runs.

| Check                                          | Observed result                                                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run test:all`                             | **97 frontend tests passed** across 6 files; **30 preserved Node tests passed**                                                                                                                              |
| Full Python suite with `OMR_TEST_POSTGRES_URL` | **78 tests passed**, SQLite + isolated real PostgreSQL schemas; no remaining QR-fixture warnings                                                                                                             |
| Production Playwright workflow                 | **3 consecutive fresh-database runs passed**, approximately 37–39 seconds each, after the save/undo regressions were fixed                                                                                   |
| Responsive browser checks                      | 6 enterprise screens × 3 widths (1440/768/390) × 2 themes = **36 combinations per workflow**, no document overflow                                                                                           |
| Ruff lint / format                             | Passed, 34 Python files formatted                                                                                                                                                                            |
| TypeScript + Vite/PWA production build         | Passed; 51 static precache entries, approximately 22.6 MiB, PDF `.mjs` worker included                                                                                                                       |
| Browser errors/cache                           | No uncaught page errors or unexpected console errors; private API HTTP responses absent from service-worker cache                                                                                            |
| `npm audit`                                    | **0 known advisories**, full executed npm dependency audit                                                                                                                                                   |
| Python runtime and development lock audits     | **No known vulnerabilities found** in both executed pinned-closure audits                                                                                                                                    |
| `pip check`                                    | No broken requirements                                                                                                                                                                                       |
| Actual Node → PostgreSQL CLI/TTY drill         | Passed with two schools, two users, two 500-question records; source files unchanged; populated destination refused; interactive hidden-terminal recovery revoked sessions without printing the new password |

The committed Python maintenance regressions additionally exercise WAL-consistent backup/source fingerprints, same IDs/rolls across schools, five-page/A–E layouts, all 1,000 retained answer detections, template/evaluation/report preservation, legacy scrypt → Argon2id upgrade, no imported sessions, initially unassigned teachers, confirmation/source/destination guards and whole-transaction rollback when the second school is invalid.

The actual CLI/TTY rehearsal used a **separate synthetic database created through the real preserved Node setup/workspace/account APIs**, not `.data/markly.sqlite`. It then invoked the Python CLI as a subprocess, verified scores/restrictions, and drove `reset-password` through a real pseudo-terminal. The new password was absent from the captured terminal transcript. This is distinct from the automated prompt-substitution unit tests, and not a migration of the user's installation.

Ignored local evidence includes `.cache/qa/continuation-{unit-tests,python-tests,production-build}.log`, `continuation-e2e-{1,2,3}.log`, advisory JSON reports, Playwright screenshots/traces and `migration-cli-drill-result.json`. These are transient QA artifacts, not published school data or permanent Git artifacts. Committed tests and [TESTING.md](TESTING.md) describe reproducible checks and coverage boundaries.

### Interpretation and remaining acceptance work

- Docker Engine is **not installed in the sandbox**. The image/Compose/Caddy configuration and CI smoke job are supplied, but local container execution is not claimed. Check the new GitHub workflow result before treating that packaging as verified. No permanent HTTPS/cloud/S3/SMTP deployment has been provisioned.
- The latest production bundle still warns about large lazily loaded ExcelJS/PDF/OpenCV assets. It precaches about 22.6 MiB. There is no claim of a low-end Android memory/CPU/load-time benchmark or optimized production capacity.
- The browser suite executes genuine native ink detection and a genuine **blank** offline PDF scan, not an arbitrary-photo accuracy corpus. Native Tesseract is absent on the local host; browser OCR assets are available, and the container is configured to install native OCR. Neither that configuration nor a synthetic fixture certifies OCR identity accuracy.
- The 36 current responsive checks cover six enterprise screens. Earlier baseline tests (500 questions, multipage PDFs, browser OCR/camera and 99 page/viewport combinations) predate enterprise integration and are not counted as fresh all-screen/device acceptance.
- Physical Android cameras, real printed forms/erasures/shadows/lighting, offline install/update lifecycle, additional report formats/categories and large-school performance still need dedicated acceptance work.
- Synchronization/session/crypto tests cover selected races, including lost acknowledgments, conflicts, edits/undo during upload, queue durability, stale images/account revalidation and deferred offline logout. They are not an exhaustive proof of every lifecycle or multi-device interleaving.
- Synthetic migration/recovery drills do not replace a representative private rehearsal, count/score/layout/evidence reconciliation, a consistent PostgreSQL/object/key restore drill and operator-approved rollback for an actual school.
- Runtime/development dependency advisory scans are point-in-time snapshots. Python pins are not yet fully hash-locked; the audit tool explicitly warns about that. No penetration-test or supply-chain certification is claimed.
- Protected cloud service configuration, managed PostgreSQL failover/PITR, S3 retention/permissions, SMTP delivery and external TLS/proxy operation remain operator/provider validation work.

A draft pull request is a review checkpoint, not a declaration that every requested production/physical-device acceptance criterion is complete. Continue the reproduce → root cause → regression → fix → retest → document loop on the same branch.
