# Security review and regression evidence

## Scope and interpretation

This is an engineering security review of this branch, **not an independent penetration test, legal/privacy certification, or permission to deploy unreviewed student data**. It covers the FastAPI application, selected client/offline trust boundaries, dependency integrity, and the regression suites. The preserved Node service is retained and regression-tested separately; it is not the recommended new production architecture.

Use [PROGRESS.md](PROGRESS.md) for checkpoint results and the PR's current-head checks for CI. No real school database, private image corpus, production credentials, external bucket or mail account was used in these checks.

## Three-digit and layout-scan follow-up

Latest local checks: **295 backend tests** (SQLite / isolated PostgreSQL), **286
frontend + 33 Node tests**, all **three** PostgreSQL/production-bundle browser
workflows, TypeScript/build and formatting/Ruff passed. Fresh `pip check`, Bandit,
full npm audit and runtime/development PyPI lock audits reported no broken
requirements, Bandit findings or known package vulnerabilities. These remain
scoped engineering checks, not independent security or physical-device approval.

Reviewed additions: image type/size/pixel limits and bounded contour processing;
key-independent measured geometry; explicit grid-type/three-column/ten-row mapping
and acceptance; no automatic identity-grid interpretation; imported OCR disabled;
contextual atomic numeric answer validation; mandatory ambiguous-column review;
coordinate-preserving human corrections; count/type/option history locks in both
backends; scan receipts bound to calibrated geometry and reading settings; fixed
report columns for mixed answers. The supplied-photo import/save/reload/download
rehearsal retained **blank keys**, and the downloaded blank form contained none
of the sample photo's marks.

**Reference-image privacy:** browser-only detection is not a device-only storage
promise. Saving a reference embeds its normalized image in the authorized school
workspace and potentially its offline vaults/backups. The dialog discloses this;
prefer a blank sheet and remove the reference after calibration when unnecessary.
Removal preserves geometry but does not erase past recovery points. Uploaded
private photos and derived image-containing QA artifacts are ignored and excluded
from the committed synthetic fixtures and CI artifact paths. This feature does
not provide consent/retention management or a bubble roll-grid decoder. See
[INTEGER_LAYOUT_SCANNING.md](INTEGER_LAYOUT_SCANNING.md).

## Google/signup/Drive follow-up

The prior auth checkpoint passed **246 backend tests** on SQLite / isolated
PostgreSQL, **238 frontend + 30 preserved Node tests**, both production-bundle
PostgreSQL browser workflows, TypeScript/build, Prettier/Ruff, `pip check`,
**zero Bandit findings** (no `nosec` annotations), **zero npm advisories** and no
known PyPI vulnerabilities in either hash-locked closure. This is separate from
the older optical checkpoint's counts below and is not live Google acceptance.

Reviewed controls: isolated opt-in registration after protected bootstrap;
production email token plus chosen-password proof and protected resend; verified
SMTP STARTTLS; no email-only Google linking; official signature/issuer/audience/
nonce checks; cookie / native-proof-bound one-use handoffs; current-session checks
for linking/Drive; recent-Google first-password creation; encrypted server-only
provider credentials; separate narrow Drive consent; per-school/admin authorization;
lease-fenced immutable backup retries and integrity checks; non-destructive
import followed by the existing password/revision restore gate. Idempotent logout
clears revoked/absent cookies without dropping CSRF/origin checks. Trusted CLI
recovery enables password login for Google-only accounts and revokes sessions.

Google/SMTP HTTP delivery in automated tests is synthetic. Real RSA signatures /
official verifier are exercised, not mocked identity acceptance. Cloud-console
consent, production mail delivery, token lifetimes/quota, physical Android callback
and external operator TLS/logging/key custody still need live validation. See
[GOOGLE_AUTH_DRIVE.md](GOOGLE_AUTH_DRIVE.md). Drive is manual workspace backup,
not a full database/original-image DR solution or scheduled synchronization.

## Executed checks in the optical/worker/storage hardening checkpoint

