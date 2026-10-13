# Student profiles and PDF transcripts (STU-PROF-01–05)

> OCR update: see [OCR demo setup](ocr-demo.md). When `OCR_WORKER_KEY` is configured, upload returns 202 and a persistent job; the local Python worker reads PDF text first and falls back to OCR. The synchronous native-only behavior below remains the fallback for deployments without a worker key.

Students can import, replace, view and delete their own transcript from **Hồ sơ & bảng điểm**, and edit class, current semester, interests and career goal. Identity fields remain read-only.

## Storage and deployment

Migration `007_student_transcripts.sql` adds `student_profiles.interests` and `student_transcripts`. Each user has one current transcript: original PDF in `BYTEA`, parsed document in `JSONB`, filename, byte count, SHA-256, version UUID and timestamps. No files depend on Render's local disk. Keep `DATABASE_AUTO_MIGRATE=true` for migration on server startup, or run `npm run db:migrate --workspace @edupath/api` against the intended database.

The table has RLS enabled and no public/Data API grants. Access goes through the authenticated backend database connection. Every endpoint derives the owner from the session, never from a client-supplied user ID. Mutations check the request Origin and lock/recheck the active student account.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/student/profile` | Read own profile |
| PATCH | `/api/student/profile` | Save allowed personal fields |
| GET | `/api/student/transcript` | Read metadata and parsed JSON |
| POST | `/api/student/transcript` | Import or replace a PDF |
| GET | `/api/student/transcript/file` | Download own original PDF |
| DELETE | `/api/student/transcript` | Delete own PDF and parsed data |

Upload uses an `application/pdf` body, `X-File-Name` (URI-encoded), `X-Confirm-Own-Transcript: true` and, for replacement, the current `X-Transcript-Version`. Delete uses JSON `{ "version": "<current UUID>", "confirmed": true }`. Stale versions return 409. Parsing and validation finish before an atomic database replacement; invalid imports preserve existing data.

## Extraction and display

PDF.js extracts positioned text in a worker. The parser targets the university eight-column native PDF layout: ordinal, course code, name, credits, score /10, score /4, letter and result. It preserves transfer credits ("Điểm bảo lưu"), semester groupings, multiline course names and the printed semester summaries. Empty grades stay null. In the native PDF the result column is an icon with no text layer, so those cells are stored as blank (`result: null`); the parser itself does not guess. Its warning reads: "Ô Kết quả chỉ có biểu tượng (không có lớp chữ) được đọc là trống; khi ô Kết quả trống, Đạt/Không đạt được xác định theo điểm chữ chính thức: A+ đến D là Đạt, F là Không đạt." Transcripts imported earlier keep their stored warning. The OCR worker reads the icons and stores "Đạt"/"Không đạt".

The page shows `sections[].courses[]` as one table per term, with term and course filters. `GET /api/student/transcript/file` returns the original PDF; the page has no download button.

JSON contains `schemaVersion`, `parserVersion`, `pageCount`, `courseCount`, `sections` and `warnings`. Sections contain academic year, semester, courses and source summary labels/values. Course rows retain source page and the conditional-course marker. Printed totals are not recalculated from filtered rows.

## Pass/fail from the letter grade

`apps/web/src/transcript-results.ts` decides each row for the transcript, curriculum and training-plan pages. The graduation page receives every course state from the API instead (`apps/api/src/competency-assessment/course-state.ts`, same rules, see below):

- A printed result always wins: "Đạt…" or ✓ is a pass; "Không đạt…", "Chưa đạt…" or ✗ is a fail; any other text stays unknown.
- Letter MT is an exemption and passes.
- Only when the result cell is blank: A+, A, B+, B, C+, C, D+ and D pass, and F fails. This is the same `PASS_LETTERS` set as the OCR pipeline (`services/ocr/test_ocr.py`). The pages label these results "suy ra từ điểm chữ" in text.
- Without a letter, a row with scores is graded but unknown; a row without scores is a registration that has no grade yet.
- Across retakes any pass wins. A course counts as inferred only when no attempt printed or exempted its result.

The cases are shared with the API in `apps/api/src/competency-assessment/fixtures/result-cases.json`; `transcript-results.test.ts` reads that file at test time.

**Credit cross-check (transcript page).** Passed credits are compared with the "Tổng số tín chỉ tích lũy" printed for the latest graded term. Condition-only courses are left out (GDTC/GDQP: codes 71NAD/71PE or rows marked (*)), and each course counts once. Passes from regular terms always count. The transcript page has no programme list, so transferred passes ("Điểm bảo lưu") widen the accepted range instead; for example, preparatory English is transferred but not accumulated. When the printed total falls outside the range, the page warns "Tổng tín chỉ chưa khớp với bảng điểm". The sample transcript matches its printed total. The graduation page runs its own check on the server (below).

## Graduation check (reference only)

The graduation page (`/dashboard#graduation`) no longer computes anything in the browser and no longer has a selected-standard combobox: the web engine (`apps/web/src/graduation-assessment.ts`, `graduation-scores.ts`) and its tests were deleted. `GET /api/student/graduation` resolves the student's own standard on the server from the cohort in the account and the specialty in the profile (`apps/api/src/graduation/resolve.ts`) and returns it with a server evaluation (`apps/api/src/graduation/evaluation.ts`) built on the same engine as the competency assessment (`apps/api/src/competency-assessment/graduation.ts`, `comp-calc-v5`). The page only displays that evaluation. Response, page layout and unresolved states: [graduation standards](graduation-standards.md).

