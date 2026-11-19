# Implementation and verification ledger

This ledger distinguishes implemented/tested work from the full target specification. It is not production certification or a claim that all bugs are fixed. The original integration [PR #1](https://github.com/abc07552/OMR-SHEET-Check-/pull/1) was merged into `main` at `b3d94f3`; subsequent work continues on the current Arena branch. The existing Markly application/data are preserved.

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

Local runtime inspected: **Node 22.22.3 / npm 10.9.8, CPython 3.11.2, PostgreSQL 16.2 QA**, Chromium 153 from the sandbox. Node 24/Python 3.11/PostgreSQL 17 and container packaging were separately exercised by successful [GitHub run 44541435692](https://github.com/abc07552/OMR-SHEET-Check-/actions/runs/44541435692) for source checkpoint `ff57c72`, not inferred from the local runtime. Check the PR's latest-head checks as well; a past successful run does not certify subsequent changes.

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

Both jobs in that GitHub run completed successfully: full regressions/audits and the enterprise container smoke test. The latter built the image, validated Compose/Caddy, initialized real PostgreSQL, applied Alembic migrations, and checked non-root UID, native OCR executable availability, a non-superuser database connection and encrypted storage roundtrip. It did not deploy public HTTPS or external cloud services.

A parallel PR run at `ff57c72` caught a **test-fixture isolation race**: the offline-undo test observed the in-memory cache before its encrypted write completed, and teardown replaced the fake IndexedDB factory while that captured write was still running. The next test correctly refused to overwrite the existing vault. Teardown now drains writes via `forgetVault` before changing fake databases, and the undo assertion waits for durable queued status. No production vault safeguard was removed and no test was skipped. The full 97-test frontend suite then passed three consecutive two-worker runs. Refer to current PR checks for the follow-up CI result.

The committed Python maintenance regressions additionally exercise WAL-consistent backup/source fingerprints, same IDs/rolls across schools, five-page/A–E layouts, all 1,000 retained answer detections, template/evaluation/report preservation, legacy scrypt → Argon2id upgrade, no imported sessions, initially unassigned teachers, confirmation/source/destination guards and whole-transaction rollback when the second school is invalid.

The actual CLI/TTY rehearsal used a **separate synthetic database created through the real preserved Node setup/workspace/account APIs**, not `.data/markly.sqlite`. It then invoked the Python CLI as a subprocess, verified scores/restrictions, and drove `reset-password` through a real pseudo-terminal. The new password was absent from the captured terminal transcript. This is distinct from the automated prompt-substitution unit tests, and not a migration of the user's installation.

Ignored local evidence includes `.cache/qa/continuation-{unit-tests,python-tests,production-build}.log`, `continuation-e2e-{1,2,3}.log`, advisory JSON reports, Playwright screenshots/traces and `migration-cli-drill-result.json`. These are transient QA artifacts, not published school data or permanent Git artifacts. Committed tests and [TESTING.md](TESTING.md) describe reproducible checks and coverage boundaries.

### Interpretation and remaining acceptance work

- Docker Engine is **not installed in the sandbox**. Container verification ran in GitHub Actions, not locally; its successful image/Compose/Caddy/migration/storage smoke result is linked above. No permanent HTTPS/cloud/S3/SMTP deployment has been provisioned, and a smoke test is not production/device certification.
- The latest production bundle still warns about large lazily loaded ExcelJS/PDF/OpenCV assets. It precaches about 22.6 MiB. There is no claim of a low-end Android memory/CPU/load-time benchmark or optimized production capacity.
- The browser suite executes genuine native ink detection and a genuine **blank** offline PDF scan, not an arbitrary-photo accuracy corpus. Native Tesseract is absent on the local host; browser OCR assets are available, and the container is configured to install native OCR. Neither that configuration nor a synthetic fixture certifies OCR identity accuracy.
- The 36 current responsive checks cover six enterprise screens. Earlier baseline tests (500 questions, multipage PDFs, browser OCR/camera and 99 page/viewport combinations) predate enterprise integration and are not counted as fresh all-screen/device acceptance.
- Physical Android cameras, real printed forms/erasures/shadows/lighting, offline install/update lifecycle, additional report formats/categories and large-school performance still need dedicated acceptance work.
- Synchronization/session/crypto tests cover selected races, including lost acknowledgments, conflicts, edits/undo during upload, queue durability, stale images/account revalidation and deferred offline logout. They are not an exhaustive proof of every lifecycle or multi-device interleaving.
- Synthetic migration/recovery drills do not replace a representative private rehearsal, count/score/layout/evidence reconciliation, a consistent PostgreSQL/object/key restore drill and operator-approved rollback for an actual school.
- Runtime/development dependency advisory scans are point-in-time snapshots. Python artifacts are now SHA-256 hash-locked and binary/hash enforcement is exercised by a clean install and negative tamper check (see the continuation below). Publisher signatures, immutable base-image provenance and operating-system vulnerability scans remain separate work; no penetration-test or supply-chain certification is claimed.
- Protected cloud service configuration, managed PostgreSQL failover/PITR, S3 retention/permissions, SMTP delivery and external TLS/proxy operation remain operator/provider validation work.

A draft pull request is a review checkpoint, not a declaration that every requested production/physical-device acceptance criterion is complete. Continue the reproduce → root cause → regression → fix → retest → document loop on the same branch.

## Optical, worker-lease and dependency-integrity continuation

The previous `fe280f5` checkpoint passed both the push [44543127429](https://github.com/abc07552/OMR-SHEET-Check-/actions/runs/44543127429) and PR [44543139014](https://github.com/abc07552/OMR-SHEET-Check-/actions/runs/44543139014) verification workflows. Those runs verified the earlier offline-test isolation fix, not the changes below.

### Reproduced defects and working fixes

- Seven deliberately delayed **real-CV worker cases** first failed: an expired worker overwrote a newer applied job; three permission/account/class revocations were missed during CV; expired/null leases were not bounded; and late failure could overwrite a newer decision. Attempt-fenced success/error commits, fresh authorization before finalization, released database connections during CV and five-attempt recovery limits now pass on SQLite and PostgreSQL. The combined targeted queue suite passed **22 tests**.
- The native optical fixture expansion initially isolated **10 genuine exposure/shape failures**, separate from fixture-anchor rounding. Radius-scaled windows, normalized absolute thresholds, adaptive markers and circle/square-aware rings now pass **34 genuine native-CV cases**, including dark/bright/shadow/faded print, radii 5–25, blur/compression, partial/residue/multiple marks and a final 500-question-layout page.
- Six failing browser pixel/quality regressions led to local-paper-relative analysis and adaptive registration. Clipped/dark/missing samples are flagged invalid rather than blank. A distinct printed-grid gate cannot be bypassed by a sharp QR. The targeted browser tests passed **22 tests**; production-bundle Playwright additionally checks four real exposure images with measured A–E selections and missing-grid rejection with no persisted result/revision change. All detections remain unverified until a person reviews them.
- Scanner/overview retention copy now distinguishes authenticated encrypted server originals, native uploads, optional offline vaults, the legacy server and the unencrypted device demo. No false device-only privacy promise remains in those screens.
- Measured a quadratic backend percentile scan and replaced it with sorted percentages / binary search, preserving tie rules, review exclusion and differing-set maxima. Three-sample synthetic 20-question analytics medians changed **264.866 → 235.533 ms (1,000 responses)** and **2,409.447 → 1,240.125 ms (5,000)**; output checksums are identical. These are local microbenchmark observations, not concurrency/SLA/device capacity. See [PERFORMANCE.md](PERFORMANCE.md).
- Runtime **46** / development **82** Python distributions now have PyPI SHA-256 artifact locks. Existing versions were retained; Bandit/PyYAML/stevedore are development-only additions. Both Docker and CI require binary/hash installs. A clean CPython 3.11 environment installed the whole development closure, passed `pip check` and imported the runtime; a deliberately wrong artifact hash was refused. Six lock-generator regressions cover constraints/markers/metadata/digests/yanked files/failure preservation.

### Executed checkpoint verification

- Full backend suite in the **clean hash-installed environment**: **124 passed in 64.54 seconds**, with `OMR_TEST_POSTGRES_URL` enabling isolated real PostgreSQL schemas. Ruff lint and format checks passed across **38 Python files**.
- Final local recheck: frontend **107 tests across 7 files**, preserved Node **30 tests**, whole-repository configured Prettier check and TypeScript/Vite/PWA production build all passed. Vite's build step took **17.46 seconds**. The expanded browser workflow was rerun with the **clean hash-installed Python environment** and a fresh PostgreSQL schema: **48.5 seconds test / 51.3 seconds overall**, with exact-schema cleanup logged. Workflow duration is not page-load/scan latency; latest-head CI must still verify the combined checkpoint on its own runtime.
- Fresh npm audit: **0 known advisories**; both Python runtime/development hash-aware advisory scans: **no known vulnerabilities**. Bandit **1.9.4** found **0 issues in 4,332 production-backend lines**, excluding tests/migrations, with no `nosec` annotations or skipped rules. These are scoped checks, not an independent penetration test.
- No schema migration, baseline database replacement, cloud provisioning or arbitrary-photo accuracy claim was made. The production precache remains about **22.6 MiB** with large-chunk warnings. Physical Android/print acceptance, external HTTPS/S3/SMTP, full disaster recovery and representative deployment load remain unverified.

Local failure/after logs, benchmark JSON, hash-install reports, advisory results and browser evidence are retained in ignored `.cache/qa/accuracy/`; committed suites provide reproduction without publishing school data. Formal deliverables: [security review](SECURITY_AUDIT.md), [performance measurements](PERFORMANCE.md), and [19-stage acceptance map](ACCEPTANCE.md). The acceptance map also records remaining **configurable clock-driven backup scheduling** and **richer report-template editing** rather than silently treating them as completed.

## Encrypted-storage boundary and CI-diagnostic follow-up

- A final storage review found S3 reads using the plaintext upload cap on larger Fernet/base64 ciphertext. The new lightweight real-encryption/SDK-shaped-stream tests reproduced **10 failures / 1 pass**, including valid boundary truncation, unclosed bodies and asymmetric size bounds. Exact ciphertext-size allowance, bounded local/provider reads, pre-write/post-decryption limits and guaranteed response closure now pass **11 tests**. No external S3 service was contacted or certified.
- Full backend rerun: **135 passed in 114.81 seconds**, with SQLite and isolated real PostgreSQL schemas, while a browser run was active. Three sequential fresh-schema production-bundle browser runs passed (**59.9 / 56.7 / 49.3 seconds test time**); each logged exact-schema cleanup. Ruff passed across **39 Python files**, configured Prettier passed, Bandit remained **0 findings / 4,346 production-backend lines / 0 suppressions**.
- At `c875049`, the [PR workflow 44552819386](https://github.com/abc07552/OMR-SHEET-Check-/actions/runs/44552819386) passed both jobs. The [push workflow 44552804136](https://github.com/abc07552/OMR-SHEET-Check-/actions/runs/44552804136) passed container/unit/database/build checks but **failed its browser step**. Its signed log archive could not be downloaded from this restricted sandbox. The failure is **not yet root-caused or declared fixed** merely because local/PR checks passed. Structured GitHub Playwright annotations and an opt-in, read-only, same-branch synthetic-log diagnostic dispatch were added to obtain the original failure context. No assertion/review safeguard was removed or retry added. Latest-head verification must complete before this continuation is accepted.

## Institution-defaults CI regression continuation

- Both normal verification workflows at `65631d2` passed: [push 44556807626](https://github.com/abc07552/OMR-SHEET-Check-/actions/runs/44556807626) and [PR 44556826491](https://github.com/abc07552/OMR-SHEET-Check-/actions/runs/44556826491), including container jobs. This does not erase the earlier failed push.
- The read-only [diagnostic dispatch 44556807249](https://github.com/abc07552/OMR-SHEET-Check-/actions/runs/44556807249) retrieved its otherwise inaccessible context: the earlier failure was in **institution-default persistence** (academic session remained empty), not optical measurement. Long check annotations were initially truncated by GitHub; compact/chunked annotations now retain their tails, with five unit checks for bounds and same-branch/workflow/run validation. A bounded synthetic artifact/context inspector adds request/response evidence without printing session headers.
- Added seven controlled form regressions and reran them against the pre-fix source: **7 failed → 7 passed**. Extracted `InstitutionDefaults.tsx`, keyed by actor/school: initial-snapshot loading gate, draft-preserving refetch, settings-specific CAS baseline, locked in-flight edits, visible retained conflicts, explicit confirmed discard/reload, acknowledged-cache-before-reload and post-unmount response fencing. Server authorization/CAS remain intact. The original browser persistence assertion was retained and strengthened with a delayed real GET and actual PUT/acknowledgment checks.
- Full local combined verification: **140 backend tests (78.76 seconds)** with real PostgreSQL parity, **114 frontend / 8 files + 30 Node tests**, Ruff across **40 Python files**, configured Prettier, strict TypeScript and production PWA build all passed. Vite build step: **19.28 seconds**, **51 precache entries / 23,118.81 KiB**. An initial TypeScript check caught test-helper typings; they were corrected without suppressions before rebuilding.
- Fresh-schema browser run with the loading regression and all genuine native/browser/offline checks passed: **49.5 seconds test / 54.0 seconds overall**, with exact-schema cleanup. Logs are `.cache/qa/accuracy/settings-*` and `institution-form-{before-complete,after}.log`. Latest-head GitHub checks must still verify this combined source; prior green runs are checkpoint-specific.

## Android workflow repair

The screenshot's original Android run
[44444843181](https://github.com/abc07552/OMR-SHEET-Check-/actions/runs/44444843181)
failed at root-level `chmod +x gradlew`: the repository contained neither that
wrapper nor an Android project. Its later `disabled_manually` workflow state is a
separate administrative state, with no evidenced attribution.

Implemented a real pinned Capacitor 8.6.2 project, Gradle wrapper with distribution
checksum, SDK 36/JDK 21 CI, web synchronization, native JVM/lint/build checks and
verified APK/checksum upload. Default APK behavior is an explicitly unprotected
device-only demo; a public, validated HTTPS origin can select a separately
deployed school app with same-origin cookies/API. No backend hosting or signing
secret is invented. Added Android runtime-camera declaration, restricted capture
FileProvider, disabled automatic backup/cleartext/debug bridge logging, Save As
and print bridges, awaited export failures, and native-versus-hosted PWA guards.

Local verification: **150 frontend tests / 11 files and 30 preserved Node tests
passed**, along with TypeScript, formatting and npm audit (0 advisories).
The production Android web bundle and Capacitor synchronization also passed.
These checks are executed independently of the native compiler.
A first native attempt stopped during Gradle default-configuration evaluation
and uploaded no APK. Version-code conversion now uses an explicit integer
assignment. Three failing pipeline/diagnostic regressions were reproduced and
fixed (four checks now pass): preserve compiler failure through `tee`, retain the
actual cause before stack frames and bound annotation escaping. Upload also
requires the native JVM XML to show executed tests with no errors/failures/skips. Native compilation
requires JDK 21/SDK 36, unavailable in the restricted local sandbox; consult
**Build Android APK** for the actual exact-commit build outcome and artifact, not
the earlier web checks. Hardware/emulator acceptance, release signing and hosted
school deployment remain separate gates. Full instructions and constraints are
in [ANDROID.md](ANDROID.md), with test contracts in [TESTING.md](TESTING.md).

Until this branch is merged, the default branch still has the old build steps.
Re-enabling a workflow does not rewrite that old revision; run the fixed branch
in Actions and review this same existing draft PR before changing `main`.

## Runtime Android → FastAPI school system — 2026-11-17

The installed APK's unavailable Team & access was caused by the intentional
bundled-Android local-demo short circuit, not by an absent FastAPI implementation.
The new connection workflow reuses actual setup, Argon2id accounts, HttpOnly
sessions, memberships and protected team APIs; it does not invent local logins
or remove authorization.

Implemented on `arena/c130af42-omr-sheet-check` after merged main `b3d94f3`:

- Bundled startup now presents **Connect your school**, with an explicit separate
  demo action. Connection entry points also exist in account/sign-in, settings
  and demo Team & access views.
- Native credential-free, bounded HTTPS `/api/connection-info` probing, strict
  origin/protocol/client/database checks, fresh validation on connect, and an
  explicit native trust prompt. Only the public origin is remembered. Development
  SQLite is labelled test-only; no wildcard CORS or certificate bypass is added.
- Whole-app navigation to the selected trusted HTTPS origin retains relative
  `/api`, real first-admin/bootstrap/sign-in, cookie security and backend RBAC.
  Android ignores a web build's alternate API override. Demo records never
  automatically enter the server or the private workspace.
- Native Connection bar/recovery dialogs work without JavaScript or server
  availability. Disconnect clears device web sessions and locks private views;
  server records and encrypted IndexedDB queues stay at their original origin.
  Offline cookie removal is not claimed as remote session revocation.
- A regression reproduced a late bootstrap response restoring a private session
  after departure. Initial discovery now uses the same authorization-epoch fence
  as later sign-in/revalidation. Both late-bootstrap and late-login tests pass.
- Public discovery metadata performs a real database query, advertises only a
  mounted/present client, is no-store and reveals no credentials. Unauthenticated
  metadata does not permit private workspaces or team administration.

Executed locally for this feature:

| Check                                      | Observed result                                                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full frontend + preserved Node regressions | **216 frontend / 13 files + 30 Node passed**                                                                                                                                             |
| Full Python suite                          | **160 passed**, SQLite + isolated real PostgreSQL 16.2 QA schemas                                                                                                                        |
| Targeted discovery/auth/deployment tests   | **28 passed** before adding the two final unavailable-DB/unmounted-client cases; those final cases passed in the full run                                                                |
| Production build                           | Passed; 51 static precache entries, 23,143.90 KiB; existing large-chunk warnings retained                                                                                                |
| Production browser workflow                | **1 passed, 43.6 s**, current Chromium 153, real PostgreSQL schema; setup/team/restricted portals/native OpenCV/reports/encrypted offline flow retained; exact disposable schema cleaned |
| Android asset synchronization              | Passed, separate `dist-android`; no native SDK/compiler installed locally                                                                                                                |
| Formatting / TypeScript / Ruff             | Passed; 42 Python files checked/formatted                                                                                                                                                |
| npm + runtime/dev Python advisory scans    | No known vulnerabilities reported; `pip check` and Bandit also passed                                                                                                                    |

The fresh sandbox initially lacked browser NSS/NSPR libraries. After extracting
the QA-only bundled libraries, an older Chromium 143 reached the existing offline
PDF stage but did not complete intake. The test was rerun with the current
Chromium 153 and passed, without weakening web security or changing OMR/PDF
behavior. These QA browser binaries/libraries and test traces remain ignored.

A real FastAPI **development** preview also serves the built web client on port
8000 with its own `.data/school-preview` SQLite database and fresh administrator
setup. It is separate from QA schemas and any retained Markly database. This is
a temporary sandbox preview, **not permanent production hosting or permission to
enter real student records**. Production still needs an institution-controlled
host/domain, PostgreSQL, persistent encrypted storage, secrets and operations.

Native compiler/JVM/lint/APK results for the feature are verified separately in
GitHub Actions before delivering a new artifact; no local native build or
physical-device acceptance is claimed. External hosting/S3/SMTP and real device
pairing/camera/lifecycle/upgrade/printed-sheet acceptance remain unprovisioned or
unexecuted. See ANDROID.md and TESTING.md for operator/device checks.

### Native raw-control regression and CI diagnostics

The initial feature checkpoint `fa17f95` passed the full [application/container
workflow](https://github.com/abc07552/OMR-SHEET-Check-/actions/runs/44601050974)
(regressions 4m51s, container 1m14s), but its Android JVM test gate failed before
lint/assembly/artifact publication. No failed-checkpoint APK was delivered.

Inspection and a direct real-JVM reproduction confirmed that Java `String.trim()`
removes a trailing NUL, turning the native test's unsafe raw URL into an apparently
valid origin before validation. Native validation now rejects raw controls before
trimming ordinary surrounding spaces; the shared TypeScript validator also rejects
surrounding controls before whitespace normalization. Existing native cases are
retained and expanded, not skipped. A new frontend regression covers surrounding
controls. A QA-only Java 25 JRE/JPype extraction was used for that primitive-level
reproduction; neither is an application dependency, Android compiler or change to
the pinned JDK 21 native build target.

Native failure annotations now include bounded JUnit case names/messages rather
than only Gradle stack tails. A synthetic XML regression verifies that diagnostics
retain the real case/message while respecting annotation bounds. The complete
follow-up local suites passed **216 frontend + 30 Node / 160 Python tests**; final
Android policy execution, lint, assembly and signature are gated by a fresh current
branch workflow, not inferred from these local runs. Six actual browser
viewport/theme connection checks also passed without horizontal overflow or page
errors and refused unsafe HTTP navigation; no preview administrator was created.
