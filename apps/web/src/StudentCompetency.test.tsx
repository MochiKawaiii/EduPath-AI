import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudentCompetency, { ConsentDialog, type CompetencyView } from "./StudentCompetency";
import { fixtureAiAssessment, fixtureAssessment, fixtureResult } from "./student-competency.fixture";
import { competencyPolicyHref } from "./public-information";
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
    const order = sectionOrder(html, ["scomp-overview", "scomp-ai", "scomp-history", "scomp-skills", "scomp-progress", "scomp-graduation", "scomp-warnings"]);
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
  it("follows the competency term by term, grouped by school year (STU-COMP-07)", () => {
    const html = withAi("completed");
    const section = html.slice(html.indexOf('id="scomp-history"'), html.indexOf('id="scomp-skills"'));
    expect(section).toContain("Theo dõi năng lực theo học kỳ");
    expect(section).toContain("Điểm năng lực tổng tăng từ 68 (học kỳ 1 năm học 2023–2024) lên 79 (học kỳ 2 năm học 2025–2026). Cao nhất là 81 vào học kỳ 2 năm học 2024–2025.");
    // One row group per school year, its end-of-year score in the header.
    expect([...section.matchAll(/Năm học (\d{4}–\d{4})<span>Cuối năm: (\d+) · (\S+)<\/span>/g)].map((match) => match.slice(1).join(" "))).toEqual([
      "2023–2024 72 Khá", "2024–2025 81 Khá", "2025–2026 79 Khá",
    ]);
    // Group columns follow the result's groups; a group without a score shows a dash.
    expect(section).toContain('<th scope="col" class="scomp-num">Kiến thức chuyên môn</th><th scope="col" class="scomp-num">Kỹ năng bổ trợ</th>');
    // Changes in whole points as shown: rises green, falls red, the first term has none.
    const changes = [...section.matchAll(/<td class="scomp-num">(?:<span class="(sg-status-pass|sg-status-fail|scomp-zero)">([^<]+)<\/span>)<\/td><\/tr>/g)].map((match) => `${match[2]} ${match[1]}`);
    expect(changes).toEqual(["— scomp-zero", "+4 sg-status-pass", "+3 sg-status-pass", "+6 sg-status-pass", "−2 sg-status-fail"]);
    expect(section).toMatch(/class="scomp-history-latest"><th scope="row">Học kỳ 2<span class="scomp-career-tag">Hiện tại<\/span><small>HK252<\/small>/);
    // A result stored before the history asks for a new run instead of an empty table.
    const assessment = fixtureAssessment("completed");
    const older = render({ assessment: { ...assessment, result: { ...fixtureResult, history: undefined } }, aiEnabled: true, workerOnline: true });
    expect(older).toContain("Bấm “Đánh giá lại” để xem năng lực của bạn qua từng năm, từng học kỳ.");
    expect(older).not.toContain("scomp-history-table");
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
  it("advises only on the target career's skills: raising its met skills to Thành thạo", () => {
    const assessment = fixtureAssessment("completed");
    const deepen = [
      { ...fixtureResult.skillPlans![0]!, skillKey: "S01", name: "Lập trình web", level: "good" as const, levelLabel: "Khá", score: 80, careerSkill: true, purpose: "deepen" as const },
      { ...fixtureResult.skillPlans![1]!, skillKey: "S03", name: "Git", level: "good" as const, levelLabel: "Khá", score: 78, careerSkill: true, purpose: "deepen" as const },
    ];
    const html = render({ assessment: { ...assessment, result: { ...fixtureResult, skillPlans: deepen } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
    const plans = html.slice(html.indexOf("Nâng kỹ năng của nghề lên mức Thành thạo"), html.indexOf("Kỹ năng cần tự học (CTĐT chưa đo)"));
    expect(plans).toContain("Kỹ năng nghề Lập trình viên web bạn đã đạt ngưỡng nhưng chưa đạt mức Thành thạo (từ 85)");
    expect(plans).toContain("Kỹ năng: Lập trình web");
    expect(plans).toContain("Khá · 80");
    expect(plans).toContain("Bạn đã học hết học phần đo kỹ năng này trong chương trình; hãy làm một dự án nhỏ gắn với nghề");
    expect(html).not.toContain("Kỹ năng cần củng cố (dưới mức Khá)");
    // Weak skills outside the career (plans of an older result) are never advised on once a career is chosen.
    const older = withAi("completed", "gap");
    expect(older).not.toContain("Kỹ năng cần củng cố (dưới mức Khá)");
    expect(older).not.toContain("Kỹ năng: Sử dụng tiếng Anh");
    // The AI's advice on the career's own skills shows on this page too.
    expect(older).toContain("Nâng kỹ năng của nghề");
    expect(older).toContain("Học phần Cấu trúc dữ liệu và giải thuật (TST102)");
  });
  it("without a target career, gives each weak skill its courses: retake, take with prerequisites checked, or self-study", () => {
    const assessment = fixtureAssessment("completed");
    const html = render({ assessment: { ...assessment, result: { ...assessment.result, career: null } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
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
    const old = render({ assessment: { ...assessment, result: { ...fixtureResult, career: null, skillPlans: undefined } }, aiEnabled: true, workerOnline: true }, { view: "gap" });
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
    expect(html).toContain("Khoảng trống kỹ năng được tính cùng lúc với đánh giá năng lực, từ bảng điểm và nghề mục tiêu của bạn. Bấm “Đánh giá năng lực” để bắt đầu. Kết quả chỉ mang tính tham khảo.");
  });
});

/* ------------------------------------------------------------------ AI 100% */

const NOTICE = "Kết quả do AI Claude Haiku 5.5 (Anthropic) tính theo công thức của Khoa, có thể sai lệch. Chỉ để tham khảo.";
const cloud = (status: AiStatus, options: { view?: CompetencyView; errorCode?: string | null; workerOnline?: boolean } = {}) =>
  render({ assessment: fixtureAiAssessment(status, options.errorCode ?? null), aiEnabled: true, workerOnline: options.workerOnline ?? false, aiMode: "cloud", consentVersion: "x" }, { view: options.view });
const between = (html: string, from: string, to: string) => html.slice(html.indexOf(`id="${from}"`), html.indexOf(`id="${to}"`));

describe("StudentCompetency — AI 100% (Claude)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("takes every number of the competency page from the AI's result", () => {
    const html = cloud("completed");
    const overview = between(html, "scomp-overview", "scomp-ai");
    // AI overall 84,6 (engine 79,4); the fit and its summary are the AI's, never the engine's.
    expect(overview).toContain("<strong>84</strong><span>/100</span>");
    expect(overview).not.toContain("<strong>79</strong>");
    expect(overview).toContain('scomp-fit-label">Phù hợp</strong>');
    expect(overview).toContain("Đạt 2/5 kỹ năng · 1 sắp học · 1 chưa đủ dữ liệu");
    expect(overview).not.toContain("Khá phù hợp");
    // Strength chips follow the AI's levels: S03 is Thành thạo for the AI (Khá for the engine).
    expect(overview).toMatch(/Điểm mạnh<\/span><ul><li class="scomp-chip">Lập trình hướng đối tượng<\/li><li class="scomp-chip">Lập trình web<\/li><li class="scomp-chip">Thiết kế cơ sở dữ liệu<\/li><\/ul>/);
    const skills = between(html, "scomp-skills", "scomp-progress");
    expect(skills).toContain('aria-label="3 kỹ năng Thành thạo trong nhóm Kiến thức chuyên môn"');
    expect(skills).toContain("Điểm nhóm 84 · Khá");
    // Skills keep aiResult's order, by the AI's scores: S02 (95) before S01 (93).
    expect(skills.indexOf("Lập trình hướng đối tượng</span>")).toBeLessThan(skills.indexOf("Lập trình web<span"));
    expect(skills).toMatch(/Thiết kế cơ sở dữ liệu<span class="scomp-career-tag">Nghề mục tiêu<\/span><\/span><span class="scomp-level scomp-level-4">.*?Thành thạo<\/span><span class="scomp-skill-score">86<\/span>/);
    // The AI comment reads the AI's result too.
    expect(html).toContain("Bạn mạnh về lập trình hướng đối tượng");
    expect(html).toContain("Claude Haiku 5.5 (Anthropic) · tạo lúc");
  });

  it("shows the notice on both pages and leaves out confidence and coverage", () => {
    for (const view of ["competency", "gap"] as const) {
      const html = cloud("completed", { view });
      expect(html).toContain(NOTICE);
      // The notice opens the result, right under the page header.
      expect(html.indexOf(NOTICE)).toBeLessThan(html.indexOf(view === "gap" ? 'id="sgap-summary"' : 'id="scomp-overview"'));
      expect(html).not.toMatch(/tin cậy|độ phủ/i);
    }
    // The legacy result still prints them.
    const legacy = withAi("completed");
    expect(legacy).toContain("Độ tin cậy");
    expect(legacy).toContain("độ phủ");
    expect(legacy).not.toContain(NOTICE);
  });

  it("keeps the term-by-term history from the system, with a note that the AI did not compute it", () => {
    const html = cloud("completed");
    const history = between(html, "scomp-history", "scomp-skills");
    expect(history).toContain("Bảng này do hệ thống tính theo công thức của Khoa (không phải AI), nên điểm có thể khác kết quả do AI tính.");
    // The engine's history: its newest term is the engine's 79, not the AI's 84.
    expect(history).toContain("Năm học 2025–2026<span>Cuối năm: 79 · Khá</span>");
    expect(withAi("completed")).not.toContain("không phải AI");
  });

  it("waits for the AI with the time waited instead of the numbers, and keeps history, progress and graduation", () => {
    vi.useFakeTimers({ now: new Date("2026-10-16T02:31:23.000Z") });
    const html = cloud("processing");
    expect(html).toContain("AI đang tính kết quả của bạn");
    expect(html).toContain('role="timer">01:23</strong>');
    expect(html).toContain("Thường mất vài phút. Bạn có thể rời trang và quay lại sau.");
    expect(html).toMatch(/<li aria-current="step">3\. AI tính kết quả<\/li>/);
    for (const id of ["scomp-overview", "scomp-ai", "scomp-skills"]) expect(html).not.toContain(`id="${id}"`);
    expect(html).not.toContain(NOTICE);
    const order = sectionOrder(html, ["scomp-ai-scoring", "scomp-history", "scomp-progress", "scomp-graduation", "scomp-warnings"]);
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // No way to cancel: a cancelled AI-100% assessment would have no numbers.
    expect(html).not.toContain("Hủy tạo nhận xét");
    const gap = cloud("queued", { view: "gap" });
    expect(gap).toContain("AI đang tính kết quả của bạn");
    expect(gap).toMatch(/<li aria-current="step">2\. Xếp hàng<\/li>/);
    for (const id of ["sgap-summary", "scomp-ai", "scomp-career", "scomp-courses"]) expect(gap).not.toContain(`id="${id}"`);
    expect(gap).toContain('id="scomp-warnings"');
  });

  it("never mentions the team's AI machine in cloud mode", () => {
    for (const html of [cloud("queued"), cloud("processing", { view: "gap" }), cloud("failed", { errorCode: "worker_timeout" }),
      render({ assessment: fixtureAssessment("queued"), aiEnabled: true, workerOnline: false, aiMode: "cloud" })]) {
      expect(html).not.toMatch(/máy AI|Chờ máy|chạy cục bộ|Gemma/i);
    }
    // A comment-only assessment in cloud mode waits in the queue, not for a machine, and names Claude.
    const legacyInCloud = render({ assessment: fixtureAssessment("queued"), aiEnabled: true, workerOnline: false, aiMode: "cloud" });
    expect(legacyInCloud).toContain("Đang xếp hàng tạo nhận xét");
    expect(legacyInCloud).toContain("AI Claude Haiku 5.5 (Anthropic).");
    // The worker mode keeps its wording.
    expect(render({ assessment: fixtureAssessment("queued"), aiEnabled: true, workerOnline: false })).toContain("Đang chờ máy AI kết nối");
  });

  it("explains a failed AI run and offers a retry", () => {
    const html = cloud("failed", { errorCode: "ai_timeout" });
    expect(html).toContain("AI chưa tính được kết quả");
    expect(html).toContain("AI xử lý quá thời gian cho phép. Bấm “Thử lại” để AI tính lại; bảng điểm và hồ sơ của bạn không bị ảnh hưởng.");
    expect(html).toMatch(/<button type="button" class="sw-outline">.*?Thử lại<\/button>/);
    for (const id of ["scomp-overview", "scomp-ai", "scomp-skills"]) expect(html).not.toContain(`id="${id}"`);
    expect(html).toContain('id="scomp-history"');
    // A failure that cannot be retried points to a new assessment.
    const assessment = fixtureAiAssessment("completed");
    const unreadable = render({ assessment: { ...assessment, aiResult: null }, aiEnabled: true, workerOnline: false, aiMode: "cloud" });
    expect(unreadable).toContain("Kết quả AI trả về chưa đọc được. Hãy bấm “Đánh giá lại” để tạo lần đánh giá mới.");
  });

  it("says when only the comment failed and offers to make it again", () => {
    const html = cloud("completed", { errorCode: "invalid_ai_output" });
    // The numbers are there…
    expect(between(html, "scomp-overview", "scomp-ai")).toContain("<strong>84</strong>");
    expect(html).toContain(NOTICE);
    // …only the comment is missing.
    const panel = between(html, "scomp-ai", "scomp-history");
    expect(panel).toContain("Chưa tạo được nhận xét");
    expect(panel).toContain("AI đã tính xong kết quả nhưng chưa viết được nhận xét.");
    expect(panel).toMatch(/<button type="button" class="sw-outline">.*?Tạo lại<\/button>/);
    expect(panel).not.toContain("Hủy tạo nhận xét");
    // The comment can fail in other ways too (the API stores the Claude error); it can be made again all the same.
    const timedOut = between(cloud("completed", { errorCode: "ai_timeout" }), "scomp-ai", "scomp-history");
    expect(timedOut).toMatch(/<button type="button" class="sw-outline">.*?Tạo lại<\/button>/);
    expect(timedOut).not.toMatch(/máy AI/i);
  });

  it("takes every number of the gap page from the AI's result and leaves the courses to the AI comment", () => {
    const html = cloud("completed", { view: "gap" });
    const summary = between(html, "sgap-summary", "scomp-ai");
    expect(summary).toContain('scomp-fit-label">Phù hợp</strong>');
    expect(summary).toContain("Đạt 2/5 kỹ năng · 1 sắp học · 1 chưa đủ dữ liệu");
    expect(summary).toContain("4/5 kỹ năng có dữ liệu");
    // Coefficient-weighted mean of the AI's scores: (93·2 + 86,5·2 + 66) / 5 = 85.
    expect(summary).toContain("Điểm trung bình các kỹ năng nghề có điểm: <strong>85</strong> (3 kỹ năng)");
    // Only Giải thuật is missing for the AI; its band is labelled from the AI's code.
    expect(summary).toContain("Dưới ngưỡng · thiếu 4 điểm");
    expect(summary).toContain('class="scomp-code">Gần ngưỡng</span>');
    expect(summary).not.toContain("Thiết kế cơ sở dữ liệu");
    const table = between(html, "scomp-career", "scomp-warnings");
    expect(table).toMatch(/Thiết kế cơ sở dữ liệu<\/span><\/th>.*?<strong>86<\/strong><\/span><small>Thành thạo<\/small><\/td><td class="scomp-num" data-label="Ngưỡng">85<\/td><td class="scomp-num" data-label="Chênh lệch">\+1<\/td>/);
    // The engine's course cards are gone; the AI comment names the courses.
    expect(html).not.toContain('id="scomp-courses"');
    expect(html).not.toContain("Học phần nên học");
    expect(html).toContain("Học phần Cấu trúc dữ liệu và giải thuật (TST102): Học cải thiện Cấu trúc dữ liệu và giải thuật.");
    expect(html).toContain("Học phần Kiểm thử phần mềm (TST105)");
    expect(html).toContain("Học phần gợi ý do AI chọn trong chương trình đào tạo của bạn");
  });

  it("says that Claude computes the result before the first assessment", () => {
    const html = render({ assessment: null, aiEnabled: true, workerOnline: false, aiMode: "cloud" });
    expect(html).toContain("AI Claude Haiku 5.5 (Anthropic) tính điểm từng kỹ năng");
    expect(html).toContain("AI Claude Haiku 5.5 (Anthropic) sẽ tính kết quả trong vài phút. Kết quả chỉ mang tính tham khảo.");
    const worker = render({ assessment: null, aiEnabled: true, workerOnline: true });
    expect(worker).toContain("Hệ thống tính điểm từng kỹ năng");
    expect(worker).not.toContain("Claude");
  });
});

describe("ConsentDialog", () => {
  const dialog = (cloud: boolean) => renderToStaticMarkup(createElement(ConsentDialog, { busy: false, cloud, onClose: () => undefined, onConfirm: () => undefined }));
  it("says plainly what Claude computes, what is sent to Anthropic and what is not, before the student agrees", () => {
    const html = dialog(true);
    for (const text of [
      "Kết quả (điểm kỹ năng, điểm nhóm, điểm tổng, mức và khoảng trống so với nghề) do AI Claude Haiku 5.5 của Anthropic tính.",
      "EduPath gửi cho Anthropic mã, tên, tín chỉ và điểm các học phần trong bảng điểm (mọi lần học), chương trình đào tạo, trọng số kỹ năng và yêu cầu của nghề mục tiêu.",
      "EduPath không gửi họ tên, mã số sinh viên, email, lớp hay tệp PDF.",
      "Anthropic là công ty tại Hoa Kỳ và xử lý dữ liệu ngoài Việt Nam.",
      "Theo điều khoản của Anthropic, dữ liệu không được dùng để huấn luyện mô hình và được xóa trong vòng 30 ngày.",
      "Kết quả AI có thể sai lệch, chỉ để tham khảo.",
      "Bạn phải đồng ý thì mới dùng được tính năng này.",
    ]) expect(html).toContain(`<li>${text}</li>`);
    expect(html).toContain("Tôi đồng ý để EduPath gửi các dữ liệu trên cho Anthropic");
    expect(html).toContain(`href="${competencyPolicyHref}"`);
    expect(html).not.toContain("chạy cục bộ");
  });
  it("keeps the local-model wording outside cloud mode", () => {
    const html = dialog(false);
    expect(html).toContain("mô hình chạy cục bộ trên máy của nhóm phát triển");
    expect(html).not.toContain("Anthropic");
    expect(html).toContain(`href="${competencyPolicyHref}"`);
  });
});
