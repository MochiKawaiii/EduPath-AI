// Web mirror of apps/api/src/competency-assessment/types.ts (result side) and
// of the student API (contract C4) and AI output (contract C5). Keep in sync
// with the engine: the page only reads these shapes, it never recomputes them.

/** student_profiles.specialty. null = "Chưa xác định". */
export type SpecialtyCode = "CNPM" | "CNDL" | "TTNT";

/** Labels copied from the engine's specialty mapping (spec §4). */
export const SPECIALTIES: readonly { code: SpecialtyCode; label: string }[] = [
  { code: "CNPM", label: "Công nghệ phần mềm" },
  { code: "CNDL", label: "Công nghệ dữ liệu" },
  { code: "TTNT", label: "Trí tuệ nhân tạo" },
];

export function specialtyLabel(code: string | null | undefined): string {
  return SPECIALTIES.find((item) => item.code === code)?.label ?? "Chưa xác định";
}

/** Result types of the engine; GraduationResolution is the only input type the result uses. */
export type GraduationResolution = "specialty" | "general" | "specialty_unset" | "not_found" | "ambiguous";

export type LevelCode = "proficient" | "good" | "basic" | "needs_work" | "no_evidence" | "exempt";
export type Confidence = "low" | "medium" | "high";
/** Per-course state shared by score, coverage, gaps, suggestions, progress and graduation. */
export type CourseState = "passed" | "failed" | "exempt" | "graded_unknown" | "in_progress" | "not_taken" | "not_in_curriculum";
export type AttemptOutcome = "pass" | "fail" | "unknown";
export type GapStatus = "met" | "below" | "upcoming" | "not_studied" | "no_data";
export type DeficitBand = "near" | "moderate" | "large" | "not_studied";
export type FitCode = "fit" | "fairly_fit" | "needs_more" | "insufficient_data";
export type Eligibility = "eligible" | "not_eligible" | "review";
export type SkillStatus = "scored" | "exempt_only" | "no_evidence" | "not_applicable";
export type NotApplicableReason = "other_specialty" | "elective_not_chosen" | "no_credits";
export type EvidenceRole = "score" | "exempt" | "studied" | "in_progress" | "planned" | "not_chosen";
export type TriState = "pass" | "fail" | "unknown";

export type AssessmentMeta = {
  calcVersion: string;
  promptVersion: string | null;
  transcriptVersion: string;
  cohortCode: string;
  curriculum: { id: string; revisionId: string; version: number };
  weights: { revisionId: string; version: number; activeCount: number; maxConfigUpdatedAt: string | null };
  graduationStandardId: string | null;
  graduationStandardRevisionId: string | null;
  graduationStandardVersion: number | null;
  planId: string | null;
  planRevisionId: string | null;
  planVersion: number | null;
  career: { id: string; version: string } | null;
  specialty: SpecialtyCode | null;
};

export type AssessmentWarning = {
  code:
    | "weights_revision_differs"
    | "weights_coverage_low"
    | "results_inferred"
    | "credits_mismatch"
    | "transcript_needs_review"
    | "graduation_standard_unresolved"
    | "specialty_conflict"
    | "specialty_value_unknown"
    | "specialty_not_in_curriculum"
    | "career_deleted"
    | "plan_unavailable"
    | "plan_ambiguous"
    | "plan_section_count_mismatch"
    | "elective_quota_unknown";
  message: string;
  consequence: string;
  details: string[];
};

export type CreditCheck = {
  /** Σ transcript credits of passed/MT courses, condition-only courses excluded. */
  computed: number;
  /** "Tổng số tín chỉ tích lũy" printed on the latest graded term, or null. */
  printed: number | null;
  status: "match" | "mismatch" | "unavailable";
};

export type TranscriptSummary = {
  parserVersion: string;
  /** Latest term with grades as HKyyS, e.g. "HK253". */
  latestTerm: string | null;
  /** Distinct course codes on the transcript. */
  courseCount: number;
  inCurriculum: number;
  passed: number;
  failed: number;
  exempt: number;
  gradedUnknown: number;
  inProgress: number;
  /** Courses whose pass/fail state was inferred from the letter grade. */
  inferredCount: number;
  needsReview: boolean;
  creditCheck: CreditCheck;
  /** Informational only (AV0, 0-credit rows …), never a warning. */
  notInCurriculum: { code: string; name: string | null; credits: number; letter: string | null; state: CourseState }[];
};

