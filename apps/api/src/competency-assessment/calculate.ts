import { referencedCourseCodes } from "../curricula/course-codes.js";
import {
  CALC_VERSION, CAREER_COEFFICIENTS, CAREER_THRESHOLDS, COVERAGE_BANDS, DEFICIT_BANDS, EVIDENCE_BANDS, FIT_BELOW_FLOOR,
  FIT_BELOW_MAX_CREDIT, FIT_LABEL_THRESHOLDS, FIT_MIN_DATA_SHARE, HIGHLIGHT_COUNT, LEVEL_THRESHOLDS, MAX_RELATED_SKILLS,
  MAX_SKILL_PLANS, MAX_SUPPORT_COURSES, MIN_WEIGHTED_COURSE_SHARE, SCOPE_MAX_LENGTH,
} from "./constants.js";
import {
  conditionOnlyCodes, courseKey, creditCrossCheck, currentTermCode, curriculumTermCode, deriveElectiveGroups, electiveCodeOf,
  isAttemptedState, isConditionOnly, isPassedState, isStudiedState, type TranscriptCourseRecord, transcriptCourses, uniqueCurriculumCourses,
} from "./course-state.js";
import { assessGraduation, electiveQuotas, programCreditMap } from "./graduation.js";
import { physicalEducationGroupsFor, planProgress, type PlanCourseInfo } from "./plan-progress.js";
import {
  classifyCurriculumSpecialty, type CurriculumSpecialtyClass, fold, specialtyBlocks, specialtyConflict, specialtyCounts,
  specialtyLabel, suggestSpecialty,
} from "./specialty.js";
import type {
  AssessmentInputs, AssessmentResult, AssessmentWarning, AttemptOutcome, CareerRequirementResult, CareerResult, Confidence,
  CourseFact, CourseState, CourseSuggestion, DeficitBand, Eligibility, EvidenceRole, FitCode, GapStatus, GroupResult, LevelCode,
  NotApplicableReason, PrerequisiteGap, SelfStudyItem, SelfStudyReason, SkillEvidenceRow, SkillPlan, SkillResult, SupportCourse,
} from "./types.js";

/* ----------------------------- labels ----------------------------- */

export const LEVEL_LABELS: Record<LevelCode, string> = {
  proficient: "Thành thạo", good: "Khá", basic: "Cơ bản", needs_work: "Cần củng cố",
  no_evidence: "Chưa có minh chứng", exempt: "Miễn/công nhận",
};
export const CONFIDENCE_LABELS: Record<Confidence, string> = { low: "Thấp", medium: "Trung bình", high: "Cao" };
export const GAP_STATUS_LABELS: Record<GapStatus, string> = {
  met: "Đạt ngưỡng", below: "Dưới ngưỡng", upcoming: "Sắp học", not_studied: "Chưa học", no_data: "Chưa đủ dữ liệu",
};
export const DEFICIT_BAND_LABELS: Record<DeficitBand, string> = {
  near: "Gần ngưỡng", moderate: "Thiếu vừa", large: "Thiếu nhiều", not_studied: "Chưa học",
};
export const FIT_LABELS: Record<FitCode, string> = {
  fit: "Phù hợp", fairly_fit: "Khá phù hợp", needs_more: "Cần bổ sung nhiều", insufficient_data: "Chưa đủ dữ liệu",
};
export const ELIGIBILITY_LABELS: Record<Eligibility, string> = {
  eligible: "Đủ điều kiện", not_eligible: "Chưa đủ điều kiện", review: "Cần xác nhận",
};
export const NOT_APPLICABLE_LABELS: Record<NotApplicableReason, string> = {
  other_specialty: "Chỉ có trong học phần của chuyên ngành khác",
  elective_not_chosen: "Không thuộc lựa chọn tự chọn của bạn",
  no_credits: "Học phần liên quan không có tín chỉ",
};
export const SELF_STUDY_REASON_LABELS: Record<SelfStudyReason, string> = {
  not_measured: "CTĐT chưa có học phần đo kỹ năng này",
  other_specialty: "Chỉ được dạy trong học phần của chuyên ngành khác",
  elective_quota_used: "Thuộc nhóm tự chọn bạn đã chọn đủ tín chỉ",
  no_course_left: "Không còn học phần nào trong CTĐT để học thêm",
};

/* ------------------------- pure formula helpers ------------------------- */

export const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};
/** Vietnamese decimal formatting without locale data: 0.6 → "0,6". */
export const vn = (value: number, digits = 2) => String(round(value, digits)).replace(".", ",");
/** A computed 0–100 score without float noise (84.99999999999999 → 85), so a level is not missed by 1e-14. */
export const snapScore = (value: number) => Math.round(value * 1e9) / 1e9;
/**
 * A stored 0–100 score: 2 decimals rounded down. The page and the AI prompt show its whole part, so a
 * score that has not reached a level is never shown at it (84.996 is stored as 84.99 and shown as 84).
 */
export const floorScore = (value: number) => Math.floor(value * 100 + 1e-9) / 100;

/** Level from an unrounded 0–100 score. */
export function levelOf(score: number | null, exemptOnly = false): LevelCode {
  if (score === null) return exemptOnly ? "exempt" : "no_evidence";
  return score >= LEVEL_THRESHOLDS.proficient ? "proficient" : score >= LEVEL_THRESHOLDS.good ? "good"
    : score >= LEVEL_THRESHOLDS.basic ? "basic" : "needs_work";
}

export const coverageBand = (coverage: number): Confidence =>
  coverage >= COVERAGE_BANDS.high ? "high" : coverage >= COVERAGE_BANDS.medium ? "medium" : "low";
export const evidenceBand = (evidence: number): Confidence =>
  evidence >= EVIDENCE_BANDS.high ? "high" : evidence >= EVIDENCE_BANDS.medium ? "medium" : "low";
const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
/** Confidence = min(coverage band, evidence band). */
export function confidenceOf(coverage: number | null, evidence: number): Confidence {
  const byCoverage = coverageBand(coverage ?? 0), byEvidence = evidenceBand(evidence);
  return CONFIDENCE_RANK[byCoverage] <= CONFIDENCE_RANK[byEvidence] ? byCoverage : byEvidence;
}

export const deficitBand = (deficit: number): DeficitBand =>
  deficit <= DEFICIT_BANDS.near ? "near" : deficit <= DEFICIT_BANDS.moderate ? "moderate" : "large";

/** Fit credit of one requirement; null when excluded (upcoming/no_data). */
export function fitCredit(status: GapStatus, score: number | null, threshold: number): number | null {
  if (status === "met") return 1;
  if (status === "not_studied") return 0;
  if (status === "below") {
    const ratio = ((score ?? 0) - FIT_BELOW_FLOOR) / (threshold - FIT_BELOW_FLOOR);
    return FIT_BELOW_MAX_CREDIT * Math.min(1, Math.max(0, ratio));
  }
  return null;
}

