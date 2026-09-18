import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { mapOcrTranscript } from "./ocr-adapter.js";
import { createTranscriptWorkerRouter } from "./transcript-jobs.js";
import type { DatabasePool } from "../db/pool.js";
const fixture = () => ({
  schema_version: "1.1", adapter: "vlu_8_columns", course_count: 1, needs_review: true,
  pages: [{ page: 1, method: "ppocr", warnings: ["ocr_requires_visual_review"] }],
  courses: [{
    ordinal: 1, course_code: "71ENG01000", course_name: "Tiếng Anh", credits: 3, score_10: 6, score_4: 2.4, letter_grade: "C", result: "passed", source_page: 1,
    academic_year: "2023-2024", semester: "HK01", section: "semester", needs_review: true, issues: []
  }],
  summaries: [{ academic_year: "2023-2024", semester: "HK01", raw_cells: [null, "- Điểm TB học kỳ (Hệ 4): 2.4"] }], semesters: [{ semester_gpa_4: 2.4 }], unparsed_rows: []
});
describe("OCR result boundary", () => {
  it("maps grades and icons, keeps review provenance and printed totals", () => {
    const result = mapOcrTranscript(fixture());
    expect(result.sections[0]?.courses[0]).toMatchObject({ code: "71ENG01000", score10: 6, score4: 2.4, result: "Đạt" });
    expect(result.sections[0]?.summaries).toEqual([{ label: "Điểm TB học kỳ (Hệ 4)", value: "2.4" }]);
    expect(result.ocr?.needsReview).toBe(true);
  });
  it.each(["count", "missing_row", "score", "semester", "duplicate", "issue", "page"])("rejects %s rather than saving partial/corrupt data", kind => {
    const f = fixture();
    if (kind === 'count') f.course_count = 2;
    if (kind === 'missing_row') (f.unparsed_rows as unknown[]).push({ cells: [] });
    if (kind === 'score') f.courses[0]!.score_10 = 11;
    if (kind === 'semester') f.courses[0]!.semester = "HK04";
    if (kind === 'duplicate') { f.courses.push({ ...f.courses[0]! }); f.course_count = 2; }
    if (kind === 'issue') (f.courses[0]!.issues as string[]).push("incomplete_scores");
    if (kind === 'page') f.courses[0]!.source_page = 2;
    expect(() => mapOcrTranscript(f)).toThrow();
  });
  it("does not require a school email or student identity in the PDF", () => expect(mapOcrTranscript(fixture()).courseCount).toBe(1));
  it("rejects missing/wrong worker keys before parsing JSON or touching DB", async () => {
    const app = express(); app.use(createTranscriptWorkerRouter({} as DatabasePool, "k".repeat(32)));
    await request(app).post('/claim').expect(401);
    await request(app).post('/claim').set('Authorization', 'Bearer wrong').send({}).expect(401);
  });
});
