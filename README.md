# Markly — OMR sheet checker

A complete, responsive, local-first OMR grading workspace. Built with React, TypeScript, Vite, Recharts, and Lucide. No API keys, account, or backend required.

## Run locally

Requires **Node.js 22.12+** (Node 22 LTS recommended).

```sh
npm install
npm run dev
```

Open the URL printed by Vite. The development server binds to `0.0.0.0` and accepts preview proxy hosts.

```sh
npm test          # 21 grading, persistence, alignment, and OMR recognition tests
npm run build    # TypeScript checks and production bundle
npm run preview  # Serve the production build
npm run format   # Format source files
```

Deploy the generated `dist/` directory to any static host. Page navigation uses hashes, so no server-side routing configuration is needed. Fonts are bundled locally; the app does not depend on external font or image services.

## Publish on GitHub Pages

A production build is included in `docs/` for GitHub Pages branch publishing. It uses the correct `/OMR-SHEET-Check-/` asset path and includes `.nojekyll`.

**One-time setup by the repository owner:**

1. Open [Settings → Pages](https://github.com/abc07552/OMR-SHEET-Check-/settings/pages).
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **`arena/ae8cdeb1-omr-sheet-check`** and folder **`/docs`**, then click **Save**.
4. Wait for the **pages build and deployment** workflow to finish. The published address is [https://abc07552.github.io/OMR-SHEET-Check-/](https://abc07552.github.io/OMR-SHEET-Check-/).

The Arena GitHub connection can push project files, but cannot change this repository's Pages configuration; the owner must complete that one-time setting. Until then, Pages still serves its previously configured branch, not this build.

For later changes, run `npm run build:pages`, commit the updated source and `docs/` build on this same branch, then push it. GitHub Pages publishes changes to the selected branch automatically. The generated `docs/` files are intentionally tracked for this hosting method; edit files in `src/`, not in `docs/`.

```sh
npm run build:pages     # Build the deployable GitHub Pages site
npm run preview:pages   # Verify it locally at /OMR-SHEET-Check-/
```

No hosting secrets or student data are stored in the deployed build. Each visitor's keys and results remain in that visitor's browser. An existing local-preview workspace does not transfer automatically to the public site; use JSON backup and restore to move it.

## Your first real assessment

1. Explore the labelled fictional demo: 248 students and six assessments.
2. In **Settings**, download a workspace backup if needed, then choose **Start a fresh workspace**.
3. In **Answer keys**, name your assessment, choose the correct options, set marking rules, and save. New assessments support 10, 20, 30, 40, 50, 60, or 100 questions. Answers can also be pasted in bulk.
4. Download and print the assessment's **Markly OMR template** (A4-proportioned PNG).
5. Have students fill one bubble fully per question using a dark pen.
6. Take a clear, upright image or flatbed scan. All four black registration squares must be visible. Upload PNG, JPG, WebP, or BMP images in **Scan sheets** (up to 20 MB per image, 30 per batch).
7. Check or edit student names and roll numbers before scanning. These fields are taken from filenames, **not OCR**. A filename such as `Maya_Verma_13001.png` pre-fills both fields.
8. Check the sheets. Open flagged student results to resolve multiple or uncertain marks, then save the responses.
9. Explore classroom trends, score distributions, question difficulty, distractor choices, and section comparisons. Changing a key immediately recalculates linked results.

**Try sample sheets** generates two filled template images and passes them through the actual image-reading pipeline; it does not simply insert pre-scored results.

## Included features

- Overview with assessment selection, live metrics, performance trends, and a question spotlight
- Answer-key creation, bubble editor, paste import, drafts, scoring and negative marking
- Real browser-side bubble recognition, batch upload, progress, errors, and a review workflow
- Searchable, filterable, sortable, paginated student records and individual response correction
- Question-level accuracy, answer-option breakdowns, and section comparison
- CSV exports, print-ready reports (use your browser's **Save as PDF**), JSON backup and restore
- Keyboard search (`Ctrl/Cmd+K`), focus-trapped dialogs, mobile navigation, and reduced-motion support

## How recognition works

`src/omr.ts` detects four dark registration squares using connected components. An eight-parameter projective transform maps template coordinates into the uploaded image. The scanner samples the interior of every bubble, classifies dark marks, leaves empty bubbles unanswered, and flags double or uncertain marks. The template layout is shared between generation and recognition.

**Scope:** This scanner supports **Markly templates only**, not arbitrary exam-board OMR layouts, PDF files, handwriting recognition, or OCR of student identity. Upright, evenly lit scans work best. Skew is corrected using the corner markers, but heavily curved, rotated, cropped, shadowed, or low-quality photos may need to be retaken. Always review important results against the source sheet.

## Privacy and storage

- Sheet images are processed entirely in the browser. They are **never uploaded** and are not retained after scanning.
- Answer keys, result records, and workspace settings persist in this browser's `localStorage` (`markly-workspace-v1`).
- Data is not synced across devices or browsers. Clearing site/browser data removes it. Export regular JSON backups from Settings or Reports.
- Storage capacity is browser-dependent. The app warns if a save fails; export a backup if this happens.
- Backups are validated before restore. Restoring a backup or resetting the workspace requires confirmation.
- CSV exports escape spreadsheet formula prefixes and quoted values.

This is a functional single-device application. Authentication, a multi-user database, cloud synchronization, and support for custom OMR layouts would require a separate backend or additional work.

## Project map

- `src/App.tsx` — shell, navigation, persistence, global search, notifications
- `src/Overview.tsx` — classroom dashboard
- `src/AnswerKeys.tsx` — assessment and answer-key editor
- `src/Scanner.tsx` — image queue and scan workflow
- `src/Students.tsx` — student list and result review
- `src/Analytics.tsx` — deep question and class analysis
- `src/Reports.tsx` — exports and print layout
- `src/Settings.tsx` — workspace preferences and backups
- `src/data.ts` — data model, demo fixtures, grading, statistics, validation, CSV
- `src/omr.ts` — printable template and image-recognition pipeline
