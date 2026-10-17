import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import StudentGraduation from "./StudentGraduation";
import type {
  GraduationAdviceResponse, GraduationCourseRow, GraduationEvaluation, GraduationGroupEvaluation, StoredAdvice,
  StudentGraduationResponse, StudentGraduationStandard,
} from "./student-graduation-types";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

// Synthetic standard and results only; no real student data.
type Live<T> = { data: T | null; error: string | null; loading: boolean };
const ready = <T,>(data: T): Live<T> => ({ data, error: null, loading: false });

const row = (code: string, name: string, groupId: string, state: GraduationCourseRow["state"], extra: Partial<GraduationCourseRow> = {}): GraduationCourseRow => ({
  code, name, credits: 3, conditionOnly: false, groupId, state, inferred: false, attempts: state === "not_taken" ? 0 : 1,
  score10: state === "passed" ? 8.2 : state === "failed" ? 3.5 : null, score4: state === "passed" ? 3.5 : state === "failed" ? 0 : null,
  letter: state === "passed" ? "B+" : state === "failed" ? "F" : null, term: state === "not_taken" ? null : "HK243", ...extra,
});

const mandatoryCourses = [
  row("71ITBS10103", "Lập trình", "BB", "passed"),
  row("71PE10101", "Giáo dục thể chất (*)", "BB", "passed", { conditionOnly: true, credits: 1 }),
  row("71ITSE30103", "Kiểm thử phần mềm", "BB", "failed", { attempts: 2 }),
  row("71ITSE41010", "Đồ án tốt nghiệp", "BB", "not_taken", { credits: 10 }),
];
const electiveCourses = [
  row("71ITSE40103", "Phát triển ứng dụng web", "TC306", "passed", { inferred: true, letter: "A" }),
  row("71ITSE40203", "Kiến trúc phần mềm", "TC306", "not_taken"),
  row("71ITSE40303", "Điện toán đám mây", "TC306", "in_progress"),
];
const freeCourses = [row("71ITAI40103", "Học máy", "TC102", "passed"), row("71ITAI40203", "Thị giác máy tính", "TC102", "passed")];

const standard = (): StudentGraduationStandard => ({
  id: "std-cnpm", revisionId: "rev-cnpm", version: 3, name: "Tiêu chuẩn xét tốt nghiệp K29 – Công nghệ phần mềm", cohortCode: "K29",
  classBlock: "71K29CNTT", major: "Công nghệ thông tin", specialty: "7480201-03", educationSystem: "Đại học chính quy", faculty: "Công nghệ thông tin",
  minimumCredits: 138, mandatoryCredits: 120, electiveCredits: 12, freeElectiveCredits: 6, minimumGpa: 2, gpaScale: 4,
  notes: "Sinh viên cần hoàn thành chứng chỉ ngoại ngữ theo quy định.",
  groups: [
    { id: "BB", name: "Nhóm bắt buộc", kind: "mandatory", minimumCredits: 120 },
    { id: "TC306", name: "Nhóm tự chọn TC306", kind: "elective", minimumCredits: 6 },
    { id: "TC102", name: "Nhóm tự chọn TC102", kind: "elective", minimumCredits: 6 },
  ],
  courses: [...mandatoryCourses, ...electiveCourses, ...freeCourses].map((course, index) => ({
    id: `c${index}`, groupId: course.groupId, code: course.code, name: course.name, credits: course.credits, conditionOnly: course.conditionOnly,
  })),
});

