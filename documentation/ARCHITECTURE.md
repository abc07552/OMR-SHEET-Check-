# ULTIMATE OMR CHECKER AI PRO — architecture

## Migration checkpoint

The verified Markly React/OpenCV.js application and Node/SQLite backend are preserved in commit `8b5360f`. The enterprise backend lives in `backend/`: FastAPI, Pydantic 2, SQLAlchemy 2, Alembic, psycopg 3, Argon2id, OpenCV, NumPy, Pillow, ZXing, ReportLab and openpyxl. PostgreSQL is required in production; a separate `enterprise.sqlite` is a local fallback. Existing `markly.sqlite` is never reset or overwritten.

The React application remains the scanner/designer/reporting client. Enterprise screens now use the authenticated API and encrypted offline projection. The committed browser suite exercises the real import/account/native-scan/review/report/privacy/offline-PDF-sync workflow. This is not evidence of a deployed cloud service or arbitrary physical-photo accuracy; see `TESTING.md` and `PROGRESS.md` for exact limits.

## Trust boundaries

- A school has normalized classes, students, examinations, templates, results and answer detections. Composite foreign keys enforce school ownership. Active roll numbers and exam/student results have unique indexes. Soft deletion retains evaluation history.
- Users have school-scoped admin, teacher or student memberships. Super administrators create institutions; opt-in public signup can create a new, isolated institution with a regular school administrator, never super-admin privilege or membership in another school. Teachers see only assigned classes, their students and associated examinations; keys shared with unassigned classes are read-only. Per-teacher scan, report and examination permissions are checked on the server. Revoked/suspended memberships take effect on the next request.
- Students cannot download school workspaces, staff analytics, keys, original images or other learners' records. The portal and report endpoints release only their own evaluated results after explicit result publication. Old evaluations are staff-only.
- Passwords use Argon2id (64 MiB, three iterations, two lanes), sessions are hashed opaque 24-hour tokens in HttpOnly cookies. Recovery tokens are hashed, single-use and expire after 30 minutes. No seeded/default accounts. Login/reset throttles are persistent database records. Setup uses a unique database sentinel to prevent a concurrent second bootstrap.
- Mutation requests require a custom header and a same-origin or explicitly configured origin. Production uses Secure cookies, security headers and an HTTPS application URL. User content never becomes executable HTML. The local OpenCV.js Emscripten runtime requires the narrowly documented `unsafe-eval`/WebAssembly policy already used by Markly.
- Uploads are bounded, validated by decoding, and guarded against oversized images and workbook zip bombs. Original scan objects and application recovery points are encrypted before local/S3 storage. The backup key is a server secret, not a `VITE_*` variable.

## Google accounts and Drive isolation

The FastAPI auth portal includes verified production password signup, Google
sign-in/signup, password-confirmed explicit linking and recent-Google first-app-
password creation. Public signup is operator-disabled by default and cannot
replace first-super-admin setup. Legacy user hashes/sessions survive the additive
migration; older sessions are never treated as recent Google reauthentication.
Trusted CLI recovery and administrator resets also enable the app-password flag.

Google Authorization Code uses server-held S256 PKCE, random state/nonce and the
official signed ID-token verifier. Only `sub` identifies an existing link; matching
an email never logs into an existing account. Browser completion is tied to its
Secure HttpOnly flow cookie; Android opens an external Custom Tab and adds an
independent WebView-held proof for its short-lived, single-use scheme ticket.
Incoming callbacks cannot change servers or navigate arbitrary deep links. The
App listener has a stable lifetime across route changes; cold-launch URLs are not
replayed on each navigation. Process death without local proof fails closed.

Drive permission is separate `drive.appdata` consent, per school and administrator.
Refresh/access credentials are encrypted with the server key and never sent to
the UI. Manual backup takes a coherent server-workspace snapshot, encrypts before
uploading and persists the operation, immutable snapshot, three-minute lease and
preallocated remote file ID. Lease-fenced writes prevent a stale worker replacing
a newer file ID. Credential refresh is serialized on PostgreSQL and SQLite.
Remote hash/size/metadata are verified before download/import. Import only creates
a server recovery point; destructive restore still requires app password,
current-revision CAS, same-school binding and a pre-restore safety snapshot.

See [GOOGLE_AUTH_DRIVE.md](GOOGLE_AUTH_DRIVE.md) for exact server credentials,
canonical callback, production email verification, Android and backup limits.
Live provider/domain/device acceptance is separate from synthetic transport tests.

