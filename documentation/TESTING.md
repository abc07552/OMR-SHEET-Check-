# Testing and evidence

Use synthetic students and a **dedicated QA database**. Never run browser setup/import tests against a live institution. Test output, downloads, traces and local QA databases belong in ignored `.cache/`, not Git.

## Reproducible checks

Locally inspected development environment: Node 22.22.3/npm 10.9.8, CPython 3.11.2, locked npm/Python dependencies. Node 24 is the configured CI/container build target, not an inferred local test result. The Python lock is for 3.11; do not silently resolve a different dependency set on another Python version.

```sh
npm ci
python3.11 -m venv .venv
.venv/bin/pip install --require-hashes --only-binary=:all: -r backend/requirements-dev.lock
npx playwright install --with-deps chromium

npm run format:check
.venv/bin/ruff check backend scripts
.venv/bin/ruff format --check backend scripts
npm run test:all
.venv/bin/pytest -q backend/tests
npm run build

npm audit
.venv/bin/pip check
.venv/bin/pip-audit -r backend/requirements.lock --require-hashes --disable-pip --vulnerability-service pypi
.venv/bin/pip-audit -r backend/requirements-dev.lock --require-hashes --disable-pip --vulnerability-service pypi
```

The audit commands read the **fully pinned, SHA-256 hash-locked runtime and development closures** without resolving new dependencies. CI and Docker require hashes and wheels; a clean CPython 3.11 environment was installed with those exact restrictions, and an intentionally incorrect hash was rejected. Regenerate only from an intentionally installed/tested environment with `scripts/lock-python.py`; it verifies installed specifiers and reads non-yanked PyPI artifact hashes before replacing either lock. This does not provide signed publisher/build provenance. A clean advisory scan is a point-in-time result, not a penetration-test or supply-chain certification. Do not suppress an advisory or an unavailable audit service to make CI appear green.

`npm test` deliberately uses `vitest run src`. Unrestricted Vitest collection also picks up the separate `node:test` suites; use `npm run test:server` for those preserved regressions.

### PostgreSQL parity