export type ScoreSummary = {
  score: number | null;
  level: LevelCode;
  levelLabel: string;
  confidence: Confidence | null;
  confidenceLabel: string | null;
  coverage: number | null;
  evidence: number;
};

export type OverallResult = ScoreSummary & {
  /** Number of groups that have a score (overall = their mean). */
  groupsWithScore: number;
  /** "Dựa trên x/y kỹ năng có minh chứng từ n học phần". */
  basis: { skillsWithEvidence: number; applicableSkills: number; evidenceCourses: number };
};

export type GroupResult = ScoreSummary & {
  key: string;
  id: string;
  name: string;
  /** Skills of the group that are not condition-only. */
  skillCount: number;
  skillsWithEvidence: number;
};

/** One curriculum course as the engine sees it (one row per CTĐT code, sorted by code). */
export type CourseFact = {
  code: string;
  /** CTĐT name (never the transcript name). */
  name: string;
  /** CTĐT credits. */
  credits: number;
  /** curriculum_courses.course_type */
  type: string;
  /** null = học phần chung. */
  specialty: SpecialtyCode | null;
  /** CTĐT elective group ("TC309"), null for mandatory courses. */
  electiveGroup: string | null;
  /** GDTC/GDQP: kept out of group and overall scores. */
  conditionOnly: boolean;
  /** In the applicable set A (common, own specialty, or already attempted). */
  applicable: boolean;
  state: CourseState;
  outcome: AttemptOutcome | null;
  /** The pass/fail state was inferred from the letter grade ("suy ra từ điểm chữ"). */
  inferred: boolean;
  /** score10 of the selected attempt (null for MT). */
  score10: number | null;
  letter: string | null;
  attempts: number;
  /** Term of the selected attempt (HKyyS), null for "Điểm bảo lưu" or not taken. */
  term: string | null;
  /** First KHĐT term, else the CTĐT year/semester, else null ("chưa xếp lịch"). */
  plannedTerm: string | null;
  plannedTermSource: "plan" | "curriculum" | null;
};

/** One linked course of a skill; course details are in AssessmentResult.courses by code. */
export type SkillEvidenceRow = {
  code: string;
  weight: number;
  /** credits × weight */
  contribution: number;
  /** contribution / skill coverage denominator, null when not counted in it. */
  share: number | null;
  role: EvidenceRole;
};

export type SkillResult = ScoreSummary & {
  key: string;
  skillId: string;
  name: string;
  groupKey: string;
  groupId: string;
  groupName: string;
  /** ad_comp_skills.scope trimmed to 200 characters. */
  scope: string;
  status: SkillStatus;
  notApplicableReason: NotApplicableReason | null;
  /** Σ(credits × weight) the coverage is divided by. */
  denominator: number;
  /** Every linked course is condition-only (GDTC/GDQP): shown separately, outside group scores. */
  conditionOnly: boolean;
  /** Required by the selected career. */
  careerSkill: boolean;
  evidenceCourses: SkillEvidenceRow[];
  /** Linked courses outside the applicable set (other specialty). */
  otherSpecialtyCourses: string[];
};

export type PrerequisiteGap = { code: string; name: string | null; kind: "prerequisite" | "prior" };

export type SupportCourse = {
  code: string;
  name: string;
  credits: number;
  weight: number;
  contribution: number;
  /** "take" = not passed yet; "improve" = passed with a course score below the threshold. */
  kind: "take" | "improve";
  state: CourseState;
  score10: number | null;
  letter: string | null;
  eligibility: Eligibility;
  eligibilityLabel: string;
  missing: PrerequisiteGap[];
  /** Raw relation text that needs confirmation. */
  reviewNotes: string[];
  term: string | null;
  termSource: "plan" | "curriculum" | null;
  termLabel: string;
  electiveGroup: string | null;
  reason: string;
};

export type CareerRequirementResult = {
  requirementId: string;
  title: string;
  skillId: string | null;
  skillKey: string | null;
  skillName: string | null;
  groupKey: string | null;
  isRequired: boolean;
  priorityLabel: string;
  coefficient: number;
  threshold: number;
  score: number | null;
  level: LevelCode | null;
  levelLabel: string | null;
  confidence: Confidence | null;
  status: GapStatus;
  statusLabel: string;
  /** threshold − score, only for 'below'. */
  deficit: number | null;
  deficitBand: DeficitBand | null;
  deficitBandLabel: string | null;
  /** Credit used in the fit index (0..1), null when excluded (upcoming/no_data). */
  fitCredit: number | null;
  /** Met only through MT courses. */
  exemptOnly: boolean;
  /** Earliest planned term of the courses that make the skill 'upcoming'. */
  upcomingTerm: string | null;
  noDataReason: "no_skill" | "not_measured" | "other_specialty" | null;
  supportCourses: SupportCourse[];
  improveCourses: SupportCourse[];
  /** The skill is also listed in selfStudy. */
  selfStudy: boolean;
};

