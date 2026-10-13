import { describe, expect, it } from "vitest";
import {
  COURSE_FILTERS, adviceAnnouncement, adviceErrorMessage, adviceFocusLabel, adviceStateCopy, adviceView, asOfLine, conditionItems,
  courseStateText, filterCourses, formatDate, formatElapsed, formatGpa, formatGpaShortfall, formatNumber, groupFacts, groupInSentence,
  groupShortfall, groupTitle, groupViews, joinVi, loadErrorMessage, lowerFirst, methodNotes, modelLabel, normalizeAdviceOutput,
  normalizeAdviceResponse, normalizeAdviceStatus, normalizeAdviceWrite, normalizeStoredAdvice, profileLine, requestErrorMessage, scoreParts,
  shouldPollAdvice, shownGpa, standardGroupLabels, standardMeta, standardThresholds, suggestionItems, termText, toneClass, unresolvedCopy,
  verdictHeadline, warningNotes,
} from "./student-graduation-data";
import type {
  GraduationAdviceResponse, GraduationCourseRow, GraduationEvaluation, GraduationGroupEvaluation, StoredAdvice,
  StudentGraduationResponse, StudentGraduationStandard,
} from "./student-graduation-types";

// Synthetic data only.
const course = (code: string, state: GraduationCourseRow["state"], extra: Partial<GraduationCourseRow> = {}): GraduationCourseRow => ({
  code, name: `Học phần ${code}`, credits: 3, conditionOnly: false, groupId: "BB", state, inferred: false,
  attempts: state === "not_taken" ? 0 : 1, score10: state === "passed" ? 7.5 : state === "failed" ? 3 : null,
  score4: state === "passed" ? 3 : state === "failed" ? 0 : null, letter: state === "passed" ? "B" : state === "failed" ? "F" : null,
  term: state === "not_taken" ? null : "HK243", ...extra,
});
const group = (overrides: Partial<GraduationGroupEvaluation> & Pick<GraduationGroupEvaluation, "id" | "kind">): GraduationGroupEvaluation => ({
  name: overrides.kind === "mandatory" ? "Nhóm bắt buộc" : "Nhóm tự chọn TC306", label: overrides.kind === "mandatory" ? "Nhóm bắt buộc" : "Nhóm tự chọn TC306",
  code: overrides.kind === "mandatory" ? null : "TC306", curriculumElectiveCode: null, unit: overrides.kind === "mandatory" ? "môn" : "TC",
  required: 4, lower: 4, upper: 4, remaining: null, status: "pass", minimumCredits: 12, accumulatedCredits: 12,
  courseCount: 4, passedCount: 4, courses: [], ...overrides,
});
const evaluation = (overrides: Partial<GraduationEvaluation> = {}): GraduationEvaluation => ({
  calcVersion: "comp-calc-v5", status: "pass", groupStatus: "pass", needsImprovement: false,
  asOf: { transcriptVersion: "00000000-0000-4000-8000-0000000000f1", transcriptUpdatedAt: "2026-10-01T08:00:00Z", latestTerm: "HK253" },
  groups: [group({ id: "BB", kind: "mandatory" })],
  credits: { lower: 140, upper: 140, required: 138, status: "pass", source: "printed", remaining: null },
  gpa: { actual: 3.1, required: 2, scale: 4, status: "pass", source: "printed", reason: "", remaining: null },
  creditCheck: { status: "match", printed: 140, computedLower: 140, computedUpper: 140 },
  improvementCandidates: [], inProgress: [], unknownResults: [], warnings: [], ...overrides,
});

/** A failing evaluation: 2 mandatory courses missing, 4 elective credits, 12 credits and 0,1251 GPA points short. */
const failing = () => {
  const mandatory = [course("71ITBS10103", "passed"), course("71ITBS10203", "passed"), course("71ITSE30103", "failed", { attempts: 2 }), course("71ITSE41010", "not_taken", { credits: 10 })];
  const elective = [
    course("71ITSE40103", "passed", { groupId: "TC306" }), course("71ITSE40203", "not_taken", { groupId: "TC306" }),
    course("71ITSE40303", "in_progress", { groupId: "TC306", attempts: 1 }), course("71ITSE40403", "failed", { groupId: "TC306" }),
  ];
  return evaluation({
    status: "fail", groupStatus: "fail",
    groups: [
      group({ id: "BB", kind: "mandatory", lower: 2, upper: 2, remaining: 2, status: "fail", passedCount: 2, courses: mandatory }),
      group({ id: "TC306", kind: "elective", curriculumElectiveCode: "TC406", required: 6, lower: 2, upper: 2, remaining: 4, status: "fail", minimumCredits: 6, passedCount: 1, courses: elective }),
    ],
    credits: { lower: 126, upper: 126, required: 138, status: "fail", source: "calculated", remaining: 12 },
    gpa: { actual: 1.8749, required: 2, scale: 4, status: "fail", source: "printed", reason: "", remaining: 0.1251 },
    improvementCandidates: [
      { code: "71ITSE40403", name: "Học phần 71ITSE40403", credits: 3, score: 0, scale: 4, letter: "F", state: "failed" },
      { code: "71ITBS10103", name: "Học phần 71ITBS10103", credits: 3, score: 1.5, scale: 4, letter: "D+", state: "passed" },
    ],
    inProgress: [course("71ITSE40303", "in_progress", { groupId: "TC306" })],
    unknownResults: [course("71ITSE20103", "graded_unknown", { score10: 6.5, score4: 2.5 })],
  });
};

