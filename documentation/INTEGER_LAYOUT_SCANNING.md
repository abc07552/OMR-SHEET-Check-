# Three-digit answers and scanned layouts

## Three-digit integer questions

1. Open **Answer keys → New answer key**. Under **Answer options**, choose
   **3-digit integer · 000–999** for an all-integer paper, or select an MCQ option
   count for a multiple-choice paper.
2. In the key editor, change an individual question's **answer type**, or use the
   question-range type control, to mix MCQs and three-digit questions in one
   assessment. A type change clears that question's incompatible key and alternate
   keys and regenerates the default geometry. Do this before collecting results.
3. Enter one to three ASCII digits. `7`, `42` and `0` are stored as `007`, `042`
   and `000`. Paste mixed answers as separate whitespace/comma/semicolon-separated
   tokens, for example `A B 007 042`. Save the key explicitly.
4. Open **Layout studio**, check the grid, **Save layout**, and download its saved
   PDF or page PNG. For numeric questions, students must mark **one digit in
   each of the hundreds, tens and units columns**, including leading zeroes.

Only unsigned whole numbers **0–999** are supported. There are no negative,
positive-sign, decimal, exponent, four-digit or fractional responses. A numeric
answer is one complete token, not three independent answers. Marking is exact;
there is no per-digit partial credit. Numeric alternate keys also contain one
whole token per question. The ordinary MCQ/exact-multiple-choice policies remain
available for choice questions.

New numeric layouts default to 12 questions per page, so a 500-question numeric
assessment has 42 pages. Older MCQ exams keep their historical defaults and
geometry hashes; they do not require a destructive migration.

Question count, question types and MCQ option count cannot change while an
assessment already has active results. Both FastAPI and the preserved Node
service enforce this, including a request that attempts to remove the results
and reinterpret the assessment at the same time. Create a new assessment for a
different sheet. Correcting a key or marking rule remains possible and retains
versioned evaluation history.

## Scan an existing layout

1. Create or select the intended assessment. Save any answer-key edits first.
   Prefer a **blank, unmarked** copy of the sheet.
2. Open **Layout studio → Scan a layout**. Choose the registration method:
   - **Outer black squares** for sheets with four or repeated solid registration
     squares. Include the whole outer marker rectangle.
   - **Whole paper edges** for sheets without registration squares. Put the whole
     page on a contrasting background, with all four corners visible.
3. Choose an image from the gallery or tap **Use camera**. Supported layout
   images are PNG/JPEG/WebP up to 10 MB, at least 300 pixels in each dimension,
   and at most 30 megapixels. Keep the page upright. Convert a layout PDF page
   to an image first; the ordinary student-sheet scanner still supports PDFs.
4. Review the measured outlines and numbered green overlays. Grey outlines are
   detected evidence, not a guarantee that every bubble was found. **Missing
   outlines are never invented.** Retake a poor image or calibrate manually.
5. All regular digit-grid candidates start **excluded**: a lattice could be a
   numeric answer, MCQ rows or an identity grid. Explicitly include the intended
   regions and choose **One 3-digit integer question** or **multiple-choice
   question rows**. Leave roll-number/identity grids excluded.
6. On a four- or five-column grid, select the intended **three consecutive digit
   columns**. On an 11-row grid, select the row that actually represents zero,
   excluding the dot/sign row. The preview shows exactly which bubbles will be
   used. No decimal/sign processing is available. Do not assume every external
   four-column format is compatible with three-digit answers.
7. Check the question numbers; use **Renumber selected regions** and edit numbers
   to match the real paper. Every question must be mapped exactly once. MCQ
   regions must agree on their option count. The scanner does not OCR numbering
   or automatically distinguish a roll grid from an answer grid.
8. Check the review acknowledgment and choose **Use reviewed layout**. This opens
   an editable draft; it does **not** immediately save an assessment.
9. Under **Question regions**, choose a question. Drag any bubble to correct its
   centre, change its origin/radius or digit spacing, or explicitly make that
   question a regular grid. Global grid controls apply only to unmapped
   questions and are disabled when every question has explicit geometry.
10. Save the layout. Downloads stay disabled while it has unsaved changes, so a
    printed template cannot accidentally use an older saved layout instead of
    the visible draft. Reload to verify your saved calibration if needed, then
    print at 100% and rehearse one sample before a batch.

