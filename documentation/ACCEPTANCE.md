# Master-requirement acceptance map

This is a **traceability and release-gate map**, not a declaration that all 19 stages are complete. Source is already implemented across these areas; the current work is integration, reliability and acceptance hardening on the current working branch; the original integration PR was merged. Existing Markly data and the Node baseline are preserved. The application must not be advertised as physically validated or permanently deployed merely because tests pass.

## Stage map

| Stage                      | Working implementation / evidence                                                                                                                                                                                                          | Remaining acceptance boundary                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Architecture/setup     | React/TypeScript/Vite/Tailwind, Router/Query/RHF/Zod/Recharts; FastAPI/Pydantic/SQLAlchemy/Alembic; locked npm and hash-locked Python closures. `README.md`, `ARCHITECTURE.md`.                                                            | Revalidate the supported OS/browser/hosting matrix for a release.                                                                                                                                                                                                    |
| 2 — Database/auth          | PostgreSQL primary, separate local/test SQLite, composite ownership constraints, opaque sessions, Argon2id, recovery/suspension/audit, backend RBAC and schema-head guard.                                                                 | Independent security/operational review, real SMTP delivery and managed-DB failover.                                                                                                                                                                                 |
| 3 — Dashboard              | Responsive navy/light UI, actual-record institution metrics, exam charts/tables/activity, navigation/command search/notifications.                                                                                                         | Broader accessibility, all-screen interaction coverage and real-device performance; never substitute fixture counters for production records.                                                                                                                        |
| 4 — People                 | Student CRUD/photo/contact/class/batch/section/history; mapped, validated, confirmed imports; teacher/linked-student accounts, assignments, feature permissions and suspension.                                                            | More diverse workbook/import/photo and accessibility acceptance.                                                                                                                                                                                                     |
| 5 — Classes/subjects/exams | School-scoped classes, exam fields/dates/duration/classes/batches/subject ranges/options/sets and publication.                                                                                                                             | Additional complex institution workflows and archival/retention policy acceptance.                                                                                                                                                                                   |
| 6 — Keys                   | Configurable keys/sets/marking rules, versioned evaluations, authorized explicit re-evaluation and history.                                                                                                                                | Broader institution-specific marking/grading policy fixtures.                                                                                                                                                                                                        |
| 7 — Designer               | Measured draggable geometry, circle/square bubbles, 2–5 options, fields/logos/QR/markers/custom print dimensions, duplication/version history/calibration/PDF.                                                                             | Every custom layout/physical print path needs a representative readability rehearsal. Native regression covers radii 5–25 and both shapes; it is not every possible layout.                                                                                          |
| 8 — Genuine OMR            | Native and browser OpenCV, perspective/orientation/markers, illumination handling, actual ink/status/confidence/coordinates, QR/barcode/OCR hooks and retained originals.                                                                  | Private real-sheet/lighting/erasures/handwriting/device corpus and measured false-accept/false-reject targets. Confidence is not a calibrated correctness probability.                                                                                               |
| 9 — Bulk/review            | Durable queues, bounded pages, duplicates, categorized retries, explicit identity/replacement, overlays/manual correction, summaries and operation IDs. Worker attempt fencing/revocation/crash-limit races verified on SQLite/PostgreSQL. | Representative sustained upload/backpressure, low-memory devices and multi-replica load/failure testing.                                                                                                                                                             |
| 10 — Scoring               | Deterministic Decimal evaluation, negative/partial/multiple/blank policies, subject scores, versioned rules/history.                                                                                                                       | Institution-approved formula/policy sign-off; no image inference from keys.                                                                                                                                                                                          |
| 11 — Results/ranks         | Persisted actual results, evaluation state, competition ties/strict-lower percentiles, sortable/filterable views.                                                                                                                          | Broader large-cohort UX/export checks; review-only results remain excluded.                                                                                                                                                                                          |
| 12 — Analytics             | Actual-record question/options/difficulty/progress/distributions/grades/subjects/comparisons; documented statistics. Backend percentile indexing optimized with identical output checksums.                                                | Dedicated deployment/database/browser capacity benchmarks and additional visual report acceptance.                                                                                                                                                                   |
| 13 — Student portal        | Own profile and published evaluated history/charts/rank/percentile/report cards; other learners/keys/originals forbidden.                                                                                                                  | Physical-device/a11y acceptance and further multi-device lifecycle testing.                                                                                                                                                                                          |
| 14 — Reports               | Branded PDF/XLSX/CSV result/merit/topper/class/subject/question/performance/error/student paths; real download checks and spreadsheet escaping.                                                                                            | Full per-category content/print acceptance, pagination at scale and a richer user-editable report-template workflow. Branding alone is not a full visual report-template editor.                                                                                     |
| 15 — Offline/cloud sync    | Cached shell, opt-in encrypted authorized IndexedDB records/originals, disconnected genuine PDF scan, stable operations, receipts/CAS conflict preservation, retry/status/journal.                                                         | Physical install/update/eviction/multi-tab/device races; external cloud connectivity/failure behavior and explicit operator conflict-resolution rehearsal.                                                                                                           |
| 16 — Backups/restore       | Manual encrypted recovery points, history/download/password-confirmed revision-checked restore/pre-restore safety snapshot; automatic daily pre-write recovery points. Migration/recovery drills preserve source and histories.            | **Configurable clock-driven backup scheduling is not implemented**; current automatic recovery is triggered by successful workspace writes, not a timer. Full PostgreSQL + object/key/off-site restore/PITR and retention/erasure policies need operator validation. |
| 17 — Security/performance  | Boundary checks, uploads/limits/headers/transactions, attempt fencing, binary/hash installs, Bandit/advisory scans, ranking optimization, code splitting and bounded APIs. See `SECURITY_AUDIT.md`, `PERFORMANCE.md`.                      | Independent pen test, OS/container scan/provenance, exact production TLS/cloud configuration and representative concurrent load/device acceptance.                                                                                                                   |
| 18 — QA/debugging          | Vitest, preserved Node tests, SQLite/PostgreSQL Pytest, actual native/browser CV and a production-bundle Playwright workflow. Reproduced worker/optical regressions fixed without bypassing review/authorization.                          | Systematic wider button/form/a11y/physical-device/report/PWA lifecycle coverage remains; passing selected suites is not proof of every requirement.                                                                                                                  |
| 19 — Production deployment | Non-root FastAPI/native OCR image, PostgreSQL 17/private app role, explicit migrations, Caddy same-origin HTTPS topology, env example and operations guide. Earlier checkpoint container jobs executed successfully in GitHub Actions.     | **Blocked for final acceptance:** real host/DNS/secrets/cloud services, external TLS/device tests, monitoring/off-site restore rehearsal/capacity and operator release approval. This branch/PR is not a permanent production installation.                          |

