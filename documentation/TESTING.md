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

`e2e/enterprise.spec.ts` is one ordered, isolated workflow. Steps share the records they deliberately create; rerun the **whole test with a fresh helper**, not a middle step against yesterday's database.

1. First-admin setup through the UI; real API/database-backed classes, students and two differently assigned assessments. No fictional dashboard counters.
2. Column-mapped CSV import, valid/duplicate/invalid preview, actual invalid-row download, no insertion before explicit confirmation, and transactional confirmation.
3. UI creation of a class-assigned teacher and a linked student account; password accessibility and correct new-member action.
4. A raster image containing **real drawn ink**, QR and registration markers goes through the actual native OpenCV worker. The deliberately double-marked response remains unverified; applying a page requires explicit student/identity verification. Original bytes and `no-store` headers are checked.
5. Result evidence/overlay opens; a human correction changes the saved selection and actual evaluation history. Applying/reloading a batch must not switch the selected assessment.
6. Real PDF/XLSX/CSV downloads and editable institution settings; checks include file signatures and CSV content, not just success toasts.
7. Four real marked-image exposure variants (dark/overexposed/shadow/faded print) pass through browser OpenCV.js and retain the measured A–E selections with verification still false. A sharp QR/marker image with its bubble grid removed is rejected visibly, without changing any result or workspace revision. The scanner discloses encrypted server-original retention accurately.
8. Teacher projection excludes the other class; unauthorized record access is rejected. Student publication starts private, becomes visible only after an administrator publishes, and another learner's report remains forbidden. Desktop portal statistic cards share a baseline.
9. Service-worker cache includes the PDF `.mjs` worker and excludes `/api` responses. An encrypted offline edit survives full reload/passphrase unlock. A downloaded blank OMR PDF is rasterized and genuinely scanned by OpenCV.js **while disconnected**. Its measured blank answers, engine and retained original are checked after reconnect/upload/materialization.
10. Six enterprise screens at 1440/768/390 pixels in dark and light themes (36 combinations), with no document overflow. Screenshots are retained for visual review.
11. No uncaught page errors. Console errors fail except specifically expected disconnected-network requests and initial unauthorized session checks. These exceptions are not general error suppression.

The hook regressions in `src/session.test.tsx` additionally record render-time save status (before passive effects), delayed encrypted writes, rapid undo before submission, offline undo, and undo during original-image materialization. A "saved" badge must not precede server acknowledgment; "queued" must not precede the current encrypted write. Existing lost-ack receipt, stale-revision preservation, authorization reduction and deferred-logout checks remain enabled.

This does **not** establish arbitrary-photo accuracy, OCR correctness on every identity, physical Android behavior, all report categories, every authorization race, install-prompt/update lifecycle, or cloud reliability. The real-ink image is a deterministic fixture, not a production accuracy corpus; detection is never mocked or derived from the answer key. The offline PDF is intentionally blank and therefore checks blank detection, PDF/WASM/OCR asset availability and synchronization rather than a second full marked-answer accuracy corpus.

Failure artifacts: `.cache/qa/e2e-artifacts/` includes screenshots, an accessibility snapshot and a Playwright trace on failure. Open a trace locally with `npx playwright show-trace <trace.zip>`. A trace can contain QA cookies, requests and synthetic credentials; never publish traces from real student sessions.

## Optical, worker-lease and dependency-integrity regressions

- `backend/tests/test_omr{,_conditions}.py`: **34 genuine native-CV cases**, including all option counts, rotation/perspective, dark/bright/shadow/faded exposure, circles/squares at radius 5–25, JPEG/half-resolution input, empty/residual/partial/multiple/crossed marks, safe blur rejection/review, wrong templates, answer-key independence and the last page of a 500-question/five-page form. Generated fixtures are test pixels, not generated answers: the engine itself measures them.
- `src/omr.test.ts` / `omrQuality.test.ts`: actual pixel exposure/blank/invalid-sampling regressions and shape-aware, answer/QR-independent outline contrast. QR orientation hints cannot substitute for a readable grid.
- `backend/tests/test_scan_leases.py`: seven cases run on **both databases**, deliberately delaying real CV. They reproduce an expired worker overwriting a newer applied job, three mid-processing authorization reductions, missing/expired lease exhaustion and stale error completion. All seven were observed failing before the attempt-fenced/fresh-authorization fix; no CV answers are mocked.
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