An imported image maps **one page and at most 100 questions**. This does not
reduce the existing 500-question multipage standard-template capability. The
importer is not a universal arbitrary-sheet/handwriting recognition system.
Printed circle outlines, registration and enough image quality are required.
Question-number/option/digit ordering, missing/extra outlines, labels, overlapping
regions and identity placement still require operator review.

## Reference photos and identity

Layout detection runs in the browser using local OpenCV assets. **Saving the
layout saves its normalized reference photo in the school workspace**, including
anything already visible on that photo. It may therefore enter authorized staff
views, optional encrypted offline workspaces and subsequent backups. Do not use
an identifiable student's sheet as a public demonstration.

Reference photos are calibration guides only: they are **never printed**, never
converted to answer keys and never used to infer correct answers. **Remove
reference photo** deletes it from the current layout without deleting measured
geometry. Save that removal. Existing recovery points/backups may still contain
the old photo and remain subject to institutional retention/erasure policy.

Imported layouts start with roll OCR **off**. A bubble roll-number grid is not a
handwritten-text crop and is not decoded by this feature. Enable OCR only after
calibrating the actual handwritten/text roll box; otherwise select/enter the
student identity explicitly during scanning. Do not accidentally reuse the
standard template's identity crop for a different form.

## Genuine reads and review

The browser and native OpenCV scanners measure all **30 bubble coordinates**
(column-major hundreds 0–9, tens 0–9, units 0–9). They accept a numeric token only
when all three columns have one clear mark. A completely blank grid stays
unanswered, not `000`. Missing, multiple, erased, partially filled or ambiguous
digits require manual review; the answer key is not consulted to fill gaps.

In the response editor, enter the intended number and tap **Confirm integer
007** (for example), or explicitly confirm it as unanswered. Saving the
correction updates scalar response, selection and verification metadata together,
retains the original measured coordinates and regrades through the existing
history system. A blanket result confirmation cannot bypass uncertain marks.

Numeric analytics count complete responses such as `007` and `008`, not the
frequency of individual digits. Question CSV/XLSX exports retain fixed MCQ columns
and add **Integer response frequencies** for mixed/numeric papers. XLSX keys are
strings, retaining zero prefixes. CSV files also contain the literal zero-prefixed
tokens, but spreadsheet applications may auto-format a numeric-looking CSV cell;
import that column as text when necessary.

## Implemented and executed verification

Committed reproducible fixtures contain only synthetic geometry/identities;
the supplied photograph is **not committed or uploaded as CI evidence**.

- `src/integerLayout.test.ts`: normalization, exact scoring, backup validation,
  independent real raster reads, blank/uncertain grids, atomic correction,
  500-question pagination, geometry/signature parity, MCQ-versus-grid review,
  invalid row/column bounds and numeric analytics/CSV alignment.
- `src/IntegerAnswerInput.test.tsx`: numeric key/input/paste and explicit-response
  confirmation controls.
- `backend/tests/test_integer_omr.py`: real native ink reads, perspective/rotation,
  repeated squares, ambiguous columns, schemas, alternate keys, API persistence,
  scan idempotency, calibrated-setting binding, semantics/history protection,
  numeric report contents and page-aware printed-outline registration.
- `server/*.test.mjs`: preserved Node validation/serialization and history locks.
- `e2e/enterprise.spec.ts`: actual browser layout import/review/calibration/save,
  mixed key paste/PDF, native and OpenCV.js numeric scans, retained 30-point
  evidence, explicit correction/history, numeric CSV, saved-versus-draft download
  gates and 1440/768/390-pixel checks. The other enterprise/privacy/offline and
  signup/security browser tests remain enabled.

Latest local full matrix: **286 frontend tests, 33 Node tests, 295 Python tests**
(SQLite and isolated real PostgreSQL), **all 3 production-bundle Playwright tests**
on PostgreSQL. TypeScript/build, formatting/Ruff, dependency consistency, Bandit
and both runtime/development advisory scans passed. See [PROGRESS.md](PROGRESS.md)
and the source commit's GitHub checks for the current CI/Android status.

A separate private browser rehearsal on the supplied photo measured **351
circles**, producing 20 four-option MCQ rows, five four-column/11-row numeric
candidates and one excluded five-column/10-row roll grid. Reviewed mapping,
editable calibration, saved reload, PDF/PNG downloads and reference-photo removal
passed. All 25 keys remained blank. Native OpenCV reread the downloaded **blank**
template as 25 blank answers with no flags, confirming that sample marks were
not printed. This is one photo-specific geometry rehearsal, **not** a claim of
arbitrary-photo accuracy, physical-camera testing, four-digit/decimal support or
production/device certification.