const standard = (overrides: Partial<StudentGraduationStandard> = {}): StudentGraduationStandard => ({
  id: "std-1", revisionId: "rev-1", version: 3, name: "Tiêu chuẩn xét tốt nghiệp K29 CNPM", cohortCode: "K29", classBlock: "71K29CNTT",
  major: "Công nghệ thông tin", specialty: "7480201-03", educationSystem: "Đại học chính quy", faculty: "Công nghệ thông tin",
  minimumCredits: 138, mandatoryCredits: 120, electiveCredits: 12, freeElectiveCredits: 6, minimumGpa: 2, gpaScale: 4, notes: "",
  groups: [
    { id: "BB", name: "Nhóm bắt buộc", kind: "mandatory", minimumCredits: 120 },
    { id: "A", name: "Nhóm tự chọn TC102", kind: "elective", minimumCredits: 3 },
    { id: "B", name: "Nhóm tự chọn TC102", kind: "elective", minimumCredits: 6 },
  ],
  courses: [
    { id: "c1", groupId: "BB", code: "71itbs10103", name: "Lập trình", credits: 3, conditionOnly: false },
    { id: "c2", groupId: "BB", code: "71PE10101", name: "Giáo dục thể chất (*)", credits: 1, conditionOnly: true },
    { id: "c3", groupId: "A", code: "71ITAI40103", name: "Học máy", credits: 3, conditionOnly: false },
    { id: "c4", groupId: "B", code: "71ITDS40103", name: "Dữ liệu lớn", credits: 3, conditionOnly: false },
    { id: "c5", groupId: "B", code: "71ITDS40203", name: "Kho dữ liệu", credits: 3, conditionOnly: false },
  ],
  ...overrides,
});
const response = (overrides: Partial<StudentGraduationResponse> = {}): StudentGraduationResponse => ({
  profile: { cohortCode: "K29", specialty: "CNPM" }, resolution: "specialty", standard: standard(),
  transcript: { version: "v1", updatedAt: "2026-10-01T08:00:00Z" }, evaluation: evaluation(), specialtySuggestion: null, ...overrides,
});

describe("formatting", () => {
  it("formats numbers the Vietnamese way with whole numbers kept whole", () => {
    expect(formatNumber(4)).toBe("4");
    expect(formatNumber(4.5)).toBe("4,5");
    expect(formatNumber(1234)).toBe("1.234");
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(Number.NaN)).toBe("—");
  });
  it("rounds a GPA like the AI prompt and its shortfall up to 2 decimals", () => {
    expect(formatGpa(2.856)).toBe("2,86");
    expect(formatGpa(2)).toBe("2,00");
    expect(formatGpa(2.29)).toBe("2,29");
    // A failing GPA is never shown as reaching its requirement.
    expect(shownGpa(1.996, 2, "fail")).toBe(1.99);
    expect(shownGpa(1.996, 2, "unknown")).toBe(2);
    expect(shownGpa(2.856, 2, "pass")).toBe(2.86);
    expect(shownGpa(1.8749, 2, "fail")).toBe(1.87);
    // Same rule as the advice prompt: Math.ceil(value * 100 - 1e-9) / 100.
    expect(formatGpaShortfall(0.13)).toBe("0,13");
    expect(formatGpaShortfall(0.1251)).toBe("0,13");
    expect(formatGpaShortfall(2 - 1.88)).toBe("0,12");
    expect(formatGpaShortfall(0.004)).toBe("0,01");
    expect(formatGpaShortfall(0.1)).toBe("0,10");
  });
  it("formats dates, terms, elapsed time, model names and lists", () => {
    expect(formatDate("2026-10-01T08:00:00Z")).toBe("01/10/2026");
    expect(formatDate("not a date")).toBe("—");
    expect(termText("HK253")).toBe("học kỳ 3 năm học 2025–2026");
    expect(termText("Điểm bảo lưu")).toBe("Điểm bảo lưu");
    expect(termText(null)).toBeNull();
    const now = Date.parse("2026-10-13T10:01:15Z");
    expect(formatElapsed("2026-10-13T10:00:00Z", now)).toBe("01:15");
    expect(formatElapsed("2026-10-13T10:05:00Z", now)).toBe("00:00");
    expect(formatElapsed("", now)).toBe("00:00");
    expect(modelLabel("gemma4:e4b")).toBe("Gemma 4 E4B");
    expect(modelLabel(null)).toBe("Gemma 4 E4B");
    expect(joinVi([])).toBe("");
    expect(joinVi(["A"])).toBe("A");
    expect(joinVi(["A", "B"])).toBe("A và B");
    expect(joinVi(["A", "B", "C"])).toBe("A, B và C");
  });
  it("says how fresh the data is", () => {
    expect(asOfLine(evaluation())).toBe("Bảng điểm cập nhật ngày 01/10/2026 · học kỳ có kết quả gần nhất: học kỳ 3 năm học 2025–2026");
    expect(asOfLine(evaluation({ asOf: { transcriptVersion: "v", transcriptUpdatedAt: "2026-10-01T08:00:00Z", latestTerm: null } })))
      .toBe("Bảng điểm cập nhật ngày 01/10/2026 · chưa có học kỳ nào có kết quả");
  });
});