const groups = (status: "pass" | "fail" | "unknown"): GraduationGroupEvaluation[] => [
  {
    id: "BB", name: "Nhóm bắt buộc", label: "Nhóm bắt buộc", kind: "mandatory", code: null, curriculumElectiveCode: null, unit: "môn",
    required: 4, lower: status === "pass" ? 4 : 2, upper: status === "pass" ? 4 : status === "unknown" ? 4 : 2,
    remaining: status === "pass" ? null : 2, status, minimumCredits: 120, accumulatedCredits: 3, courseCount: 4, passedCount: status === "pass" ? 4 : 2,
    courses: status === "pass" ? mandatoryCourses.map((course) => ({ ...course, state: "passed" as const }))
      : status === "unknown" ? mandatoryCourses.map((course) => course.state === "passed" ? course : { ...course, state: "graded_unknown" as const, score10: 6, score4: 2 })
        : mandatoryCourses,
  },
  {
    id: "TC306", name: "Nhóm tự chọn TC306", label: "Nhóm tự chọn TC306", kind: "elective", code: "TC306", curriculumElectiveCode: "TC406", unit: "TC",
    required: 6, lower: status === "fail" ? 3 : 6, upper: status === "fail" ? 3 : 6, remaining: status === "fail" ? 3 : null,
    status: status === "fail" ? "fail" : "pass", minimumCredits: 6, accumulatedCredits: 3, courseCount: 3, passedCount: status === "fail" ? 1 : 2,
    courses: status === "fail" ? electiveCourses : electiveCourses.map((course) => ({ ...course, state: "passed" as const })),
  },
  {
    id: "TC102", name: "Nhóm tự chọn TC102", label: "Nhóm tự chọn TC102", kind: "elective", code: "TC102", curriculumElectiveCode: null, unit: "TC",
    required: 6, lower: 6, upper: 6, remaining: null, status: "pass", minimumCredits: 6, accumulatedCredits: 6, courseCount: 2, passedCount: 2, courses: freeCourses,
  },
];

const evaluation = (status: "pass" | "fail" | "unknown", extra: Partial<GraduationEvaluation> = {}): GraduationEvaluation => ({
  calcVersion: "comp-calc-v5", status, groupStatus: status, needsImprovement: false,
  asOf: { transcriptVersion: "00000000-0000-4000-8000-0000000000f1", transcriptUpdatedAt: "2026-10-01T08:00:00Z", latestTerm: "HK253" },
  groups: groups(status),
  credits: status === "fail"
    ? { lower: 126, upper: 126, required: 138, status: "fail", source: "printed", remaining: 12 }
    : { lower: 140, upper: 140, required: 138, status: "pass", source: "printed", remaining: null },
  gpa: status === "fail"
    ? { actual: 1.8749, required: 2, scale: 4, status: "fail", source: "printed", reason: "", remaining: 0.1251 }
    : { actual: 3.12, required: 2, scale: 4, status: "pass", source: "printed", reason: "", remaining: null },
  creditCheck: { status: "match", printed: status === "fail" ? 126 : 140, computedLower: 126, computedUpper: 140 },
  improvementCandidates: status === "fail" ? [
    { code: "71ITSE30103", name: "Kiểm thử phần mềm", credits: 3, score: 0, scale: 4, letter: "F", state: "failed" },
    { code: "71ITBS10103", name: "Lập trình", credits: 3, score: 1.5, scale: 4, letter: "D+", state: "passed" },
  ] : [],
  inProgress: status === "fail" ? [electiveCourses[2]!] : [],
  unknownResults: status === "unknown" ? [{ ...mandatoryCourses[2]!, state: "graded_unknown" }] : [],
  warnings: [],
  ...extra,
});

const graduation = (overrides: Partial<StudentGraduationResponse> = {}): StudentGraduationResponse => ({
  profile: { cohortCode: "K29", specialty: "CNPM" }, resolution: "specialty", standard: standard(),
  transcript: { version: "00000000-0000-4000-8000-0000000000f1", updatedAt: "2026-10-01T08:00:00Z" },
  evaluation: evaluation("fail"), specialtySuggestion: null, ...overrides,
});

