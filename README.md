# ULTIMATE OMR CHECKER AI PRO

A real optical-mark examination platform: React/TypeScript client, genuine browser/server OpenCV scanning, FastAPI/Pydantic/SQLAlchemy/Alembic API, PostgreSQL production data, and an opt-in encrypted IndexedDB offline workspace.

**This branch is an active implementation, not a claim of production certification.** The preserved Markly/Node service and existing data are retained. See [verification and remaining work](documentation/PROGRESS.md) for exactly what has been tested. No cloud hosting, S3 bucket, SMTP service or physical Android device has been provisioned by this repository.

## Run the enterprise application

Prerequisites: Node 22.13+ (Node 24 recommended), CPython 3.11, and PostgreSQL for production. The tested Python locks target CPython 3.11. Use a new database; **never point SQLAlchemy at the existing `markly.sqlite`.**

```sh
npm ci
npm run build
python3.11 -m venv .venv
.venv/bin/pip install --require-hashes --only-binary=:all: -r backend/requirements.lock

# Development/local fallback creates a SEPARATE .data/enterprise.sqlite.
# Prefer a dedicated PostgreSQL database for shared use:
# export DATABASE_URL='postgresql+psycopg://user:password@host/database'
.venv/bin/uvicorn backend.main:create_app --factory --no-access-log --host 0.0.0.0 --port 8000
```

Open port 8000. FastAPI serves the built React application and `/api` on the same origin. First-run setup creates your own administrator; there are no default credentials. `/api/docs` describes the API. A separate device demo is explicitly labeled and is not authenticated school data.

For frontend hot reload, keep FastAPI running and, in another terminal:

```sh
VITE_API_PROXY=http://127.0.0.1:8000 npm run dev -- --port 5173
```

Open port 5173, not a browser-side localhost API URL. Vite proxies relative `/api` requests. The service worker is generated for production builds, not the hot-reload server.

Production requires `APP_ENV=production`, a PostgreSQL `DATABASE_URL`, a stable Fernet `BACKUP_KEY`, an HTTPS `PUBLIC_APP_URL`, and a first-run `SETUP_TOKEN`. The default Dockerfile now packages React + FastAPI with native OCR; `deployment/compose.yaml` supplies private PostgreSQL, explicit Alembic migrations and a Caddy HTTPS ingress. The former Node packaging is preserved in `deployment/Dockerfile.node`. Read the [deployment/backup/upgrade guide](documentation/DEPLOYMENT.md), [architecture](documentation/ARCHITECTURE.md) and [migration guide](documentation/MIGRATION.md). Container/cloud execution must be checked separately from passing local app tests.

## Android APK

A native Capacitor project and **Build Android APK** workflow are included. The
build uses **JDK 21 / Android SDK 36**, compiles in `android/`, runs native JVM tests
and lint, and uploads a verified **debug** APK with a checksum. The default APK now
opens **Connect your school**: enter a deployed HTTPS school origin, check the
FastAPI system, approve the native trust prompt, then create the first
administrator or sign in. **Team & access** uses real server accounts and roles.
The address is remembered; a native **Connection** button supports recovery even
if the server is down. The optional, unprotected device demo stays separate and
is never uploaded automatically. No rebuild is needed to choose a school server.
Python/PostgreSQL are not embedded or provisioned. See [Android build, connection,
download and device testing](documentation/ANDROID.md). Compilation is not
physical-device acceptance or a Play Store release.

```sh
npm ci
npm run android:debug  # requires JDK 21 and Android SDK 36 locally
# android/app/build/outputs/apk/debug/app-debug.apk
```

## Signup, Google login and Drive

The FastAPI portal supports email/password signup, verified production email,
Google sign-in/sign-up and password-confirmed Google linking. New signups create
**isolated school-admin workspaces, never super-admin or existing-school access**.
Public registration is operator-controlled (`PUBLIC_SIGNUP_ENABLED`, default
false); school administrators continue to create teacher/student memberships.
Google-only users can set an app password in **Settings → Sign-in & security**.

