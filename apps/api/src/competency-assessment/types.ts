import type { GraduationData } from "../graduation/model.js";
import type { PlanData } from "../plans/model.js";
import type { TranscriptData } from "../student/transcript-parser.js";

/* ------------------------------------------------------------------------ */
/* Inputs: exactly what the DB layer (inputs.ts) reads in one READ ONLY     */
/* snapshot. Every list must come from a query with a deterministic ORDER BY.*/
/* ------------------------------------------------------------------------ */

/** student_profiles.specialty (migration 028). NULL = "Chưa xác định". */
export type SpecialtyCode = "CNPM" | "CNDL" | "TTNT";

/** One curriculum_courses row of the active curriculum's current revision (ORDER BY position, code). */
export type CurriculumCourseInput = {
  /** curriculum_courses.code */
  code: string;
  /** curriculum_courses.name. Course names always come from here, never from the transcript. */
  name: string;
  /** curriculum_courses.credits (NUMERIC, convert to number). */
  credits: number;
  /** curriculum_courses.course_type, e.g. "BB", "BBKTL", "TC002 (2TC)", "TC309". */
  type: string;
  /** curriculum_courses.block, e.g. "Giáo dục thể chất và giáo dục quốc phòng". */
  block: string;
  /** curriculum_courses.specialty, raw value ('', '0', 'Công nghệ Phần mềm', 'Tự chọn Chuyên ngành', …). */
  specialty: string;
  /** curriculum_courses.semester (1–3) or null. */
  semester: number | null;
  /** curriculum_courses.study_year or null. */
  studyYear: number | null;
};

/** One curriculum_relations row of the same revision (ORDER BY course_code, kind). */
export type CurriculumRelationInput = {
  /** curriculum_relations.course_code */
  courseCode: string;
  /** "prerequisite" = tiên quyết (needs a pass), "prior" = học trước (any attempt). */
  kind: "prerequisite" | "prior";
  /** curriculum_relations.raw */
  raw: string;
  /** curriculum_relations.target_codes */
  targetCodes: string[];
  /** curriculum_relations.unresolved_codes */
  unresolvedCodes: string[];
  /** curriculum_relations.review_required */
  reviewRequired: boolean;
};

export type CurriculumInput = {
  /** curricula.id of the single is_active curriculum whose cohort_code = student cohort. */
  id: string;
  /** curricula.current_revision */
  revisionId: string;
  /** curriculum_revisions.version of the current revision. */
  version: number;
  /** curriculum_revisions.data->>'name' */
  name: string;
  /** curriculum_revisions.data->>'admissionYear' (used to turn CTĐT year/semester into HKyyS). */
  admissionYear: number | null;
  /** curriculum_courses of the current revision. Elective groups are derived from course_type. */
  courses: CurriculumCourseInput[];
  /** curriculum_relations of the current revision. */
  relations: CurriculumRelationInput[];
};

/** One ad_comp_course_links row (weight > 0) of an ACTIVE config in the weights revision (ORDER BY course_code, skill_id). */
export type WeightLinkInput = {
  /** ad_comp_course_configs.course_code; matched to the current curriculum by code. */
  courseCode: string;
  /** ad_comp_course_links.skill_id */
  skillId: string;
  /** ad_comp_course_links.weight (NUMERIC(12,10), convert to number). */
  weight: number;
};

/** An active, not deleted ad_comp_skills row joined to career_skills (ORDER BY name, skill_id). */
export type WeightSkillInput = {
  /** ad_comp_skills.skill_id (= career_skills.id) */
  skillId: string;
  /** career_skills.name */
  name: string;
  /** career_skills.description */
  description: string;
  /** ad_comp_skills.scope (the engine trims it to 200 characters). */
  scope: string;
  /** ad_comp_skills.group_id */
  groupId: string;
};

export type WeightsInput = {
  /** Newest revision of the same curriculum with ≥1 active ad_comp_course_configs row (§2.3). */
  revisionId: string;
  /** curriculum_revisions.version of that revision. */
  version: number;
  /** count(*) of active ad_comp_course_configs in that revision. */
  activeCount: number;
  /** max(updated_at) of those active configs, ISO string, or null. */
  maxConfigUpdatedAt: string | null;
  links: WeightLinkInput[];
  skills: WeightSkillInput[];
  /** Active ad_comp_groups (id, name). The engine orders groups itself. */
  groups: { id: string; name: string }[];
};

/**
 * How the DB layer resolved the graduation standard (active, same cohort, current revision):
 * - "specialty": matched the student's specialty by program code (data.specialty/classBlock);
 * - "general": specialty unset and exactly one general standard (no 7480201-0x code);
 * - "specialty_unset": specialty unset and no single general standard (K29) — not blocking;
 * - "not_found": no standard for the cohort/specialty;
 * - "ambiguous": several standards match.
 * resolveGraduationStandard() in specialty.ts implements this rule; graduation/resolve.ts reads the
 * candidates for every caller (competency inputs, student graduation page, graduation advice).
 */
export type GraduationResolution = "specialty" | "general" | "specialty_unset" | "not_found" | "ambiguous";

export type GraduationStandardInput = {
  /** graduation_standards.id */
  id: string;
  /** graduation_standards.current_revision */
  revisionId: string;
  /** graduation_revisions.version */
  version: number;
  /** graduation_revisions.data. gpaScale may be missing; the engine defaults it to 4. */
  data: GraduationData;
};

/** "found" = exactly one usable plan (preferring the one linked to the curriculum), else not_found/ambiguous. */
export type PlanResolution = "found" | "not_found" | "ambiguous";