const output = {
  summary: "Bạn còn thiếu 3 tín chỉ ở nhóm tự chọn TC306 và 2 môn bắt buộc.",
  advice: [
    { focus: "G2", label: "Nhóm tự chọn TC306", text: "Hãy chọn thêm Kiến trúc phần mềm để đủ 6 tín chỉ." },
    { focus: "GPA", label: "Điểm trung bình tích lũy", text: "Học lại Kiểm thử phần mềm sẽ giúp nâng điểm trung bình." },
    { focus: "CREDITS", label: "Tổng số tín chỉ tích lũy", text: "Bạn còn thiếu 12 tín chỉ tích lũy." },
    { focus: "GENERAL", label: "Lời khuyên chung", text: "Hãy trao đổi với cố vấn học tập về kế hoạch học tập." },
  ],
  nextSteps: ["Kiểm tra lịch mở lớp học kỳ tới.", "Trao đổi với cố vấn học tập về thứ tự học."],
};
const stored = (status: StoredAdvice["status"], extra: Partial<StoredAdvice> = {}): StoredAdvice => ({
  id: "advice-1", status, errorCode: null, createdAt: new Date(Date.now() - 65_000).toISOString(),
  completedAt: status === "completed" ? "2026-10-13T03:05:00Z" : null, model: "gemma4:e4b", standardVersion: 3,
  output: status === "completed" ? output : null, ...extra,
});
const adviceResponse = (overrides: Partial<GraduationAdviceResponse> = {}): GraduationAdviceResponse => ({
  advice: null, stale: false, needsAdvice: false, aiEnabled: true, worker: { online: true, supportsAdvice: true }, fingerprint: "fp-current", ...overrides,
});

function render(page: Live<StudentGraduationResponse>, advice: Live<GraduationAdviceResponse> = ready(adviceResponse({ advice: stored("completed") }))) {
  liveData.mockImplementation((url: string) => {
    if (url === "/api/student/graduation") return page;
    if (url === "/api/student/graduation/advice") return advice;
    throw new Error(`Unexpected URL ${url}`);
  });
  return renderToStaticMarkup(createElement(StudentGraduation));
}
const withAdvice = (advice: GraduationAdviceResponse) => render(ready(graduation()), ready(advice));
/** Visible text without tags, for sentences that span several elements. */
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'");

describe("StudentGraduation loading", () => {
  it("shows a status while loading and an alert with a reload button on error", () => {
    const loading = render({ data: null, error: null, loading: true }, { data: null, error: null, loading: true });
    expect(loading).toContain('role="status"');
    expect(loading).toContain("Đang tải điều kiện xét tốt nghiệp…");
    expect(loading).not.toContain("sg-stats");
    const failed = render({ data: null, error: "Không thể tải điều kiện xét tốt nghiệp. Vui lòng thử lại.", loading: false });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Không thể tải điều kiện xét tốt nghiệp. Vui lòng thử lại.");
    expect(failed).toContain("Thử lại");
  });
});

