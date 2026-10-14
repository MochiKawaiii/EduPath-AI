import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import StudentCompetency, { type CompetencyView } from "./StudentCompetency";
import { fixtureAssessment, fixtureResult } from "./student-competency.fixture";
import type { AiStatus, LatestAssessmentResponse } from "./competency-assessment-types";
import type { GraduationCourseRow, GraduationEvaluation, StudentGraduationResponse } from "./student-graduation-types";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

// Synthetic graduation answer: everything passes but the thesis group TC306 and, because of it, the total credits.
const row = (code: string, name: string, credits: number, state: GraduationCourseRow["state"]): GraduationCourseRow => ({
  code, name, credits, conditionOnly: false, groupId: "TC306", state, inferred: false, attempts: state === "not_taken" ? 0 : 1,
  score10: null, score4: null, letter: null, term: null,
});
const evaluation: GraduationEvaluation = {
  calcVersion: "comp-calc-v5", status: "fail", groupStatus: "fail", needsImprovement: false,
  asOf: { transcriptVersion: "v1", transcriptUpdatedAt: "2026-10-01T08:00:00Z", latestTerm: "HK253" },
  groups: [
    { id: "BB", name: "Nhóm bắt buộc", label: "Nhóm bắt buộc", kind: "mandatory", code: null, curriculumElectiveCode: null, unit: "môn", required: 42, lower: 42, upper: 42, remaining: null, status: "pass", minimumCredits: null, accumulatedCredits: 108, courseCount: 42, passedCount: 42, courses: [] },
    {
      id: "TC306", name: "Nhóm tự chọn TC306", label: "Nhóm tự chọn TC306", kind: "elective", code: "TC306", curriculumElectiveCode: "TC406", unit: "TC",
      required: 6, lower: 0, upper: 0, remaining: 6, status: "fail", minimumCredits: 6, accumulatedCredits: 0, courseCount: 3, passedCount: 0,
      courses: [row("TST301", "Chuyên đề Tốt nghiệp 1", 3, "not_taken"), row("TST306", "Đồ án Tốt nghiệp", 6, "not_taken"), row("TST302", "Chuyên đề Tốt nghiệp 2", 3, "not_taken")],
    },
  ],
  credits: { lower: 120, upper: 120, required: 126, status: "fail", source: "printed", remaining: 6 },
  gpa: { actual: 3.11, required: 2, scale: 4, status: "pass", source: "printed", reason: "", remaining: null },
  creditCheck: { status: "match", printed: 120, computedLower: 120, computedUpper: 120 },
  improvementCandidates: [], inProgress: [], unknownResults: [], warnings: [],
};
const graduation: StudentGraduationResponse = {
  profile: { cohortCode: "K29", specialty: "CNPM" }, resolution: "specialty",
  standard: {
    id: "std-1", revisionId: "rev-1", version: 1, name: "71K29CNTT_7480201-03_TN04 - K29CNTT_Công nghệ thông tin (Công nghệ phần mềm)",
    cohortCode: "K29", classBlock: "71K29CNTT", major: "Công nghệ thông tin", specialty: "Công nghệ phần mềm (7480201-03)",
    educationSystem: "Đại học chính quy", faculty: "Công nghệ thông tin", minimumCredits: 126, mandatoryCredits: null, electiveCredits: null,
    freeElectiveCredits: null, minimumGpa: 2, gpaScale: 4, notes: "", groups: [], courses: [],
  },
  transcript: { version: "v1", updatedAt: "2026-10-01T08:00:00Z" }, evaluation, specialtySuggestion: null,
};

const profile = { careerPositionId: "career-1", careerPosition: { id: "career-1", nameVi: "Lập trình viên web", nameEn: "Web Developer", deletedAt: null } };
function render(latest: LatestAssessmentResponse | null, options: { loading?: boolean; transcript?: boolean; specialty?: string | null; view?: CompetencyView; graduation?: StudentGraduationResponse } = {}) {
  liveData.mockImplementation((url: string) => url.endsWith("/latest")
    ? { data: latest, error: null, loading: options.loading ?? false }
    : url === "/api/student/graduation" ? { data: options.graduation ?? graduation, error: null, loading: false }
      : { data: options.transcript ?? true, error: null, loading: false });
  return renderToStaticMarkup(createElement(StudentCompetency, { profile: { ...profile, specialty: options.specialty === undefined ? "CNPM" : options.specialty }, view: options.view }));
}
const withAi = (status: AiStatus, view?: CompetencyView) => render({ assessment: fixtureAssessment(status), aiEnabled: true, workerOnline: true }, { view });
const sectionOrder = (html: string, ids: string[]) => ids.map((id) => html.indexOf(`id="${id}"`));