export type PlanRevisionInput = {
  /** training_plans.id */
  id: string;
  /** training_plans.current_revision */
  revisionId: string;
  /** training_plan_revisions.version */
  version: number;
  /** training_plan_revisions.data */
  data: PlanData;
  /**
   * Course codes of the PE elective groups, as plans/student-router.ts builds them:
   * { TC002: [...], TC102: [...] } from the active curriculum. physicalEducationGroupsFor()
   * in plan-progress.ts computes the same object from curriculum courses.
   */
  physicalEducationGroups: Record<string, string[]>;
};

export type CareerRequirementInput = {
  /** career_requirements.id (deleted_at IS NULL), ORDER BY is_required DESC, title, id. */
  id: string;
  /** career_requirements.skill_id (nullable). */
  skillId: string | null;
  /** career_skills.name when the skill is not deleted, else null. */
  skillName: string | null;
  /** career_requirements.title */
  title: string;
  /** career_requirements.is_required: true = "Bắt buộc", false = "Ưu tiên". */
  isRequired: boolean;
};

export type CareerInput = {
  /** career_positions.id = student_profiles.career_position_id */
  id: string;
  /** career_positions.code, e.g. "NN009" */
  code: string;
  /** career_positions.name_vi */
  nameVi: string;
  /** career_positions.name_en */
  nameEn: string;
  /** career_positions.version (uuid) */
  version: string;
  /** career_positions.deleted_at IS NOT NULL */
  deleted: boolean;
  requirements: CareerRequirementInput[];
};

export type AssessmentInputs = {
  student: {
    /** student_profiles.cohort_code */
    cohortCode: string;
    /** student_profiles.specialty */
    specialty: SpecialtyCode | null;
    /** student_profiles.career_position_id */
    careerPositionId: string | null;
  };
  transcript: {
    /** student_transcripts.version */
    version: string;
    /** student_transcripts.parsed_data */
    data: TranscriptData;
  };
  curriculum: CurriculumInput;
  weights: WeightsInput;
  graduation: { resolution: GraduationResolution; standard: GraduationStandardInput | null };
  plan: { resolution: PlanResolution; revision: PlanRevisionInput | null };
  /** The selected career (even when soft-deleted) or null when none is selected. */
  career: CareerInput | null;
  /** Optional course_catalog names for transcript codes outside the curriculum. */
  catalogNames?: Record<string, string>;
  /** Optional prompt version label copied into meta. */
  promptVersion?: string;
};

/* ------------------------------------------------------------------------ */
/* Result: JSON-serializable; everything the page and the AI prompt need.   */
/* ------------------------------------------------------------------------ */

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
  /** Skills of the group that are neither condition-only nor not applicable (sums to overall.basis.applicableSkills). */
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

/**
 * What to study for one scored skill that is not a career gap (comp-calc-v6). With a career, one of
 * its met skills below Thành thạo ("deepen", comp-calc-v7); without one, a skill below Khá
 * ("strengthen"). Career gaps (below/not studied/upcoming) keep their courses in CareerRequirementResult.
 */
export type SkillPlan = {
  skillKey: string;
  skillId: string;
  name: string;
  groupKey: string;
  /** Stored like SkillResult.score: 2 decimals rounded down. */
  score: number;
  level: LevelCode;
  levelLabel: string;
  /** Required by the selected career (SkillResult.careerSkill). */
  careerSkill: boolean;
  /** comp-calc-v7; a v6 plan has none and strengthens a skill below Khá. */
  purpose: "deepen" | "strengthen";
  /**
   * Applicable courses not passed yet (a failed one is học lại), elective quota left, no thesis
   * replacement unless the student is on that path; by credits × weight.
   */
  take: SupportCourse[];
  /** Passed courses whose own score is below Khá (học cải thiện), condition-only excluded; by credits × weight. */
  improve: SupportCourse[];
  /** No course to take or improve: self-study with a product as evidence. */
  selfStudy: boolean;
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
  /** "TC306" when the name holds a TCxxx code, else null (comp-calc-v5). */
  code: string | null;
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

/** STU-COMP-07: the competency computed from the transcript as it stood at the end of one graded term. */
export type HistoryPoint = {
  /** HKyyS of that term (termCode of the section). */
  term: string;
  /** School year as "2023–2024" (en dash), from the term code. */
  schoolYear: string;
  /** 1, 2 or 3. */
  semester: number;
  /** Transcript courses with a result up to this term: passed + failed + exempt + graded_unknown (the transcript summary counts). */
  gradedCourses: number;
  overall: { score: number | null; level: LevelCode; levelLabel: string; skillsWithEvidence: number; applicableSkills: number };
  /** Same keys, names and order as AssessmentResult.groups. */
  groups: { key: string; name: string; score: number | null; level: LevelCode; levelLabel: string }[];
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
  /**
   * STU-COMP-07: overall and groups at the end of every graded term, oldest first; the last point is
   * this result (comp-calc-v8; absent before). Empty without a graded term.
   */
  history: HistoryPoint[];
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
  /**
   * Course plans, condition-only skills excluded, weakest first like highlights.improvements, at most
   * MAX_SKILL_PLANS (comp-calc-v6; absent before). With a career only its met skills below Thành thạo
   * ("deepen", v7); without one the scored skills below Khá ("strengthen").
   */
  skillPlans: SkillPlan[];
  /**
   * Courses of a thesis elective group other than the thesis (the graduation/thesis.ts rule), left out
   * of every course suggestion while the student is not on that replacement path; sorted by code,
   * empty when there is none (comp-calc-v7; absent before).
   */
  excludedThesisReplacements: string[];
  progress: PlanProgressResult | null;
  graduation: GraduationSummary;
  warnings: AssessmentWarning[];
  specialtySuggestion: SpecialtySuggestion | null;
};
