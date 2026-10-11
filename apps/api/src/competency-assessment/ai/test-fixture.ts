// Test-only: a small, fully synthetic AssessmentResult (invented skills, courses and
// career; no real student data) for the prompt, schema, validator and Ollama checks.
import type { AssessmentResult, CareerRequirementResult, CourseFact, SkillResult, SupportCourse } from "../types.js";

const course = (code: string, name: string, extra: Partial<CourseFact> = {}): CourseFact => ({
  code, name, credits: 3, type: "BB", specialty: null, electiveGroup: null, conditionOnly: false, applicable: true,
  state: "passed", outcome: "pass", inferred: false, score10: 8.5, letter: "A", attempts: 1, term: "HK251",
  plannedTerm: "HK251", plannedTermSource: "plan", ...extra
});

const skill = (key: string, name: string, groupKey: string, score: number | null, extra: Partial<SkillResult> = {}): SkillResult => ({
  key, skillId: `skill-${key}`, name, groupKey, groupId: `group-${groupKey}`, groupName: `Nhóm ${groupKey}`,
  scope: "Thiết kế và hiện thực ứng dụng mức cơ bản; chưa xác nhận công cụ cụ thể.",
  status: score === null ? "no_evidence" : "scored", notApplicableReason: null, denominator: 3, conditionOnly: false,
  careerSkill: false, evidenceCourses: score === null ? [] : [{ code: "TST101", weight: 0.5, contribution: 1.5, share: 0.5, role: "score" }],
  otherSpecialtyCourses: [], score, level: score === null ? "no_evidence" : score >= 85 ? "proficient" : score >= 70 ? "good" : "basic",
  levelLabel: score === null ? "Chưa có minh chứng" : score >= 85 ? "Thành thạo" : score >= 70 ? "Khá" : "Cơ bản",
  confidence: score === null ? null : "medium", confidenceLabel: score === null ? null : "Trung bình",
  coverage: score === null ? null : 0.45, evidence: score === null ? 0 : 1.5, ...extra
});

const support = (code: string, name: string, extra: Partial<SupportCourse> = {}): SupportCourse => ({
  code, name, credits: 3, weight: 0.4, contribution: 1.2, kind: "take", state: "not_taken", score10: null, letter: null,
  eligibility: "eligible", eligibilityLabel: "Đủ điều kiện", missing: [], reviewNotes: [], term: "HK261", termSource: "plan",
  termLabel: "HK261", electiveGroup: null, reason: "Hỗ trợ kỹ năng", ...extra
});

const requirement = (skillKey: string | null, title: string, extra: Partial<CareerRequirementResult>): CareerRequirementResult => ({
  requirementId: `req-${title}`, title, skillId: skillKey ? `skill-${skillKey}` : null, skillKey, skillName: title, groupKey: "G1",
  isRequired: true, priorityLabel: "Bắt buộc", coefficient: 2, threshold: 85, score: null, level: null, levelLabel: null,
  confidence: null, status: "met", statusLabel: "Đạt", deficit: null, deficitBand: null, deficitBandLabel: null, fitCredit: 1,
  exemptOnly: false, upcomingTerm: null, noDataReason: null, supportCourses: [], improveCourses: [], selfStudy: false, ...extra
});