describe("labels", () => {
  it("adds the CTĐT elective code to a group name only when it is a different code", () => {
    expect(groupTitle({ label: "Nhóm tự chọn TC306", code: "TC306", curriculumElectiveCode: "TC406" })).toBe("Nhóm tự chọn TC306 (CTĐT: TC406)");
    expect(groupTitle({ label: "Nhóm tự chọn TC306", code: "TC306", curriculumElectiveCode: "tc306" })).toBe("Nhóm tự chọn TC306");
    expect(groupTitle({ label: "Nhóm bắt buộc", code: null, curriculumElectiveCode: null })).toBe("Nhóm bắt buộc");
    expect(groupInSentence("Nhóm tự chọn TC306 (CTĐT: TC406)")).toBe("nhóm tự chọn TC306 (CTĐT: TC406)");
    expect(groupInSentence("Học phần bắt buộc")).toBe("nhóm học phần bắt buộc");
    expect(lowerFirst("Điểm trung bình chưa rõ. Hãy kiểm tra PDF gốc.")).toBe("điểm trung bình chưa rõ. Hãy kiểm tra PDF gốc.");
    expect(lowerFirst("PDF chưa đọc được")).toBe("PDF chưa đọc được");
    expect(groupInSentence("Tự chọn tự do")).toBe("nhóm tự chọn tự do");
    expect(groupInSentence("TC306 chuyên ngành")).toBe("nhóm TC306 chuyên ngành");
  });
  it("labels course states, repeated failures and tones", () => {
    expect(courseStateText(course("A", "failed", { attempts: 2 }))).toBe("Chưa đạt (đã học 2 lần)");
    expect(courseStateText(course("A", "failed"))).toBe("Chưa đạt");
    expect(courseStateText(course("A", "exempt"))).toBe("Miễn thi (MT)");
    expect(courseStateText(course("A", "graded_unknown"))).toBe("Chưa rõ kết quả");
    expect(courseStateText(course("A", "not_taken"))).toBe("Chưa học");
    expect(courseStateText(course("A", "in_progress"))).toBe("Đang học");
    expect(toneClass("pass")).toBe("sg-status-pass");
    expect(toneClass("info")).toBe("sg-tone-info");
    expect(COURSE_FILTERS.map((option) => option.label)).toEqual(["Tất cả trạng thái", "Chưa hoàn thành", "Đã đạt", "Miễn thi (MT)", "Chưa đạt", "Đang học", "Chưa rõ kết quả", "Chưa học"]);
  });
  it("labels repeated group names of a standard like the server does", () => {
    const labels = standardGroupLabels(standard());
    expect(labels.get("BB")).toBe("Nhóm bắt buộc");
    expect(labels.get("A")).toBe("Nhóm tự chọn TC102 · 1 học phần, gồm 71ITAI40103");
    expect(labels.get("B")).toBe("Nhóm tự chọn TC102 · 2 học phần, gồm 71ITDS40103");
  });
});

