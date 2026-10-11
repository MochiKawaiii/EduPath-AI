import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { TRANSCRIPT_POLICY_VERSION } from "./consent.js";
import { createStudentDataRouter } from "./router.js";
import { createTranscriptWorkerRouter } from "./transcript-jobs.js";

// Replacing or deleting the transcript removes every derived competency result (spec §8).
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

function studentApp(existing: boolean) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: studentId }] };
    if (sql.includes("SELECT version FROM student_transcripts")) return existing ? { rowCount: 1, rows: [{ version }] } : { rowCount: 0, rows: [] };
    if (sql.includes("INSERT INTO student_transcripts")) return { rowCount: 1, rows: [{ version: "new" }] };
    return { rowCount: 1, rows: [] };
  });
  const pool = { connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }), query: vi.fn() } as unknown as DatabasePool;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, { session: { user: { userId: studentId, tenantId, role: "student" } } }); next(); });
  app.use("/student", createStudentDataRouter(pool, origin));
  return { app, sql: () => query.mock.calls.map(([text, params]) => [String(text), params] as const) };
}

function expectCascadeBefore(calls: readonly (readonly [string, unknown])[], marker: string, userId: string) {
  const jobs = calls.findIndex(([sql]) => sql === "DELETE FROM stu_comp_ai_jobs WHERE user_id=$1");
  const results = calls.findIndex(([sql]) => sql === "DELETE FROM stu_comp_assessments WHERE user_id=$1");
  expect(jobs).toBeGreaterThan(-1);
  expect(results).toBeGreaterThan(jobs);
  expect(calls[results]?.[1]).toEqual([userId]);
  expect(results).toBeLessThan(calls.findIndex(([sql]) => sql === marker));
}

describe("competency results follow the transcript", () => {
  it("are deleted with the transcript in the same transaction", async () => {
    const { app, sql } = studentApp(true);
    await request(app).delete("/student/transcript").set("Origin", origin).send({ version, confirmed: true }).expect(200, { deleted: true });
    expectCascadeBefore(sql(), "COMMIT", studentId);
  });

  it("are deleted when a native upload replaces the transcript", async () => {
    const { app, sql } = studentApp(true);
    await request(app).post("/student/transcript").set("Origin", origin).set("Content-Type", "application/pdf")
      .set("X-File-Name", "bang-diem.pdf").set("X-Confirm-Own-Transcript", "true").set("X-Consent-Policy-Version", TRANSCRIPT_POLICY_VERSION)
      .set("X-Transcript-Version", version).send(pdf).expect(200);
    const calls = sql();
    expect(calls.findIndex(([text]) => text.includes("INSERT INTO student_transcripts"))).toBeLessThan(calls.findIndex(([text]) => text.startsWith("DELETE FROM stu_comp_assessments")));
    expectCascadeBefore(calls, "COMMIT", studentId);
  });

  it("are deleted when an OCR job replaces the transcript, and kept when the job fails", async () => {
    const run = async (result: unknown) => {
      const query = vi.fn(async (sql: string) => {
        if (sql.startsWith("SELECT user_id FROM transcript_jobs")) return { rowCount: 1, rows: [{ user_id: studentId }] };
        if (sql.startsWith("SELECT is_active")) return { rowCount: 1, rows: [{ is_active: true }] };
        if (sql.startsWith("SELECT *,lease_until")) return { rowCount: 1, rows: [{ status: "processing", lease_token: lease, valid: true, filename: "bang-diem.pdf", pdf_data: pdf, expected_version: version }] };
        if (sql.startsWith("SELECT version FROM student_transcripts")) return { rowCount: 1, rows: [{ version }] };
        return { rowCount: 1, rows: [] };
      });
      const pool = { connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }), query: vi.fn() } as unknown as DatabasePool;
      const app = express();
      app.use("/worker", createTranscriptWorkerRouter(pool, "k".repeat(40)));
      await request(app).post(`/worker/${jobId}/complete`).set("Authorization", `Bearer ${"k".repeat(40)}`).send(result).expect(200, { ok: true });
      return query.mock.calls.map(([text, params]) => [String(text), params] as const);
    };
    const ocr = {
      schema_version: "1.1", adapter: "vlu_8_columns", course_count: 1, needs_review: false,
      pages: [{ page: 1, method: "ppocr", warnings: [] }],
      courses: [{ ordinal: 1, course_code: "71ITBS10103", course_name: "Nhập môn Công nghệ thông tin", credits: 3, score_10: 8, score_4: 3.5, letter_grade: "B+",
        result: "passed", source_page: 1, academic_year: "2023-2024", semester: "HK01", section: "semester", needs_review: false, issues: [] }],
      summaries: [], semesters: [], unparsed_rows: [],
    };
    const replaced = await run({ leaseToken: lease, result: ocr });
    expect(replaced.some(([sql]) => sql.includes("INSERT INTO student_transcripts"))).toBe(true);
    expectCascadeBefore(replaced, "COMMIT", studentId);
    const failed = await run({ leaseToken: lease, error: "ocr_failed" });
    expect(failed.some(([sql]) => sql.includes("stu_comp_"))).toBe(false);
  });
});
