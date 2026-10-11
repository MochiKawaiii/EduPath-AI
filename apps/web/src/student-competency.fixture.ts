// Synthetic assessment used by the #competency tests and the visual harness.
// Every value is invented; it describes no real student.
import type { AiOutput, AiStatus, AssessmentResult, CourseFact, SkillResult, StoredAssessment } from "./competency-assessment-types";

const course = (code: string, name: string, credits: number, state: CourseFact["state"], score10: number | null, letter: string | null, term: string | null, extra: Partial<CourseFact> = {}): CourseFact => ({
  code, name, credits, type: "BB", specialty: null, electiveGroup: null, conditionOnly: false, applicable: true, state,
  outcome: state === "passed" || state === "exempt" ? "pass" : state === "failed" ? "fail" : null, inferred: false,
  score10, letter, attempts: score10 === null && state !== "exempt" ? 0 : 1, term, plannedTerm: term, plannedTermSource: term ? "plan" : null, ...extra,
});

const courses: CourseFact[] = [
  course("TST101", "Nhập môn lập trình", 3, "passed", 8.6, "A", "HK231"),
  course("TST102", "Cấu trúc dữ liệu và giải thuật", 4, "passed", 6.4, "C+", "HK232", { attempts: 2 }),
  course("TST103", "Cơ sở dữ liệu", 3, "passed", 7.5, "B", "HK241", { inferred: true }),
  course("TST104", "Lập trình web", 3, "passed", 9.1, "A+", "HK242"),
  course("TST105", "Kiểm thử phần mềm", 3, "not_taken", null, null, null, { plannedTerm: "HK261", plannedTermSource: "plan" }),
  course("TST106", "Điện toán đám mây", 3, "not_taken", null, null, null, { plannedTerm: null, plannedTermSource: null, type: "TC309", electiveGroup: "TC309" }),
  course("TST107", "Kỹ năng giao tiếp", 2, "exempt", null, "MT", "HK231"),
  course("TST108", "Giáo dục thể chất 1", 1, "passed", 7, "B", "HK231", { conditionOnly: true }),
];

type SkillSeed = [key: string, name: string, group: "G1" | "G2", score: number | null, level: SkillResult["level"], evidence: [code: string, weight: number][], extra?: Partial<SkillResult>];
const levelLabels: Record<SkillResult["level"], string> = { proficient: "Thành thạo", good: "Khá", basic: "Cơ bản", needs_work: "Cần củng cố", no_evidence: "Chưa có minh chứng", exempt: "Miễn/công nhận" };
const seeds: SkillSeed[] = [
  ["S01", "Lập trình web", "G1", 91, "proficient", [["TST104", 0.6], ["TST101", 0.2]], { careerSkill: true }],
  ["S02", "Lập trình hướng đối tượng", "G1", 86.2, "proficient", [["TST101", 0.5]]],
  ["S03", "Thiết kế cơ sở dữ liệu", "G1", 75, "good", [["TST103", 0.7]], { careerSkill: true }],
  ["S04", "Giải thuật", "G1", 64.4, "basic", [["TST102", 0.8]], { careerSkill: true }],
  ["S05", "Giao tiếp", "G2", null, "exempt", [["TST107", 0.6]], { status: "exempt_only", confidence: null, confidenceLabel: null }],
  ["S06", "Rèn luyện thể chất", "G2", 70, "good", [["TST108", 1]], { conditionOnly: true }],
  ["S07", "Kiểm thử tự động", "G1", null, "no_evidence", [["TST105", 0.5]], { status: "no_evidence", confidence: null, confidenceLabel: null, careerSkill: true }],
  ["S08", "Triển khai dịch vụ đám mây", "G1", null, "no_evidence", [["TST106", 0.6]], { status: "not_applicable", notApplicableReason: "elective_not_chosen", confidence: null, confidenceLabel: null }],
];
const groupNames = { G1: "Kiến thức chuyên môn", G2: "Kỹ năng bổ trợ" } as const;
const skills: SkillResult[] = seeds.map(([key, name, group, score, level, evidence, extra]) => {
  const rows = evidence.map(([code, weight]) => {
    const credits = courses.find((c) => c.code === code)!.credits;
    return { code, weight, contribution: credits * weight, share: 0.5, role: (score === null ? "planned" : "score") as SkillResult["evidenceCourses"][number]["role"] };
  });
  return {
    key, skillId: `skill-${key}`, name, groupKey: group, groupId: `group-${group}`, groupName: groupNames[group],
    scope: `Phạm vi tổng hợp của kỹ năng ${name.toLowerCase()} trong các học phần liên quan.`,
    status: "scored", notApplicableReason: null, denominator: rows.reduce((n, r) => n + r.contribution, 0) * 2,
    conditionOnly: false, careerSkill: false, evidenceCourses: rows, otherSpecialtyCourses: [],
    score, level, levelLabel: levelLabels[level], confidence: score === null ? null : "medium", confidenceLabel: score === null ? null : "Trung bình",
    coverage: score === null ? null : 0.5, evidence: rows.reduce((n, r) => n + r.contribution, 0), ...extra,
  };
});

