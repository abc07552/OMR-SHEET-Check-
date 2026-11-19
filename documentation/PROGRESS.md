# Implementation and verification ledger

This ledger distinguishes implemented/tested work from the full target specification. It is not production certification or a claim that all bugs are fixed.

## Preserved checkpoints

- `8b5360f`: verified Markly React/OpenCV.js application and Node/SQLite service, existing functionality/data retained.
- `eea3ae5`: enterprise API foundation: FastAPI/Pydantic/SQLAlchemy/Alembic, PostgreSQL/SQLite, RBAC, scoring/history, genuine native OpenCV, mapped imports, object storage/recovery, report endpoints and maintenance CLI. At that checkpoint: 45 Python, 58 frontend and 30 Node tests passed.

## Enterprise client / security / evidence checkpoint

Implemented since the API foundation:

- React Router, memory-only TanStack Query, RHF/Zod forms, Tailwind integration, navy/electric-blue branding, light/dark/system themes and responsive enterprise screens.
- Private student portal, teacher assignments/feature permissions and team/suspension/recovery controls connected to backend APIs.
- Actual-record dashboard metrics, evaluation policies/sets/re-evaluation, sync journal and institution settings/health/audit.
- Server job detail and identity-verified page application, original-upload receipts, encrypted retained originals, measured image transforms/overlays, atomic single/multiple/blank manual corrections and mandatory uncertain-answer review.
- Mapped import inspection/preview/duplicate/invalid-row/explicit-confirmation workflow, including local bounded CSV/XLSX parsing.
- Decimal.js/Python Decimal parity; alternate sets and detected selections feed scoring/analytics/report cards, rather than silently reusing only scalar responses.
- Report catalogue with PDF/XLSX/CSV outputs, class filters, institution logo/contact/default preferences and preference-aware encrypted restore.
- AES-GCM/PBKDF2 IndexedDB staff/student vaults: separate passphrases, 24-hour authorization, scope/expiry checks, immutable serialized writes, lifecycle guards, original-image account-switch protection, pending/in-flight operation retention and stable upload materialization before saves.
- Private views are cleared after membership/role/class/feature changes even without an unlocked vault. Session-expiry/download handling and deferred offline logout prevent stale private views or silent reconnection after sign-out.
- PWA static-only precache, offline PDF worker coverage, no API/evidence HTTP runtime cache, install prompt and explicit update confirmation.
- Enterprise migration refuses the preserved `markly.sqlite` as a SQLAlchemy destination and refuses source/destination equality.

### Executed verification (2026-11-17)

| Check | Observed result |
| --- | --- |
| `npm run test:all` | **92 frontend tests passed**, **30 preserved Node tests passed** |
| Full Python suite with `OMR_TEST_POSTGRES_URL` | **65 tests passed**, including SQLite and isolated real PostgreSQL 16.2 schemas |
| Ruff lint / format check | Passed; 29 Python files formatted |
| `npm run build` | Passed strict TypeScript + production/PWA build |
| PWA generation | 51 static precache entries, approximately 22.6 MiB; `.mjs` PDF worker included |
| `npm audit` | **0 known vulnerabilities** in the executed full dependency audit |
| `pip check` | No broken requirements |
| New desktop auth screen | Playwright screenshot inspected at 1440×1080; no page/console errors in that run |

The full Python suite covers real image processing, archived original ownership, duplicate/replay/CAS guards, explicit identity/replacement checks, answer evidence/correction/history, worker retry/expired leases/concurrent PostgreSQL claims, student privacy/publication, encrypted backups/preferences restore, transactional imports, class constraints, re-evaluation receipts and scoped journals.

The new frontend suites exercise decimal scoring/verification/geometry; real IndexedDB encryption roundtrips; TTL/scope/account-isolation checks; delayed image/open races; operation retention; lost-ack replay with the same operation ID; stale-server conflict preservation; edits during original upload; no-vault authorization reductions; deferred logout ordering; and stale revalidation after logout.

Nine remaining Python warnings come from the synthetic QR fixture's deprecated ZXing `write_barcode` API. Build warnings remain for large lazily loaded ExcelJS/PDF/OpenCV assets; successful compilation is not a mobile performance benchmark. Earlier baseline browser tests (500 questions, multipage PDFs, browser OCR/camera and 99 page/viewport combinations) predate the enterprise client changes and are not presented as current end-to-end evidence.

## Continuing work / PR review scope

- Browser-test the authenticated enterprise flows: team/teacher/student privacy, mapped imports, native batch/application, browser/native scan parity, evidence/manual verification, evaluation changes and reports.
- Rebuild/restart the preview after backend changes, then test production service-worker/offline PDF/OCR, vault unlock/reconnect/revocation, install/update behavior and cache contents in an actual browser.
- Repeat mobile/light/all-screen responsive and performance QA. Physical Android cameras, real printed forms, varied lighting and an accuracy corpus remain unverified.
- Execute migration/recovery drills against representative legacy databases; command/source-preservation guards exist but the entire migration CLI workflow is not yet established by the current suite.
- Finish enterprise Docker/PostgreSQL/reverse-proxy/S3/SMTP deployment documentation and repeat Python dependency/security audits.
- No external cloud database, S3 bucket, email transport or permanent HTTPS deployment has been provisioned/tested. The optional local QA PostgreSQL binary is not a supported production deployment.

A pull request is a review checkpoint, not a declaration that every requested production/physical-device acceptance criterion is complete.
