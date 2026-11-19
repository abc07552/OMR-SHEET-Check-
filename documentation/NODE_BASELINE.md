> Archived documentation for the preserved Markly/Node baseline (`8b5360f`). Some historical test counts, audit results and deployment details below are superseded by the root README and current verification ledger. Do not use this document as the enterprise deployment guide.

# Markly · Assessment intelligence

A dark, responsive OMR workspace for registering students, designing answer sheets, evaluating exams, and understanding progress. React + TypeScript in the browser; an optional **real Node/SQLite backend** for shared data and secure administrator/teacher accounts.

**Public device-mode app:** https://abc07552.github.io/OMR-SHEET-Check-/

> **Hosting matters:** GitHub Pages serves static files. It cannot run the API, authenticate accounts, or host SQLite. The public Pages build therefore clearly identifies itself as **device mode**. The backend is included and tested, but has **not been deployed to a permanent server**. Deploy the full-stack app to enable shared school accounts. No hosting subscription, email service, or cloud backup provider is provisioned automatically.

## What is included

- **Student register:** add, edit, delete (with linked-result confirmation), search, class filters, student progress history, CSV/XLSX imports, and a downloadable import template. Roll numbers are unique per school; leading zeroes are preserved.
- **Multiple schools and classes:** isolated school workspaces, class creation/renaming/deletion, and sidebar school switching. A new school starts empty, not with fictional results.
- **Assessments:** 1–500 questions; A–D or A–E; individual or pasted answer keys; positive marks, negative marking, pass thresholds; non-overlapping subject question ranges. Editing a saved key automatically recalculates existing responses. Draft keys do not contribute evaluated statistics.
- **Layout studio:** draggable text/identity/QR/line/logo fields; local PNG/JPEG/WebP school-logo uploads embedded in templates; editable positions, sizes, type size, visibility, and content; question columns, bubble spacing/size/shape, fill threshold, questions per page, and OCR crop. PNG and **multipage A4 PDF** templates; personalised student templates.
- **Calibration:** upload an existing upright sheet as a reference, click bubble centres/registration points, and adjust the grid and OCR region. Four-marker or paper-edge alignment. Reference images are saved with the template; they are not printed.
- **Scanning:** real OpenCV.js perspective correction and bubble sampling; image batches; Android-friendly camera capture; live camera preview with automatic framing/capture; numeric-roll OCR using Tesseract; QR identity/page identification; PDF.js multipage/batch PDF rendering. Live captures enter the same reading pipeline automatically.
- **Human review:** uncertain/double/faint marks, unmatched/low-confidence identities, missing pages, identity mismatches, and duplicate-page protection. Correct any response, verify identity, or explicitly accept missing pages as unanswered; scores update immediately. A rescan can replace a page without creating a second result for the same student.
- **Analytics:** question-wise correct percentage, distractor choices, easiest/hardest questions, class comparisons, subject score/accuracy, longitudinal student results, overall/subject/class rankings, tied competition ranks, strictly-lower-score percentiles, pass/fail statistics, and distributions. Unresolved results are excluded from aggregates and rankings.
- **Reports:** real `.xlsx` workbooks (results, questions, subject rankings, summary), formula-safe UTF-8 CSV, downloadable exam PDFs, individual multipage PDF report cards, and browser printing.
- **Storage/recovery:** version-1 data migration; device persistence; IndexedDB recovery history; portable JSON; optional AES-256-GCM encrypted exports with PBKDF2 (310,000 iterations); manual recovery points. With a backend: SQLite persistence, optimistic concurrency, server recovery points and audit events.
- **Accounts:** server-enforced school membership and administrator/teacher permissions, scrypt password hashes, expiring HttpOnly cookie sessions, origin/custom-header CSRF checks, login throttling, password changes, administrator-managed memberships and eligible password resets. There is **no fake browser-only “secure login.”**

Fictional Greenwood Academy records are labelled as sample data. Create your own school in Settings to start with a clean register while keeping the demo available separately.

## Run locally

Use **Node 22.13+** (Node 24 LTS recommended) and npm. Node 22 may print an experimental warning for its built-in SQLite module.

```sh
npm ci
# Terminal 1 — real API and persistent .data/markly.sqlite
npm run server
# Terminal 2 — frontend; /api is proxied to the API
npm run dev
```

Open the Vite URL. On a new API database, create the first administrator and school. There are **no default credentials**. Passwords must be 12–128 characters. “Explore the device demo” uses a separate browser-local workspace; it does not import demo records into the shared database.

`npm run dev` alone also works in device mode. OCR assets are copied from installed npm packages by `predev`/`prebuild`; the app does not depend on public OCR/CDN downloads at scan time. The larger OpenCV, OCR, PDF, and Excel engines load only when needed.

## Deploy the full-stack app

The simplest reliable deployment serves frontend and API **from the same HTTPS origin**, on **one Node instance with a persistent disk**. Do not use ephemeral/serverless storage for SQLite.