describe("StudentGraduation standard", () => {
  it("shows only the student's own standard, picked automatically, without a selector", () => {
    const html = render(ready(graduation()));
    expect(html).toContain("Tiêu chuẩn xét tốt nghiệp của bạn");
    expect(html).toContain("<h2 id=\"sg-standard-title\" class=\"sg-title\">Tiêu chuẩn xét tốt nghiệp K29 – Công nghệ phần mềm</h2>");
    expect(html).toContain('<ul class="sg-meta-tags"><li><span>Khóa</span> <strong>K29</strong></li><li><span>Chuyên ngành</span> <strong>Công nghệ phần mềm</strong></li><li><span>Phiên bản</span> <strong>3</strong></li></ul>');
    for (const label of ["Tín chỉ tích lũy tối thiểu", "Tín chỉ bắt buộc", "Tín chỉ nhóm tự chọn", "Tín chỉ tự chọn tự do", "Điểm TB tích lũy tối thiểu"]) expect(html).toContain(label);
    expect(html).toContain("2,00 / 4");
    expect(html).toContain("Sinh viên cần hoàn thành chứng chỉ ngoại ngữ theo quy định.");
    expect(html).toContain("Tiêu chuẩn được chọn tự động theo khóa trong tài khoản và chuyên ngành trong hồ sơ của bạn.");
    expect(html).toContain('<a class="sg-link" href="#profile">Cập nhật chuyên ngành</a>');
    expect(html).not.toContain("<select value");
    expect(html).not.toContain("Tiêu chuẩn đang áp dụng");
  });
  it("explains each unresolved standard and links to the profile where it helps", () => {
    const unresolved = (overrides: Partial<StudentGraduationResponse>) =>
      render(ready(graduation({ standard: null, evaluation: null, ...overrides })), ready(adviceResponse({ fingerprint: null })));
    const noCohort = unresolved({ resolution: "cohort_unknown", profile: { cohortCode: null, specialty: null } });
    expect(noCohort).toContain("Hồ sơ chưa có khóa học");
    expect(noCohort).toContain("<li><span>Khóa trong tài khoản:</span> <strong>chưa có</strong></li><li><span>Chuyên ngành trong hồ sơ:</span> <strong>Chưa xác định</strong></li>");
    expect(noCohort).toContain('href="#profile"');
    const unset = unresolved({ resolution: "specialty_unset", profile: { cohortCode: "K29", specialty: null }, specialtySuggestion: { code: "CNPM", label: "Công nghệ phần mềm", count: 4 } });
    expect(unset).toContain("Hãy chọn chuyên ngành trong hồ sơ");
    expect(unset).toContain("Gợi ý: Công nghệ phần mềm — bạn đã đạt 4 học phần bắt buộc của chuyên ngành này.");
    expect(unset).toContain('<a class="sw-outline" href="#profile">Cập nhật chuyên ngành</a>');
    const notFound = unresolved({ resolution: "not_found", profile: { cohortCode: "K30", specialty: null } });
    expect(notFound).toContain("Chưa có tiêu chuẩn xét tốt nghiệp cho khóa K30");
    expect(notFound).not.toContain('href="#profile"');
    const ambiguous = unresolved({ resolution: "ambiguous" });
    expect(ambiguous).toContain("Có nhiều tiêu chuẩn cùng phù hợp với bạn");
    for (const html of [noCohort, unset, notFound, ambiguous]) {
      expect(html).toContain("Kết quả xét tốt nghiệp chính thức do nhà trường công bố.");
      expect(html).not.toContain("Kết quả xét tốt nghiệp tính đến thời điểm hiện tại");
      expect(html).not.toContain("<table");
      expect(html).not.toContain("sg-stats");
    }
  });
});

