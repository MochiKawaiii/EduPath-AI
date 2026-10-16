import { describe, expect, it } from "vitest";
import { buildAiInput } from "./prompt.js";
import { syntheticResult, withCompV3Improvements } from "./test-fixture.js";
import { hasForbiddenContent, numbersIn, termCodeNumbers, validateAiOutput, validationContextFromAiInput, type AiOutput } from "./validate.js";

const input = buildAiInput(syntheticResult());
const context = validationContextFromAiInput(input)!;

const valid = (): AiOutput => ({
  summary: "Bạn có nền tảng lập trình hướng đối tượng vững với điểm 88, nhưng kiểm thử phần mềm mới đạt 55 trên ngưỡng 85.",
  groupInsights: [{ groupKey: "G1", comment: "Nhóm kỹ thuật phần mềm đạt 80, mức Khá." }],
  strengths: [{ skillKey: "S01", comment: "Học phần Nhập môn lập trình đạt 8.5 cho thấy bạn nắm chắc nền tảng." }],
  improvements: [
    {
      skillKey: "S03", priority: "high", courses: [{ courseCode: "TST201", reason: "Chưa học, đủ điều kiện đăng ký ở HK261." }],
      comment: "Kiểm thử phần mềm còn thiếu 30 điểm so với ngưỡng của nghề; hãy đăng ký Kiểm thử phần mềm cơ bản."
    },
    {
      skillKey: "S02", priority: "medium", courses: [{ courseCode: "TST130", reason: "Đã đạt 6,8 (C+), có thể học cải thiện." }],
      comment: "Cơ sở dữ liệu đạt 72, đã qua ngưỡng của nghề; học cải thiện Nhập môn cơ sở dữ liệu để nâng lên mức Thành thạo."
    }
  ],
  careerFit: { comment: "Bạn đạt 2/4 kỹ năng của nghề, mức Khá phù hợp." },
  gaps: [
    { skillKey: "S03", priority: "high", explanation: "Đây là kỹ năng bắt buộc của nghề.", courses: [{ courseCode: "TST201", reason: "Học ở HK261." }], selfStudy: ["Viết bộ kiểm thử cho một dự án cá nhân."] },
    { skillKey: "S05", priority: "low", explanation: "Chương trình chưa đo kỹ năng này.", courses: [], selfStudy: ["Tự triển khai một ứng dụng nhỏ lên nền tảng đám mây."] }
  ],
  progress: "Bạn đang trễ 1 mục với 3 tín chỉ so với kế hoạch; nên ưu tiên học lại Toán rời rạc.",
  nextSteps: ["Đăng ký Kiểm thử phần mềm cơ bản.", "Hoàn thành một sản phẩm kiểm thử nhỏ.", "Học lại Toán rời rạc."]
});

const reasonOf = (raw: unknown) => {
  const result = validateAiOutput(raw, context);
  return result.ok ? "ok" : `${result.error.reason}@${result.error.path}`;
};