export type CareerResult = {
  id: string;
  code: string;
  nameVi: string;
  nameEn: string;
  deleted: boolean;
  requirements: CareerRequirementResult[];
  counts: { total: number; met: number; below: number; upcoming: number; notStudied: number; noData: number; withData: number };
  /** "Đạt x/y kỹ năng · z sắp học · t chưa đủ dữ liệu" */
  summaryText: string;
  /** "x/y kỹ năng có dữ liệu" */
  dataText: string;
  fit: number | null;
  fitCode: FitCode;
  fitLabel: string;
  /** Σ coefficient with data (met/below/not_studied) ÷ Σ coefficient. */
  dataShare: number;
  /** Coefficient-weighted mean of the scored career skills (does not saturate). */
  weightedMeanScore: number | null;
  weightedMeanCount: number;
};

export type CourseSuggestion = Omit<SupportCourse, "reason"> & {
  /** Career skills this course helps, by key. */
  skills: { key: string; status: GapStatus }[];
  /** Σ coefficient × credits × weight over those skills; the list is sorted by it. */
  priority: number;
  reason: string;
};

export type SelfStudyReason = "not_measured" | "other_specialty" | "elective_quota_used" | "no_course_left";

export type SelfStudyItem = {
  skillKey: string;
  skillId: string | null;
  name: string;
  reason: SelfStudyReason;
  reasonLabel: string;
  requirementTitle: string;
  isRequired: boolean;
  status: GapStatus;
  /** Measured skills with similar names, as context only (never merged). */
  relatedSkillKeys: string[];
  otherSpecialtyCourses: string[];
};

export type PlanCourseRef = { code: string; name: string; credits: number | null; state: CourseState };

export type LateEntry =
  | { kind: "course"; code: string; name: string; credits: number; termCode: string; state: CourseState }
  | { kind: "choice"; label: string; termCode: string; required: number; unit: "course" | "credit"; missing: number; missingCredits: number; options: PlanCourseRef[] }
  | { kind: "physical_education"; label: string; termCode: string; required: number; passed: number; missingCredits: number };

export type NextEntry =
  | { kind: "course"; code: string; name: string; credits: number; state: CourseState }
  | { kind: "choice"; label: string; required: number; unit: "course" | "credit"; remaining: number; options: PlanCourseRef[] }
  | { kind: "physical_education"; label: string; required: number; passed: number };

export type PlanProgressResult = {
  /** Latest term with grades on the transcript (HKyyS). */
  currentTerm: string | null;
  /** First plan term after currentTerm. */
  nextTerm: string | null;
  late: LateEntry[];
  lateCount: number;
  lateCredits: number;
  next: NextEntry[];
  nextCount: number;
  nextCredits: number;
  /** Sections that are never late (no k, or "Không tính vào tích lũy"). */
  informationalSections: { label: string; termCode: string; options: PlanCourseRef[] }[];
  /** Sections whose "trong n" differs from the real item count. */
  countMismatches: { label: string; termCode: string; stated: number; actual: number }[];
};

export type GraduationGroupCheck = {
  groupId: string;
  /** The group name; a name shared by several groups adds " · n học phần, gồm <first code>" (comp-calc-v5). */
  label: string;
  kind: "mandatory" | "elective";
  /** "TC306" when the name holds a TCxxx code, else null; absent in results stored before comp-calc-v5. */
  code?: string | null;
  unit: "môn" | "TC";
  /** Certainly completed (passed/MT). */
  lower: number | null;
  /** Completed + graded with an unknown result. */
  upper: number | null;
  required: number | null;
  status: TriState;
  /** Accumulated credits of the certainly completed courses, condition-only excluded. */
  accumulatedCredits: number | null;
  /** The CTĐT elective group with the same courses (TC209 ≡ TC309). */
  curriculumElectiveCode: string | null;
};

export type GraduationGpa = {
  actual: number | null;
  required: number | null;
  scale: 4 | 10;
  status: TriState;
  source: "printed" | "calculated" | null;
  reason: string;
};