const supportTesting = {
  code: "TST105", name: "Kiểm thử phần mềm", credits: 3, weight: 0.5, contribution: 1.5, kind: "take" as const, state: "not_taken" as const,
  score10: null, letter: null, eligibility: "not_eligible" as const, eligibilityLabel: "Chưa đủ điều kiện",
  missing: [{ code: "TST109", name: "Công nghệ phần mềm", kind: "prerequisite" as const }], reviewNotes: [],
  term: "HK261", termSource: "plan" as const, termLabel: "HK261", electiveGroup: null, reason: "Đo kỹ năng Kiểm thử tự động với trọng số cao nhất trong các học phần chưa học.",
};
const improveAlgorithms = {
  code: "TST102", name: "Cấu trúc dữ liệu và giải thuật", credits: 4, weight: 0.8, contribution: 3.2, kind: "improve" as const, state: "passed" as const,
  score10: 6.4, letter: "C+", eligibility: "eligible" as const, eligibilityLabel: "Đủ điều kiện", missing: [], reviewNotes: [],
  term: null, termSource: null, termLabel: "Chưa xếp lịch", electiveGroup: null, reason: "Đã đạt nhưng điểm học phần thấp hơn ngưỡng của kỹ năng Giải thuật.",
};

export const fixtureResult: AssessmentResult = {
  meta: {
    calcVersion: "comp-calc-v1", promptVersion: "comp-v1", transcriptVersion: "00000000-0000-4000-8000-000000000001", cohortCode: "K29",
    curriculum: { id: "c1", revisionId: "r1", version: 3 }, weights: { revisionId: "r1", version: 3, activeCount: 6, maxConfigUpdatedAt: null },
    graduationStandardId: "g1", graduationStandardRevisionId: "gr1", graduationStandardVersion: 1, planId: "p1", planRevisionId: "pr1", planVersion: 2,
    career: { id: "career-1", version: "v1" }, specialty: "CNPM",
  },
  student: { cohortCode: "K29", specialty: "CNPM", specialtyLabel: "Công nghệ phần mềm" },
  transcript: {
    parserVersion: "test", latestTerm: "HK252", courseCount: 8, inCurriculum: 7, passed: 5, failed: 0, exempt: 1, gradedUnknown: 0, inProgress: 0, inferredCount: 1, needsReview: false,
    creditCheck: { computed: 15, printed: 15, status: "match" },
    notInCurriculum: [{ code: "AV0", name: "Tiếng Anh dự bị", credits: 0, letter: "B", state: "not_in_curriculum" }],
  },
  weightsCoverage: { weightedCourses: 7, curriculumCourses: 8, share: 0.875 },
  courses,
  overall: { score: 79.4, level: "good", levelLabel: "Khá", confidence: "medium", confidenceLabel: "Trung bình", coverage: 0.55, evidence: 9.4, groupsWithScore: 1, basis: { skillsWithEvidence: 5, applicableSkills: 7, evidenceCourses: 5 } },
  groups: [
    { key: "G1", id: "group-G1", name: groupNames.G1, score: 79.4, level: "good", levelLabel: "Khá", confidence: "medium", confidenceLabel: "Trung bình", coverage: 0.55, evidence: 8.2, skillCount: 6, skillsWithEvidence: 4 },
    { key: "G2", id: "group-G2", name: groupNames.G2, score: null, level: "exempt", levelLabel: "Miễn/công nhận", confidence: null, confidenceLabel: null, coverage: null, evidence: 1.2, skillCount: 1, skillsWithEvidence: 1 },
  ],
  skills,
  skillDirectory: [...skills.map((s) => ({ key: s.key, skillId: s.skillId, name: s.name, measured: true })), { key: "S09", skillId: "skill-S09", name: "Docker", measured: false }],
  highlights: { strengths: ["S01", "S02"], improvements: ["S04"] },
  promptSelection: { careerSkillKeys: ["S01", "S03", "S04", "S07", "S09"], topSkillKeys: ["S02"], bottomSkillKeys: [] },
  career: {
    id: "career-1", code: "NN000", nameVi: "Lập trình viên web", nameEn: "Web Developer", deleted: false,
    requirements: [
      { requirementId: "q1", title: "Lập trình web", skillId: "skill-S01", skillKey: "S01", skillName: "Lập trình web", groupKey: "G1", isRequired: true, priorityLabel: "Bắt buộc", coefficient: 2, threshold: 85, score: 91, level: "proficient", levelLabel: "Thành thạo", confidence: "medium", status: "met", statusLabel: "Đạt ngưỡng", deficit: null, deficitBand: null, deficitBandLabel: null, fitCredit: 1, exemptOnly: false, upcomingTerm: null, noDataReason: null, supportCourses: [], improveCourses: [], selfStudy: false },
      { requirementId: "q2", title: "Thiết kế cơ sở dữ liệu", skillId: "skill-S03", skillKey: "S03", skillName: "Thiết kế cơ sở dữ liệu", groupKey: "G1", isRequired: true, priorityLabel: "Bắt buộc", coefficient: 2, threshold: 85, score: 75, level: "good", levelLabel: "Khá", confidence: "medium", status: "below", statusLabel: "Dưới ngưỡng", deficit: 10, deficitBand: "moderate", deficitBandLabel: "Thiếu vừa", fitCredit: 0.39, exemptOnly: false, upcomingTerm: null, noDataReason: null, supportCourses: [], improveCourses: [], selfStudy: false },
      { requirementId: "q3", title: "Giải thuật", skillId: "skill-S04", skillKey: "S04", skillName: "Giải thuật", groupKey: "G1", isRequired: false, priorityLabel: "Ưu tiên", coefficient: 1, threshold: 70, score: 64.4, level: "basic", levelLabel: "Cơ bản", confidence: "medium", status: "below", statusLabel: "Dưới ngưỡng", deficit: 5.6, deficitBand: "moderate", deficitBandLabel: "Thiếu vừa", fitCredit: 0.4, exemptOnly: false, upcomingTerm: null, noDataReason: null, supportCourses: [], improveCourses: [improveAlgorithms], selfStudy: false },
      { requirementId: "q4", title: "Kiểm thử tự động", skillId: "skill-S07", skillKey: "S07", skillName: "Kiểm thử tự động", groupKey: "G1", isRequired: false, priorityLabel: "Ưu tiên", coefficient: 1, threshold: 70, score: null, level: "no_evidence", levelLabel: "Chưa có minh chứng", confidence: null, status: "upcoming", statusLabel: "Sắp học", deficit: null, deficitBand: null, deficitBandLabel: null, fitCredit: null, exemptOnly: false, upcomingTerm: "HK261", noDataReason: null, supportCourses: [supportTesting], improveCourses: [], selfStudy: false },
      { requirementId: "q5", title: "Docker", skillId: "skill-S09", skillKey: "S09", skillName: "Docker", groupKey: null, isRequired: false, priorityLabel: "Ưu tiên", coefficient: 1, threshold: 70, score: null, level: null, levelLabel: null, confidence: null, status: "no_data", statusLabel: "Chưa đủ dữ liệu", deficit: null, deficitBand: null, deficitBandLabel: null, fitCredit: null, exemptOnly: false, upcomingTerm: null, noDataReason: "not_measured", supportCourses: [], improveCourses: [], selfStudy: true },
    ],
    counts: { total: 5, met: 1, below: 2, upcoming: 1, notStudied: 0, noData: 1, withData: 3 },
    summaryText: "Đạt 1/5 kỹ năng · 1 sắp học · 1 chưa đủ dữ liệu", dataText: "3/5 kỹ năng có dữ liệu",
    fit: 0.58, fitCode: "fairly_fit", fitLabel: "Khá phù hợp", dataShare: 0.71, weightedMeanScore: 80.1, weightedMeanCount: 3,
  },
  courseSuggestions: [
    { ...supportTesting, skills: [{ key: "S07", status: "upcoming" }], priority: 1.5, reason: supportTesting.reason },
    { ...improveAlgorithms, skills: [{ key: "S04", status: "below" }], priority: 3.2, reason: improveAlgorithms.reason },
  ],
  selfStudy: [{ skillKey: "S09", skillId: "skill-S09", name: "Docker", reason: "not_measured", reasonLabel: "CTĐT chưa có học phần đo kỹ năng này", requirementTitle: "Docker", isRequired: false, status: "no_data", relatedSkillKeys: ["S08"], otherSpecialtyCourses: [] }],
  progress: {
    currentTerm: "HK252", nextTerm: "HK261",
    late: [{ kind: "course", code: "TST109", name: "Công nghệ phần mềm", credits: 3, termCode: "HK252", state: "not_taken" }],
    lateCount: 1, lateCredits: 3,
    next: [{ kind: "course", code: "TST105", name: "Kiểm thử phần mềm", credits: 3, state: "not_taken" }, { kind: "choice", label: "Tự chọn chuyên ngành (chọn 1 trong 2)", required: 1, unit: "course", remaining: 1, options: [{ code: "TST106", name: "Điện toán đám mây", credits: 3, state: "not_taken" }, { code: "TST110", name: "Phát triển ứng dụng di động", credits: 3, state: "not_taken" }] }],
    nextCount: 2, nextCredits: 6, informationalSections: [], countMismatches: [],
  },
  graduation: {
    resolution: "specialty", standard: { id: "g1", name: "Tiêu chuẩn tốt nghiệp K29 – CNPM", version: 1, specialty: "Công nghệ phần mềm", classBlock: "K29" },
    status: "fail", statusLabel: "Chưa đủ điều kiện", reason: null,
    groups: [
      { groupId: "BB", label: "Học phần bắt buộc", kind: "mandatory", unit: "TC", lower: 15, upper: 15, required: 120, status: "fail", accumulatedCredits: 15, curriculumElectiveCode: null },
      { groupId: "TC309", label: "Tự chọn chuyên ngành", kind: "elective", unit: "TC", lower: 0, upper: 0, required: 6, status: "fail", accumulatedCredits: 0, curriculumElectiveCode: "TC309" },
    ],
    groupStatus: "fail", gpa: { actual: 3.1, required: 2, scale: 4, status: "pass", source: "printed", reason: "Điểm trung bình tích lũy in trên bảng điểm." },
    credits: { lower: 15, upper: 15, required: 135, status: "fail", source: "printed" }, needsImprovement: false,
  },
  warnings: [{ code: "results_inferred", message: "1 học phần có kết quả suy ra từ điểm chữ.", consequence: "Nếu điểm chữ đọc sai, mức kỹ năng liên quan có thể lệch.", details: ["Tổng tín chỉ các môn Đạt khớp với bảng điểm (15 = 15)."] }],
  specialtySuggestion: null,
};

