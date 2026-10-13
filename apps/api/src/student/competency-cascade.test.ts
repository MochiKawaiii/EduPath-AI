import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { TRANSCRIPT_POLICY_VERSION } from "./consent.js";
import { createStudentDataRouter } from "./router.js";
import { createTranscriptWorkerRouter, type TranscriptImportHook } from "./transcript-jobs.js";

// Replacing or deleting the transcript removes every derived competency result (spec §8) and
// every graduation advice (design §5.7); a committed import then queues fresh advice best-effort.
vi.mock("./transcript-parser.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./transcript-parser.js")>(),
  parseTranscript: vi.fn(async () => ({ schemaVersion: 1, parserVersion: "vlu-native-1", pageCount: 1, courseCount: 0, sections: [], warnings: [] })),
}));

const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const version = "33333333-3333-4333-8333-333333333333";
const jobId = "44444444-4444-4444-8444-444444444444";
const lease = "55555555-5555-4555-8555-555555555555";
const origin = "https://edupath.example";
const pdf = Buffer.from("%PDF-1.7\n%test\n");

function studentApp(existing: boolean, afterTranscriptImport?: TranscriptImportHook, ocrEnabled = false) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: studentId }] };
    if (sql.includes("SELECT version FROM student_transcripts")) return existing ? { rowCount: 1, rows: [{ version }] } : { rowCount: 0, rows: [] };
    if (sql.includes("INSERT INTO student_transcripts")) return { rowCount: 1, rows: [{ version: "new" }] };
    if (sql.includes("INSERT INTO transcript_jobs")) return { rowCount: 1, rows: [{ id: jobId, status: "queued" }] };
    if (sql.includes("count(*)::int AS count FROM transcript_jobs")) return { rowCount: 1, rows: [{ count: 0 }] };
    if (sql.includes("SELECT id FROM transcript_jobs")) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [] };
  });
  const pool = { connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }), query: vi.fn(async () => ({ rowCount: 0, rows: [] })) } as unknown as DatabasePool;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, { session: { user: { userId: studentId, tenantId, role: "student" } } }); next(); });
  app.use("/student", createStudentDataRouter(pool, origin, ocrEnabled, { afterTranscriptImport }));
  return { app, sql: () => query.mock.calls.map(([text, params]) => [String(text), params] as const) };
}

const upload = (app: express.Express, transcriptVersion: string | null = version) => {
  const req = request(app).post("/student/transcript").set("Origin", origin).set("Content-Type", "application/pdf")
    .set("X-File-Name", "bang-diem.pdf").set("X-Confirm-Own-Transcript", "true").set("X-Consent-Policy-Version", TRANSCRIPT_POLICY_VERSION);
  return (transcriptVersion ? req.set("X-Transcript-Version", transcriptVersion) : req).send(pdf);
};

const ocrResult = {
  schema_version: "1.1", adapter: "vlu_8_columns", course_count: 1, needs_review: false,
  pages: [{ page: 1, method: "ppocr", warnings: [] }],
  courses: [{ ordinal: 1, course_code: "71ITBS10103", course_name: "Nhập môn Công nghệ thông tin", credits: 3, score_10: 8, score_4: 3.5, letter_grade: "B+",
    result: "passed", source_page: 1, academic_year: "2023-2024", semester: "HK01", section: "semester", needs_review: false, issues: [] }],
  summaries: [], semesters: [], unparsed_rows: [],
};

/** Completes an OCR job through the worker router; returns the SQL of the transaction. */
async function completeOcr(result: unknown, afterTranscriptImport?: TranscriptImportHook) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT user_id FROM transcript_jobs")) return { rowCount: 1, rows: [{ user_id: studentId }] };
    if (sql.startsWith("SELECT is_active")) return { rowCount: 1, rows: [{ is_active: true }] };
    if (sql.startsWith("SELECT *,lease_until")) return { rowCount: 1, rows: [{ status: "processing", lease_token: lease, valid: true, filename: "bang-diem.pdf", pdf_data: pdf, expected_version: version }] };
    if (sql.startsWith("SELECT version FROM student_transcripts")) return { rowCount: 1, rows: [{ version }] };
    return { rowCount: 1, rows: [] };
  });
  const pool = { connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }), query: vi.fn() } as unknown as DatabasePool;
  const app = express();
  app.use("/worker", createTranscriptWorkerRouter(pool, "k".repeat(40), { afterTranscriptImport }));
  await request(app).post(`/worker/${jobId}/complete`).set("Authorization", `Bearer ${"k".repeat(40)}`).send(result).expect(200, { ok: true });
  return query.mock.calls.map(([text, params]) => [String(text), params] as const);
}

/** The student's graduation advice is deleted in the same transaction, before the marker statement. */
function expectAdvicePurgedBefore(calls: readonly (readonly [string, unknown])[], marker: string, userId: string) {
  const purge = calls.findIndex(([sql]) => sql === "DELETE FROM stu_grad_advice WHERE user_id=$1");
  expect(purge).toBeGreaterThan(-1);
  expect(calls[purge]?.[1]).toEqual([userId]);
  expect(purge).toBeLessThan(calls.findIndex(([sql]) => sql === marker));
}