| Check                                 | Observed result                                                                                                                                                                 | Scope / limitation                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend tests                         | **140 passed**, using both SQLite and randomly isolated real PostgreSQL schemas                                                                                                 | Includes auth/RBAC, constraints, transactions, original ownership, history, recovery/migration, native CV and worker races; not every possible interleaving |
| Frontend / preserved Node suites      | **114 frontend + 30 Node passed**                                                                                                                                               | Includes encryption/session fencing, saved/queued status, optical pixels/readability, scoring and validation                                                |
| Production-bundle Playwright workflow | Passed against a fresh PostgreSQL schema, including four real-image exposure variants, unsafe-grid rejection, review, private publication, downloads and disconnected scan/sync | Synthetic images and desktop Chromium, not physical Android or arbitrary-photo acceptance                                                                   |
| Bandit **1.9.4**                      | **0 findings**, 4,346 production-backend lines, **0 `nosec` annotations / 0 skipped tests**                                                                                     | `bandit -r backend -x backend/tests,backend/migrations`; tests and generated migrations are outside this static scan, not silently waived findings          |
| npm audit                             | **0 known advisories** in the executed full dependency snapshot                                                                                                                 | Advisory-service point-in-time result, not absence of unknown vulnerabilities                                                                               |
| pip-audit **2.10.0**                  | **No known vulnerabilities** in runtime and development closures                                                                                                                | PyPI advisory source; both files explicitly checked with `--require-hashes`                                                                                 |
| Dependency installation               | A **new CPython 3.11 venv** installed the complete development closure with `--require-hashes --only-binary=:all:`; imports and `pip check` passed                              | Linux x86-64 exercised locally; other platforms need their own installation/CI validation                                                                   |
| Negative integrity check              | pip rejected a deliberately incorrect Alembic SHA-256; no package was installed by that negative dry-run                                                                        | Verifies artifact-hash enforcement, not publisher identity or signing provenance                                                                            |

Bandit is a **development-only** addition. Existing application/transitive versions were not upgraded during hash-locking. The locks retain all published non-yanked artifact hashes for each selected version; production/CI require wheels, so a source build cannot fetch unpinned build dependencies. `scripts/lock-python.py` validates installed versions against direct and transitive specifiers and completes all registry checks before replacing either lock. Six regressions cover specifier, extras/platform-marker, metadata identity/hash, yanked-file and failed-regeneration behavior.

## Findings addressed

| ID         | Priority                       | Finding / reproduction                                                                                                                                                                                                          | Underlying fix and regression                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OMR-SEC-01 | High — integrity               | A deliberately delayed real scan outlived its 15-minute lease. A second worker reclaimed it and a person applied the newer page; the first worker then reset the job to `done` and discarded its newer application association. | The monotonic attempt counter now fences **both success and error commits**. Finalization checks `(job ID, processing status, attempt)` in a fresh transaction; a superseded attempt cannot change the job or emit a completion audit. Actual apply-API race tested on SQLite and PostgreSQL.  |
| OMR-SEC-02 | High — authorization boundary  | Suspension, `scan` permission removal, or class reassignment during real CV did not prevent the old worker from committing completion using its cached membership.                                                              | Fresh-session authorization before processing and immediately before committing pixels. All three revocation regressions failed before the fix and pass on both databases; unauthorized output is not retained as a completed scan.                                                            |
| OMR-SEC-03 | Medium — availability          | Interrupted workers could be requeued indefinitely; a processing row without a timestamp was never reclaimed.                                                                                                                   | Automatic and explicit attempts are capped at five. Missing/expired leases at the cap become an explicit `lease_exhausted` error, not a hot retry loop or silent stuck status.                                                                                                                 |
| OMR-SEC-04 | High — evaluation safety       | Fixed global brightness thresholds could produce false blank/multiple selections in readable dark, bright, faded or shadowed browser images. Large native bubbles also exceeded the fixed threshold neighborhood.               | Local paper-relative browser sampling; adaptive marker detection; normalized native thresholds with radius-sized neighborhoods; square-aware outline evidence. Invalid/clipped samples are explicitly flagged. Ten native-condition and six browser-pixel regressions failed before the fixes. |
| OMR-SEC-05 | Medium — evaluation safety     | Code review found that a QR orientation bonus was also counted as proof of grid readability. A crisp identifier is not evidence that answers can be read.                                                                       | QR may help choose orientation, but a separate average printed-outline contrast gate must pass. The real browser test retains a sharp QR/markers, removes the grid, and asserts a visible error with **no result/revision change**.                                                            |
| OMR-SEC-06 | Medium — privacy communication | Scanner/overview copy incorrectly claimed all images/records stayed on-device even for authenticated school workspaces.                                                                                                         | Copy now distinguishes browser processing, encrypted server originals, offline vaults, native uploads, the legacy service and unencrypted device demos. Browser test checks the authenticated retention disclosure.                                                                            |
| OMR-SEC-07 | Medium — supply chain          | Python versions were pinned but downloaded artifacts were not hash-locked.                                                                                                                                                      | SHA-256 locks, strict binary/hash installs in Docker/CI, fail-closed regeneration, clean installation and negative tamper verification. Public registry metadata is still a trust dependency, not a signature/provenance guarantee.                                                            |

Storage follow-up: a real-Fernet/local-stream boundary suite first produced **10 failures / 1 pass**. S3 reads incorrectly applied the 50 MiB **plaintext** limit to larger base64/encrypted bytes, truncating valid originals near the accepted upload maximum. Response streams also remained open; local reads and writes were not symmetrically bounded. The fix computes the exact maximum Fernet size (PKCS7 padding + 57-byte envelope + base64), bounds both local/S3 reads, enforces the plaintext cap before writes and after decryption, and closes provider bodies on success or failure. **All 11 storage tests pass**, including corruption rejection. These are SDK-shaped in-memory streams with real encryption, **not an external S3 integration test**. The full backend rerun passed **135 tests**.