```sh
npm ci
npm run build
# Set these through your hosting platform's secret/environment controls:
# NODE_ENV=production
# DATA_DIR=/persistent/path/markly
# SETUP_TOKEN=<a long random server-only value>
# PORT=<your host's port>
npm start
```

- Put the Node service behind your host's HTTPS reverse proxy. Production sessions use Secure cookies and will not work over plain public HTTP.
- The Content Security Policy permits same-origin scripts plus `unsafe-eval`/WebAssembly compilation because the bundled OpenCV/Emscripten bindings require generated function constructors. It does not permit remote script hosts, and user content is never evaluated. A stricter hosting policy will require an OpenCV build compiled without dynamic execution; simply removing this allowance breaks scanning.
- Generate the initial setup token on the server, e.g. `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. **Do not paste it into issues, chat, Git, or `VITE_*` variables.** Enter it privately in the first-administrator screen. Remove/rotate it after setup; setup is permanently disabled once the first account exists.
- Mount/persist **all of `DATA_DIR`**: the SQLite database, WAL files, and backup directory. The server binds to `0.0.0.0`; health is `GET /api/health`.
- Use a single app instance for this SQLite design. Horizontal/multi-region deployments require a different shared-database architecture.
- Use your host's encrypted disk and an **off-server backup** policy. Built-in server recovery files are on the same disk, not geographically separate cloud backups.
- A host-provided `PORT`, `DATA_DIR`, and HTTPS proxy are sufficient. The `.env.example` describes the optional configuration.

### Docker

```sh
docker build -t markly .
# Supply SETUP_TOKEN through your secret manager or an untracked environment file.
# Run behind an HTTPS reverse proxy; mount a durable volume at /app/data.
docker run --env-file .env.production -p 3001:3001 -v markly-data:/app/data markly
```

The runtime runs as an unprivileged user and installs production dependencies only. The Dockerfile is supplied; running a Docker deployment is the operator's responsibility.

### Separate API / GitHub Pages frontend (optional)

At frontend build time, set `VITE_API_BASE=https://your-real-api-host/api`. On the API, set `PUBLIC_WEB_ORIGIN` to the **exact frontend origin** (for this Pages site: `https://abc07552.github.io`, without the repository path). Use HTTPS at both ends. The API never accepts wildcard credentialed CORS. Cross-site cookie restrictions vary by browser; same-origin hosting is strongly preferred.

Changing `VITE_API_BASE` requires a new frontend build. Merely pushing server source to GitHub Pages does **not** deploy the server.

## Roles and recovery

| Operation                                                             | Teacher | School administrator |
| --------------------------------------------------------------------- | ------: | -------------------: |
| Student/class CRUD, keys/layouts, scans, corrections                  |     Yes |                  Yes |
| Analytics, reports, downloadable exports                              |     Yes |                  Yes |
| Rename institution, manage memberships, create another school         |      No |                  Yes |
| Import/replace a shared workspace; list/create/restore server backups |      No |                  Yes |
| Change own password                                                   |     Yes |                  Yes |

Teachers can export personal/student data as part of their reporting role; only give accounts to trusted staff. Server backup restore requires the current administrator password. A school cannot lose its last administrator. Removing membership revokes access immediately.

New-account passwords must be shared securely; **no invitation/reset email is sent**. Existing-account membership does not change that account's password. Administrators can reset a non-owner account belonging exclusively to their school after confirming their own password. Multi-school accounts and the initial owner use their own password-change flow, or server-owner recovery:

```sh
# In an interactive terminal on the trusted server, with the correct DATA_DIR:
npm run admin:reset
```

The recovery command prompts for email and a hidden, confirmed new password and revokes all sessions. It is a local operator tool, not an unauthenticated HTTP reset endpoint.

## Safe scanning workflow

1. Register the students and their **unique** roll numbers. Create and complete an answer key.
2. Open Layout studio. Save a standard layout, or upload a reference and calibrate it. Keep the fields/grid inside the printable area. Different layouts require their own calibration; arbitrary third-party sheets are **not** guessed automatically.
3. Download the PDF template, optionally for a selected student. A 500-question standard template has five pages. Print on A4 at **100% scale**, without cropping or “fit to page.” QR fields identify assessment, page, and optional roll.
4. Photograph upright in even lighting, retaining the whole sheet and all four registration squares. Paper-edge mode needs a contrasting background. Do not rotate pages sideways/upside down. Check a known sample before a large batch.
5. Upload images/PDFs, capture an Android photo, or use live camera. The browser needs camera permission and HTTPS (localhost is allowed by browsers). An embedded preview may require opening the app in its own tab and allowing camera access.
6. For legacy PDFs without a Markly QR, pages are initially assigned in sequential exam-page order. **Verify page numbers** and enter/match a roll number (or use calibrated numeric OCR) on every page. Reordering/omitting pages must be corrected manually. QR-identified pages can be merged out of order.
7. Review uncertain marks, unmatched identities, and missing pages. OCR supports **numeric, clearly written/printed roll numbers**, not unrestricted handwriting/name recognition. QR identity also supports non-numeric rolls. Never treat OCR as authoritative without verification.
8. Correct responses and export the reports you need. Download a backup before destructive changes.