- Course states follow the rules above (a printed result first, then the letter grade; MT passes; across retakes any pass wins). A registration without a grade after an F counts as in progress.
- Each group has a lower bound (passed or MT) and an upper bound (plus graded courses whose result cannot be read). A group passes once the lower bound meets the requirement, even when the upper bound is unknown; it fails when even the upper bound cannot, and is otherwise "Chưa xác định". Mandatory groups count courses, (*) included; elective groups count credits (the standard's credit, else the CTĐT credit, else the transcript credit of the selected attempt). Groups are matched by their member courses, never by name; groups that share a name are labelled with their course count and first code (`<name> · n học phần, gồm <first code>`).
- Total credits use the printed "Tổng số tín chỉ tích lũy" (or "Số tín chỉ tích lũy") of the latest graded term. Without one, they are estimated from passed courses of the programme (standard ∪ CTĐT, each code once, condition-only courses left out); courses outside the programme, such as preparatory English, are not accumulated. An unreadable or conflicting printed value falls back to the estimate with a `printed_credits_unreadable` warning.
- Credit cross-check: the printed total matches when it lies within the estimate's bounds (lower = passed credits, upper = plus unclear results, tolerance 1e-6); otherwise the evaluation carries a `credits_mismatch` warning with both numbers.
- A missing `gpaScale` reads as 4. The synthetic cases in `apps/api/src/competency-assessment/fixtures/graduation-cases.json` now feed the shared engine's test (`graduation.test.ts`). The school's decision is the official result.

**Graduation advice and transcript changes.** Replacing or deleting the transcript (native upload, OCR job or `DELETE`) deletes the student's competency results and AI graduation advice (`stu_grad_advice`) in the same transaction. After a native upload or an OCR job has committed a new transcript, and only when `AI_WORKER_KEY` is configured, a best-effort hook queues AI graduation advice for it once the response is sent, so the advice is usually ready when the student opens the graduation page. The hook never fails or delays the import and logs only an error code. It does not run for a rejected upload, an OCR enqueue, a failed OCR job or a deletion. See [graduation advice](graduation-advice.md).

## Limits and testing

Limits: 5 MB, 20 pages, 1,000 course rows, 25-second extraction timeout, one extraction worker at a time per server instance. Without `OCR_WORKER_KEY`, scanned/image-only PDFs are rejected (`scanned_pdf`); with it, uploads go to the OCR worker (see [OCR demo setup](ocr-demo.md)). Encrypted files and unsupported layouts are rejected. The supplied three-page PDF extracted 50 course rows (3 transfer rows and 47 rows across 9 semesters). The source file contains no usable student identity for ownership verification, so upload requires the student's explicit confirmation. Uploaded records are not institution-verified.

The sample PDF and extracted personal data are not committed or automatically assigned to a user. Unit tests use synthetic rows only: `apps/web/src/transcript-results.test.ts`, `student-plan-results.test.ts`, `student-graduation-data.test.ts` and `StudentGraduation.test.tsx`; on the API, `apps/api/src/graduation/*.test.ts` (resolver, evaluation and the student graduation API) and `apps/api/src/student/competency-cascade.test.ts` (results and advice deleted with the transcript, post-import hook).