describe("StudentGraduation result", () => {
  it("asks for a transcript and still lists the standard's groups and courses", () => {
    const html = render(ready(graduation({ transcript: null, evaluation: null })), ready(adviceResponse({ fingerprint: null })));
    expect(html).toContain("Chưa có bảng điểm để đối chiếu");
    expect(html).toContain('<a class="sw-outline" href="#profile">Import bảng điểm</a>');
    expect(html).toContain("Chưa có bảng điểm</span>");
    expect(html).toContain("Bắt buộc · Yêu cầu: 4 môn — phải đạt tất cả học phần");
    expect(html).toContain("Kiến trúc phần mềm");
    expect(html).toContain('<th scope="col" class="sg-col-credits sg-num">TC</th></tr></thead>');
    expect(html).not.toContain("sg-col-state");
    expect(html).toContain('<select disabled="">');
    expect(html).not.toContain("Lời khuyên từ EduPath AI");
    expect(html).not.toContain("sg-banner");
  });
  it("names every failing part with its shortfall and lists what to do", () => {
    const html = render(ready(graduation()));
    expect(html).toContain("Kết quả xét tốt nghiệp tính đến thời điểm hiện tại");
    expect(html).toContain("Bảng điểm cập nhật ngày 01/10/2026 · học kỳ có kết quả gần nhất: học kỳ 3 năm học 2025–2026");
    expect(html).toMatch(/class="sg-banner sg-banner-fail" role="status"><span class="sg-glyph" aria-hidden="true">✗<\/span>/);
    // The same sentence as the competency page; the failing groups already cover the 12 missing credits.
    expect(html).toContain("Hiện tại bạn chưa đủ điều kiện xét tốt nghiệp vì còn thiếu 2 môn thuộc nhóm bắt buộc, 3 tín chỉ thuộc nhóm tự chọn TC306 (CTĐT: TC406) và 0,13 điểm trung bình tích lũy. Tổng số tín chỉ tích lũy (126/138) cũng sẽ đủ khi bạn hoàn thành các nhóm trên.");
    const visible = text(html);
    expect(visible).toContain("✓ Đã đạt1Nhóm tự chọn TC102: đã đạt 6/6 TC");
    expect(visible).toContain("Nhóm bắt buộc: đã đạt 2/4 môn — còn thiếu 2 môn");
    expect(visible).toContain("Điểm trung bình tích lũy (hệ 4): hiện 1,87, yêu cầu tối thiểu 2,00 — còn thiếu 0,13 điểm");
    expect(html).not.toContain("Chưa xác định</h3>");
    // Blue suggestions: missing mandatory courses, and the elective group's not-passed courses with their state.
    expect(html).toContain("→</span> Đề xuất điều cần làm");
    expect(html).toContain("Hoàn thành 2 môn còn thiếu trong nhóm bắt buộc:");
    expect(visible).toContain("71ITSE30103Kiểm thử phần mềm3 TC✗ Chưa đạt (đã học 2 lần)");
    expect(html).toContain("Chọn học thêm ít nhất 3 tín chỉ trong nhóm tự chọn TC306 (CTĐT: TC406).");
    expect(visible).toContain("Các học phần bạn chưa đạt trong nhóm:71ITSE40203Kiến trúc phần mềm3 TC○ Chưa học71ITSE40303Điện toán đám mây3 TC◐ Đang học");
    expect(html).toContain("Tổng số tín chỉ tích lũy (hiện 126/138) sẽ đủ khi bạn hoàn thành các việc ở trên; không cần học thêm học phần khác.");
    expect(html).toContain("Nâng điểm trung bình tích lũy (hệ 4) thêm ít nhất 0,13 điểm để đạt 2,00.");
    expect(visible).toContain("Kiểm thử phần mềm3 TC · điểm 0/4 (F)↻ Học lại");
    expect(visible).toContain("Lập trình3 TC · điểm 1,5/4 (D+)↑ Học cải thiện");
    expect(html).toContain("Hoàn thành 1 học phần đang học:");
    expect(html).toContain("Kết quả xét tốt nghiệp chính thức do nhà trường công bố.");
  });
  it("recommends the graduation thesis first and lists the replacement courses as a fallback", () => {
    const thesisCourses = [
      row("71ITGR40203", "Chuyên đề Tốt nghiệp 1", "TC306", "not_taken"),
      row("71ITGR40206", "Đồ án Tốt nghiệp", "TC306", "not_taken", { credits: 6 }),
      row("71ITGR40303", "Chuyên đề Tốt nghiệp 2", "TC306", "not_taken"),
    ];
    const base = evaluation("pass");
    const thesisGroup: GraduationGroupEvaluation = { ...base.groups[1]!, required: 6, lower: 0, upper: 0, remaining: 6, status: "fail", passedCount: 0, courses: thesisCourses };
    const html = render(ready(graduation({ evaluation: { ...base, status: "fail", groupStatus: "fail", groups: [base.groups[0]!, thesisGroup, base.groups[2]!] } })));
    const visible = text(html);
    expect(html).toContain("Đăng ký Đồ án Tốt nghiệp (6 TC) để hoàn thành nhóm tự chọn TC306 (CTĐT: TC406). Đây là phương án chính của chương trình: một học phần đủ 6 tín chỉ của nhóm.");
    expect(html).toContain("Chỉ chọn học phần thay thế khi bạn không làm đồ án tốt nghiệp theo quy định của Khoa");
    expect(visible).toContain("Phương án thay thế: chọn đủ 6 tín chỉ trong các học phần sau:71ITGR40203Chuyên đề Tốt nghiệp 13 TC○ Chưa học71ITGR40303Chuyên đề Tốt nghiệp 23 TC○ Chưa học");
    expect(html).not.toContain("Chọn học thêm ít nhất 6 tín chỉ trong nhóm tự chọn TC306");
  });
  it("shows a green verdict when every condition passes", () => {
    const html = render(ready(graduation({ evaluation: evaluation("pass") })));
    expect(html).toContain("sg-banner sg-banner-pass");
    expect(html).toContain("Bạn đã đủ các điều kiện xét tốt nghiệp theo tiêu chuẩn của khóa (tham khảo).");
    // An empty "Chưa đạt" list stays neutral: no red box on a passing page.
    expect(html).toContain('<div class="sg-box sg-box-none"><h3><span aria-hidden="true">✗</span> Chưa đạt</h3><p class="sg-box-empty">Không có điều kiện nào chưa đạt.</p></div>');
    expect(html).not.toContain("sg-box-fail");
    expect(html).toContain("Theo dõi thông báo xét tốt nghiệp chính thức của nhà trường.");
  });
  it("shows an amber verdict and the undecided conditions", () => {
    const html = render(ready(graduation({ evaluation: evaluation("unknown") })));
    expect(html).toContain("sg-banner sg-banner-unknown");
    expect(html).toContain("Chưa đủ dữ liệu để kết luận vì chưa xác định được kết quả nhóm bắt buộc.");
    expect(text(html)).toContain("? Chưa xác định1Nhóm bắt buộc: đã đạt 2/4 môn — 2 môn có điểm nhưng chưa rõ kết quả");
    expect(html).toContain("Kiểm tra kết quả 1 học phần có điểm nhưng chưa rõ Đạt/Chưa đạt:");
    expect(html).toContain("tối đa 2 môn");
  });
  it("shows data warnings as notes", () => {
    const html = render(ready(graduation({ evaluation: evaluation("fail", { warnings: [
      { code: "results_inferred", count: 1 }, { code: "credits_mismatch", printed: 126, computedLower: 120, computedUpper: 123 }, { code: "ocr_needs_review" },
    ] }) })));
    expect(html).toContain('aria-label="Lưu ý về dữ liệu"');
    expect(html).toContain("1 học phần trong tiêu chuẩn có ô Kết quả trống trong PDF");
    expect(html).toContain("Tổng số tín chỉ tích lũy in trên bảng điểm là 126 TC, nhưng các học phần Đạt trong chương trình cộng lại được 120–123 TC.");
    expect(html).toContain("Bảng điểm được đọc bằng nhận dạng ảnh (OCR)");
  });
});