describe("standard", () => {
  it("lists the five thresholds and the identity line", () => {
    const items = standardThresholds(standard({ freeElectiveCredits: null }));
    expect(items.map((item) => `${item.label}: ${item.value}`)).toEqual([
      "Tín chỉ tích lũy tối thiểu: 138", "Tín chỉ bắt buộc: 120", "Tín chỉ nhóm tự chọn: 12", "Tín chỉ tự chọn tự do: Chưa xác định",
      "Điểm TB tích lũy tối thiểu: 2,00 / 4",
    ]);
    expect(items[3]!.known).toBe(false);
    expect(standardMeta(response())).toBe("Khóa K29 · Chuyên ngành Công nghệ phần mềm · Phiên bản 3");
    expect(standardMeta(response({ resolution: "general", profile: { cohortCode: "K27", specialty: null } }))).toBe("Khóa K27 · Tiêu chuẩn chung của khóa · Phiên bản 3");
    expect(profileLine({ cohortCode: null, specialty: null })).toBe("Khóa trong tài khoản: chưa có · Chuyên ngành trong hồ sơ: Chưa xác định");
  });
  it("explains every unresolved standard without naming another cohort", () => {
    const base = { profile: { cohortCode: "K29", specialty: null }, specialtySuggestion: null } as const;
    expect(unresolvedCopy({ ...base, profile: { cohortCode: null, specialty: null }, resolution: "cohort_unknown" }))
      .toMatchObject({ title: "Hồ sơ chưa có khóa học", action: { href: "#profile" } });
    const unset = unresolvedCopy({ ...base, resolution: "specialty_unset", specialtySuggestion: { code: "CNDL", label: "Công nghệ dữ liệu", count: 5 } });
    expect(unset.title).toBe("Hãy chọn chuyên ngành trong hồ sơ");
    expect(unset.text).toContain("Khóa K29 có tiêu chuẩn xét tốt nghiệp riêng cho từng chuyên ngành");
    expect(unset.suggestion).toBe("Gợi ý: Công nghệ dữ liệu — bạn đã đạt 5 học phần bắt buộc của chuyên ngành này.");
    expect(unset.action).toEqual({ label: "Cập nhật chuyên ngành", href: "#profile" });
    expect(unresolvedCopy({ ...base, resolution: "specialty_unset" }).suggestion).toBeNull();
    const missing = unresolvedCopy({ ...base, resolution: "not_found" });
    expect(missing.title).toBe("Chưa có tiêu chuẩn xét tốt nghiệp cho khóa K29");
    expect(missing.action).toBeNull();
    const missingSpecialty = unresolvedCopy({ ...base, profile: { cohortCode: "K29", specialty: "TTNT" }, resolution: "not_found" });
    expect(missingSpecialty.text).toContain("chuyên ngành Trí tuệ nhân tạo");
    expect(missingSpecialty.action?.href).toBe("#profile");
    const ambiguous = unresolvedCopy({ ...base, profile: { cohortCode: "K29", specialty: "CNPM" }, resolution: "ambiguous" });
    expect(ambiguous.title).toBe("Có nhiều tiêu chuẩn cùng phù hợp với bạn");
    expect(ambiguous.text).toContain("Khóa K29, chuyên ngành Công nghệ phần mềm, đang có hơn một tiêu chuẩn");
  });
});

describe("verdict and conditions", () => {
  it("names every failing part with its shortfall in the headline", () => {
    expect(verdictHeadline(failing())).toEqual({
      tone: "fail", glyph: "✗",
      text: "Chưa đủ điều kiện xét tốt nghiệp vì thiếu 2 môn thuộc nhóm bắt buộc, 4 tín chỉ thuộc nhóm tự chọn TC306 (CTĐT: TC406), 12 tín chỉ tích lũy và 0,13 điểm trung bình tích lũy.",
    });
  });
  it("passes and says what is undecided", () => {
    expect(verdictHeadline(evaluation())).toEqual({ tone: "pass", glyph: "✓", text: "Đủ các điều kiện xét tốt nghiệp theo tiêu chuẩn của khóa (tham khảo)." });
    const unknown = evaluation({
      status: "unknown", groupStatus: "unknown",
      groups: [group({ id: "BB", kind: "mandatory", lower: 3, upper: 4, remaining: 1, status: "unknown" })],
      gpa: { actual: null, required: 2, scale: 4, status: "unknown", source: null, reason: "Chưa có điểm các môn tính điểm trung bình hệ 4.", remaining: null },
    });
    expect(verdictHeadline(unknown).text).toBe("Chưa đủ dữ liệu để kết luận vì chưa xác định được kết quả nhóm bắt buộc và điểm trung bình tích lũy.");
    const items = conditionItems(unknown);
    expect(items[0]).toMatchObject({ status: "unknown", progress: "đã đạt 3/4 môn", note: "1 môn có điểm nhưng chưa rõ kết quả", shortfall: null });
    expect(items[2]).toMatchObject({ title: "Điểm trung bình tích lũy (hệ 4)", progress: "chưa có điểm các môn tính điểm trung bình hệ 4.", note: null });
    const noMinimum = conditionItems(evaluation({ gpa: { actual: 2.85, required: null, scale: 4, status: "unknown", source: "printed", reason: "Tiêu chuẩn chưa có điểm trung bình tối thiểu.", remaining: null } }));
    expect(noMinimum[2]).toMatchObject({ progress: "hiện 2,85", note: "tiêu chuẩn chưa có điểm trung bình tối thiểu." });
    expect(verdictHeadline(evaluation({ status: "fail", groups: [] })).text).toBe("Chưa đủ điều kiện xét tốt nghiệp theo bảng điểm hiện tại.");
  });
  it("describes each condition with its progress and shortfall", () => {
    const items = conditionItems(failing());
    expect(items.map((item) => [item.title, item.progress, item.shortfall])).toEqual([
      ["Nhóm bắt buộc", "đã đạt 2/4 môn", "còn thiếu 2 môn"],
      ["Nhóm tự chọn TC306 (CTĐT: TC406)", "đã đạt 2/6 TC", "còn thiếu 4 TC"],
      ["Tín chỉ tích lũy", "đã tích lũy 126/138 TC (ước tính)", "còn thiếu 12 TC"],
      ["Điểm trung bình tích lũy (hệ 4)", "hiện 1,87, yêu cầu tối thiểu 2,00", "còn thiếu 0,13 điểm"],
    ]);
    const passing = conditionItems(evaluation());
    expect(passing.map((item) => item.progress)).toEqual(["đã đạt 4/4 môn", "đã tích lũy 140/138 TC", "hiện 3,10, yêu cầu tối thiểu 2,00"]);
    const edge = conditionItems(evaluation({ status: "fail", gpa: { actual: 1.996, required: 2, scale: 4, status: "fail", source: "calculated", reason: "", remaining: 0.004 } }));
    expect(edge[2]).toMatchObject({ progress: "hiện 1,99, yêu cầu tối thiểu 2,00 (tính tham khảo)", shortfall: "còn thiếu 0,01 điểm" });
    expect(conditionItems(evaluation({ credits: null }))).toHaveLength(2);
  });
});