afterEach(() => vi.restoreAllMocks());

function expectCascadeBefore(calls: readonly (readonly [string, unknown])[], marker: string, userId: string) {
  const jobs = calls.findIndex(([sql]) => sql === "DELETE FROM stu_comp_ai_jobs WHERE user_id=$1");
  const results = calls.findIndex(([sql]) => sql === "DELETE FROM stu_comp_assessments WHERE user_id=$1");
  expect(jobs).toBeGreaterThan(-1);
  expect(results).toBeGreaterThan(jobs);
  expect(calls[results]?.[1]).toEqual([userId]);
  expect(results).toBeLessThan(calls.findIndex(([sql]) => sql === marker));
}

describe("competency results and graduation advice follow the transcript", () => {
  it("are deleted with the transcript in the same transaction", async () => {
    const { app, sql } = studentApp(true);
    await request(app).delete("/student/transcript").set("Origin", origin).send({ version, confirmed: true }).expect(200, { deleted: true });
    expectCascadeBefore(sql(), "COMMIT", studentId);
    expectAdvicePurgedBefore(sql(), "COMMIT", studentId);
  });

  it("are deleted when a native upload replaces the transcript", async () => {
    const { app, sql } = studentApp(true);
    await upload(app).expect(200);
    const calls = sql();
    expect(calls.findIndex(([text]) => text.includes("INSERT INTO student_transcripts"))).toBeLessThan(calls.findIndex(([text]) => text.startsWith("DELETE FROM stu_comp_assessments")));
    expect(calls.findIndex(([text]) => text.includes("INSERT INTO student_transcripts"))).toBeLessThan(calls.findIndex(([text]) => text.startsWith("DELETE FROM stu_grad_advice")));
    expectCascadeBefore(calls, "COMMIT", studentId);
    expectAdvicePurgedBefore(calls, "COMMIT", studentId);
  });

  it("are deleted when an OCR job replaces the transcript, and kept when the job fails", async () => {
    const replaced = await completeOcr({ leaseToken: lease, result: ocrResult });
    expect(replaced.some(([sql]) => sql.includes("INSERT INTO student_transcripts"))).toBe(true);
    expectCascadeBefore(replaced, "COMMIT", studentId);
    expectAdvicePurgedBefore(replaced, "COMMIT", studentId);
    const failed = await completeOcr({ leaseToken: lease, error: "ocr_failed" });
    expect(failed.some(([sql]) => sql.includes("stu_comp_") || sql.includes("stu_grad_advice"))).toBe(false);
  });
});

describe("graduation advice is queued after a committed import", () => {
  it("runs the hook once, after COMMIT, for a native upload", async () => {
    let statementsAtHook: string[] = [];
    const hook = vi.fn<TranscriptImportHook>(async () => { statementsAtHook = sql().map(([text]) => text); });
    const { app, sql } = studentApp(true, hook);
    await upload(app).expect(200);
    await vi.waitFor(() => expect(hook).toHaveBeenCalledTimes(1));
    expect(hook).toHaveBeenCalledWith(studentId);
    expect(statementsAtHook.at(-1)).toBe("COMMIT");
    expect(statementsAtHook).toContain("DELETE FROM stu_grad_advice WHERE user_id=$1");
  });

  it("never fails the import when the hook throws, and logs only an error code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hook = vi.fn<TranscriptImportHook>(async () => { throw Object.assign(new Error(`deadlock for ${studentId}`), { code: "40P01" }); });
    const { app } = studentApp(false, hook);
    const res = await upload(app, null).expect(201);
    expect(res.body.transcript).toEqual({ version: "new" });
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("[transcript] post-import hook failed (40P01)"));
    expect(JSON.stringify(error.mock.calls)).not.toContain(studentId);
    const sync = vi.fn<TranscriptImportHook>(() => { throw new TypeError("boom"); });
    await upload(studentApp(true, sync).app).expect(200);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("[transcript] post-import hook failed (TypeError)"));
  });

  it("does not run the hook for a rejected upload, an OCR enqueue or a transcript deletion", async () => {
    const hook = vi.fn<TranscriptImportHook>(async () => undefined);
    await upload(studentApp(true, hook).app, "77777777-7777-4777-8777-777777777777").expect(409, { error: "transcript_changed" });
    await upload(studentApp(true, hook, true).app).expect(202);
    await request(studentApp(true, hook).app).delete("/student/transcript").set("Origin", origin).send({ version, confirmed: true }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(hook).not.toHaveBeenCalled();
  });

  it("runs the hook after an OCR job replaced the transcript, not after a failed job", async () => {
    const replacedHook = vi.fn<TranscriptImportHook>(async () => undefined);
    await completeOcr({ leaseToken: lease, result: ocrResult }, replacedHook);
    await vi.waitFor(() => expect(replacedHook).toHaveBeenCalledWith(studentId));
    const failedHook = vi.fn<TranscriptImportHook>(async () => undefined);
    await completeOcr({ leaseToken: lease, error: "ocr_failed" }, failedHook);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(failedHook).not.toHaveBeenCalled();
  });
});