## Concurrency and history

Workspace saves perform a compare-and-swap on the institution revision in the same transaction as all record updates. An operation ID is unique within a school and bound to its actor and payload hash. Retrying the exact request returns its receipt; reusing an ID for different data or a stale revision fails without overwriting newer data. Whole-workspace conflicts require an explicit human merge/reload, not last-write-wins. Institution defaults have their own actor/school-keyed form and fetched-snapshot revision: editing waits for loading, refetch does not erase a dirty draft or advance its baseline, failed saves remain visible, and replacing a draft requires explicit confirmation. Late mutation responses after unmount cannot reload or repopulate the private view.

Answer-key/rule changes increment a version and append deterministic evaluation records; old evaluations are not overwritten. Template geometry changes append immutable template versions. Scan jobs are durable database records, with atomic claims, categorized failures and 15-minute leases. The monotonically increasing attempt fences both success/error commits, so a slow expired worker cannot overwrite a newer done/applied job. Missing/expired leases are recovered with a five-attempt cap; exhaustion is explicit. CV/OCR retains no database connection/transaction, and a fresh session rechecks the owner's current account, permissions and class assignments before committing. A scan does not automatically publish or confirm an uncertain result.

## Image processing

Both browser OpenCV.js and server OpenCV measure real images. The Python engine uses bounded image decoding, EXIF normalization, reference-square/page-boundary detection, four candidate orientations, perspective warping, illumination normalization, adaptive marker/ink thresholds, and radius-scaled circle/square-aware per-option measurements. Orientation is chosen from printed bubble-outline evidence, **never the answer key**. The browser uses local-paper-relative pixel evidence and independently gates printed-outline readability: a QR orientation hint cannot certify a missing grid. Clipped, dark or missing samples are invalid rather than silently blank. QR/barcode identity and geometry are validated. Per-answer confidence, status and original/aligned coordinates accompany the result. Partial, erased, multiple, uncertain and unreadable marks are surfaced, not invented. Unmatched identities remain review-only. Synthetic exposure/shape/perspective/blur fixtures and production-bundle browser tests exercise these paths, but do not establish a physical-sheet/device accuracy percentage.

The server's Tesseract integration is optional and explicitly reports when its executable is absent. Local browser Tesseract remains functional independently. This is an optical/classical-CV product; no untrained "AI accuracy" claim is made.

## Storage / cloud

`DATABASE_URL=postgresql+psycopg://...` selects PostgreSQL. The enterprise Docker/Compose topology uses explicit Alembic migrations, a non-root Python runtime, a private non-superuser PostgreSQL role and a same-origin Caddy HTTPS ingress. With automatic migrations disabled, startup requires the exact application migration head before accepting traffic. See `DEPLOYMENT.md` for operational/verification limits. `S3_BUCKET`, region, optional endpoint and standard AWS credentials select S3-compatible object storage; otherwise encrypted local objects are used. Remote SMTP enables email recovery. Without these settings the application is a local server, **not a deployed cloud service**. A QA PostgreSQL 16.2 binary supplied by an optional test-only wheel is isolated on a private Unix socket; it must not be used as a production database.

Workspace recovery points do not replace database disaster-recovery backups, original-image backups, the encryption key, or off-site retention. Use managed PostgreSQL point-in-time recovery and versioned object storage for production. Losing the encryption key makes stored encrypted objects unrecoverable.

## Reproducibility and verification

`backend/requirements.in` / `requirements-dev.in` declare selected versions; `.lock` files pin the tested CPython 3.11 closures with published non-yanked PyPI artifact SHA-256 hashes. Runtime contains 52 distributions; development contains 85, including development-only Bandit. `scripts/lock-python.py` checks installed direct/transitive specifiers, registry identity and digests and completes both closures before writing. Docker/CI enforce `--require-hashes --only-binary=:all:` to avoid unpinned source-build dependencies. A clean Linux x86-64 CPython 3.11 install and a rejected tampered hash exercise these guarantees; other platform closures and publisher/build provenance need separate verification. `package-lock.json` locks JavaScript dependencies. Optional PostgreSQL QA binaries have their own input file and are excluded from runtime/development locks.

Run `python -m pytest`, `ruff check backend scripts`, `npm run test:all`, `npm run build`, and the browser tests. See `PROGRESS.md` for actual executed results, `SECURITY_AUDIT.md` / `PERFORMANCE.md` for review and measurements, and `ACCEPTANCE.md` for remaining release gates rather than assuming every requirement is complete.