describe("suggestions", () => {
  it("lists what to do for every failing part", () => {
    const items = suggestionItems(failing());
    expect(items.map((item) => item.key)).toEqual(["group:BB", "group:TC306", "credits", "gpa", "in-progress", "unknown-results"]);
    const [mandatory, elective, credits, gpa, inProgress, unknown] = items;
    expect(mandatory!.text).toBe("Hoàn thành 2 môn còn thiếu trong nhóm bắt buộc:");
    expect(mandatory!.courses.map((item) => `${item.code} ${item.state}`)).toEqual(["71ITSE30103 Chưa đạt (đã học 2 lần)", "71ITSE41010 Chưa học"]);
    expect(elective!.text).toBe("Chọn học thêm ít nhất 4 tín chỉ trong nhóm tự chọn TC306 (CTĐT: TC406).");
    expect(elective!.coursesLabel).toBe("Các học phần bạn chưa đạt trong nhóm:");
    expect(elective!.courses.map((item) => `${item.code} ${item.glyph} ${item.state}`)).toEqual([
      "71ITSE40203 ○ Chưa học", "71ITSE40303 ◐ Đang học", "71ITSE40403 ✗ Chưa đạt",
    ]);
    expect(credits!.text).toBe("Tích lũy thêm ít nhất 12 tín chỉ để đạt 138 tín chỉ tích lũy.");
    expect(gpa!.text).toBe("Nâng điểm trung bình tích lũy (hệ 4) thêm ít nhất 0,13 điểm để đạt 2,00.");
    expect(gpa!.courses.map((item) => `${item.code} ${item.state} ${item.detail}`)).toEqual([
      "71ITSE40403 Học lại điểm 0/4 (F)", "71ITBS10103 Học cải thiện điểm 1,5/4 (D+)",
    ]);
    expect(inProgress!.text).toBe("Hoàn thành 1 học phần đang học:");
    expect(unknown!.text).toBe("Kiểm tra kết quả 1 học phần có điểm nhưng chưa rõ Đạt/Chưa đạt:");
  });
  it("only reminds of the official notice when everything passes", () => {
    expect(suggestionItems(evaluation())).toEqual([{ key: "official", text: "Theo dõi thông báo xét tốt nghiệp chính thức của nhà trường.", coursesLabel: null, courses: [], note: null }]);
    const noCandidates = suggestionItems(evaluation({ status: "fail", gpa: { actual: 1.9, required: 2, scale: 4, status: "fail", source: "printed", reason: "", remaining: 0.1 } }));
    expect(noCandidates[0]).toMatchObject({ key: "gpa", coursesLabel: null, note: "Hãy trao đổi với cố vấn học tập để chọn học phần học cải thiện." });
  });
});

describe("notes", () => {
  it("turns every data warning into a sentence", () => {
    const notes = warningNotes(evaluation({ warnings: [
      { code: "results_inferred", count: 3 }, { code: "credits_mismatch", printed: 140, computedLower: 131, computedUpper: 134 },
      { code: "printed_credits_unreadable" }, { code: "ocr_needs_review" }, { code: "standard_ambiguous_codes" },
    ] }));
    expect(notes.map((note) => note.code)).toEqual(["results_inferred", "credits_mismatch", "printed_credits_unreadable", "ocr_needs_review", "standard_ambiguous_codes"]);
    expect(notes[0]!.text).toContain("3 học phần trong tiêu chuẩn có ô Kết quả trống");
    expect(notes[1]!.text).toContain("là 140 TC, nhưng các học phần Đạt trong chương trình cộng lại được 131–134 TC");
    expect(methodNotes(failing()).join(" ")).toContain("Số tín chỉ tích lũy là ước tính");
    expect(methodNotes(evaluation()).join(" ")).toContain("Điểm trung bình lấy từ dòng điểm trung bình tích lũy hệ 4");
  });
});