describe("StudentCompetency — Đánh giá năng lực", () => {
  it("renders the competency sections in order with the AI comment right after the overview", () => {
    const html = withAi("completed");
    const order = sectionOrder(html, ["scomp-overview", "scomp-ai", "scomp-skills", "scomp-progress", "scomp-graduation", "scomp-warnings"]);
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The gap analysis lives on its own page now.
    expect(html).not.toContain('id="scomp-career"');
    expect(html).not.toContain('id="scomp-courses"');
    expect(html).toContain('href="#skill-gap"');
    expect(html).toContain("Đánh giá lại");
    expect(html).toContain("Xóa kết quả đánh giá");
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });
  it("shows the competency part of the AI text with names, the AI label and the local model footer", () => {
    const html = withAi("completed");
    expect(html).toContain("Nhận xét từ EduPath AI");
    expect(html).toContain(">AI<");
    expect(html).toContain("Gemma 4 E4B, chạy cục bộ");
    expect(html).toContain("có thể chưa chính xác");
    expect(html).toContain("Bạn đang có nền tảng lập trình web rất tốt");
    expect(html).toContain("Nên cải thiện");
    expect(html).not.toContain("Với nghề mục tiêu");
    expect(html).not.toContain("Không ánh xạ được");
    // comp-v4: each improvement names its course; codes outside the engine's list are dropped.
    expect(html).toContain("Học phần Cấu trúc dữ liệu và giải thuật (TST102): Đã đạt với điểm 6,4; học cải thiện để nâng kỹ năng giải thuật.");
    expect(html).not.toContain("XXX998");
  });
  it("keeps the full computed result when AI is disabled", () => {
    const html = render({ assessment: fixtureAssessment("disabled"), aiEnabled: false, workerOnline: false });
    expect(html).toContain("Nhận xét AI chưa được bật");
    expect(html).not.toContain("Tạo lại nhận xét");
    expect(html).toContain("Khá phù hợp");
    expect(html).toContain("Bảng phân tích mức độ thành thạo theo nhóm kỹ năng");
  });
  it("explains the proficiency table and counts skills per level and group", () => {
    const html = withAi("completed");
    expect(html).not.toContain("Chi tiết kỹ năng");
    expect(html).toContain("Kết quả này cho biết gì?");
    // G1: S01, S02 Thành thạo · S03 Khá · S04 Cơ bản · S07 no evidence (S08 is outside the student's choices).
    expect(html).toContain('aria-label="2 kỹ năng Thành thạo trong nhóm Kiến thức chuyên môn"');
    expect(html).toContain('aria-label="1 kỹ năng Cơ bản trong nhóm Kiến thức chuyên môn"');
    expect(html).toContain('aria-label="1 kỹ năng Chưa có minh chứng trong nhóm Kiến thức chuyên môn"');
    expect(html).toContain("Điểm nhóm 79 · Khá");
  });
  it("shows a busy AI box with a cancel button while processing", () => {
    const html = withAi("processing");
    // No aria-busy on the AI section: it would hide the pending state from screen readers for minutes.
    expect(html).not.toMatch(/id="scomp-ai"[^>]*aria-busy/);
    expect(html).toContain("EduPath AI đang phân tích kết quả");
    expect(html).toContain("Hủy tạo nhận xét");
  });
  it("offers regeneration after a failure and explains the error", () => {
    const failed = fixtureAssessment("failed", "ai_timeout");
    const html = render({ assessment: failed, aiEnabled: true, workerOnline: true });
    expect(html).toContain("Máy AI xử lý quá thời gian cho phép.");
    expect(html).toContain("Tạo lại nhận xét");
  });
  it("counts group skills like the overall line and tags AI priorities without 'Ưu tiên'", () => {
    const html = withAi("completed");
    // G1 has S01–S04 scored, S07 no evidence, S08 outside the student's choices (not counted).
    expect(html).toContain("4/5 kỹ năng có minh chứng");
    expect(html).not.toContain("4/6 kỹ năng có minh chứng");
    // G1 4/5 + G2 1/1 = the overall 5/6.
    expect(html).toContain("1/1 kỹ năng có minh chứng");
    expect(html).toContain("Dựa trên 5/6 kỹ năng có minh chứng");
    expect(html).toContain('class="scomp-priority">Cần làm sớm</span>');
    expect(html).not.toMatch(/scomp-priority">Ưu tiên/);
  });
  it("groups skills with no evidence last and says it is not a weakness", () => {
    const html = withAi("completed");
    expect(html.indexOf("Chưa có minh chứng (1)")).toBeGreaterThan(html.indexOf("Kiến thức chuyên môn (4)"));
    expect(html).toContain("Không phải điểm yếu");
    expect(html).toContain("suy ra từ điểm chữ");
  });
  it("colours progress red when late and green when on plan", () => {
    const late = withAi("completed");
    expect(late).toMatch(/scomp-plan-status scomp-plan-late"><span aria-hidden="true">✗<\/span><span>Chậm so với kế hoạch: 1 học phần · 3 TC/);
    expect(late).toContain('<dd class="sg-status-fail">1 ');
    const assessment = fixtureAssessment("completed");
    const onPlan = { ...assessment, result: { ...fixtureResult, progress: { ...fixtureResult.progress!, late: [], lateCount: 0, lateCredits: 0 } } };
    const html = render({ assessment: onPlan, aiEnabled: true, workerOnline: true });
    expect(html).toMatch(/scomp-plan-status scomp-plan-ok"><span aria-hidden="true">✓<\/span><span>Đúng kế hoạch/);
    expect(html).toContain("sg-status-pass\">Bạn đang theo đúng kế hoạch đào tạo.");
  });
  it("shows the graduation page's verdict with the reason, what to do and the detail link first", () => {
    const html = withAi("completed");
    const section = html.slice(html.indexOf('id="scomp-graduation"'), html.indexOf('id="scomp-warnings"'));
    expect(section).toContain("Hiện tại bạn chưa đủ điều kiện xét tốt nghiệp vì còn thiếu 6 tín chỉ thuộc nhóm tự chọn TC306 (CTĐT: TC406). Tổng số tín chỉ tích lũy (120/126) cũng sẽ đủ khi bạn hoàn thành nhóm tự chọn TC306 (CTĐT: TC406).");
    // The full standard name opens the section; the detail button sits with the verdict, before "Nên làm" and the table.
    expect(section.indexOf("Căn cứ:")).toBeLessThan(section.indexOf("scomp-grad-verdict"));
    expect(section).toMatch(/scomp-grad-verdict scomp-grad-fail">.*<a class="sw-outline scomp-grad-detail" href="#graduation">Xem chi tiết/);
    expect(section.indexOf("scomp-grad-detail")).toBeLessThan(section.indexOf("Nên làm"));
    expect(section.indexOf("Nên làm")).toBeLessThan(section.indexOf("<table"));
    // The thesis is the main path; the replacement courses are a fallback with a reason.
    expect(section).toContain("Đăng ký Đồ án Tốt nghiệp (6 TC) để hoàn thành nhóm tự chọn TC306 (CTĐT: TC406). Đây là phương án chính");
    expect(section).toContain("Chỉ chọn học phần thay thế khi bạn không làm đồ án tốt nghiệp theo quy định của Khoa");
    expect(section).toContain("Phương án thay thế: chọn đủ 6 tín chỉ trong các học phần sau: Chuyên đề Tốt nghiệp 1 (TST301), Chuyên đề Tốt nghiệp 2 (TST302).");
    // Same order as the graduation page: groups, GPA, total credits last.
    const titles = [...section.matchAll(/<th scope="row">([^<]+)/g)].map((match) => match[1]);
    expect(titles).toEqual(["Nhóm bắt buộc", "Nhóm tự chọn TC306 (CTĐT: TC406)", "Điểm trung bình tích lũy (hệ 4)", "Tổng số tín chỉ tích lũy"]);
    expect(section).not.toContain("Kết quả chính thức do nhà trường xác nhận");
    expect(section).toContain("Căn cứ: <a class=\"scomp-doc-link\" href=\"#graduation\">Tiêu chuẩn xét tốt nghiệp 71K29CNTT_7480201-03_TN04 - K29CNTT_Công nghệ thông tin (Công nghệ phần mềm) — khóa K29, ngành Công nghệ thông tin, chuyên ngành Công nghệ phần mềm (7480201-03), phiên bản 1</a>");
    // Never the copy stored with the assessment (its standard name and numbers differ).
    expect(section).not.toContain("Tiêu chuẩn tốt nghiệp K29 – CNPM");
  });
  it("explains a missing standard instead of a verdict", () => {
    const html = render({ assessment: fixtureAssessment("completed"), aiEnabled: true, workerOnline: true }, { graduation: { ...graduation, resolution: "specialty_unset", standard: null, evaluation: null } });
    expect(html).toContain("Hãy chọn chuyên ngành trong hồ sơ");
    expect(html).not.toContain("scomp-grad-verdict");
  });
  it("shows an introduction when there is no assessment yet", () => {
    const html = render({ assessment: null, aiEnabled: false, workerOnline: false }, { specialty: null });
    expect(html).toContain("Chưa có kết quả đánh giá");
    expect(html).toContain("Đánh giá năng lực</button>");
    expect(html).toContain("Chưa xác định");
    expect(html).not.toContain("Xóa kết quả đánh giá");
  });
  it("shows a loading state while the first request runs", () => {
    const html = render(null, { loading: true });
    expect(html).toContain("Đang tải kết quả đánh giá…");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Đánh giá năng lực<\/button>/);
  });
  it("says when the profile changed after the assessment", () => {
    expect(withAi("completed")).not.toContain("Hồ sơ đã thay đổi sau lần đánh giá này");
    const html = render({ assessment: fixtureAssessment("completed"), aiEnabled: true, workerOnline: true }, { specialty: null });
    expect(html).toContain("Hồ sơ đã thay đổi sau lần đánh giá này");
  });
  it("does not stay on 'Đang kiểm tra…' when the transcript check fails", () => {
    liveData.mockImplementation((url: string) => url.endsWith("/latest")
      ? { data: { assessment: null, aiEnabled: false, workerOnline: false }, error: null, loading: false }
      : { data: null, error: "Chưa kiểm tra được bảng điểm.", loading: false });
    const html = renderToStaticMarkup(createElement(StudentCompetency, { profile: { ...profile, specialty: "CNPM" } }));
    expect(html).toContain("Chưa kiểm tra được — thử tải lại trang");
    expect(html).not.toContain("Đang kiểm tra…");
  });
});

describe("StudentCompetency — Khoảng trống kỹ năng", () => {
  it("renders the gap sections in order, with no delete button and no graduation check", () => {
    const html = withAi("completed", "gap");
    expect(html).toContain("Kết quả phân tích khoảng trống kỹ năng");
    const order = sectionOrder(html, ["sgap-summary", "scomp-ai", "scomp-career", "scomp-courses", "scomp-warnings"]);
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('id="scomp-skills"');
    expect(html).not.toContain('id="scomp-graduation"');
    expect(html).not.toContain("Xóa kết quả đánh giá");
    expect(html).toContain("Đánh giá lại");
    expect(html).toContain("Cách tính mức phù hợp và khoảng trống");
  });
  it("lists the missing skills with their shortfall", () => {
    const html = withAi("completed", "gap");
    const summary = html.slice(html.indexOf('id="sgap-summary"'), html.indexOf('id="scomp-ai"'));
    expect(summary).toContain("Kỹ năng còn thiếu");
    expect(summary).toContain("Thiết kế cơ sở dữ liệu");
    expect(summary).toContain("Dưới ngưỡng · thiếu 10 điểm");
    expect(summary).toContain("Thiếu vừa");
    expect(summary).not.toContain("Lập trình web</strong>");
  });
  it("shows the gap part of the AI text with its courses", () => {
    const html = withAi("completed", "gap");
    expect(html).toContain("Nhận xét từ EduPath AI về khoảng trống kỹ năng");
    expect(html).toContain("Với nghề mục tiêu");
    expect(html).toContain("Học phần Kiểm thử phần mềm (TST105)");
    expect(html).not.toContain("XXX999");
    expect(html).not.toContain("Bước tiếp theo");
  });
  it("renders gap statuses with glyphs and never colours missing data as a failure", () => {
    const html = withAi("completed", "gap");
    expect(html).toContain("✓</span> Đạt ngưỡng");
    expect(html).toContain("Dưới ngưỡng · thiếu 10 điểm");
    expect(html).toContain("Sắp học · HK261");
    expect(html).toMatch(/scomp-status scomp-status-neutral"><span aria-hidden="true">\?<\/span> Chưa đủ dữ liệu/);
    expect(html).toContain("<caption");
  });
  it("names every suggested course with whether it was taken and whether it can be registered", () => {
    const html = withAi("completed", "gap");
    expect(html).toContain("Học phần nên học");
    expect(html).toContain("Tình trạng của bạn");
    expect(html).toContain("○</span> Chưa học");
    expect(html).toContain("Cần học trước Công nghệ phần mềm (TST109)");
    expect(html).toContain("Học cải thiện");
    expect(html).toContain("✓</span> Đã học, đạt · điểm 6,4 (C+)");
    expect(html).toContain("Kỹ năng cần tự học (CTĐT chưa đo)");
    expect(html).toContain("Kỹ năng: Docker");
    expect(html).toContain("Không có học phần nào trong chương trình đào tạo của bạn để đăng ký cho kỹ năng này.");
    expect(html).toContain("Đóng gói ứng dụng web của bạn bằng Docker.");
  });
  it("gives each weak skill its courses: retake, take with prerequisites checked, or self-study", () => {
    const html = withAi("completed", "gap");
    const plans = html.slice(html.indexOf("Kỹ năng cần củng cố (dưới mức Khá)"), html.indexOf("Kỹ năng cần tự học (CTĐT chưa đo)"));
    expect(plans).toContain("Kỹ năng: Sử dụng tiếng Anh");
    expect(plans).toContain("Cơ bản · 61");
    expect(plans).toMatch(/scomp-plan-action">Học cải thiện<\/span><strong>Tiếng Anh 2<\/strong>/);
    expect(plans).toContain("✓</span> Đã học, đạt · điểm 5,8 (C)");
    expect(plans).toMatch(/scomp-plan-action">Học mới<\/span><strong>Tiếng Anh chuyên ngành<\/strong>/);
    expect(plans).toContain("✓</span> Đủ điều kiện đăng ký");
    expect(plans).toContain("HK261 theo KHĐT");
    expect(plans).toContain("Kỹ năng: Định tuyến mạng");
    expect(plans).toContain("Không còn học phần nào trong chương trình của bạn để học thêm cho kỹ năng này");
    // Results stored before comp-calc-v6 have no plans: the part is left out, nothing breaks.
    const assessment = fixtureAssessment("completed");
    const old = render({ assessment: { ...assessment, result: { ...fixtureResult, skillPlans: undefined } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    expect(old).not.toContain("Kỹ năng cần củng cố (dưới mức Khá)");
  });
  it("does not praise a career that has no requirements yet", () => {
    const assessment = fixtureAssessment("completed");
    const result = { ...assessment.result, career: { ...assessment.result.career!, requirements: [] } };
    const html = render({ assessment: { ...assessment, result }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    expect(html).toContain("Nghề này chưa có yêu cầu kỹ năng trong danh mục nên chưa so sánh được.");
    expect(html).not.toContain("Bạn đã đạt mọi kỹ năng có dữ liệu của nghề này.");
  });
  it("asks for a target career when none is chosen", () => {
    const assessment = fixtureAssessment("completed");
    const html = render({ assessment: { ...assessment, result: { ...assessment.result, career: null } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    expect(html).toContain("Bạn chưa chọn nghề mục tiêu");
    expect(html).not.toContain('id="scomp-career"');
  });
  it("introduces the page before the first assessment", () => {
    const html = render({ assessment: null, aiEnabled: false, workerOnline: false }, { view: "gap" });
    expect(html).toContain("Chưa có kết quả phân tích");
    expect(html).toContain("Khoảng trống kỹ năng được tính cùng lúc với đánh giá năng lực");
  });
});