## Google/signup/Drive extension

Stage 2 now includes the opt-in verified password-registration portal,
Google sign-in/signup, password-confirmed explicit linking and recent-Google
first-password creation. Existing-school teacher/student access remains controlled
by administrators. Stage 16 now includes **manual**, per-administrator/school,
encrypted Google Drive app-data backups with durable retries, authenticated
downloads and non-destructive import into the existing password/CAS restore flow.
This does not complete the clock-driven scheduling or full-DR gates above.

The local full matrix passed **246 Python + 238 frontend + 30 Node tests**. Both
real PostgreSQL/production-bundle Playwright tests passed, including registration,
password change/re-login, private portal/privacy, real CV and offline sync.
Provider HTTP and SMTP delivery are synthetic; Google identity signatures are
verified with real RSA/X.509 and the official verifier. Actual Cloud credentials,
consent/revocation/quotas, production SMTP and Android external-browser return /
process death still need an operator-configured domain, authorized users and
physical devices. See [GOOGLE_AUTH_DRIVE.md](GOOGLE_AUTH_DRIVE.md).

## Three-digit / layout-scan extension

Stages 6–10 now include mixed MCQ/three-digit keys, reviewed camera/gallery
layout detection, editable per-question geometry, 30-point numeric ink evidence,
explicit uncertainty correction and whole-number exact scoring. Stages 12/14
include whole-token frequency analysis and mixed CSV/XLSX/PDF reporting. Existing
MCQ defaults/hashes/migration data and 500-question standard pagination are
preserved. Count/type/MCQ-option history locks are enforced by both backends.

**Executed locally:** 286 frontend, 33 preserved Node, 295 SQLite/PostgreSQL Python
tests and all three production-bundle PostgreSQL Playwright workflows passed.
An additional private rehearsal on the supplied photo passed reviewed mapping,
calibration/save/reload, PDF/PNG generation and reference removal with no key
inference. It is one geometry acceptance check, not general camera/ink accuracy.

**Limits:** import is one image / at most 100 mapped questions; three digits means
unsigned integers 0–999, not four-digit/decimal/sign support. External grid
classification, numbering and intended columns/zero row require review; roll-grid
decoding is not implemented. Reference photos enter the saved school workspace
but are never printed. Representative private print/lighting/device/erasure and
production hosting acceptance remain open. See [INTEGER_LAYOUT_SCANNING.md](INTEGER_LAYOUT_SCANNING.md).

## Current continuation priorities

1. Retain reproducible failure → root cause → regression → fix → full relevant retest evidence for every change. Do not mark earlier checks as verification of later code without rerunning CI.
2. Complete remaining settings/operations workflow gaps, especially configurable scheduled recovery/retention and richer report templates, with backend authorization and transactional tests.
3. Expand physical/real-device and all-screen/report/PWA acceptance using consented private data, never public student datasets or fabricated accuracy numbers.
4. Rehearse production restore/deployment and concurrency/resource limits in an operator-approved environment. Never request production credentials in chat or reset an existing school database.

See `PROGRESS.md` for executed results, `TESTING.md` for reproduction, and the existing draft PR for latest-head CI. Keep Stage 19 gated rather than silently treating these remaining items as completed.