describe("validateAiOutput", () => {
  it("accepts an output that only uses supplied keys, courses and numbers", () => {
    const result = validateAiOutput(valid(), context);
    expect(result).toEqual({ ok: true, output: valid() });
  });

  it("rejects schema violations with a typed error", () => {
    expect(reasonOf({ ...valid(), extra: 1 })).toBe("schema@");
    expect(reasonOf({ ...valid(), summary: "" })).toBe("schema@summary");
    expect(reasonOf({ ...valid(), summary: "a".repeat(601) })).toBe("schema@summary");
    expect(reasonOf({ ...valid(), nextSteps: ["Một", "Hai"] })).toBe("schema@nextSteps");
    expect(reasonOf({ ...valid(), improvements: [{ skillKey: "S03", priority: "urgent", comment: "x" }] })).toBe("schema@improvements.0.priority");
    expect(reasonOf("not json")).toBe("schema@");
  });

  it("rejects unknown skill and group keys", () => {
    expect(reasonOf({ ...valid(), strengths: [{ skillKey: "S99", comment: "Tốt." }] })).toBe("unknown_skill_key@strengths.0.skillKey");
    expect(reasonOf({ ...valid(), groupInsights: [{ groupKey: "G7", comment: "Tốt." }] })).toBe("unknown_group_key@groupInsights.0.groupKey");
    expect(reasonOf({ ...valid(), gaps: [{ ...valid().gaps[0]!, skillKey: "S01" }] })).toBe("unknown_gap_skill@gaps.0.skillKey");
  });

  it("rejects a course that belongs to another skill or is invented", () => {
    const gaps = valid().gaps;
    gaps[1] = { ...gaps[1]!, courses: [{ courseCode: "TST201", reason: "Học ở HK261." }] };
    expect(reasonOf({ ...valid(), gaps })).toBe("foreign_course@gaps.1.courses.0.courseCode");
    const invented = valid().gaps;
    invented[0] = { ...invented[0]!, courses: [{ courseCode: "XYZ999", reason: "Học thêm." }] };
    expect(reasonOf({ ...valid(), gaps: invented })).toBe("foreign_course@gaps.0.courses.0.courseCode");
  });

  it("keeps strengths to strong skills and away from improvements and gaps", () => {
    expect(reasonOf({ ...valid(), strengths: [{ skillKey: "S03", comment: "Tốt." }] })).toBe("unknown_skill_key@strengths.0.skillKey");
    expect(reasonOf({ ...valid(), improvements: [{ skillKey: "S01", priority: "low", comment: "Ôn lại." }] })).toBe("unknown_skill_key@improvements.0.skillKey");
    expect(reasonOf({ ...valid(), strengths: [{ skillKey: "S04", comment: "Tốt." }] })).toBe("unknown_skill_key@strengths.0.skillKey");
    // Cross-list conflict, checked even if a stored schema allowed both (e.g. a comp-v1 job).
    const loose = { ...context, strengthKeys: ["S01", "S03"], improvementKeys: ["S01", "S02", "S03"] };
    expect(validateAiOutput({ ...valid(), strengths: [{ skillKey: "S03", comment: "Tốt." }] }, loose)).toMatchObject({ ok: false, error: { reason: "conflicting_skill", path: "strengths.0.skillKey" } });
    // A met career skill to deepen is no strength (comp-v5).
    expect(reasonOf({ ...valid(), strengths: [{ skillKey: "S02", comment: "Tốt." }] })).toBe("unknown_skill_key@strengths.0.skillKey");
  });

  it("allows an improvement only the courses listed for exactly that skill (comp-v4)", () => {
    const improvements = (courses: AiOutput["improvements"][number]["courses"], skillKey = "S02") =>
      ({ ...valid(), improvements: [{ skillKey, priority: "high" as const, courses, comment: "Học cải thiện Nhập môn cơ sở dữ liệu." }] });
    // Take and improve courses of the plan; at most 2.
    expect(reasonOf(improvements([{ courseCode: "TST240", reason: "Chưa học, đủ điều kiện đăng ký." }, { courseCode: "TST130", reason: "Đã đạt, học cải thiện." }]))).toBe("ok");
    expect(reasonOf(improvements([{ courseCode: "TST201", reason: "Học mới." }]))).toBe("foreign_course@improvements.0.courses.0.courseCode");
    expect(reasonOf(improvements([{ courseCode: "XYZ999", reason: "Học thêm." }]))).toBe("foreign_course@improvements.0.courses.0.courseCode");
    expect(reasonOf(improvements([{ courseCode: "TST130", reason: "A." }, { courseCode: "TST130", reason: "B." }]))).toBe("duplicate@improvements.0.courses.1.courseCode");
    const three = ["TST240", "TST130", "TST201"].map((courseCode) => ({ courseCode, reason: "Học." }));
    expect(reasonOf(improvements(three))).toBe("schema@improvements.0.courses");
    // Reasons are checked like every other text.
    expect(reasonOf(improvements([{ courseCode: "TST130", reason: "Học cải thiện để đạt 9,5." }]))).toBe("invented_number@improvements.0.courses.0.reason");
    expect(reasonOf(improvements([{ courseCode: "TST130", reason: "Xem www.example.org." }]))).toBe("forbidden_content@improvements.0.courses.0.reason");
    expect(reasonOf(improvements([{ courseCode: "TST130", reason: "" }]))).toBe("schema@improvements.0.courses.0.reason");
    // With a career, a weak skill outside it is no improvement at all (comp-v5).
    expect(reasonOf(improvements([], "S06"))).toBe("unknown_skill_key@improvements.0.skillKey");
    // Without one, its plan's courses (take, retake, improve) are allowed, and a plan without courses allows none.
    const noCareer = validationContextFromAiInput(buildAiInput(syntheticResult({ career: false })))!;
    const strengthen = (skillKey: string, courses: AiOutput["improvements"][number]["courses"]) => {
      const result = validateAiOutput({
        ...valid(), summary: "Bạn có nền tảng lập trình hướng đối tượng vững với điểm 88.", gaps: [],
        improvements: [{ skillKey, priority: "high", courses, comment: "Học lại Toán rời rạc." }]
      }, noCareer);
      return result.ok ? "ok" : `${result.error.reason}@${result.error.path}`;
    };
    expect(strengthen("S06", [{ courseCode: "TST310", reason: "Cần đạt trước Hệ điều hành." }, { courseCode: "TST150", reason: "Chưa đạt, học lại." }])).toBe("ok");
    expect(strengthen("S07", [{ courseCode: "TST120", reason: "Ôn lại." }])).toBe("foreign_course@improvements.0.courses.0.courseCode");
    expect(strengthen("S07", [])).toBe("ok");
  });

  it("validates the output of a job queued before comp-v4 against its own schema", () => {
    const legacyInput = { ...input, schema: withCompV3Improvements(input.schema, ["S03", "S06"]) };
    const legacy = validationContextFromAiInput(legacyInput)!;
    const old = { ...valid(), improvements: [{ skillKey: "S03", priority: "high", comment: "Kiểm thử phần mềm còn thiếu 30 điểm." }] };
    // No courses in the old schema: stored as an empty list.
    expect(validateAiOutput(old, legacy)).toEqual({ ok: true, output: { ...old, improvements: [{ ...old.improvements[0]!, courses: [] }] } });
    expect(validateAiOutput(valid(), legacy)).toMatchObject({ ok: false, error: { reason: "foreign_course", path: "improvements.0.courses.0.courseCode" } });
    // A current job never lacks courses (its grammar requires them), but a missing list reads as empty.
    expect(validateAiOutput(old, context)).toMatchObject({ ok: true, output: { improvements: [{ skillKey: "S03", courses: [] }] } });
  });

  it("rejects course codes in free text that are not in the data block", () => {
    const real = { ...context, numbers: new Set([...context.numbers, 71, 30103]), courseCodes: new Set(["71ITSE30103"]) };
    const check = (summary: string) => { const r = validateAiOutput({ ...valid(), summary }, real); return r.ok ? "ok" : `${r.error.reason}@${r.error.path}`; };
    expect(check("Bạn nên học Kiểm thử phần mềm (71ITSE30103).")).toBe("ok");
    expect(check("Bạn nên học Cơ sở dữ liệu (ITSE30103).")).toBe("foreign_course@summary");
    expect(check("Bạn nên học thêm 71ITXX30103.")).toBe("foreign_course@summary");
    expect(check("Học kỳ HK253 và kỹ năng S03 không phải mã học phần.")).toBe("ok");
  });

  it("rejects duplicates", () => {
    expect(reasonOf({ ...valid(), strengths: [{ skillKey: "S01", comment: "A." }, { skillKey: "S01", comment: "B." }] })).toBe("duplicate@strengths.1");
    const gaps = valid().gaps;
    gaps[0] = { ...gaps[0]!, courses: [{ courseCode: "TST201", reason: "A." }, { courseCode: "TST201", reason: "B." }] };
    expect(reasonOf({ ...valid(), gaps })).toBe("duplicate@gaps.0.courses.1.courseCode");
  });

  it("rejects numbers that are not in the data block", () => {
    expect(reasonOf({ ...valid(), summary: "Bạn đạt 73 điểm kiểm thử." })).toBe("invented_number@summary");
    expect(reasonOf({ ...valid(), nextSteps: ["Luyện 2 tuần.", "Làm dự án.", "Ôn tập."] })).toBe("ok");
    expect(reasonOf({ ...valid(), nextSteps: ["Luyện 17 tuần.", "Làm dự án.", "Ôn tập."] })).toBe("invented_number@nextSteps.0");
    expect(reasonOf({ ...valid(), progress: "Điểm 72.46 cho thấy..." })).toBe("invented_number@progress");
  });

  it("rejects extra decimals on a score the data block gives as a whole number", () => {
    // The engine scores are 88,5 / 80,5 / 72,25; the data block (and the page) show 88 / 80 / 72.
    expect(reasonOf({ ...valid(), summary: "Điểm tổng của bạn là 72." })).toBe("ok");
    expect(reasonOf({ ...valid(), summary: "Điểm tổng của bạn là 72,25." })).toBe("invented_number@summary");
    expect(reasonOf({ ...valid(), summary: "Lập trình hướng đối tượng đạt 88,5." })).toBe("invented_number@summary");
    expect(reasonOf({ ...valid(), groupInsights: [{ groupKey: "G1", comment: "Nhóm đạt 80,5." }] })).toBe("invented_number@groupInsights.0.comment");
  });

  it("accepts a term written in words or as the code of a term in the data block, and rejects an invented term code", () => {
    expect(reasonOf({ ...valid(), progress: "Bạn đang ở học kỳ 3 năm học 2025–2026, học kỳ tới là học kỳ 1 năm học 2026–2027." })).toBe("ok");
    expect(reasonOf({ ...valid(), progress: "Bạn nên đăng ký Kiểm thử phần mềm cơ bản ở HK261." })).toBe("ok");
    expect(reasonOf({ ...valid(), progress: "Bạn nên đăng ký Kiểm thử phần mềm cơ bản ở HK271." })).toBe("invented_number@progress");
  });

  it("rejects URLs, emails and HTML", () => {
    expect(reasonOf({ ...valid(), summary: "Xem https://example.org nhé." })).toBe("forbidden_content@summary");
    expect(reasonOf({ ...valid(), summary: "Xem www.example.org nhé." })).toBe("forbidden_content@summary");
    expect(reasonOf({ ...valid(), summary: "Học trên example.com nhé." })).toBe("forbidden_content@summary");
    expect(reasonOf({ ...valid(), summary: "Liên hệ ai@example.org nhé." })).toBe("forbidden_content@summary");
    expect(reasonOf({ ...valid(), summary: "Bạn <b>giỏi</b>." })).toBe("forbidden_content@summary");
    expect(reasonOf({ ...valid(), summary: "Bạn giỏi &amp; chăm." })).toBe("forbidden_content@summary");
  });
});