Set `OMR_TEST_POSTGRES_URL` only to a dedicated QA database. This is a **plain psycopg URI** (`postgresql://…`, not SQLAlchemy's `postgresql+psycopg://…`). Use server environment/secret controls rather than publishing credentials in a command transcript.

```sh
# After setting OMR_TEST_POSTGRES_URL privately:
.venv/bin/pytest -q backend/tests
```

The fixture runs the database-dependent cases on both SQLite and PostgreSQL, creating a random `test_*` schema per PostgreSQL case and dropping that exact schema on teardown. Pure scoring/image tests run once. The QA role needs permission to create/drop its own schemas. Do not use a shared schema, production credentials or a database another tool may reset.

`scripts/local-postgres.py` and `backend/requirements-postgres-test.in` are optional sandbox helpers, not a supported production database. The locally exercised QA binary was PostgreSQL 16.2; CI is configured with PostgreSQL 17. Cloud/PostgreSQL-provider behavior still needs provider-specific validation.

## Authenticated browser/PWA regression

Build first: the browser test exercises the **production bundle and service worker**, not the Vite development server.

```sh
npm run build
OMR_E2E_ALLOW_SETUP=1 npm run test:e2e
```

By default Playwright starts `scripts/e2e-server.py` on port 8010, waits for `/api/health`, runs the workflow, then terminates it. Port 8010 must be free; `reuseExistingServer` is deliberately false. Every launch gets a new `.cache/e2e/server-*` directory and either:

- a new, separate SQLite database; or
- a random `omr_e2e_*` PostgreSQL schema when `OMR_TEST_POSTGRES_URL` is set.

The setup assertion refuses a populated database. The helper never resets a school or uses `.data/markly.sqlite`. PostgreSQL cleanup runs **inside the ASGI shutdown lifespan**, before Uvicorn re-raises SIGTERM; cleanup was checked against the PostgreSQL catalog after a managed run. A hard kill/crash can leave a QA schema behind. Remove only the specific schema you created, after checking no QA server is still using it. Never use a wildcard schema-deletion command.

The local `.cache/e2e/server-*` data directories are retained for investigation; they are synthetic but still contain sessions/encryption material. Delete them deliberately when no process is using them. They are ignored by Git and not included in CI evidence uploads.

Advanced overrides:

- `OMR_TEST_PYTHON`: Python executable for the helper and real-ink fixture (default `.venv/bin/python`).
- `OMR_E2E_BASE_URL`: use an explicitly managed **fresh QA server** instead; the setup/write guard still applies.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`: existing compatible Chromium, useful in restricted sandboxes. Normal installations should use Playwright's browser.
- Sandbox Chromium may need OS libraries exposed through `LD_LIBRARY_PATH`; this is not an application requirement.

### What the committed browser test asserts

`e2e/enterprise.spec.ts` contains an ordered enterprise workflow, a real
password-registration/security workflow and a mixed-integer/layout-import
workflow. The helper explicitly enables
public signup for **disposable QA only**, and explicitly leaves Google
credentials empty. Rerun the **whole file with a fresh helper**, not a middle step
against yesterday's database.

1. First-admin setup through the UI; real API/database-backed classes, students and two differently assigned assessments. No fictional dashboard counters.
2. Column-mapped CSV import, valid/duplicate/invalid preview, actual invalid-row download, no insertion before explicit confirmation, and transactional confirmation.
3. UI creation of a class-assigned teacher and a linked student account; password accessibility and correct new-member action.
4. A raster image containing **real drawn ink**, QR and registration markers goes through the actual native OpenCV worker. The deliberately double-marked response remains unverified; applying a page requires explicit student/identity verification. Original bytes and `no-store` headers are checked.
5. Result evidence/overlay opens; a human correction changes the saved selection and actual evaluation history. Applying/reloading a batch must not switch the selected assessment.
6. Real PDF/XLSX/CSV downloads and editable institution settings; checks include file signatures and CSV content, not just success toasts. A deliberately delayed genuine settings GET keeps placeholder controls disabled; saving checks the actual PUT payload, successful acknowledgment and final database value.
7. Four real marked-image exposure variants (dark/overexposed/shadow/faded print) pass through browser OpenCV.js and retain the measured A–E selections with verification still false. A sharp QR/marker image with its bubble grid removed is rejected visibly, without changing any result or workspace revision. The scanner discloses encrypted server-original retention accurately.
8. Teacher projection excludes the other class; unauthorized record access is rejected. Student publication starts private, becomes visible only after an administrator publishes, and another learner's report remains forbidden. Desktop portal statistic cards share a baseline.
9. Service-worker cache includes the PDF `.mjs` worker and excludes `/api` responses. An encrypted offline edit survives full reload/passphrase unlock. A downloaded blank OMR PDF is rasterized and genuinely scanned by OpenCV.js **while disconnected**. Its measured blank answers, engine and retained original are checked after reconnect/upload/materialization.
10. Six enterprise screens at 1440/768/390 pixels in dark and light themes (36 combinations), with no document overflow. Screenshots are retained for visual review.
11. No uncaught page errors. Console errors fail except specifically expected disconnected-network requests and initial unauthorized session checks. These exceptions are not general error suppression.

The seven `src/SystemCenter.test.tsx` form regressions cover loading gates, dirty refetch retention, snapshot-bound revisions, visible retained conflicts, in-flight locking, acknowledged-cache ordering, post-unmount privacy fencing and explicit discard confirmation. All seven were run against the pre-fix source and observed failing before the fix. The form is keyed by user/institution; no draft is reused across that boundary.

The hook regressions in `src/session.test.tsx` additionally record render-time save status (before passive effects), delayed encrypted writes, rapid undo before submission, offline undo, and undo during original-image materialization. A "saved" badge must not precede server acknowledgment; "queued" must not precede the current encrypted write. Existing lost-ack receipt, stale-revision preservation, authorization reduction and deferred-logout checks remain enabled.

This does **not** establish arbitrary-photo accuracy, OCR correctness on every identity, physical Android behavior, all report categories, every authorization race, install-prompt/update lifecycle, or cloud reliability. The real-ink image is a deterministic fixture, not a production accuracy corpus; detection is never mocked or derived from the answer key. The offline PDF is intentionally blank and therefore checks blank detection, PDF/WASM/OCR asset availability and synchronization rather than a second full marked-answer accuracy corpus.

Failure artifacts: `.cache/qa/e2e-artifacts/` includes screenshots, an accessibility snapshot and a Playwright trace on failure. Open a trace locally with `npx playwright show-trace <trace.zip>`. A trace can contain QA cookies, requests and synthetic credentials; never publish traces from real student sessions.

## Google/signup/Drive regressions

See [GOOGLE_AUTH_DRIVE.md](GOOGLE_AUTH_DRIVE.md) for configuration and live-test
boundaries. `backend/tests/test_google_and_drive.py` uses bounded HTTPX synthetic
provider transport but real generated RSA signatures / X.509 certificates and
the official Google verifier. Both database engines exercise state/cookie/nonce/
PKCE/ticket replay, forged/invalid identity, password-confirmed linking, isolated
signup, recent-Google first-password creation, scope separation, encrypted refresh
credentials, cross-user/school/role refusal, durable upload retries, expired-lease
file-ID fencing, integrity checking, non-destructive import, password/revision
restore and revoked/disconnected provider behavior. No OMR detection is mocked.

`test_registration.py` covers opt-in/bootstrap boundaries, verified production
SMTP signup, chosen-password proof, expiry/single-use, non-enumerating responses,
throttles, pending-signup resend protection and preservation of existing users /
sessions through the additive migration. SMTP transport and Google service are
synthetic; external delivery/consent/quotas are not certified.

`src/googleAuth.test.ts` checks real client S256 proofs, external-browser-only
launch, origin/package/path/ticket bounds and cancellation of a late start after
school departure. `GoogleReturn.test.tsx` checks one completion under React Strict
Mode, cancellation, absent/mismatched proof and password-linking explanations.
The session suite checks legacy-server 401 logout after prior revocation so it
cannot strand sign-in in an offline loop.

`GoogleNativeBridge.test.tsx` covers cold-launch and warm callback dispatch,
origin/proof loss, sign-out/server departure and explicit native-plugin failure.
Its cold-return regression reproduced duplicate listener/launch-URL processing
when a route change replaced React Router's navigate callback; the listener now
retains a stable lifetime and uses the current navigation ref. These are JS
plugin-shaped tests, not real-device instrumentation. AccountSecurity tests cover
password confirmation, error feedback, Google-only password creation and expired
five-minute authorization exposing a reauthentication button. The Alembic schema
comparison covers the new tables, constraints, indexes and account/session
columns on both database engines; a SQLite boolean-default representation drift
was reproduced and fixed with SQLAlchemy's portable `true()` expression.

The second Playwright test registers a new isolated institution through the real
portal, checks password confirmation, changes password, signs out/reloads/signs
back in, and verifies the unconfigured Drive panel/disabled connection rather
than pretending Google is connected. It checks six Drive-screen theme/viewport
combinations. Its first run **reproduced an offline sign-in loop after password
revocation**; logout is now idempotent and deferred revocation treats an already-
revoked legacy cookie as complete. The unchanged registration/re-login assertions
then passed with the entire genuine enterprise browser test.

## Optical, worker-lease and dependency-integrity regressions

- `backend/tests/test_omr{,_conditions}.py`: **34 genuine native-CV cases**, including all option counts, rotation/perspective, dark/bright/shadow/faded exposure, circles/squares at radius 5–25, JPEG/half-resolution input, empty/residual/partial/multiple/crossed marks, safe blur rejection/review, wrong templates, answer-key independence and the last page of a 500-question/five-page form. Generated fixtures are test pixels, not generated answers: the engine itself measures them.
- `src/omr.test.ts` / `omrQuality.test.ts`: actual pixel exposure/blank/invalid-sampling regressions and shape-aware, answer/QR-independent outline contrast. QR orientation hints cannot substitute for a readable grid.
- `backend/tests/test_scan_leases.py`: seven cases run on **both databases**, deliberately delaying real CV. They reproduce an expired worker overwriting a newer applied job, three mid-processing authorization reductions, missing/expired lease exhaustion and stale error completion. All seven were observed failing before the attempt-fenced/fresh-authorization fix; no CV answers are mocked.
- `backend/tests/test_object_store.py`: real-Fernet local/S3-shaped stream boundaries, valid near-limit ciphertext, before/after-decryption size limits, corrupt-token refusal and provider-stream closure on success/failure. Ten checks failed before the fix; all 11 pass afterward. No external bucket is contacted.
- `backend/tests/test_dependency_lock.py`: specifier/extras/platform-marker checks, invalid registry identity/hash refusal, yanked-file handling and failure preserving both existing lock files.
- `backend/tests/test_scoring.py`: decimal rules, ties/strict-lower percentiles/review exclusion, and different keyed maxima where score order is not percentage order.

```sh
.venv/bin/bandit -r backend -x backend/tests,backend/migrations
.venv/bin/python scripts/benchmark.py --records 1000 5000 --questions 20 --iterations 3
```

See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) and [PERFORMANCE.md](PERFORMANCE.md) for exact executed findings, benchmarks and their limits. The benchmark opens no school database and imposes no noisy-runner timing threshold; it checks correctness as well as measuring wall time.

## Migration and trusted recovery drills

`backend/tests/test_maintenance.py` executes actual migrations against both database engines:

- consistent SQLite backup with committed WAL data; source/main-WAL fingerprints unchanged;
- two schools sharing record IDs/roll numbers safely across school boundaries;
- 500-question, A–E, five-page records, template versions, all 1,000 answer detections, evaluation/report preservation and validated institution preferences;
- legacy scrypt sign-in upgrades to Argon2id; old sessions are not imported; teachers initially have no class assignments;
- populated-destination refusal, source=destination refusal, missing-source guard and CLI confirmation requirement;
- invalid second school rolls back all first-school records while retaining the private source snapshot;
- hidden recovery prompts (substituted in the test), mismatched confirmation rollback, old-password/session/reset-token revocation, and unchanged school records.

These automated fixtures mirror the preserved Node schema and use synthetic records only. A separate local rehearsal also created a two-school source through the actual Node service APIs, invoked the migration CLI into an isolated PostgreSQL schema, and drove the recovery CLI through a real pseudo-terminal. It verified unchanged source files, 500-question scores, populated-destination refusal, teacher restrictions, session revocation and absence of the new password from terminal output. Its ignored local summary is `.cache/qa/migration-cli-drill-result.json`; it is not a published real-school migration or a substitute for the committed tests.

Before a real cutover, follow [MIGRATION.md](MIGRATION.md), rehearse with a private representative backup, compare institution/record counts, scores, layouts and original evidence, and have a tested rollback path. Automated drills are not permission to migrate a live school without that review.

## CI and honest status

`.github/workflows/verify.yml` defines locked-dependency, frontend/Node/Python/PostgreSQL/browser/audit checks plus a separate Docker/Compose/migration/non-root/container-encryption smoke job. Actions are pinned to verified upstream commit SHAs. CI creates only disposable records and retains evidence for seven days. Repository permissions/branch protection must be configured by its owner; the presence of this workflow is not evidence that a GitHub run passed.

Both jobs in [run 44541435692](https://github.com/abc07552/OMR-SHEET-Check-/actions/runs/44541435692) passed for source checkpoint `ff57c72`, including real container execution. A parallel PR run exposed a test-only fake-IndexedDB teardown race; pending encryption is now drained before swapping factories, and assertions wait for durable queued status rather than only the in-memory cache. The vault's refusal to overwrite locked data was preserved. Check current PR-head results rather than treating that earlier success as evidence for every later commit.

Current **executed** results, caveats and open deployment/device acceptance work are recorded in [PROGRESS.md](PROGRESS.md). Reproduce a failure, identify the cause, add a regression, fix it and rerun the affected checks before claiming it resolved.

### Inspecting a restricted CI failure

Playwright emits structured GitHub failure annotations in Actions as well as retaining traces; retries remain disabled. If a sandbox cannot reach the signed archive host, an operator can dispatch the existing verification workflow with `diagnose_run` set to a failed run number. This read-only diagnostic path accepts only failed runs of the **same synthetic workflow and branch**, emits compact, size-bounded failure-log/context annotations, and runs in a separate concurrency group. A follow-up context step inspects only the synthetic artifact and selected settings request/result fields; it does not expose session headers, cookies, logos or object URLs. Leave the input empty for normal full verification. It neither reruns nor marks the original failed check as passed. Never use this synthetic-data workflow for real student sessions.

## Android build and native-bridge regressions

See [ANDROID.md](ANDROID.md) for the corrected workflow, exact native toolchain,
configuration, download and physical-device acceptance checklist.

- `src/native.test.tsx`: browser download URL lifecycle; exact native binary/MIME
  payload; completion only after the native writer resolves; cancelled/failed
  saves without fake browser fallback; filename safety; bounded allocation;
  visible encoding failure; platform-specific printing.
- `src/android-config.test.ts`: default demo versus trusted same-origin HTTPS
  deployment; invalid/credential-bearing/localhost/wildcard URL refusal; camera,
  backup, transport and narrowly scoped FileProvider permission guards.
- `src/session.test.tsx`: the bundled APK opens an explicitly unprotected local
  demo without trying to authenticate against an imaginary `/api`.
- `src/PWAStatus.test.tsx`: bundled assets avoid stale PWA registration; hosted
  clients retain actual cache readiness and visible registration errors.
- `backend/tests/test_android_workflow.py`: a failing compiler process cannot be
  hidden by log capture; successful output is retained; the actual error cause
  survives long stacks; percent-heavy annotations stay bounded. Three regressions
  failed before the pipeline/diagnostic fix; all four pass after it. The tiny
  executable in these tests checks shell plumbing, not Android compilation.
- Native `ExportPolicyTest`: real JVM filename/MIME/base64 size validation.
  `.github/workflows/main.yml` builds web assets, synchronizes Capacitor, runs
  `testDebugUnitTest lintDebug assembleDebug` inside `android/`, then checks the
  APK signature, launchable activity, package and API levels before upload.

The original failing run is the reproduced missing-project/wrapper failure, not
a compiler result. Local web/bridge tests are not a native APK compilation. Use
the successful Actions run's exact commit and downloadable artifact as native
build evidence. `connectedDebugAndroidTest` and hardware camera/file-picker/print/
hosted-cookie acceptance require an actual device or emulator and are not counted
as passing simply because a workflow file or instrumented test exists.

## Android runtime FastAPI connection

The default APK now starts at **Connect your school**; demo exploration is an
explicit separate action. Regressions include `src/serverConnection.test.ts`,
`src/ServerConnection.test.tsx`, `src/session.test.tsx`,
`backend/tests/test_connection.py` and `SchoolServerPolicyTest.java`.

- Origin validation rejects credentials, HTTP, API paths, queries/fragments,
  loopback, ambiguous numeric hosts, control characters and overlong input.
- The credential-free native probe checks a versioned connection contract,
  same-origin client availability and actual database connectivity. No TLS bypass,
  redirects, cross-origin cookie proxy or unbounded metadata allocation is used.
- Component tests cover explicit check/approval, invalidating stale UI checks,
  network/certificate/cancellation errors, development/SQLite warnings, delayed
  preference lookup, demo separation and disconnect controls. Their native bridge
  doubles exercise UI behavior only, **not a real Android device or TLS stack**.
- Real SQLite/PostgreSQL API tests cover public metadata/no secrets/no CORS
  widening, absent/unmounted client, unavailable database, and actual first-admin
  setup, logout, sign-in and protected team access after discovery.
- The production Playwright workflow additionally verifies real discovery and
  the browser connection modal before real admin setup. Its full existing
  restricted-teacher/student, native OpenCV, reports and encrypted offline
  workflow must still pass.
- Two hook regressions cover private-vault locking and late login/bootstrap
  responses after native departure. The bootstrap case reproduced a private
  session being restored after departure before the epoch checks were added.
- Android CI requires **both** real JVM XML suites: at least four export-policy
  cases and six server-policy cases, with no failures/errors/skips. A separate
  synthetic-XML Python test verifies missing/failed/skipped native suites cannot
  pass the artifact gate; synthetic XML is never counted as native execution.

On representative devices, still test: valid production HTTPS pairing with
first-admin bootstrap and later sign-in; wrong/older/API-only hosts; invalid TLS,
redirects, slow/oversized responses and cancelled trust; process restart and
remembered origin; server/DNS/JavaScript failure with native Connection recovery;
logout and cookie clearing; pending encrypted queue recovery at its original
origin; independent schools/demo; camera/chooser/exports and APK upgrade. Do not
claim these physical checks from compilation, mocked UI tests or JVM policy tests.

## Three-digit and scanned-layout acceptance

The full local continuation passed **286 frontend / 33 preserved Node / 295
Python tests** (SQLite plus isolated PostgreSQL) and **all three** fresh
PostgreSQL/production-bundle browser workflows. See [PROGRESS.md](PROGRESS.md)
for executed checks, and [INTEGER_LAYOUT_SCANNING.md](INTEGER_LAYOUT_SCANNING.md)
for user steps, numerical semantics, limits and privacy.

```sh
npx vitest run src/integerLayout.test.ts src/IntegerAnswerInput.test.tsx
.venv/bin/pytest -q backend/tests/test_integer_omr.py
# Build first; the helper creates a fresh disposable database:
OMR_E2E_ALLOW_SETUP=1 npx playwright test -g 'scanned mixed layouts'
```

The new browser test actually imports a synthetic repeated-square sheet, reviews
its five 4×11 grids and excluded roll grid, selects the intended digit columns /
zero row, renumbers and accepts a draft, saves/reloads measured geometry, enters
mixed keys, downloads a real PDF, runs native and browser numeric ink reads and
explicitly confirms an incomplete grid as `007`. It checks retained 30-point
measurements, persisted manual evidence/history, result-type locks, numeric
analytics/CSV column alignment, dirty-layout download gates and mobile widths.

Native regressions additionally verify page-specific outline registration using
either the explicit page hint or a printed QR page identifier. The shared
synthetic fixture has signature `b6cec795` in TypeScript and Python, including
Pydantic roundtrip. Historical MCQ tests and migration source-preservation checks
remain enabled. A schema-default regression during this continuation was fixed by
keeping absent new layout fields absent in legacy serialization, not by weakening
the migration assertion.

A separate private browser rehearsal on the supplied photo found 351 circles,
20 MCQ rows, five 4×11 numeric candidates and one excluded 5×10 identity grid.
Reviewed mapping, save/reload/coordinate editing, genuine PDF/PNG download and
reference-photo removal passed. Keys stayed null, and native CV reread the printed
blank template as 25 blank responses with no flags. The photo and derived
reference-containing artifacts stay ignored; **never add them to public fixtures
or CI evidence uploads**. Only anonymous synthetic fixtures are committed.
This single-photo geometry check is not a general optical-accuracy benchmark or
physical-device/camera/print certification.