describe("StudentGraduation AI advice", () => {
  it("shows one muted line when AI is switched off and never asks for consent", () => {
    const html = withAdvice(adviceResponse({ aiEnabled: false }));
    expect(html).toContain("Lời khuyên từ EduPath AI hiện chưa được bật.");
    expect(html).not.toContain("sg-ai-heading");
    expect(html).not.toContain("<dialog");
  });
  it("shows the completed advice with its condition labels, next steps and the local model footer", () => {
    const html = withAdvice(adviceResponse({ advice: stored("completed") }));
    expect(html).toContain('<h3 id="sg-ai-title">Lời khuyên từ EduPath AI</h3><span class="sg-ai-tag">AI</span>');
    expect(html).toContain("Bạn còn thiếu 3 tín chỉ ở nhóm tự chọn TC306 và 2 môn bắt buộc.");
    expect(html).toContain('<span class="sg-ai-focus">Nhóm tự chọn TC306</span><p>Hãy chọn thêm Kiến trúc phần mềm để đủ 6 tín chỉ.</p>');
    expect(html).toContain('<span class="sg-ai-focus">Điểm trung bình tích lũy</span>');
    expect(html).toContain('<span class="sg-ai-focus">Tổng số tín chỉ tích lũy</span>');
    expect(html).toContain('<span class="sg-ai-focus">Lời khuyên chung</span>');
    expect(html).not.toMatch(/sg-ai-focus">(G\d|GENERAL|CREDITS|GPA)</);
    expect(html).toContain("<li>Kiểm tra lịch mở lớp học kỳ tới.</li>");
    expect(html).toContain("Gemma 4 E4B, chạy cục bộ · tạo lúc 10:05 13/10/2026. Lời khuyên do AI viết dựa trên kết quả đã tính, có thể chưa chính xác — hãy đối chiếu số liệu và trao đổi với cố vấn học tập.");
    expect(html).not.toContain("Tạo lời khuyên");
    expect(html).not.toContain("Hủy");
    expect(html).not.toContain("<dialog");
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
  });
  it("tells whether the queued advice waits for a free, an outdated or an offline AI machine", () => {
    const waiting = withAdvice(adviceResponse({ advice: stored("queued") }));
    expect(waiting).toContain("Đang chuẩn bị lời khuyên…");
    expect(waiting).toContain("sg-ai-spinner");
    const outdated = withAdvice(adviceResponse({ advice: stored("queued"), worker: { online: true, supportsAdvice: false } }));
    expect(outdated).toContain("Máy AI đang chạy phiên bản cũ…");
    expect(outdated).not.toContain("sg-ai-spinner");
    const offline = withAdvice(adviceResponse({ advice: stored("queued"), worker: { online: false, supportsAdvice: false } }));
    expect(offline).toContain("Lời khuyên sẽ có khi máy AI hoạt động trở lại");
    expect(offline).not.toContain("sg-ai-spinner");
  });
  it("says the queue is full for a deferred advice, without a spinner or a retry button", () => {
    const html = withAdvice(adviceResponse({ advice: stored("deferred", { id: null, createdAt: null }), needsAdvice: true }));
    expect(html).toContain("Hàng đợi AI đang đầy");
    expect(html).toContain("Lời khuyên sẽ được tạo tự động khi bạn mở lại trang này sau ít phút.");
    expect(html).not.toContain("sg-ai-spinner");
    expect(html).not.toContain("Thử lại");
  });
  it("shows the elapsed time while the advice is being written", () => {
    const html = withAdvice(adviceResponse({ advice: stored("processing") }));
    expect(html).toContain("EduPath AI đang viết lời khuyên…");
    expect(html).toMatch(/<span class="sg-ai-elapsed"><span class="sr-only">Đã chạy <\/span>\d{2}:\d{2}<\/span> · Thường mất khoảng 20–60 giây\./);
    expect(html).toContain("sg-ai-spinner");
    expect(html).not.toMatch(/sg-ai[^"]*"[^>]*aria-busy/);
  });
  it("keeps the old advice visible, dimmed, while advice for the new data is prepared", () => {
    const html = withAdvice(adviceResponse({ advice: stored("completed"), stale: true, needsAdvice: true }));
    expect(html).toContain("Đang chuẩn bị lời khuyên…");
    expect(html).toContain("sg-ai-body sg-ai-dimmed");
    expect(html).toContain("Lời khuyên trước, viết cho dữ liệu cũ — có thể không còn đúng.");
    expect(html).toContain("Hãy chọn thêm Kiến trúc phần mềm để đủ 6 tín chỉ.");
  });
  it("explains a failure and offers Thử lại", () => {
    const html = withAdvice(adviceResponse({ advice: stored("failed", { errorCode: "ai_timeout" }) }));
    expect(html).toContain("Chưa tạo được lời khuyên");
    expect(html).toContain("Máy AI xử lý quá thời gian cho phép. Các đề xuất ở trên không bị ảnh hưởng.");
    expect(html).toMatch(/<button type="button" class="sw-outline">.*Thử lại<\/button>/);
    expect(withAdvice(adviceResponse({ advice: stored("queued") }))).not.toContain("Thử lại");
  });
  it("keeps the deterministic suggestions while the advice loads or cannot be read", () => {
    const loading = render(ready(graduation()), { data: null, error: null, loading: true });
    expect(loading).toContain("Đề xuất điều cần làm");
    expect(loading).toContain("Đang tải lời khuyên…");
    const failed = render(ready(graduation()), { data: null, error: "Không tải được", loading: false });
    expect(failed).toContain("Chưa tải được lời khuyên từ EduPath AI");
    expect(failed).toContain("Đề xuất điều cần làm");
  });
});

describe("StudentGraduation comparison", () => {
  it("opens on the group view and renders both tables", () => {
    const html = render(ready(graduation()));
    expect(html).toContain('<button type="button" class="sg-tab" aria-pressed="true" aria-controls="sg-view-groups">Đối chiếu theo nhóm kiến thức</button>');
    expect(html).toContain('<button type="button" class="sg-tab" aria-pressed="false" aria-controls="sg-view-courses">Đối chiếu theo danh sách học phần</button>');
    expect(html).toContain('<div id="sg-view-groups" class="sg-view">');
    expect(html).toContain('<div id="sg-view-courses" class="sg-view" hidden="">');
    expect(html).toContain('<table class="sg-table sg-group-table">');
    expect(html).toContain('<table class="sg-table sg-course-table sg-course-table-wide">');
    expect(html).toContain('<thead><tr><th scope="col">Nhóm</th><th scope="col">Đã có</th><th scope="col">Yêu cầu</th><th scope="col">Còn thiếu</th><th scope="col">Kết quả</th></tr></thead>');
    expect(html).toContain('<thead><tr><th scope="col" class="sg-col-code">Mã</th><th scope="col">Tên học phần</th><th scope="col" class="sg-col-group">Nhóm</th><th scope="col" class="sg-col-credits sg-num">TC</th><th scope="col" class="sg-col-score">Điểm</th><th scope="col" class="sg-col-state">Trạng thái</th></tr></thead>');
    expect(html).toContain('<input type="search" placeholder="Mã hoặc tên học phần…" value=""/>');
    expect(html).toContain("<option value=\"open\">Chưa hoàn thành</option>");
    expect(html).toContain("9 học phần");
  });
  it("shows every group with its CTĐT code, what is achieved, required and missing, and an expandable course list", () => {
    const html = render(ready(graduation()));
    expect(html).toContain('aria-expanded="false" aria-controls="sg-group-1"><span class="sg-chevron" aria-hidden="true"></span><span>Nhóm tự chọn TC306 (CTĐT: TC406)</span>');
    expect(html).toContain('<tr id="sg-group-1" class="sg-group-detail" hidden="">');
    expect(html).toContain("Tự chọn · Đã đạt: 3 TC · Yêu cầu: 6 TC — chỉ cần đủ số tín chỉ, không phải học hết các học phần.");
    expect(html).toContain("Bắt buộc · Đã đạt: 2 môn · Yêu cầu: 4 môn — phải đạt tất cả học phần, kể cả môn điều kiện (*).");
    expect(html).toContain('<td data-label="Còn thiếu">3 TC</td>');
    expect(html).toContain('<span class="sg-state sg-status-fail"><span aria-hidden="true">✗</span> Chưa đạt</span>');
    expect(html).toContain('<span class="sg-state sg-status-pass"><span aria-hidden="true">✓</span> Đạt</span>');
    expect(html).toContain("Mở rộng tất cả");
  });
  it("labels every course state with a glyph and marks letter-grade inferences", () => {
    const html = render(ready(graduation({ evaluation: evaluation("fail", {
      groups: [{ ...groups("fail")[0]!, courses: [...mandatoryCourses, row("71ITBS20103", "Toán rời rạc", "BB", "exempt", { letter: "MT", score10: null, score4: null }), row("71ITBS20203", "Xác suất", "BB", "graded_unknown", { score10: 6, score4: 2 })] }, ...groups("fail").slice(1)],
    }) })));
    for (const label of ["✓</span> Đã đạt", "✓</span> Miễn thi (MT)", "✗</span> Chưa đạt (đã học 2 lần)", "◐</span> Đang học", "?</span> Chưa rõ kết quả", "○</span> Chưa học"]) expect(html).toContain(label);
    expect(html).toContain("<small>suy ra từ điểm chữ</small>");
    expect(html).toContain("<strong>3,5 / 4</strong><small>8,2 / 10 · B+</small>");
    expect(html).toContain("<strong>MT</strong><small>Miễn thi</small>");
    expect(html).toContain("Môn điều kiện (*): cần đạt nhưng không tính tín chỉ tích lũy, điểm trung bình");
    expect(html).toContain("Nên học lại để nâng điểm trung bình");
    expect(html).toContain("Có thể học cải thiện để nâng điểm trung bình");
  });
});