**Limits:** 50 MB per uploaded file; up to 200 rendered pages per batch; up to 100 questions per printed page and 500 per exam. The backend limits a school workspace request to 15 MB, with schema caps of 20,000 students, 1,000 exams and 50,000 results (the byte limit may be reached first). Large PDF/image batches consume browser memory; use smaller batches on mobile. No image-recognition system can guarantee correct results for every photograph.

Only answers and identity/result metadata are saved by scanning; temporary scan thumbnails are discarded on navigation. Uploaded **calibration reference images** are intentionally saved in the layout and thus appear in backups. Do not use references containing unnecessary personal information.

## Data, backups, and concurrency

- Existing `markly-workspace-v1` data migrates without dropping exam/result history; a roster is derived once. Migration does not silently send local data to the server.
- Device state uses browser localStorage; recovery points use IndexedDB. Different browsers, origins, and devices have different data. Clearing browser storage removes both. Private mode/quota failures are surfaced with an export action.
- Device automatic recovery runs on workspace changes at most once per five minutes, retaining 10 automatic points. Manual points remain until deleted.
- Server automatic points are made before the first write in each 15-minute window, plus a daily check while the process runs. The latest **14 automatic points** are retained (not “14 days”); manual points are retained. Restores preserve a pre-restore point. These are recovery files on the same server, not offsite disaster recovery.
- AES-GCM encrypted exports require the original passphrase; there is no recovery for a lost passphrase. Unencrypted backups contain personal data. Downloaded workspace files do not contain account password hashes, sessions, or permissions.
- The SQLite database contains account hashes and memberships; protect/backup the entire server volume separately. Use a consistent SQLite backup or stop the service before copying the database/WAL files.
- Conflicting shared edits do not silently overwrite another teacher's work. The app blocks autosave, offers an unsaved-data download, and asks you to reload the server version. Download first; this is optimistic concurrency, not real-time collaborative merging. Refresh/reopen to see another teacher's saved changes.

## Verify

```sh
npm run test:all    # 58 browser-logic/OMR/backup tests + 30 API/security/persistence tests
npm run build      # strict TypeScript + production bundle
npm audit --omit=dev
```

Browser QA additionally exercised real OpenCV A–E reads, five-page/500-question PDF merging, the local OCR worker, genuine four-sheet XLSX files, individual PDF cards, encrypted UI restore, full-stack teacher/admin workflows, and **99 page/viewport combinations** (360–1440 px) without horizontal document overflow. A physical Android camera/lighting test is still recommended; browser permission/framing behaviour varies by device. Automated test results are not a promise that all possible photos/layouts are supported.

Production dependency audit is clean at the last verification. There is an **unpatched upstream development-tool advisory** in the Vite/Vitest `picomatch` chain ([GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)); the full audit currently reports five high-severity entries for that chain. No patched picomatch release is published in the registry used here. Build/test globs are repository-controlled, and the Node production API does not load this development chain. Do not expose the Vite dev server as a public production service or feed it untrusted glob configuration. Upgrade when a verified patch is available; do not use `npm audit fix --force` to blindly downgrade tooling. ExcelJS's vulnerable legacy UUID dependency is overridden to the tested patched v11 API.

## Update the existing GitHub Pages site

Pages currently publishes the **`arena/ae8cdeb1-omr-sheet-check` branch, `/docs` directory**. Keep that source setting.

```sh
npm ci
npm run build:pages
# Review and commit source + the regenerated docs/ directory on the current branch.
# Push that same branch; GitHub Pages publishes the checked-in /docs output.
```

`docs/` is intentionally tracked; `.nojekyll` is included. The build uses `/OMR-SHEET-Check-/` asset paths. `public/vendor/` is generated/ignored; `build:pages` copies its required OCR assets into the published build. Do not publish `.data/`, `.env`, account databases, or backup files.

The live Pages site's browser data remains local to that site's origin. Export/restore JSON to transfer from a preview or another device.

## Implementation map

- `src/data.ts`, `src/layout.ts`: migration, validation, grading, analytics, ranking, and editable geometry.
- `src/omr.ts`, `src/scanEngine.ts`, `src/Scanner.tsx`: printable sheets/PDFs, perspective alignment, bubble reading, local OCR, PDF batches, and camera flow.
- `src/session.tsx`, `server/`: authentication, membership enforcement, SQLite, revisioned saves, backups and audit.
- `src/Roster.tsx`, `src/Templates.tsx`, `src/Leaderboard.tsx`: student CRUD/history, visual calibration, subject/overall rankings.
- `src/storage.ts`, `src/documents.ts`: encrypted portable backups, IndexedDB, real Excel/PDF generation.
- `scripts/prepare-assets.mjs`: self-hosted OCR assets. `public/fonts/`: Noto Sans and its OFL license for PDF text.

See [THIRD_PARTY.md](THIRD_PARTY.md) for major third-party components. Student information should be processed and shared in accordance with your institution's consent, retention and access policies.