**Backups → Google Drive backups** separately authorizes a private Drive app-data
folder for manual, encrypted workspace backups, safe retries, verified downloads
and non-destructive import followed by password/revision-confirmed restore. It is
not scheduled replication or a full database/original-image disaster-recovery
backup. Google Cloud OAuth credentials, Drive API, a canonical HTTPS app domain,
and SMTP for production password signup must be configured **on your server**.
There are no embedded Google secrets or invented connected accounts. Android
Google consent opens in the external browser, not an embedded WebView.

See the [complete configuration, usage and verification guide](documentation/GOOGLE_AUTH_DRIVE.md).
Live Google/SMTP authorization and real Android callback acceptance still need
your configured project, domain and authorized test users.

## Working capabilities

- Navy/electric-blue responsive interface, light/dark/system themes, role-aware navigation, command search, filters and real-record dashboard metrics.
- Super-administrator institutions; administrator account management; assigned-class and feature-restricted teachers; private, explicitly published student results/progress/report cards.
- Camera/gallery/drop/multi-image/PDF scanning; browser OpenCV.js or native Python OpenCV; calibrated templates, perspective/orientation handling, QR/barcode and numeric roll OCR. Detection never uses the answer key to infer marks.
- Up to **500 questions**, **2–5 options including A–E**, multipage layouts, draggable fields, logos, geometry calibration, PDF/print templates and retained template versions.
- Durable server scan jobs with categorized failures/retry, explicit identity matching, revision-checked page application and operation receipts. Original pixels are retained encrypted; evidence includes measured coordinates, per-answer status/confidence and manual-verification history.
- Student CRUD and column-mapped CSV/XLSX imports: inspection → validation/duplicate preview → invalid-row report → explicit confirmation → transactional import. No automatic import just from uploading a file.
- Decimal-based scoring, alternate/multiple-answer sets, negative/partial/blank policies, versioned keys, authorized re-evaluation and historical evaluations. Unverified uncertain marks, flagged identities and missing pages do not silently become final results.
- Actual-record question/option/subject analytics, competition ranks and percentiles; real PDF, XLSX and CSV downloads. Formula-like spreadsheet text is escaped.
- Optional encrypted staff/student offline vaults with separate passphrases, 24-hour authorization, account/scope isolation, retained originals and conflict-aware synchronization. A stale revision blocks, preserves unsent data and requires explicit reconciliation; it never silently overwrites a newer server version.
- Validated institution defaults/contact/logo, service health, audit and sync journals, encrypted recovery points, local/S3-compatible object storage and SMTP recovery configuration.

Some API capabilities have stronger automated coverage than their browser workflows. Read the [19-stage acceptance map](documentation/ACCEPTANCE.md), [security review](documentation/SECURITY_AUDIT.md) and [measured performance report](documentation/PERFORMANCE.md) rather than treating this list as verification of every device, photo or deployment. Configurable clock-driven backups and richer report-template editing remain explicit product gaps; physical-device, load and production-operations acceptance remain gated.

## Scanning and privacy notes

Use a known/calibrated template, print at 100% scale, retain all registration corners and verify a sample before a large run. OCR and identity matches need human checking. Poor lighting, erasures, overlapping marks, unknown layouts and physical camera behavior cannot be guaranteed by synthetic-image tests. Native Tesseract OCR additionally needs the `tesseract` executable; browser English OCR assets are self-hosted during the build.

Authenticated APIs and original images use `no-store`; the PWA precaches only application code, fonts and local OCR assets, including the PDF worker. Private data is not put in the service-worker HTTP cache. Offline access is opt-in: PBKDF2/AES-GCM encrypted IndexedDB, keys in memory, separate passphrase, bounded lifetime and storage. After sign-out private views lock; an offline sign-out defers server-cookie revocation until reconnection. Device demo data is separate and unencrypted.