describe("helpers", () => {
  it("reads decimal comma and dot the same way", () => {
    expect(numbersIn("điểm 72,5 và 8.5, HK253, 2/4")).toEqual([72.5, 8.5, 253, 2, 4]);
    // Course scores keep their decimals (8,5); 100-point skill scores are whole (72,5 is sent as 72).
    expect(context.numbers.has(8.5)).toBe(true);
    expect(context.numbers.has(72)).toBe(true);
    expect(context.numbers.has(72.5)).toBe(false);
    expect(context.numbers.has(2026)).toBe(true);
  });
  it("derives HKyyS codes from terms written in words", () => {
    expect(termCodeNumbers("học kỳ 3 năm học 2025–2026; học kỳ 1 năm học 2026-2027; học kỳ 2 năm học 2009–2010")).toEqual([253, 261, 92]);
    expect(numbersIn("HK092")).toEqual([92]);
    expect(context.numbers.has(253)).toBe(true);
    expect(context.numbers.has(262)).toBe(true);
    expect(context.numbers.has(271)).toBe(false);
  });
  it("does not flag technology names", () => {
    expect(hasForbiddenContent("ASP.NET, Node.js, C#/C++ và Socket.io")).toBe(false);
  });
  it("needs a well-formed stored input", () => {
    expect(validationContextFromAiInput({ schema: {}, user: "x" })).toBeNull();
    expect(validationContextFromAiInput({ schema: input.schema, user: 1 })).toBeNull();
  });
});
