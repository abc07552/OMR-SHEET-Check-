# ULTIMATE OMR CHECKER AI PRO — architecture

## Migration checkpoint

The verified Markly React/OpenCV.js application and Node/SQLite backend are preserved in commit `8b5360f`. The enterprise backend lives in `backend/`: FastAPI, Pydantic 2, SQLAlchemy 2, Alembic, psycopg 3, Argon2id, OpenCV, NumPy, Pillow, ZXing, ReportLab and openpyxl. PostgreSQL is required in production; a separate `enterprise.sqlite` is a local fallback. Existing `markly.sqlite` is never reset or overwritten.

The React application remains the scanner/designer/reporting client. Enterprise screens now use the authenticated API and encrypted offline projection. The committed browser suite exercises the real import/account/native-scan/review/report/privacy/offline-PDF-sync workflow. This is not evidence of a deployed cloud service or arbitrary physical-photo accuracy; see `TESTING.md` and `PROGRESS.md` for exact limits.

## Trust boundaries

* A school has normalized classes, students, examinations, templates, results and answer detections. Composite foreign keys enforce school ownership. Active roll numbers and exam/student results have unique indexes. Soft deletion retains evaluation history.
* Users have school-scoped admin, teacher or student memberships. Super administrators create institutions. Teachers see only assigned classes, their students and associated examinations; keys shared with unassigned classes are read-only. Per-teacher scan, report and examination permissions are checked on the server. Revoked/suspended memberships take effect on the next request.
* Students cannot download school workspaces, staff analytics, keys, original images or other learners' records. The portal and report endpoints release only their own evaluated results after explicit result publication. Old evaluations are staff-only.
* Passwords use Argon2id (64 MiB, three iterations, two lanes), sessions are hashed opaque 24-hour tokens in HttpOnly cookies. Recovery tokens are hashed, single-use and expire after 30 minutes. No seeded/default accounts. Login/reset throttles are persistent database records. Setup uses a unique database sentinel to prevent a concurrent second bootstrap.
* Mutation requests require a custom header and a same-origin or explicitly configured origin. Production uses Secure cookies, security headers and an HTTPS application URL. User content never becomes executable HTML. The local OpenCV.js Emscripten runtime requires the narrowly documented `unsafe-eval`/WebAssembly policy already used by Markly.
* Uploads are bounded, validated by decoding, and guarded against oversized images and workbook zip bombs. Original scan objects and application recovery points are encrypted before local/S3 storage. The backup key is a server secret, not a `VITE_*` variable.

## Concurrency and history

Workspace saves perform a compare-and-swap on the institution revision in the same transaction as all record updates. An operation ID is unique within a school and bound to its actor and payload hash. Retrying the exact request returns its receipt; reusing an ID for different data or a stale revision fails without overwriting newer data. Whole-workspace conflicts require an explicit human merge/reload, not last-write-wins.

Answer-key/rule changes increment a version and append deterministic evaluation records; old evaluations are not overwritten. Template geometry changes append immutable template versions. Scan jobs are durable database records, with atomic claims, attempt counts, categorized failures and expiring worker leases. A scan does not automatically publish or confirm an uncertain result.

## Image processing

Both browser OpenCV.js and server OpenCV measure real images. The Python engine uses bounded image decoding, EXIF normalization, reference-square/page-boundary detection, four candidate orientations, perspective warping, illumination normalization, adaptive and absolute thresholds, and calibrated per-option ink measurements. Orientation is chosen from printed bubble-outline evidence, **never the answer key**. QR/barcode identity and geometry are validated. Per-answer confidence, status and original/aligned coordinates accompany the result. Partial, erased, multiple, uncertain and unreadable marks are surfaced, not invented. Unmatched identities remain review-only.

The server's Tesseract integration is optional and explicitly reports when its executable is absent. Local browser Tesseract remains functional independently. This is an optical/classical-CV product; no untrained "AI accuracy" claim is made.

## Storage / cloud

`DATABASE_URL=postgresql+psycopg://...` selects PostgreSQL. The enterprise Docker/Compose topology uses explicit Alembic migrations, a non-root Python runtime, a private non-superuser PostgreSQL role and a same-origin Caddy HTTPS ingress. With automatic migrations disabled, startup requires the exact application migration head before accepting traffic. See `DEPLOYMENT.md` for operational/verification limits. `S3_BUCKET`, region, optional endpoint and standard AWS credentials select S3-compatible object storage; otherwise encrypted local objects are used. Remote SMTP enables email recovery. Without these settings the application is a local server, **not a deployed cloud service**. A QA PostgreSQL 16.2 binary supplied by an optional test-only wheel is isolated on a private Unix socket; it must not be used as a production database.

Workspace recovery points do not replace database disaster-recovery backups, original-image backups, the encryption key, or off-site retention. Use managed PostgreSQL point-in-time recovery and versioned object storage for production. Losing the encryption key makes stored encrypted objects unrecoverable.

## Reproducibility and verification

`backend/requirements.in` / `requirements-dev.in` declare selected versions; `.lock` files pin tested transitive dependencies for CPython 3.11. `scripts/lock-python.py` regenerates the closure from an installed environment. `package-lock.json` locks JavaScript dependencies. Optional PostgreSQL QA binaries have their own input file and are excluded from runtime locks.

Run `python -m pytest`, `ruff check backend`, `npm test`, `npm run test:server`, `npm run build`, and the browser tests. See `PROGRESS.md` for actual executed results and remaining work rather than assuming every requirement is complete.