A lost offline passphrase cannot be recovered. Server-side encrypted originals/recovery points require the original `BACKUP_KEY`. Application recovery points are not complete disaster-recovery backups: preserve the PostgreSQL database, object storage and encryption key separately, with off-site retention and restore drills.

## Verify

```sh
npm run test:all                     # frontend/unit + preserved Node regression tests
npm run build                       # strict TypeScript, Vite, PWA generation
.venv/bin/pip install --require-hashes --only-binary=:all: -r backend/requirements-dev.lock
.venv/bin/ruff check backend scripts
.venv/bin/ruff format --check backend scripts
.venv/bin/pytest -q backend/tests    # SQLite + genuine OpenCV tests
.venv/bin/bandit -r backend -x backend/tests,backend/migrations

# Also run the database-parametrized API suite on a dedicated QA PostgreSQL DB:
OMR_TEST_POSTGRES_URL='postgresql://user:password@host/qa_db' .venv/bin/pytest -q backend/tests
npm audit
.venv/bin/pip check
```

The PostgreSQL test user must be allowed to create/drop isolated schemas in the QA database. Do not use production credentials or a database that may be reset by other tooling.

```sh
# After building; automatically starts/stops a FRESH disposable QA server:
npx playwright install --with-deps chromium
OMR_E2E_ALLOW_SETUP=1 npm run test:e2e
```

The browser regression covers real imports/accounts, native ink detection/review, private student publication, reports, an encrypted offline reload and a genuine disconnected OpenCV.js PDF scan with original upload on reconnect. It also checks 36 enterprise screen/theme/viewport combinations. See [TESTING.md](documentation/TESTING.md) for isolation requirements, migration/recovery drills, failure evidence and exact coverage limits. CI is defined in `.github/workflows/verify.yml`; a committed workflow is not a passed run. Current executed results are in [PROGRESS.md](documentation/PROGRESS.md); dependency checks are snapshots, not security certification.

## Preserve existing installations

The verified Node baseline is commit `8b5360f`; the enterprise API checkpoint is `eea3ae5`. `server/` remains runnable with `npm run server`, and the old SQLite file is never an enterprise destination. Read [MIGRATION.md](documentation/MIGRATION.md) before cutover; migration opens the source read-only, retains a consistent private copy, requires an empty destination and does not migrate sessions. Legacy teachers require explicit class assignments.

[Archived Node documentation](documentation/NODE_BASELINE.md) records the old workflow. GitHub Pages can serve the static client/device demo, **not FastAPI or PostgreSQL**. The tracked `docs/` site is a separately built publication and is not automatically updated by `npm run build` or by opening a pull request.

## Source map

- `src/session.tsx`, `src/offline.ts`: authentication, encrypted offline authorization, stable operation queues and revision conflicts.
- `src/Scanner.tsx`, `src/scanEngine.ts`, `src/omr.ts`, `src/geometry.ts`: real browser scans, camera/PDF input and printable geometry.
- `src/BatchCenter.tsx`, `src/ScanEvidence.tsx`, `src/Students.tsx`: native job application, originals/overlays and atomic human corrections.
- `src/StudentImport.tsx`, `src/StudentPortal.tsx`, `src/EvaluationCenter.tsx`, `src/SystemCenter.tsx`, `src/InstitutionDefaults.tsx`: imports, private results, scoring policy, revision-protected preferences and operations.
- `backend/`: relational API, schemas/migrations, authorization, deterministic scoring, genuine native OMR, encrypted storage and reports.
- `backend/tests/`, `src/*.test.*`, `server/*.test.mjs`: automated regression suites.
- `documentation/`: architecture, migration, verification and deployment notes; [THIRD_PARTY.md](THIRD_PARTY.md): component/license information.

Protect student information according to your institution's consent, retention and access policies.