export const fixtureAiOutput: AiOutput = {
  summary: "Bạn đang có nền tảng lập trình web rất tốt, thể hiện qua kết quả học phần Lập trình web. Phần cần chú ý nhất là thiết kế cơ sở dữ liệu và giải thuật.",
  groupInsights: [{ groupKey: "G1", comment: "Nhóm kiến thức chuyên môn ở mức Khá, kéo lên chủ yếu nhờ các học phần lập trình." }, { groupKey: "G9", comment: "Không ánh xạ được, phải bị bỏ." }],
  strengths: [{ skillKey: "S01", comment: "Điểm học phần Lập trình web cao cho thấy bạn làm chủ được giao diện và xử lý phía máy chủ." }],
  improvements: [{ skillKey: "S04", priority: "high", comment: "Ôn lại các cấu trúc dữ liệu cơ bản và luyện bài tập có giới hạn thời gian." }],
  careerFit: { comment: "Với nghề Lập trình viên web, bạn đã đạt kỹ năng lập trình web; cần nâng thiết kế cơ sở dữ liệu lên mức Thành thạo." },
  gaps: [{ skillKey: "S07", priority: "medium", explanation: "Học phần Kiểm thử phần mềm nằm ở học kỳ tới, nên chuẩn bị trước.", courses: [{ courseCode: "TST105", reason: "Đo trực tiếp kỹ năng kiểm thử." }, { courseCode: "XXX999", reason: "Không có trong danh sách, phải bị bỏ." }], selfStudy: ["Viết kiểm thử đơn vị cho một dự án cá nhân."] },
    { skillKey: "S09", priority: "low", explanation: "Chương trình chưa có học phần đo Docker.", courses: [], selfStudy: ["Đóng gói ứng dụng web của bạn bằng Docker."] }],
  progress: "Bạn đang chậm 1 học phần so với kế hoạch; nên đăng ký Công nghệ phần mềm sớm vì đây là điều kiện của Kiểm thử phần mềm.",
  nextSteps: ["Đăng ký học phần Công nghệ phần mềm.", "Làm một dự án nhỏ có thiết kế cơ sở dữ liệu chuẩn hóa.", "Tự học Docker qua dự án cá nhân."],
};

export function fixtureAssessment(status: AiStatus = "completed", errorCode: string | null = null): StoredAssessment {
  return {
    id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-10-11T02:30:00.000Z", meta: fixtureResult.meta, result: fixtureResult,
    ai: { status, errorCode, model: status === "completed" ? "gemma4:e4b" : null, completedAt: status === "completed" ? "2026-10-11T02:34:00.000Z" : null, output: status === "completed" ? fixtureAiOutput : null },
  };
}