export function fitCodeOf(fit: number | null, dataShare: number): FitCode {
  if (fit === null || dataShare < FIT_MIN_DATA_SHARE) return "insufficient_data";
  return fit >= FIT_LABEL_THRESHOLDS.fit ? "fit" : fit >= FIT_LABEL_THRESHOLDS.fairlyFit ? "fairly_fit" : "needs_more";
}

const compareText = (a: string, b: string) => {
  const left = fold(a), right = fold(b);
  return left < right ? -1 : left > right ? 1 : a < b ? -1 : a > b ? 1 : 0;
};
const compareCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const trimText = (value: string, max: number) => Array.from(value.replace(/\s+/g, " ").trim()).slice(0, max).join("");

/** §7.11: score desc (no score last), evidence desc, key. */
export function compareSkills(a: { score: number | null; evidence: number; key: string }, b: { score: number | null; evidence: number; key: string }) {
  if (a.score !== b.score) {
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  }
  return b.evidence - a.evidence || compareCode(a.key, b.key);
}

const STOP_WORDS = new Set([
  "va", "voi", "cac", "cua", "cho", "trong", "ve", "tren", "theo", "lap", "trinh", "ky", "nang", "ung", "dung", "phat", "trien",
  "thiet", "ke", "quan", "ly", "he", "thong", "co", "ban", "cao", "nhap", "mon", "hoc", "phan", "tich", "so", "may", "tinh",
  "mo", "hinh", "cong", "nghe", "thuc", "hanh", "kien", "kinh", "nghiem", "the", "ngon", "ngu", "du", "lieu", "su", "va/hoac",
]);
const nameTokens = (name: string) =>
  new Set(fold(name).split(/[^a-z0-9#+]+/).filter((token) => (token.length >= 2 || /[#+]/.test(token)) && !STOP_WORDS.has(token) && !/^\d+$/.test(token)));

/* ------------------------------ internals ------------------------------ */

type Row = {
  code: string;
  name: string;
  credits: number;
  type: string;
  specialty: CurriculumSpecialtyClass;
  electiveCode: string | null;
  conditionOnly: boolean;
  record: TranscriptCourseRecord | null;
  state: CourseState;
  applicable: boolean;
  plannedTerm: string | null;
  plannedTermSource: "plan" | "curriculum" | null;
  /** score10 of the selected attempt when it counts in averages (MT never does). */
  score10: number | null;
  letter: string | null;
  outcome: AttemptOutcome | null;
  inferred: boolean;
  attempts: number;
  attemptTerm: string | null;
};

type Link = { row: Row; weight: number };

/** Career requirement statuses that get course suggestions (supportCourses/improveCourses). */
const CAREER_GAP_STATUSES: ReadonlySet<GapStatus> = new Set<GapStatus>(["below", "not_studied", "upcoming"]);

type ElectiveState = { code: string; quota: number | null; fill: number; remaining: number | null; rows: Row[] };

/** num/den: coverage; scoreNum/scoreDen: score; exempt: Σ credits × weight of MT courses. */
type Exposure = { num: number; den: number; scoreNum: number; scoreDen: number; exempt: number };

type SkillWork = {
  skillId: string;
  name: string;
  scope: string;
  groupId: string;
  links: Link[];
  key: string;
  all: Exposure;
  nonCondition: Exposure;
  score: number | null;
  status: SkillResult["status"];
  notApplicableReason: NotApplicableReason | null;
  conditionOnly: boolean;
  exempt: boolean;
};

const emptyExposure = (): Exposure => ({ num: 0, den: 0, scoreNum: 0, scoreDen: 0, exempt: 0 });
const addExposure = (into: Exposure, from: Exposure) => {
  into.num += from.num; into.den += from.den; into.scoreNum += from.scoreNum; into.scoreDen += from.scoreDen; into.exempt += from.exempt;
};

export function calculateAssessment(inputs: AssessmentInputs): AssessmentResult {
  const warnings: AssessmentWarning[] = [];
  const warn = (code: AssessmentWarning["code"], message: string, consequence: string, details: string[] = []) =>
    warnings.push({ code, message, consequence, details });
  const specialty = inputs.student.specialty;
  const graduationStandard = inputs.graduation.standard;
  const standardData = graduationStandard?.data ?? null;
  const planRevision = inputs.plan.resolution === "found" ? inputs.plan.revision : null;
  const transcript = inputs.transcript.data;

  /* ---- 1. one shared per-course state table (§7.1, §7.2) ---- */
  const curriculumCourses = uniqueCurriculumCourses(inputs.curriculum.courses);
  const electives = deriveElectiveGroups(curriculumCourses);
  const quotas = electiveQuotas(electives, standardData);
  const conditionCodes = conditionOnlyCodes(standardData, curriculumCourses);
  const records = transcriptCourses(transcript);
  const currentTerm = currentTermCode(transcript);
  const admissionYear = inputs.curriculum.admissionYear ?? planRevision?.data.admissionYear ?? null;
  const planTerms = new Map<string, string>();
  for (const item of [...(planRevision?.data.items ?? [])].sort((a, b) => compareCode(a.termCode, b.termCode) || a.position - b.position)) {
    const code = courseKey(item.code);
    if (code && !planTerms.has(code)) planTerms.set(code, item.termCode);
  }
  // A specialty standard's course list also decides applicability (§7.8); a general one does not.
  const standardCodes = new Set(inputs.graduation.resolution === "specialty" ? (standardData?.courses ?? []).map((course) => courseKey(course.code)) : []);
  const unknownSpecialtyValues = new Set<string>();
  const table = new Map<string, Row>();
  for (const course of curriculumCourses) {
    const code = courseKey(course.code);
    const record = records.get(code) ?? null;
    const state: CourseState = record?.state ?? "not_taken";
    const specialtyClass = classifyCurriculumSpecialty(course.specialty);
    if (specialtyClass.kind === "common" && !specialtyClass.known) unknownSpecialtyValues.add(course.specialty.trim());
    const plannedFromPlan = planTerms.get(code) ?? null;
    const plannedFromCurriculum = curriculumTermCode(admissionYear, course.studyYear, course.semester);
    const selected = record?.selected ?? null;
    table.set(code, {
      code, name: course.name, credits: Number.isFinite(course.credits) && course.credits > 0 ? course.credits : 0, type: course.type,
      specialty: specialtyClass, electiveCode: electiveCodeOf(course.type), conditionOnly: isConditionOnly(code, conditionCodes),
      record, state,
      applicable: specialtyClass.kind === "common" || specialtyClass.code === specialty || standardCodes.has(code) || isAttemptedState(state),
      plannedTerm: plannedFromPlan ?? plannedFromCurriculum,
      plannedTermSource: plannedFromPlan ? "plan" : plannedFromCurriculum ? "curriculum" : null,
      score10: selected && !selected.exempt ? selected.score10 : null,
      letter: selected?.letter ?? null,
      outcome: selected?.outcome ?? null,
      inferred: record?.inferred ?? false,
      attempts: record?.attempts.length ?? 0,
      attemptTerm: selected?.termCode ?? null,
    });
  }
  const stateOf = (code: string): CourseState => table.get(courseKey(code))?.state ?? records.get(courseKey(code))?.state ?? "not_taken";

  // Elective groups: what the student chose and how much quota remains (§7.3).
  const electiveStates = new Map<string, ElectiveState>();
  for (const elective of electives) {
    const rows = elective.courseCodes.map((code) => table.get(code)).filter((row): row is Row => Boolean(row?.applicable));
    const quota = quotas.get(elective.code)?.quota ?? null;
    const fill = rows.filter((row) => isPassedState(row.state) || row.state === "in_progress" || row.state === "graded_unknown")
      .reduce((sum, row) => sum + row.credits, 0);
    electiveStates.set(elective.code, { code: elective.code, quota, fill, rows, remaining: quota === null ? null : Math.max(0, quota - fill) });
  }
  const notChosen = (row: Row) => row.electiveCode !== null && electiveStates.get(row.electiveCode)?.remaining === 0 && !isAttemptedState(row.state);
  const quotaUnknownGroups = [...electiveStates.values()].filter((group) => group.quota === null && group.rows.length).map((group) => group.code).sort(compareCode);

  /* ---- 2. weights (§2.3): matched by code, credits from the current CTĐT ---- */
  const groupsById = new Map(inputs.weights.groups.map((group) => [group.id, group]));
  const skillInputs = new Map(inputs.weights.skills.filter((skill) => groupsById.has(skill.groupId)).map((skill) => [skill.skillId, skill]));
  const linksBySkill = new Map<string, Link[]>();
  const weightedCodes = new Set<string>();
  for (const link of inputs.weights.links) {
    const row = table.get(courseKey(link.courseCode));
    if (!row || !skillInputs.has(link.skillId) || !(Number.isFinite(link.weight) && link.weight > 0)) continue;
    const list = linksBySkill.get(link.skillId) ?? [];
    if (list.some((existing) => existing.row.code === row.code)) continue;
    list.push({ row, weight: link.weight });
    linksBySkill.set(link.skillId, list);
    weightedCodes.add(row.code);
  }
  const weightsCoverage = {
    weightedCourses: weightedCodes.size, curriculumCourses: table.size,
    share: table.size ? round(weightedCodes.size / table.size, 4) : 0,
  };

  /* ---- 3. score, coverage, confidence per skill (§7.3) ---- */
  const exposure = (links: readonly Link[], include: (row: Row) => boolean): Exposure => {
    const result = emptyExposure();
    const weightOf = new Map(links.map((link) => [link.row.code, link.weight]));
    const groups = new Set<string>();
    for (const { row, weight } of links) {
      if (!include(row)) continue;
      const contribution = row.credits * weight;
      if (row.score10 !== null) { result.scoreNum += row.score10 * contribution; result.scoreDen += contribution; }
      if (!row.applicable) continue;
      if (row.state === "exempt") result.exempt += contribution;
      if (row.electiveCode && electiveStates.has(row.electiveCode)) { groups.add(row.electiveCode); continue; }
      result.den += contribution;
      if (isStudiedState(row.state)) result.num += contribution;
    }
    for (const code of groups) {
      const group = electiveStates.get(code)!;
      const rows = group.rows.filter(include);
      const credits = rows.reduce((sum, row) => sum + row.credits, 0);
      const offered = rows.reduce((sum, row) => sum + row.credits * (weightOf.get(row.code) ?? 0), 0);
      const chosen = rows.filter((row) => isAttemptedState(row.state));
      const chosenExposure = chosen.reduce((sum, row) => sum + row.credits * (weightOf.get(row.code) ?? 0), 0);
      // Quota-aware: chosen courses plus the remaining quota at the group's average weight per credit.
      result.den += group.remaining === null ? offered : chosenExposure + (credits > 0 ? group.remaining * offered / credits : 0);
      result.num += chosen.filter((row) => isStudiedState(row.state)).reduce((sum, row) => sum + row.credits * (weightOf.get(row.code) ?? 0), 0);
    }
    return result;
  };

  const work: SkillWork[] = [];
  for (const [skillId, links] of linksBySkill) {
    const skill = skillInputs.get(skillId)!;
    const all = exposure(links, () => true);
    const nonCondition = exposure(links, (row) => !row.conditionOnly);
    const score = all.scoreDen > 0 ? snapScore(10 * all.scoreNum / all.scoreDen) : null;
    const exempt = links.some((link) => link.row.applicable && link.row.state === "exempt");
    const inA = links.filter((link) => link.row.applicable);
    let status: SkillResult["status"], reason: NotApplicableReason | null = null;
    if (score !== null) status = "scored";
    else if (exempt) status = "exempt_only";
    else if (all.den > 0) status = "no_evidence";
    else {
      status = "not_applicable";
      reason = inA.length && inA.every((link) => notChosen(link.row)) ? "elective_not_chosen" : inA.length ? "no_credits" : "other_specialty";
    }
    work.push({
      skillId, name: skill.name, scope: trimText(skill.scope, SCOPE_MAX_LENGTH), groupId: skill.groupId, links, key: "",
      all, nonCondition, score, status, notApplicableReason: reason, exempt,
      conditionOnly: links.every((link) => link.row.conditionOnly),
    });
  }

  /* ---- 4. deterministic keys ---- */
  const groupOrder = [...new Set(work.map((skill) => skill.groupId))].map((id) => groupsById.get(id)!)
    .sort((a, b) => compareText(a.name, b.name) || compareCode(a.id, b.id));
  const groupKey = new Map(groupOrder.map((group, index) => [group.id, `G${index + 1}`]));
  work.sort((a, b) => groupOrder.findIndex((group) => group.id === a.groupId) - groupOrder.findIndex((group) => group.id === b.groupId) ||
    compareText(a.name, b.name) || compareCode(a.skillId, b.skillId));
  const career = inputs.career;
  const careerOnly = new Map<string, string>();
  for (const requirement of career?.requirements ?? []) {
    if (requirement.skillId && requirement.skillName && !linksBySkill.has(requirement.skillId)) careerOnly.set(requirement.skillId, requirement.skillName);
  }
  const careerOnlyOrdered = [...careerOnly].sort(([idA, nameA], [idB, nameB]) => compareText(nameA, nameB) || compareCode(idA, idB));
  const keyWidth = Math.max(2, String(work.length + careerOnlyOrdered.length).length);
  const makeKey = (index: number) => `S${String(index + 1).padStart(keyWidth, "0")}`;
  work.forEach((skill, index) => { skill.key = makeKey(index); });
  const skillKeyById = new Map<string, string>(work.map((skill) => [skill.skillId, skill.key]));
  careerOnlyOrdered.forEach(([skillId], index) => skillKeyById.set(skillId, makeKey(work.length + index)));
  const careerSkillIds = new Set((career?.requirements ?? []).map((requirement) => requirement.skillId).filter((id): id is string => Boolean(id)));

  const evidenceRows = (skill: SkillWork): SkillEvidenceRow[] => {
    const rank: Record<EvidenceRole, number> = { score: 0, exempt: 1, studied: 2, in_progress: 3, planned: 4, not_chosen: 5 };
    return skill.links.filter((link) => link.row.applicable).map(({ row, weight }) => {
      const role: EvidenceRole = row.score10 !== null && row.state !== "exempt" ? "score" : row.state === "exempt" ? "exempt"
        : isStudiedState(row.state) ? "studied" : row.state === "in_progress" ? "in_progress" : notChosen(row) ? "not_chosen" : "planned";
      const contribution = row.credits * weight;
      const group = row.electiveCode ? electiveStates.get(row.electiveCode) : undefined;
      // Unchosen options of a quota group only enter the denominator through the remaining quota.
      const counted = role !== "not_chosen" && (!group || group.remaining === null || isAttemptedState(row.state));
      return {
        code: row.code, weight: round(weight, 4), contribution: round(contribution, 4),
        share: counted && skill.all.den > 0 ? round(contribution / skill.all.den, 4) : null, role,
      };
    }).sort((a, b) => rank[a.role] - rank[b.role] || b.contribution - a.contribution || compareCode(a.code, b.code));
  };

  const skills: SkillResult[] = work.map((skill) => {
    const coverage = skill.all.den > 0 ? Math.min(1, Math.max(0, skill.all.num / skill.all.den)) : null;
    const hasEvidence = skill.status === "scored" || skill.status === "exempt_only";
    const level = levelOf(skill.score, skill.status === "exempt_only");
    const confidence = hasEvidence ? confidenceOf(coverage, skill.all.num) : null;
    const group = groupsById.get(skill.groupId)!;
    return {
      key: skill.key, skillId: skill.skillId, name: skill.name, groupKey: groupKey.get(skill.groupId)!, groupId: skill.groupId,
      groupName: group.name, scope: skill.scope,
      score: skill.score === null ? null : floorScore(skill.score), level, levelLabel: LEVEL_LABELS[level],
      confidence, confidenceLabel: confidence ? CONFIDENCE_LABELS[confidence] : null,
      coverage: coverage === null ? null : round(coverage, 4), evidence: round(skill.all.num, 4), denominator: round(skill.all.den, 4),
      status: skill.status, notApplicableReason: skill.notApplicableReason, conditionOnly: skill.conditionOnly,
      careerSkill: careerSkillIds.has(skill.skillId), evidenceCourses: evidenceRows(skill),
      otherSpecialtyCourses: skill.links.filter((link) => !link.row.applicable).map((link) => link.row.code).sort(compareCode),
    };
  });
  // Rank on unrounded values; keys break ties.
  const rawScore = new Map(work.map((skill) => [skill.key, { score: skill.score, evidence: skill.all.num, key: skill.key }]));
  skills.sort((a, b) => compareSkills(rawScore.get(a.key)!, rawScore.get(b.key)!));

  /* ---- 5. groups and overall, condition-only courses excluded (§7.4) ---- */
  const summary = (exp: Exposure) => {
    const score = exp.scoreDen > 0 ? snapScore(10 * exp.scoreNum / exp.scoreDen) : null;
    const coverage = exp.den > 0 ? Math.min(1, Math.max(0, exp.num / exp.den)) : null;
    const level = levelOf(score, exp.exempt > 0);
    const confidence = score !== null || exp.exempt > 0 ? confidenceOf(coverage, exp.num) : null;
    return { score, coverage, level, confidence };
  };
  const totalExposure = emptyExposure();
  const groupResults: (GroupResult & { rawScore: number | null })[] = groupOrder.map((group) => {
    const members = work.filter((skill) => skill.groupId === group.id);
    const pooled = emptyExposure();
    for (const skill of members) addExposure(pooled, skill.nonCondition);
    addExposure(totalExposure, pooled);
    const result = summary(pooled);
    // Same rule as overall.basis: condition-only and not-applicable skills are not counted.
    const counted = members.filter((skill) => !skill.conditionOnly && skill.status !== "not_applicable");
    return {
      key: groupKey.get(group.id)!, id: group.id, name: group.name, rawScore: result.score,
      score: result.score === null ? null : floorScore(result.score), level: result.level, levelLabel: LEVEL_LABELS[result.level],
      confidence: result.confidence, confidenceLabel: result.confidence ? CONFIDENCE_LABELS[result.confidence] : null,
      coverage: result.coverage === null ? null : round(result.coverage, 4), evidence: round(pooled.num, 4),
      skillCount: counted.length, skillsWithEvidence: counted.filter((skill) => skill.status === "scored" || skill.status === "exempt_only").length,
    };
  });
  const scoredGroups = groupResults.filter((group) => group.rawScore !== null);
  const overallScore = scoredGroups.length ? snapScore(scoredGroups.reduce((sum, group) => sum + group.rawScore!, 0) / scoredGroups.length) : null;
  const overallSummary = summary(totalExposure);
  const overallLevel = levelOf(overallScore, totalExposure.exempt > 0);
  const overallConfidence = overallScore !== null || totalExposure.exempt > 0 ? overallSummary.confidence : null;
  const countedSkills = work.filter((skill) => !skill.conditionOnly);
  const evidenceCourseCodes = new Set(countedSkills.flatMap((skill) => skill.links)
    .filter((link) => !link.row.conditionOnly && isStudiedState(link.row.state)).map((link) => link.row.code));
  const overall = {
    score: overallScore === null ? null : floorScore(overallScore), level: overallLevel, levelLabel: LEVEL_LABELS[overallLevel],
    confidence: overallConfidence, confidenceLabel: overallConfidence ? CONFIDENCE_LABELS[overallConfidence] : null,
    coverage: overallSummary.coverage === null ? null : round(overallSummary.coverage, 4), evidence: round(totalExposure.num, 4),
    groupsWithScore: scoredGroups.length,
    basis: {
      skillsWithEvidence: countedSkills.filter((skill) => skill.status === "scored" || skill.status === "exempt_only").length,
      applicableSkills: countedSkills.filter((skill) => skill.status !== "not_applicable").length,
      evidenceCourses: evidenceCourseCodes.size,
    },
  };
  const groups: GroupResult[] = groupResults.map(({ rawScore: _raw, ...group }) => group);

  /* ---- 6. prerequisites (3 states) and terms (§7.7) ---- */
  const relationsByCourse = new Map<string, AssessmentInputs["curriculum"]["relations"]>();
  const relations = [...inputs.curriculum.relations].sort((a, b) =>
    compareCode(courseKey(a.courseCode), courseKey(b.courseCode)) || compareCode(a.kind, b.kind) || compareCode(a.raw, b.raw));
  for (const relation of relations) {
    const code = courseKey(relation.courseCode);
    relationsByCourse.set(code, [...(relationsByCourse.get(code) ?? []), relation]);
  }
  const reviewNote = (raw: string) => trimText(raw, SCOPE_MAX_LENGTH);
  const eligibilityOf = (code: string): { eligibility: Eligibility; missing: PrerequisiteGap[]; reviewNotes: string[] } => {
    const missing: PrerequisiteGap[] = [], reviewNotes: string[] = [];
    for (const relation of relationsByCourse.get(code) ?? []) {
      const targetsAll = relation.targetCodes.map(courseKey);
      let targets: string[];
      const blocks = specialtyBlocks(relation.raw);
      if (blocks) {
        const block = specialty ? blocks.get(specialty) : undefined;
        targets = block ? referencedCourseCodes(block, relation.targetCodes).map(courseKey).filter((target) => targetsAll.includes(target)) : [];
        if (!targets.length) {
          reviewNotes.push(specialty ? reviewNote(relation.raw) : "Điều kiện phụ thuộc chuyên ngành; bạn chưa chọn chuyên ngành.");
          continue;
        }
      } else if (relation.reviewRequired || relation.unresolvedCodes.length) {
        reviewNotes.push(reviewNote(relation.raw));
        continue;
      } else targets = targetsAll;
      for (const target of targets) {
        const state = stateOf(target);
        const met = relation.kind === "prerequisite" ? isPassedState(state) : isAttemptedState(state);
        if (!met && !missing.some((gap) => gap.code === target && gap.kind === relation.kind)) {
          missing.push({ code: target, name: table.get(target)?.name ?? null, kind: relation.kind });
        }
      }
    }
    return { eligibility: missing.length ? "not_eligible" : reviewNotes.length ? "review" : "eligible", missing, reviewNotes };
  };
  const supportCourse = (row: Row, weight: number, kind: SupportCourse["kind"], threshold: number): SupportCourse => {
    const eligibility = kind === "improve" ? { eligibility: "eligible" as const, missing: [], reviewNotes: [] } : eligibilityOf(row.code);
    const contribution = row.credits * weight;
    return {
      code: row.code, name: row.name, credits: row.credits, weight: round(weight, 4), contribution: round(contribution, 4), kind,
      state: row.state, score10: row.score10, letter: row.letter, ...eligibility, eligibilityLabel: ELIGIBILITY_LABELS[eligibility.eligibility],
      term: row.plannedTerm, termSource: row.plannedTermSource, termLabel: row.plannedTerm ?? "Chưa xếp lịch", electiveGroup: row.electiveCode,
      reason: kind === "improve" && row.score10 !== null
        ? `Đã đạt nhưng điểm học phần ${vn(row.score10 * 10)}/100 thấp hơn ngưỡng ${threshold}`
        : `${vn(row.credits)} tín chỉ × trọng số ${vn(weight)} cho kỹ năng này`,
    };
  };
  const byContribution = (a: Link, b: Link) => b.row.credits * b.weight - a.row.credits * a.weight || compareCode(a.row.code, b.row.code);
  /** Applicable courses still to study (a failed one is a retake), elective quota left; with prerequisites and term. */
  const takeCourses = (links: readonly Link[], threshold: number) =>
    links.filter((link) => link.row.applicable && !notChosen(link.row) && !isPassedState(link.row.state)).sort(byContribution)
      .slice(0, MAX_SUPPORT_COURSES).map((link) => supportCourse(link.row, link.weight, "take", threshold));
  /** Passed courses whose own score is below the threshold (học cải thiện); never a condition-only course. */
  const improveCourses = (links: readonly Link[], threshold: number) =>
    links.filter((link) => link.row.state === "passed" && link.row.score10 !== null && !link.row.conditionOnly && link.row.score10 * 10 < threshold)
      .sort(byContribution).slice(0, MAX_SUPPORT_COURSES).map((link) => supportCourse(link.row, link.weight, "improve", threshold));

  /* ---- 7. career gaps and fit (§7.5, §7.6) ---- */
  const workById = new Map(work.map((skill) => [skill.skillId, skill]));
  let careerResult: CareerResult | null = null;
  const selfStudy: SelfStudyItem[] = [];
  if (career) {
    const rows: CareerRequirementResult[] = career.requirements.map((requirement) => {
      const isRequired = requirement.isRequired;
      const threshold = isRequired ? CAREER_THRESHOLDS.required : CAREER_THRESHOLDS.preferred;
      const coefficient = isRequired ? CAREER_COEFFICIENTS.required : CAREER_COEFFICIENTS.preferred;
      const skill = requirement.skillId ? workById.get(requirement.skillId) : undefined;
      const skillKey = requirement.skillId && requirement.skillName ? skillKeyById.get(requirement.skillId) ?? null : null;
      const base = {
        requirementId: requirement.id, title: requirement.title, skillId: requirement.skillId, skillKey,
        skillName: skill?.name ?? requirement.skillName, groupKey: skill ? groupKey.get(skill.groupId)! : null,
        isRequired, priorityLabel: isRequired ? "Bắt buộc" : "Ưu tiên", coefficient, threshold,
      };
      const applicableLinks = skill?.links.filter((link) => link.row.applicable) ?? [];
      let status: GapStatus;
      let noDataReason: CareerRequirementResult["noDataReason"] = null;
      let upcomingTerm: string | null = null;
      if (!requirement.skillId || !requirement.skillName) { status = "no_data"; noDataReason = "no_skill"; }
      else if (!skill) { status = "no_data"; noDataReason = "not_measured"; }
      else if (!applicableLinks.length) { status = "no_data"; noDataReason = "other_specialty"; }
      else if (skill.score !== null) status = skill.score >= threshold ? "met" : "below";
      else if (skill.exempt) status = "met";
      else {
        const pending = applicableLinks.map((link) => link.row).filter((row) => !notChosen(row) && !isStudiedState(row.state));
        const future = (row: Row) => row.state === "in_progress" || (row.plannedTerm !== null && (currentTerm === null || row.plannedTerm > currentTerm));
        if (pending.length && pending.every(future)) {
          status = "upcoming";
          upcomingTerm = pending.map((row) => (row.state === "in_progress" ? row.attemptTerm ?? row.plannedTerm : row.plannedTerm))
            .filter((term): term is string => term !== null).sort(compareCode)[0] ?? null;
        } else status = "not_studied";
      }
      const score = skill?.score ?? null;
      const deficit = status === "below" && score !== null ? threshold - score : null;
      const band: DeficitBand | null = deficit !== null ? deficitBand(deficit) : status === "not_studied" ? "not_studied" : null;
      const level = skill ? levelOf(skill.score, skill.status === "exempt_only") : null;
      const coverage = skill && skill.all.den > 0 ? Math.min(1, skill.all.num / skill.all.den) : null;
      const take = CAREER_GAP_STATUSES.has(status) ? takeCourses(applicableLinks, threshold) : [];
      const improve = status === "below" ? improveCourses(skill?.links ?? [], threshold) : [];
      let selfStudyReason: SelfStudyReason | null = null;
      if (status === "no_data" && skillKey) selfStudyReason = noDataReason === "other_specialty" ? "other_specialty" : "not_measured";
      else if (status === "not_studied" && applicableLinks.every((link) => notChosen(link.row))) selfStudyReason = "elective_quota_used";
      // An improve course is still a course to study for a below skill (spec §7.7), so it is not "no course left".
      else if (!take.length && (status === "not_studied" || (status === "below" && !improve.length))) selfStudyReason = "no_course_left";
      if (selfStudyReason && skillKey) {
        selfStudy.push({
          skillKey, skillId: requirement.skillId, name: skill?.name ?? requirement.skillName ?? requirement.title, reason: selfStudyReason,
          reasonLabel: SELF_STUDY_REASON_LABELS[selfStudyReason], requirementTitle: requirement.title, isRequired, status,
          relatedSkillKeys: [], otherSpecialtyCourses: skill ? skill.links.filter((link) => !link.row.applicable).map((link) => link.row.code).sort(compareCode) : [],
        });
      }
      return {
        ...base, score: score === null ? null : floorScore(score), level, levelLabel: level ? LEVEL_LABELS[level] : null,
        confidence: skill && (skill.status === "scored" || skill.status === "exempt_only") ? confidenceOf(coverage, skill.all.num) : null,
        status, statusLabel: GAP_STATUS_LABELS[status], deficit: deficit === null ? null : round(deficit),
        deficitBand: band, deficitBandLabel: band ? DEFICIT_BAND_LABELS[band] : null,
        fitCredit: (() => { const value = fitCredit(status, score, threshold); return value === null ? null : round(value, 4); })(),
        exemptOnly: status === "met" && score === null, upcomingTerm, noDataReason,
        supportCourses: take, improveCourses: improve, selfStudy: Boolean(selfStudyReason && skillKey),
      };
    });
    const rank: Record<GapStatus, number> = { not_studied: 0, below: 1, upcoming: 2, no_data: 3, met: 4 };
    rows.sort((a, b) => Number(b.isRequired) - Number(a.isRequired) || rank[a.status] - rank[b.status] ||
      (b.deficit ?? 0) - (a.deficit ?? 0) || compareCode(a.skillKey ?? "~", b.skillKey ?? "~") || compareText(a.title, b.title) ||
      compareCode(a.requirementId, b.requirementId));
    const count = (status: GapStatus) => rows.filter((row) => row.status === status).length;
    const totalCoefficient = rows.reduce((sum, row) => sum + row.coefficient, 0);
    const included = rows.filter((row) => row.status === "met" || row.status === "below" || row.status === "not_studied");
    const includedCoefficient = included.reduce((sum, row) => sum + row.coefficient, 0);
    const fitRaw = includedCoefficient > 0
      ? included.reduce((sum, row) => sum + row.coefficient * (fitCredit(row.status, workById.get(row.skillId ?? "")?.score ?? null, row.threshold) ?? 0), 0) / includedCoefficient
      : null;
    const dataShare = totalCoefficient > 0 ? includedCoefficient / totalCoefficient : 0;
    const fitCode = fitCodeOf(fitRaw, dataShare);
    const scoredRows = rows.filter((row) => row.skillId && workById.get(row.skillId)?.score != null);
    const meanCoefficient = scoredRows.reduce((sum, row) => sum + row.coefficient, 0);
    const counts = {
      total: rows.length, met: count("met"), below: count("below"), upcoming: count("upcoming"), notStudied: count("not_studied"),
      noData: count("no_data"), withData: rows.length - count("no_data"),
    };
    careerResult = {
      id: career.id, code: career.code, nameVi: career.nameVi, nameEn: career.nameEn, deleted: career.deleted, requirements: rows, counts,
      summaryText: `Đạt ${counts.met}/${counts.total} kỹ năng · ${counts.upcoming} sắp học · ${counts.noData} chưa đủ dữ liệu`,
      dataText: `${counts.withData}/${counts.total} kỹ năng có dữ liệu`,
      fit: fitRaw === null ? null : round(fitRaw, 4), fitCode, fitLabel: FIT_LABELS[fitCode], dataShare: round(dataShare, 4),
      weightedMeanScore: meanCoefficient > 0
        ? floorScore(snapScore(scoredRows.reduce((sum, row) => sum + row.coefficient * workById.get(row.skillId!)!.score!, 0) / meanCoefficient)) : null,
      weightedMeanCount: scoredRows.length,
    };
    if (career.deleted) {
      warn("career_deleted", `Nghề mục tiêu ${career.code} – ${career.nameVi} hiện không còn trong danh mục nghề.`,
        "Mức phù hợp nghề chỉ để tham khảo; hãy chọn lại nghề mục tiêu trong hồ sơ.");
    }
  }

  // Required first, then by key; one item per skill.
  selfStudy.sort((a, b) => Number(b.isRequired) - Number(a.isRequired) || compareCode(a.skillKey, b.skillKey));
  for (let index = selfStudy.length - 1; index > 0; index--) {
    if (selfStudy.findIndex((item) => item.skillKey === selfStudy[index]!.skillKey) < index) selfStudy.splice(index, 1);
  }
  // Self-study context: measured skills with a similar name, never merged automatically.
  for (const item of selfStudy) {
    const tokens = nameTokens(item.name);
    item.relatedSkillKeys = work.filter((skill) => skill.skillId !== item.skillId)
      .map((skill) => ({ key: skill.key, shared: [...nameTokens(skill.name)].filter((token) => tokens.has(token)).length }))
      .filter((entry) => entry.shared > 0).sort((a, b) => b.shared - a.shared || compareCode(a.key, b.key))
      .slice(0, MAX_RELATED_SKILLS).map((entry) => entry.key);
  }

  /* ---- 8. course suggestions merged over all career gaps ---- */
  const merged = new Map<string, CourseSuggestion>();
  for (const row of careerResult?.requirements ?? []) {
    for (const course of [...row.supportCourses, ...row.improveCourses]) {
      const id = `${course.kind}:${course.code}`;
      const { reason: _reason, ...rest } = course;
      const entry = merged.get(id) ?? { ...rest, skills: [], priority: 0, reason: "" };
      if (row.skillKey && !entry.skills.some((skill) => skill.key === row.skillKey)) entry.skills.push({ key: row.skillKey, status: row.status });
      entry.priority += row.coefficient * course.contribution;
      merged.set(id, entry);
    }
  }
  const nameByKey = new Map<string, string>([...work.map((skill) => [skill.key, skill.name] as const), ...careerOnlyOrdered.map(([id, name]) => [skillKeyById.get(id)!, name] as const)]);
  const courseSuggestions = [...merged.values()].map((entry) => ({
    ...entry, priority: round(entry.priority, 4),
    reason: `${entry.kind === "improve" ? "Học cải thiện cho" : "Hỗ trợ"} ${entry.skills.length} kỹ năng của nghề: ${entry.skills.map((skill) => nameByKey.get(skill.key) ?? skill.key).join(", ")}`,
  })).sort((a, b) => b.priority - a.priority || (a.kind === b.kind ? 0 : a.kind === "take" ? -1 : 1) || compareCode(a.code, b.code));

  /* ---- 9. training-plan progress (§7.8) ---- */
  let progress: AssessmentResult["progress"] = null;
  if (planRevision) {
    const planCourses = new Map<string, PlanCourseInfo>([...table.values()].map((row) => [row.code, {
      code: row.code, name: row.name, credits: row.credits, state: row.state, applicable: row.applicable, electiveCode: row.electiveCode,
    }]));
    const peGroups = Object.values(planRevision.physicalEducationGroups ?? {}).some((codes) => codes.length)
      ? planRevision.physicalEducationGroups : physicalEducationGroupsFor(curriculumCourses);
    progress = planProgress({ plan: planRevision.data, physicalEducationGroups: peGroups, currentTerm, courses: planCourses, quotas });
  }

  /* ---- 10. graduation (§7.9): the graduation page's engine, inputs built like graduationInputs() ---- */
  const curriculumCredits = new Map([...table.values()].map((row) => [row.code, row.credits]));
  const graduation = assessGraduation({
    resolution: inputs.graduation.resolution, standard: graduationStandard, transcript, records,
    programCredits: programCreditMap(standardData, curriculumCredits), electives, conditionCodes,
  });

  /* ---- 11. transcript summary and warnings (§5, §7.10) ---- */
  const recordList = [...records.values()];
  const creditCheck = creditCrossCheck(transcript, records, curriculumCredits, conditionCodes);
  const inferredCount = recordList.filter((record) => record.inferred).length;
  const needsReview = Boolean(transcript.ocr?.needsReview);
  const transcriptSummary = {
    parserVersion: transcript.parserVersion, latestTerm: currentTerm, courseCount: records.size,
    inCurriculum: recordList.filter((record) => table.has(record.code)).length,
    passed: recordList.filter((record) => record.state === "passed").length,
    failed: recordList.filter((record) => record.state === "failed").length,
    exempt: recordList.filter((record) => record.state === "exempt").length,
    gradedUnknown: recordList.filter((record) => record.state === "graded_unknown").length,
    inProgress: recordList.filter((record) => record.state === "in_progress").length,
    inferredCount, needsReview, creditCheck,
    notInCurriculum: recordList.filter((record) => !table.has(record.code)).sort((a, b) => compareCode(a.code, b.code)).map((record) => ({
      code: record.code, name: inputs.catalogNames?.[record.code] ?? null, credits: record.selected.credits,
      letter: record.selected.letter, state: record.state as CourseState,
    })),
  };
  const creditSentence = creditCheck.status === "unavailable"
    ? "Bảng điểm không in “Tổng số tín chỉ tích lũy” để đối chiếu."
    : `Đối chiếu: tổng tín chỉ các học phần đạt (trừ môn điều kiện) là ${vn(creditCheck.computed)}, ${creditCheck.status === "match" ? "khớp với" : "khác với"} “Tổng số tín chỉ tích lũy” in trên bảng điểm (${vn(creditCheck.printed ?? 0)}).`;
  if (inferredCount) {
    warn("results_inferred", `Kết quả Đạt/Không đạt của ${inferredCount} học phần được suy ra từ điểm chữ vì ô “Kết quả” trên bảng điểm để trống. ${creditSentence}`,
      creditCheck.status === "mismatch"
        ? "Tổng tín chỉ không khớp nên trạng thái đạt của một số học phần, tiến độ và xét tốt nghiệp có thể chưa chính xác; hãy đối chiếu với PDF gốc."
        : "Nếu điểm chữ bị đọc sai, trạng thái đạt của học phần, tiến độ và xét tốt nghiệp có thể chưa chính xác.");
  } else if (creditCheck.status === "mismatch") {
    warn("credits_mismatch", `Tổng tín chỉ các học phần đạt (trừ môn điều kiện) là ${vn(creditCheck.computed)}, khác với “Tổng số tín chỉ tích lũy” in trên bảng điểm (${vn(creditCheck.printed ?? 0)}).`,
      "Một số kết quả có thể bị đọc sai; hãy đối chiếu bảng điểm với PDF gốc.");
  }
  if (needsReview) {
    warn("transcript_needs_review", "Bảng điểm được nhận dạng tự động (OCR) và đang được đánh dấu cần rà soát.",
      "Điểm hoặc kết quả của một số học phần có thể bị đọc sai; hãy đối chiếu với PDF gốc.");
  }
  if (inputs.weights.revisionId !== inputs.curriculum.revisionId) {
    warn("weights_revision_differs", `Trọng số kỹ năng lấy từ CTĐT phiên bản ${inputs.weights.version}, khác phiên bản hiện hành ${inputs.curriculum.version}.`,
      "Học phần được khớp theo mã, tín chỉ lấy theo CTĐT hiện hành; học phần mới hoặc đã đổi mã có thể chưa được tính.");
  }
  if (table.size && weightsCoverage.share < MIN_WEIGHTED_COURSE_SHARE) {
    warn("weights_coverage_low", `Chỉ ${weightsCoverage.weightedCourses}/${weightsCoverage.curriculumCourses} học phần (${vn(weightsCoverage.share * 100, 1)}%) trong CTĐT có cấu hình trọng số kỹ năng.`,
      "Một số kỹ năng có thể thiếu minh chứng hoặc điểm chưa phản ánh đầy đủ kết quả học tập.");
  }
  if (unknownSpecialtyValues.size) {
    warn("specialty_value_unknown", "CTĐT có giá trị chuyên ngành chưa nhận diện được.",
      "Các học phần này được coi là học phần chung.", [...unknownSpecialtyValues].sort(compareText));
  }
  if (specialty && ![...table.values()].some((row) => row.specialty.kind === "specialty" && row.specialty.code === specialty)) {
    warn("specialty_not_in_curriculum", `CTĐT khóa ${inputs.student.cohortCode} không có học phần riêng của chuyên ngành ${specialtyLabel(specialty)}.`,
      "Chỉ các học phần chung và học phần bạn đã học được dùng để đánh giá.");
  }
  const counts = specialtyCounts([...table.values()].map((row) => ({ type: row.type, specialty: row.specialty, passed: isPassedState(row.state) })));
  const conflict = specialty ? specialtyConflict(specialty, counts) : null;
  if (specialty && conflict) {
    warn("specialty_conflict", `Chuyên ngành đã chọn (${specialtyLabel(specialty)}) khác với các học phần chuyên ngành bạn đã đạt (${specialtyLabel(conflict.code)}: ${conflict.count} học phần).`,
      "Tập học phần áp dụng, tiêu chuẩn tốt nghiệp và tiến độ có thể không đúng; hãy kiểm tra lại chuyên ngành trong hồ sơ.");
  }
  if (!graduationStandard) {
    warn("graduation_standard_unresolved", graduation.reason ?? "Chưa xác định được tiêu chuẩn xét tốt nghiệp.",
      "Phần xét tốt nghiệp ở trạng thái chưa xác định; hạn mức nhóm tự chọn lấy theo CTĐT.");
  }
  if (quotaUnknownGroups.length) {
    warn("elective_quota_unknown", `Chưa xác định được số tín chỉ phải chọn của nhóm tự chọn ${quotaUnknownGroups.join(", ")}.`,
      "Độ phủ của kỹ năng thuộc các nhóm này tính trên toàn bộ học phần tự chọn nên có thể thấp hơn thực tế.", quotaUnknownGroups);
  }
  if (!planRevision) {
    const ambiguous = inputs.plan.resolution === "ambiguous";
    warn(ambiguous ? "plan_ambiguous" : "plan_unavailable",
      ambiguous ? `Có nhiều kế hoạch đào tạo cùng áp dụng cho khóa ${inputs.student.cohortCode}.` : `Chưa có kế hoạch đào tạo đang áp dụng cho khóa ${inputs.student.cohortCode}.`,
      "Không tính tiến độ so với kế hoạch; học kỳ của học phần lấy theo CTĐT.");
  }
  if (progress?.countMismatches.length) {
    warn("plan_section_count_mismatch", "Một số nhóm lựa chọn trong kế hoạch đào tạo có số môn khác số ghi trên nhãn.",
      "Tiến độ của các nhóm này dựa trên các môn thực có trong kế hoạch.",
      progress.countMismatches.map((item) => `${item.termCode}: “${item.label}” có ${item.actual} môn`));
  }

  /* ---- 12. highlights, prompt selection, course plans, directory, meta ---- */
  const ranked = skills.filter((skill) => skill.status === "scored" && !skill.conditionOnly);
  const belowGood = (skill: SkillResult) => rawScore.get(skill.key)!.score! < LEVEL_THRESHOLDS.good;
  /** Unrounded score ascending, evidence descending, key. */
  const weakestFirst = (a: SkillResult, b: SkillResult) =>
    rawScore.get(a.key)!.score! - rawScore.get(b.key)!.score! || rawScore.get(b.key)!.evidence - rawScore.get(a.key)!.evidence || compareCode(a.key, b.key);
  const strengths = ranked.filter((skill) => !belowGood(skill)).slice(0, HIGHLIGHT_COUNT).map((skill) => skill.key);
  const improvements = ranked.filter(belowGood).sort(weakestFirst).slice(0, HIGHLIGHT_COUNT).map((skill) => skill.key);
  // comp-calc-v6: courses for the weak skills that no career gap covers (a career gap has its own).
  const careerGapIds = new Set((careerResult?.requirements ?? []).filter((row) => CAREER_GAP_STATUSES.has(row.status))
    .map((row) => row.skillId).filter((id): id is string => id !== null));
  const linksByKey = new Map(work.map((skill) => [skill.key, skill.links]));
  const skillPlans: SkillPlan[] = ranked.filter((skill) => belowGood(skill) && !careerGapIds.has(skill.skillId)).sort(weakestFirst)
    .slice(0, MAX_SKILL_PLANS).map((skill) => {
      const links = linksByKey.get(skill.key) ?? [];
      const take = takeCourses(links, LEVEL_THRESHOLDS.good);
      const improve = improveCourses(links, LEVEL_THRESHOLDS.good);
      return {
        skillKey: skill.key, skillId: skill.skillId, name: skill.name, groupKey: skill.groupKey, score: skill.score!,
        level: skill.level, levelLabel: skill.levelLabel, careerSkill: skill.careerSkill, take, improve, selfStudy: !take.length && !improve.length,
      };
    });
  const careerSkillKeys = [...new Set((careerResult?.requirements ?? []).map((row) => row.skillKey).filter((key): key is string => key !== null))];
  const rest = ranked.filter((skill) => !careerSkillKeys.includes(skill.key));
  const topSkillKeys = rest.slice(0, HIGHLIGHT_COUNT).map((skill) => skill.key);
  const bottomSkillKeys = rest.slice(-HIGHLIGHT_COUNT).map((skill) => skill.key).filter((key) => !topSkillKeys.includes(key));
  const skillDirectory = [
    ...work.map((skill) => ({ key: skill.key, skillId: skill.skillId, name: skill.name, measured: true })),
    ...careerOnlyOrdered.map(([skillId, name]) => ({ key: skillKeyById.get(skillId)!, skillId, name, measured: false })),
  ].sort((a, b) => compareCode(a.key, b.key));

  const courses: CourseFact[] = [...table.values()].sort((a, b) => compareCode(a.code, b.code)).map((row) => ({
    code: row.code, name: row.name, credits: row.credits, type: row.type,
    specialty: row.specialty.kind === "specialty" ? row.specialty.code : null, electiveGroup: row.electiveCode,
    conditionOnly: row.conditionOnly, applicable: row.applicable, state: row.state, outcome: row.outcome, inferred: row.inferred,
    score10: row.score10, letter: row.letter, attempts: row.attempts, term: row.attemptTerm,
    plannedTerm: row.plannedTerm, plannedTermSource: row.plannedTermSource,
  }));
  const standardMeta = graduationStandard;
  return {
    meta: {
      calcVersion: CALC_VERSION, promptVersion: inputs.promptVersion ?? null, transcriptVersion: inputs.transcript.version,
      cohortCode: inputs.student.cohortCode,
      curriculum: { id: inputs.curriculum.id, revisionId: inputs.curriculum.revisionId, version: inputs.curriculum.version },
      weights: {
        revisionId: inputs.weights.revisionId, version: inputs.weights.version, activeCount: inputs.weights.activeCount,
        maxConfigUpdatedAt: inputs.weights.maxConfigUpdatedAt,
      },
      graduationStandardId: standardMeta?.id ?? null, graduationStandardRevisionId: standardMeta?.revisionId ?? null,
      graduationStandardVersion: standardMeta?.version ?? null,
      planId: planRevision?.id ?? null, planRevisionId: planRevision?.revisionId ?? null, planVersion: planRevision?.version ?? null,
      career: career ? { id: career.id, version: career.version } : null,
      specialty,
    },
    student: { cohortCode: inputs.student.cohortCode, specialty, specialtyLabel: specialtyLabel(specialty) },
    transcript: transcriptSummary,
    weightsCoverage,
    courses,
    overall,
    groups,
    skills,
    skillDirectory,
    highlights: { strengths, improvements },
    promptSelection: { careerSkillKeys, topSkillKeys, bottomSkillKeys },
    career: careerResult,
    courseSuggestions,
    selfStudy,
    skillPlans,
    progress,
    graduation,
    warnings,
    specialtySuggestion: specialty ? null : suggestSpecialty(counts),
  };
}
