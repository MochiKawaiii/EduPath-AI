import { z } from "zod";
import { TranscriptError, type TranscriptData, type TranscriptSection } from "./transcript-parser.js";

const text = z.string().max(2000);
const courseSchema = z.object({
  ordinal: z.number().int().min(1).max(1000), course_code: z.string().regex(/^\d{2}[A-Z]{2,10}\d{5,8}$/),
  course_name: text.min(1), credits: z.number().int().min(0).max(30),
  score_10: z.number().min(0).max(10).nullable(), score_4: z.number().min(0).max(4).nullable(),
  letter_grade: z.enum(["A+","A","B+","B","C+","C","D+","D","F","MT"]).nullable(),
  result: z.enum(["passed","failed"]).nullable(), source_page: z.number().int().min(1).max(20),
  academic_year: z.string().regex(/^\d{4}-\d{4}$/).nullable(), semester: z.enum(["HK01","HK02","HK03"]).nullable(),
  section: z.enum(["semester","credit_transfer"]), needs_review: z.boolean(), issues: z.array(text).max(100)
});
const documentSchema = z.object({
  schema_version: z.literal("1.1"), adapter: z.literal("vlu_8_columns"), course_count: z.number().int().min(1).max(1000),
  courses: z.array(courseSchema).min(1).max(1000), needs_review: z.boolean(),
  pages: z.array(z.object({ page: z.number().int().min(1).max(20), method: z.enum(["pdf_text","ppocr"]), warnings: z.array(text).max(100) })).min(1).max(20),
  summaries: z.array(z.object({ academic_year: text.nullable(), semester: text.nullable(), raw_cells: z.array(text.nullable()).max(20) })).max(200),
  semesters: z.array(z.record(z.string(), z.unknown())).max(100),
  unparsed_rows: z.array(z.unknown()).max(1000)
});

export function mapOcrTranscript(input: unknown): TranscriptData {
  const checked = documentSchema.safeParse(input);
  if (!checked.success) throw new TranscriptError("invalid_ocr_result");
  const d = checked.data;
  if (d.unparsed_rows.length || d.course_count !== d.courses.length || d.pages.some((p,i) => p.page !== i+1)) throw new TranscriptError("unreadable_rows");
  const sections = new Map<string, TranscriptSection>();
  for (const c of d.courses) {
    const transfer = c.section === "credit_transfer";
    if (c.issues.length || (c.score_10 === null) !== (c.score_4 === null)) throw new TranscriptError("unreadable_grades");
    if (c.source_page > d.pages.length) throw new TranscriptError("invalid_ocr_result");
    if (transfer ? c.academic_year !== null || c.semester !== null : !c.academic_year || !c.semester || Number(c.academic_year.slice(5)) !== Number(c.academic_year.slice(0,4))+1) throw new TranscriptError("missing_semester");
    const id = transfer ? "transfer" : `${c.academic_year}-${c.semester}`;
    let s = sections.get(id);
    if (!s) { s = { id, academicYear:c.academic_year, semester:c.semester, label:transfer ? "Điểm bảo lưu" : `${c.academic_year} · ${c.semester}`, courses:[], summaries:[] }; sections.set(id,s); }
    if (s.courses.some(row => row.ordinal === c.ordinal)) throw new TranscriptError("duplicate_rows");
    s.courses.push({ ordinal:c.ordinal, code:c.course_code, name:c.course_name, credits:c.credits, score10:c.score_10, score4:c.score_4, letter:c.letter_grade,
      result:c.result === "passed" ? "Đạt" : c.result === "failed" ? "Không đạt" : null,
      conditional:c.course_name.includes("*") || /^(71NAD|71PE)/.test(c.course_code), sourcePage:c.source_page });
  }
  for (const raw of d.summaries) {
    const section = sections.get(raw.academic_year ? `${raw.academic_year}-${raw.semester}` : "transfer");
    if (!section) throw new TranscriptError("missing_semester");
    for (const cell of raw.raw_cells) for (const line of (cell ?? "").split(/\r?\n/)) {
      const cleaned = line.replace(/^-\s*/, "").trim(), colon = cleaned.indexOf(":");
      if (colon >= 0) section.summaries.push({label:cleaned.slice(0,colon).trim(),value:cleaned.slice(colon+1).trim() || null});
    }
  }
  return { schemaVersion:1, parserVersion:"vlu-ocr-1.1", pageCount:d.pages.length, courseCount:d.course_count,
    sections:[...sections.values()], warnings:["Bảng điểm do sinh viên tải lên; chưa được nhà trường xác minh.", ...(d.needs_review ? ["Bảng điểm đã được nhận dạng tự động. Hãy đối chiếu các môn học và điểm với PDF gốc."] : [])],
    ocr:{ needsReview:d.needs_review, pages:d.pages, semesters:d.semesters } };
}