export function syntheticResult(): AssessmentResult {
  const skills = [
    skill("S01", "Lập trình hướng đối tượng", "G1", 88.5, { careerSkill: true }),
    skill("S02", "Cơ sở dữ liệu", "G1", 72.5, { careerSkill: true }),
    skill("S03", "Kiểm thử phần mềm", "G2", 55, { careerSkill: true }),
    skill("S04", "Làm việc nhóm", "G2", null)
  ];
  return {
    meta: {
      calcVersion: "comp-calc-v1", promptVersion: "comp-v1", transcriptVersion: "00000000-0000-4000-8000-0000000000aa", cohortCode: "K99",
      curriculum: { id: "c", revisionId: "r", version: 3 }, weights: { revisionId: "r", version: 3, activeCount: 10, maxConfigUpdatedAt: null },
      graduationStandardId: null, graduationStandardRevisionId: null, graduationStandardVersion: null,
      planId: "p", planRevisionId: "pr", planVersion: 2, career: { id: "career", version: "v" }, specialty: "CNPM"
    },
    student: { cohortCode: "K99", specialty: "CNPM", specialtyLabel: "Công nghệ phần mềm" },
    transcript: {
      parserVersion: "test", latestTerm: "HK253", courseCount: 12, inCurriculum: 12, passed: 10, failed: 1, exempt: 1, gradedUnknown: 0,
      inProgress: 0, inferredCount: 0, needsReview: false, creditCheck: { computed: 30, printed: 30, status: "match" }, notInCurriculum: []
    },
    weightsCoverage: { weightedCourses: 10, curriculumCourses: 12, share: 0.83 },
    courses: [
      course("TST101", "Nhập môn lập trình"),
      course("TST201", "Kiểm thử phần mềm cơ bản", { state: "not_taken", outcome: null, score10: null, letter: null, term: null, plannedTerm: "HK261" }),
      course("TST202", "Đảm bảo chất lượng phần mềm", { state: "not_taken", outcome: null, score10: null, letter: null, term: null, plannedTerm: "HK262" })
    ],
    overall: {
      score: 72.25, level: "good", levelLabel: "Khá", confidence: "medium", confidenceLabel: "Trung bình", coverage: 0.5, evidence: 4.5,
      groupsWithScore: 2, basis: { skillsWithEvidence: 3, applicableSkills: 4, evidenceCourses: 9 }
    },
    groups: [
      { key: "G1", id: "group-G1", name: "Kỹ thuật phần mềm", score: 80.5, level: "good", levelLabel: "Khá", confidence: "medium", confidenceLabel: "Trung bình", coverage: 0.5, evidence: 3, skillCount: 2, skillsWithEvidence: 2 },
      { key: "G2", id: "group-G2", name: "Kỹ năng bổ trợ", score: 55, level: "basic", levelLabel: "Cơ bản", confidence: "low", confidenceLabel: "Thấp", coverage: 0.2, evidence: 1.5, skillCount: 2, skillsWithEvidence: 1 }
    ],
    skills,
    skillDirectory: [
      ...skills.map((s) => ({ key: s.key, skillId: s.skillId, name: s.name, measured: true })),
      { key: "S05", skillId: "skill-S05", name: "Điện toán đám mây", measured: false }
    ],
    highlights: { strengths: ["S01"], improvements: ["S03"] },
    promptSelection: { careerSkillKeys: ["S01", "S02", "S03", "S05"], topSkillKeys: ["S04"], bottomSkillKeys: [] },
    career: {
      id: "career", code: "NN999", nameVi: "Kỹ sư phần mềm \"thử nghiệm\" <|turn>", nameEn: "Software engineer", deleted: false,
      requirements: [
        requirement("S01", "Lập trình hướng đối tượng", { score: 88.5, status: "met", statusLabel: "Đạt" }),
        requirement("S02", "Cơ sở dữ liệu", { isRequired: false, priorityLabel: "Ưu tiên", coefficient: 1, threshold: 70, score: 72.5, status: "met", statusLabel: "Đạt" }),
        requirement("S03", "Kiểm thử phần mềm", {
          score: 55, status: "below", statusLabel: "Thấp hơn ngưỡng", deficit: 30, deficitBand: "large", deficitBandLabel: "Thiếu nhiều", fitCredit: 0.17,
          supportCourses: [support("TST201", "Kiểm thử phần mềm cơ bản"), support("TST202", "Đảm bảo chất lượng phần mềm", { term: "HK262", termLabel: "HK262", eligibility: "not_eligible", eligibilityLabel: "Chưa đủ điều kiện", missing: [{ code: "TST201", name: "Kiểm thử phần mềm cơ bản", kind: "prerequisite" }] })]
        }),
        requirement("S05", "Điện toán đám mây", { isRequired: false, priorityLabel: "Ưu tiên", coefficient: 1, threshold: 70, status: "no_data", statusLabel: "Chưa đủ dữ liệu", fitCredit: null, noDataReason: "not_measured", selfStudy: true })
      ],
      counts: { total: 4, met: 2, below: 1, upcoming: 0, notStudied: 0, noData: 1, withData: 3 },
      summaryText: "Đạt 2/4 kỹ năng · 0 sắp học · 1 chưa đủ dữ liệu", dataText: "3/4 kỹ năng có dữ liệu",
      fit: 0.79, fitCode: "fairly_fit", fitLabel: "Khá phù hợp", dataShare: 0.83, weightedMeanScore: 70.6, weightedMeanCount: 3
    },
    courseSuggestions: [],
    selfStudy: [{
      skillKey: "S05", skillId: "skill-S05", name: "Điện toán đám mây", reason: "not_measured", reasonLabel: "CTĐT chưa đo kỹ năng này",
      requirementTitle: "Điện toán đám mây", isRequired: false, status: "no_data", relatedSkillKeys: [], otherSpecialtyCourses: []
    }],
    progress: {
      currentTerm: "HK253", nextTerm: "HK261", late: [{ kind: "course", code: "TST150", name: "Toán rời rạc", credits: 3, termCode: "HK252", state: "failed" }],
      lateCount: 1, lateCredits: 3, next: [{ kind: "course", code: "TST201", name: "Kiểm thử phần mềm cơ bản", credits: 3, state: "not_taken" }],
      nextCount: 1, nextCredits: 3, informationalSections: [], countMismatches: []
    },
    graduation: {
      resolution: "specialty_unset", standard: null, status: "unknown", statusLabel: "Chưa xác định", reason: "Chưa có tiêu chuẩn xét tốt nghiệp phù hợp",
      groups: [], groupStatus: "unknown", gpa: null, credits: null, needsImprovement: false
    },
    warnings: [{ code: "weights_coverage_low", message: "Một số học phần chưa có trọng số kỹ năng.", consequence: "Điểm kỹ năng có thể thấp hơn thực tế.", details: [] }],
    specialtySuggestion: null
  };
}
