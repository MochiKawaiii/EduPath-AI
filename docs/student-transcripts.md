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

PDF.js extracts positioned text in a worker. The parser targets the supplied university eight-column native PDF layout: ordinal, course code, name, credits, score /10, score /4, letter and result. It preserves transfer credits, semester groupings, multiline course names and the printed semester summaries. Empty grades stay null; graphic result icons are not inferred. The website maps `sections[].courses[]` into tables, with semester and course filters, and offers PDF/JSON downloads.

JSON contains `schemaVersion`, `parserVersion`, `pageCount`, `courseCount`, `sections` and `warnings`. Sections contain academic year, semester, courses and source summary labels/values. Course rows retain source page and the conditional-course marker. Printed totals are not recalculated from filtered rows.

Limits: 5 MB, 20 pages, 1,000 course rows, 25-second extraction timeout, one extraction worker at a time per server instance. Scanned/image-only PDFs, encrypted files and unsupported layouts are rejected. OCR is not implemented. The supplied three-page PDF extracted 50 course rows (3 transfer rows and 47 rows across 9 semesters). The source file contains no usable student identity for ownership verification, so upload requires the student's explicit confirmation. Uploaded records are not institution-verified.

The sample PDF and extracted personal data are not committed or automatically assigned to a user. No build, typecheck, automated tests or browser smoke tests were run, as requested by the user.