describe("course views", () => {
  it("builds groups from the evaluation, with retake marks", () => {
    const groups = groupViews(response({ evaluation: failing() }));
    expect(groups.map((item) => [item.title, item.achieved, item.required])).toEqual([
      ["Nhóm bắt buộc", "2 môn", "4 môn"], ["Nhóm tự chọn TC306 (CTĐT: TC406)", "2 TC", "6 TC"],
    ]);
    expect(groups[0]!.courses[0]).toMatchObject({ code: "71ITBS10103", improvement: "passed", groupTitle: "Nhóm bắt buộc" });
    expect(groups[1]!.courses[3]).toMatchObject({ code: "71ITSE40403", improvement: "failed" });
    expect(groupFacts(groups[1]!)).toBe("Tự chọn · Đã đạt: 2 TC · Yêu cầu: 6 TC — chỉ cần đủ số tín chỉ, không phải học hết các học phần.");
    expect(groupShortfall(groups[1]!.result)).toBe("4 TC");
    expect(groupShortfall(group({ id: "X", kind: "mandatory", status: "unknown", remaining: 1 }))).toBe("tối đa 1 môn");
    expect(groupShortfall(group({ id: "X", kind: "mandatory" }))).toBe("—");
  });
  it("builds groups from the standard alone before a transcript is imported", () => {
    const groups = groupViews(response({ evaluation: null, transcript: null }));
    expect(groups.map((item) => [item.title, item.achieved, item.required])).toEqual([
      ["Nhóm bắt buộc", "—", "2 môn"], ["Nhóm tự chọn TC102 · 1 học phần, gồm 71ITAI40103", "—", "3 TC"], ["Nhóm tự chọn TC102 · 2 học phần, gồm 71ITDS40103", "—", "6 TC"],
    ]);
    expect(groups[0]!.courses[0]).toMatchObject({ code: "71ITBS10103", row: null });
    expect(groupFacts(groups[0]!)).toBe("Bắt buộc · Yêu cầu: 2 môn — phải đạt tất cả học phần, kể cả môn điều kiện (*).");
    expect(groupViews(response({ standard: null, evaluation: null }))).toEqual([]);
  });
  it("searches without accents and filters by state", () => {
    const courses = groupViews(response({ evaluation: failing() })).flatMap((item) => item.courses);
    const named = courses.map((item, index) => index === 0 ? { ...item, name: "Lập trình hướng đối tượng" } : item);
    expect(filterCourses(named, "lap trinh", "").map((item) => item.code)).toEqual(["71ITBS10103"]);
    expect(filterCourses(named, "40203", "").map((item) => item.code)).toEqual(["71ITSE40203"]);
    expect(filterCourses(courses, "", "failed").map((item) => item.code)).toEqual(["71ITSE30103", "71ITSE40403"]);
    expect(filterCourses(courses, "", "open")).toHaveLength(5);
    expect(filterCourses(groupViews(response({ evaluation: null })).flatMap((item) => item.courses), "", "passed")).toEqual([]);
  });
  it("shows scores on the GPA scale first", () => {
    expect(scoreParts(course("A", "passed"), 4)).toEqual({ main: "3 / 4", detail: "7,5 / 10 · B" });
    expect(scoreParts(course("A", "passed"), 10)).toEqual({ main: "7,5 / 10", detail: "3 / 4 · B" });
    expect(scoreParts(course("A", "exempt", { letter: "MT" }), 4)).toEqual({ main: "MT", detail: "Miễn thi" });
    expect(scoreParts(course("A", "graded_unknown", { letter: "C" }), 4)).toEqual({ main: "C", detail: null });
    expect(scoreParts(course("A", "not_taken"), 4)).toBeNull();
  });
});