Institution-form follow-up: CI exposed a lost academic-session save. Seven controlled React regressions then failed on the old component: editable placeholders before the first GET; dirty drafts reset by refetch; a settings payload paired with an unrelated workspace revision; nonpersistent conflict feedback; mutable in-flight fields; a late success reloading/repopulating a private query after unmount; and no explicit discard/reload path. The keyed actor/institution form now loads before editing, retains its own snapshot revision, preserves dirty drafts, caches acknowledgments before reload and ignores post-unmount effects. All seven pass. Browser coverage delays the **real** initial GET and checks disabled controls, the submitted PUT, the server acknowledgment and final persisted value; no assertion or backend CAS check was weakened.

The seven worker regressions were **all observed failing before the fix**. Neither job claims, authorization safeguards, vault protection nor manual verification requirements were disabled to make these checks pass. The QA suite intentionally delays execution but calls the real native engine; it does not fabricate detected answers.

## Implemented controls reviewed

- School-scoped authorization on protected APIs, assigned-class teacher checks and a linked-student-only portal/report path. Private HTTP data and originals use `no-store` and are excluded from service-worker caches.
- Argon2id passwords; opaque hashed, expiring sessions; revocation after password changes/recovery; single-use reset tokens; bootstrap sentinel; persistent attempt throttles. Production cookies require HTTPS.
- Custom mutation header plus same-origin/explicit-origin checks, Pydantic bounds, parameterized SQLAlchemy queries, composite school ownership keys, unique active-roll/result constraints and transactional revision/operation receipts.
- Decode/file-size/pixel/zip-entry bounds, normalized raster formats, no remote/SVG logo execution, spreadsheet formula escaping and escaped PDF text. No inference from an answer key.
- Encrypted originals and recovery points, private filesystem permissions, server-only encryption key, source-preserving migrations and pre-restore safety snapshots. A recovery point is not a full database/object disaster-recovery backup.
- Optional offline records use a separate passphrase, PBKDF2/AES-GCM, account/lifecycle fencing and bounded authorization lifetime. Queued ciphertext is preserved across locks; a locked existing vault cannot be silently replaced. Local demos are explicitly separate.

## Remaining risks / release gates

1. **External deployment is not validated here.** Verify real DNS/TLS/proxy trust, non-public database/API ports, S3 permissions/retention, SMTP delivery, operator access controls, logs/alerts and key custody on the intended host. Container smoke success is not public production certification.
2. **Physical accuracy remains a release gate.** Confidence is an ink-separation/quality measure, not a calibrated probability. Synthetic exposure, blur, erasure-like residue and geometric fixtures do not establish pen/pencil/handwriting accuracy. Use a representative, consented, privately held printed-sheet corpus and real Android cameras; retain human review.
3. OpenCV.js currently needs Emscripten/WebAssembly and `unsafe-eval` in the documented CSP. Removing that allowance needs a compatible isolated runtime/worker build and a complete scanning regression, not simply a stricter header that breaks detection.
4. Offline authorization can only be revoked on reconnection or lifetime expiry; a disconnected trusted device necessarily has a bounded revocation delay. Device compromise, passphrase strength, browser storage eviction, multiple-tab lifecycle and a lost encryption key require operator/device policies and additional acceptance work.
5. No independent penetration test, fuzz campaign, container-OS vulnerability scan, signed build provenance, immutable base-image digest policy or disaster-recovery/PITR drill is claimed. Package scans do not cover operating-system packages or unknown vulnerabilities.
6. Large CV/PDF/OCR/Excel assets and whole-workspace projections need representative memory/concurrency/load acceptance. Upload and batch bounds are not proof of adequate capacity for every institution. See [PERFORMANCE.md](PERFORMANCE.md).
7. Scheduled operations, retention/erasure policies and configurable report-template acceptance remain tracked in [ACCEPTANCE.md](ACCEPTANCE.md); do not mark Stage 19 complete while those operator/product gates remain unresolved.

## Reproduce

```sh
npm run test:all
npm run build
.venv/bin/pytest -q backend/tests
# Set a dedicated QA OMR_TEST_POSTGRES_URL privately for PostgreSQL parity.
OMR_E2E_ALLOW_SETUP=1 npm run test:e2e
.venv/bin/bandit -r backend -x backend/tests,backend/migrations
npm audit
.venv/bin/pip-audit -r backend/requirements.lock --require-hashes --disable-pip --vulnerability-service pypi
.venv/bin/pip-audit -r backend/requirements-dev.lock --require-hashes --disable-pip --vulnerability-service pypi
```

Detailed transient logs are in ignored `.cache/qa/accuracy/`. Never publish traces or audit artifacts from real student sessions without reviewing them for private data.