export type GraduationCredits = {
  /** Printed cumulative credits, or the certainly passed estimate ("ước tính"). */
  lower: number | null;
  upper: number | null;
  required: number;
  status: TriState;
  /**
   * "calculated" = estimated from the passed courses of the program (standard ∪ CTĐT) without
   * condition-only courses; also used when the printed total is unreadable (comp-calc-v5).
   */
  source: "printed" | "calculated";
};

export type GraduationSummary = {
  resolution: GraduationResolution;
  standard: { id: string; name: string; version: number; specialty: string; classBlock: string } | null;
  status: TriState;
  statusLabel: string;
  /** Why the result is unknown, when it is. */
  reason: string | null;
  groups: GraduationGroupCheck[];
  groupStatus: TriState;
  gpa: GraduationGpa | null;
  /** Null when the standard has no minimumCredits (nothing to check). */
  credits: GraduationCredits | null;
  /** Groups pass but GPA fails: "Có thể học cải thiện". */
  needsImprovement: boolean;
};

export type SpecialtySuggestion = {
  code: SpecialtyCode;
  label: string;
  passedCount: number;
  /** "Gợi ý: Công nghệ phần mềm (6 học phần chuyên ngành đã học)" */
  text: string;
};

export type AssessmentResult = {
  meta: AssessmentMeta;
  student: { cohortCode: string; specialty: SpecialtyCode | null; specialtyLabel: string | null };
  transcript: TranscriptSummary;
  /** Courses with skill weights ÷ courses in the current curriculum. */
  weightsCoverage: { weightedCourses: number; curriculumCourses: number; share: number };
  /** Every CTĐT course with its state; evidence rows and suggestions refer to it by code. */
  courses: CourseFact[];
  overall: OverallResult;
  /** Keys G1, G2 … ordered by group name. */
  groups: GroupResult[];
  /** Sorted by score desc, evidence desc, key (§7.11). */
  skills: SkillResult[];
  /** Every skill key used anywhere in this result (measured and career-only), sorted by key. */
  skillDirectory: { key: string; skillId: string; name: string; measured: boolean }[];
  /** UI chips; condition-only skills excluded. */
  highlights: { strengths: string[]; improvements: string[] };
  /** Skill keys for the AI prompt: all career skills plus the 5 best and 5 weakest of the rest. */
  promptSelection: { careerSkillKeys: string[]; topSkillKeys: string[]; bottomSkillKeys: string[] };
  career: CareerResult | null;
  /** Candidate courses of all career gaps, merged by course. */
  courseSuggestions: CourseSuggestion[];
  /** "Kỹ năng cần tự học (CTĐT chưa đo)". */
  selfStudy: SelfStudyItem[];
  progress: PlanProgressResult | null;
  graduation: GraduationSummary;
  warnings: AssessmentWarning[];
  specialtySuggestion: SpecialtySuggestion | null;
};

/* ------------------------------------------------------------------------ */
/* Student API (C4) and AI output (C5).                                     */
/* ------------------------------------------------------------------------ */

export type AiStatus = "disabled" | "deferred" | "queued" | "processing" | "completed" | "failed" | "cancelled";
export type AiPriority = "high" | "medium" | "low";

export type AiOutput = {
  summary: string;
  groupInsights: { groupKey: string; comment: string }[];
  strengths: { skillKey: string; comment: string }[];
  improvements: { skillKey: string; priority: AiPriority; comment: string }[];
  careerFit: { comment: string };
  gaps: { skillKey: string; priority: AiPriority; explanation: string; courses: { courseCode: string; reason: string }[]; selfStudy: string[] }[];
  progress: string;
  nextSteps: string[];
};

export type StoredAssessment = {
  id: string;
  createdAt: string;
  meta: AssessmentMeta;
  result: AssessmentResult;
  ai: { status: AiStatus; errorCode: string | null; model: string | null; completedAt: string | null; output: AiOutput | null };
};

/** GET /api/student/competency-assessments/latest */
export type LatestAssessmentResponse = {
  assessment: StoredAssessment | null;
  aiEnabled: boolean;
  workerOnline: boolean;
  /** Policy version of this student's active competency consent (null = none; missing on an older API). */
  consentVersion?: string | null;
};
/** GET /api/student/competency-assessments/latest/status */
export type AssessmentStatusResponse = { id: string | null; aiStatus: AiStatus | null; aiErrorCode: string | null; workerOnline: boolean };