describe("loading and request errors", () => {
  it("explains failed requests", () => {
    expect(loadErrorMessage(401, null)).toBe("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    expect(loadErrorMessage(403, "account_unavailable")).toContain("Tài khoản của bạn hiện không dùng được");
    expect(loadErrorMessage(500, null)).toBe("Không thể tải điều kiện xét tốt nghiệp. Vui lòng thử lại.");
    expect(requestErrorMessage("advice_too_frequent")).toBe("Bạn vừa thử lại. Hãy đợi khoảng 30 giây rồi thử lại.");
    expect(requestErrorMessage("queue_full")).toBe("Hàng đợi AI đang đầy. Vui lòng thử lại sau ít phút.");
    expect(requestErrorMessage("advice_not_retryable")).toContain("đang được tạo hoặc đã có");
    expect(requestErrorMessage("ai_disabled")).toBe("Lời khuyên từ EduPath AI hiện chưa được bật.");
    expect(requestErrorMessage(undefined)).toBe("Thao tác chưa thành công. Vui lòng thử lại.");
    expect(adviceErrorMessage("invalid_ai_output")).toBe("Lời khuyên chưa khớp với số liệu đã tính nên hệ thống không hiển thị.");
    expect(adviceErrorMessage(null)).toBe("Máy AI chưa viết được lời khuyên.");
  });
});

describe("AI advice", () => {
  const output = { summary: "Bạn còn thiếu 4 tín chỉ tự chọn.", advice: [{ focus: "G2", label: "Nhóm tự chọn TC306", text: "Chọn thêm học phần." }], nextSteps: ["Xem lịch học."] };
  const stored = (status: StoredAdvice["status"], extra: Partial<StoredAdvice> = {}): StoredAdvice => ({
    id: "advice-1", status, errorCode: null, createdAt: "2026-10-13T10:00:00Z", completedAt: status === "completed" ? "2026-10-13T10:00:40Z" : null,
    model: "gemma4:e4b", standardVersion: 3, output: status === "completed" ? output : null, ...extra,
  });
  const advice = (overrides: Partial<GraduationAdviceResponse> = {}): GraduationAdviceResponse => ({
    advice: null, stale: false, needsAdvice: false, aiEnabled: true, worker: { online: true, supportsAdvice: true }, fingerprint: "fp-1", ...overrides,
  });
  const view = (response: GraduationAdviceResponse | null, extra: Partial<Parameters<typeof adviceView>[0]> = {}) =>
    adviceView({ response, loading: false, failed: false, ensure: null, remembered: null, ...extra });

  it("reads the advice API defensively", () => {
    expect(normalizeAdviceResponse(null)).toEqual({ advice: null, stale: false, needsAdvice: false, aiEnabled: false, worker: { online: false, supportsAdvice: false }, fingerprint: null });
    const read = normalizeAdviceResponse({ advice: { ...stored("completed"), output: { summary: " Tóm tắt ", advice: [{ focus: "G1", label: "Nhóm bắt buộc", text: "" }, { focus: "GENERAL", label: "", text: "Giữ nhịp học." }, "x"], nextSteps: ["", "Bước 1"] } }, stale: true, needsAdvice: true, aiEnabled: true, worker: { online: true, supportsAdvice: false }, fingerprint: "fp" });
    expect(read.advice?.output).toEqual({ summary: "Tóm tắt", advice: [{ focus: "GENERAL", label: "", text: "Giữ nhịp học." }], nextSteps: ["Bước 1"] });
    expect(read).toMatchObject({ stale: true, needsAdvice: true, aiEnabled: true, worker: { online: true, supportsAdvice: false }, fingerprint: "fp" });
    expect(normalizeAdviceResponse({ advice: { status: "unknown" } }).advice).toBeNull();
    expect(normalizeAdviceOutput({ summary: "", advice: [], nextSteps: [] })).toBeNull();
    expect(normalizeAdviceStatus({ id: "a", status: "processing", worker: { online: true, supportsAdvice: true } }))
      .toEqual({ id: "a", status: "processing", errorCode: null, worker: { online: true, supportsAdvice: true } });
    expect(normalizeAdviceWrite({ advice: stored("queued") })).toEqual({ advice: stored("queued"), deferred: false });
    // The router's answer when the queue is full: nothing stored, so no id and no createdAt.
    const deferred = { id: null, status: "deferred", errorCode: null, createdAt: null, completedAt: null, model: null, standardVersion: 3, output: null };
    expect(normalizeStoredAdvice(deferred)).toEqual(deferred);
    expect(normalizeAdviceWrite({ advice: deferred })).toEqual({ advice: null, deferred: true });
    expect(normalizeAdviceWrite({ status: "deferred" })).toEqual({ advice: null, deferred: true });
    expect(normalizeAdviceWrite({ advice: null })).toEqual({ advice: null, deferred: false });
    expect(shouldPollAdvice("queued")).toBe(true);
    expect(shouldPollAdvice("processing")).toBe(true);
    expect(shouldPollAdvice("completed")).toBe(false);
  });
  it("hides, loads, reports and switches off", () => {
    expect(view(null).kind).toBe("hidden");
    expect(view(null, { loading: true }).kind).toBe("loading");
    expect(view(null, { failed: true }).kind).toBe("unavailable");
    expect(view(advice({ aiEnabled: false, advice: stored("completed") })).kind).toBe("disabled");
    expect(view(advice({ fingerprint: null })).kind).toBe("hidden");
  });
  it("prepares advice automatically and keeps an older one visible, dimmed", () => {
    const old = stored("completed", { id: "old" });
    expect(view(advice({ needsAdvice: true }))).toEqual({ kind: "preparing", previous: null });
    expect(view(advice({ needsAdvice: true, stale: true, advice: old }))).toEqual({ kind: "preparing", previous: old });
    expect(view(advice({ needsAdvice: true }), { ensure: { fingerprint: "fp-1", state: "deferred" } }).kind).toBe("deferred");
    expect(view(advice({ needsAdvice: true }), { ensure: { fingerprint: "fp-1", state: "error" } }).kind).toBe("request_failed");
    expect(view(advice({ needsAdvice: true }), { ensure: { fingerprint: "other", state: "deferred" } }).kind).toBe("preparing");
    expect(view(advice({ advice: stored("queued", { id: "new" }) }), { remembered: old })).toEqual({ kind: "queued", worker: "ready", previous: old });
  });
  it("follows the job and the worker", () => {
    expect(view(advice({ advice: stored("queued") }))).toMatchObject({ kind: "queued", worker: "ready" });
    expect(view(advice({ advice: stored("queued"), worker: { online: true, supportsAdvice: false } }))).toMatchObject({ kind: "queued", worker: "outdated" });
    expect(view(advice({ advice: stored("queued"), worker: { online: false, supportsAdvice: false } }))).toMatchObject({ kind: "queued", worker: "offline" });
    expect(view(advice({ advice: stored("processing") }))).toMatchObject({ kind: "processing", since: "2026-10-13T10:00:00Z" });
    expect(view(advice({ advice: stored("deferred", { id: null, createdAt: null }) })).kind).toBe("deferred");
    // Deferred comes first, even while the current facts still need advice.
    expect(view(advice({ needsAdvice: true, advice: stored("deferred", { id: null, createdAt: null }) }), { ensure: { fingerprint: "fp-1", state: "error" } }).kind).toBe("deferred");
    expect(shouldPollAdvice("deferred")).toBe(false);
    expect(view(advice({ advice: stored("cancelled") })).kind).toBe("cancelled");
    expect(view(advice({ advice: stored("failed", { errorCode: "ai_timeout" }) }))).toMatchObject({ kind: "failed", errorCode: "ai_timeout" });
    expect(view(advice({ advice: stored("completed", { output: null }) }))).toMatchObject({ kind: "failed", errorCode: "invalid_ai_output" });
    const done = view(advice({ advice: stored("completed") }), { remembered: stored("completed") });
    expect(done).toMatchObject({ kind: "completed", stale: false });
    expect(view(advice({ advice: stored("completed"), stale: true }))).toMatchObject({ kind: "completed", stale: true });
  });
  it("words every state and announces changes", () => {
    expect(adviceStateCopy({ kind: "queued", worker: "ready", previous: null })?.title).toBe("Đang chuẩn bị lời khuyên…");
    expect(adviceStateCopy({ kind: "queued", worker: "outdated", previous: null })?.title).toBe("Máy AI đang chạy phiên bản cũ…");
    expect(adviceStateCopy({ kind: "queued", worker: "offline", previous: null })?.title).toBe("Lời khuyên sẽ có khi máy AI hoạt động trở lại");
    expect(adviceStateCopy({ kind: "processing", since: "", previous: null })?.text).toBe("Thường mất khoảng 20–60 giây.");
    expect(adviceStateCopy({ kind: "deferred", previous: null })?.text).toContain("tự động khi bạn mở lại trang");
    expect(adviceStateCopy({ kind: "failed", errorCode: "worker_timeout", previous: null })?.text)
      .toBe("Máy AI chưa xử lý xong trong thời gian cho phép. Các đề xuất ở trên không bị ảnh hưởng.");
    expect(adviceStateCopy({ kind: "completed", advice: { ...stored("completed"), output }, stale: false })).toBeNull();
    expect(adviceAnnouncement("completed")).toBe("Đã có lời khuyên từ EduPath AI.");
    expect(adviceAnnouncement("failed")).toBe("Chưa tạo được lời khuyên từ EduPath AI.");
    expect(adviceAnnouncement("hidden")).toBe("");
  });
  it("never shows internal condition keys", () => {
    expect(adviceFocusLabel({ focus: "G2", label: "Nhóm tự chọn TC306" })).toBe("Nhóm tự chọn TC306");
    expect(adviceFocusLabel({ focus: "GENERAL", label: "" })).toBe("Lời khuyên chung");
    expect(adviceFocusLabel({ focus: "CREDITS", label: "Tổng số tín chỉ tích lũy" })).toBe("Tổng số tín chỉ tích lũy");
    expect(adviceFocusLabel({ focus: "CREDITS", label: "CREDITS" })).toBe("Tổng số tín chỉ tích lũy");
    expect(adviceFocusLabel({ focus: "GPA", label: "" })).toBe("Điểm trung bình tích lũy");
    expect(adviceFocusLabel({ focus: "G3", label: "G3" })).toBe("Điều kiện xét tốt nghiệp");
  });
});
