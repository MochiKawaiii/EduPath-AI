// The engine result with the model's validated numbers (ai_scoring, comp-ai-v1) merged in, so the pages and
// the commentary prompt show the AI's numbers. No score is computed here: levels and labels follow the AI's
// scores with the engine's thresholds, lists are re-sorted and re-counted, and the engine numbers the AI does
// not produce (confidence, coverage, the fit index) are cleared. History, progress, graduation, course facts
// and warnings stay the engine's.
import {
  compareSkills, DEFICIT_BAND_LABELS, deficitBand, FIT_LABELS, floorScore, GAP_STATUS_LABELS, LEVEL_LABELS, levelOf,
} from "../calculate.js";
import { HIGHLIGHT_COUNT, LEVEL_THRESHOLDS } from "../constants.js";
import type {
  AssessmentResult, CareerRequirementResult, CareerResult, DeficitBand, FitCode, GapStatus, GroupResult, SkillPlan, SkillResult,
} from "../types.js";
import { requirementKey } from "./scoring-prompt.js";
import type { AiScoring, ScoringFit } from "./scoring-validate.js";

const FIT_CODES: Record<ScoringFit, FitCode> = {
  phu_hop: "fit", kha_phu_hop: "fairly_fit", can_bo_sung_nhieu: "needs_more", chua_du_du_lieu: "insufficient_data",
};
const STATUS_RANK: Record<GapStatus, number> = { not_studied: 0, below: 1, upcoming: 2, no_data: 3, met: 4 };
const compareCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const hasEvidence = (skill: SkillResult) => skill.status === "scored" || skill.status === "exempt_only";

function mergeSkill(skill: SkillResult, aiScore: number | null): SkillResult {
  const level = levelOf(aiScore, aiScore === null && skill.status === "exempt_only");
  const status: SkillResult["status"] = aiScore !== null ? "scored" : skill.status === "scored" ? "no_evidence" : skill.status;
  return {
    ...skill, score: aiScore, level, levelLabel: LEVEL_LABELS[level], status,
    notApplicableReason: status === "not_applicable" ? skill.notApplicableReason : null,
    confidence: null, confidenceLabel: null, coverage: null,
  };
}

function mergeGroup(group: GroupResult, aiScore: number | null, members: readonly SkillResult[]): GroupResult {
  const level = levelOf(aiScore, aiScore === null && group.level === "exempt");
  // Same rule as calculate.ts: condition-only and not-applicable skills are not counted.
  const counted = members.filter((skill) => !skill.conditionOnly && skill.status !== "not_applicable");
  return {
    ...group, score: aiScore, level, levelLabel: LEVEL_LABELS[level], confidence: null, confidenceLabel: null, coverage: null,
    skillCount: counted.length, skillsWithEvidence: counted.filter(hasEvidence).length,
  };
}

function mergeRequirement(req: CareerRequirementResult, ai: AiScoring["career"][string] | undefined, skill: SkillResult | null): CareerRequirementResult {
  if (!ai) return req;
  const status: GapStatus = ai.status === "dat" ? "met" : ai.status === "duoi_nguong" ? "below"
    : req.status === "not_studied" || req.status === "upcoming" || req.status === "no_data" ? req.status : "not_studied";
  const score = skill?.score ?? null;
  const level = skill?.level ?? null;
  const deficit = status === "below" ? ai.deficit : null;
  const band: DeficitBand | null = deficit !== null ? deficitBand(deficit) : status === "not_studied" ? "not_studied" : null;
  return {
    ...req, score, level, levelLabel: level ? LEVEL_LABELS[level] : null, confidence: null, status, statusLabel: GAP_STATUS_LABELS[status],
    deficit, deficitBand: band, deficitBandLabel: band ? DEFICIT_BAND_LABELS[band] : null, fitCredit: null,
    exemptOnly: status === "met" && score === null, upcomingTerm: status === "upcoming" ? req.upcomingTerm : null,
  };
}

function mergeCareer(career: CareerResult | null, scoring: AiScoring, skillsByKey: ReadonlyMap<string, SkillResult>): CareerResult | null {
  if (!career) return null;
  // Y1, Y2 … were given in this (engine) order to the requirements that have a skill key.
  let index = 0;
  const rows = career.requirements.map((req) => req.skillKey === null ? req
    : mergeRequirement(req, scoring.career[requirementKey(index++)], skillsByKey.get(req.skillKey) ?? null));
  rows.sort((a, b) => Number(b.isRequired) - Number(a.isRequired) || STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    (b.deficit ?? 0) - (a.deficit ?? 0) || compareCode(a.skillKey ?? "~", b.skillKey ?? "~") || compareCode(a.title, b.title) ||
    compareCode(a.requirementId, b.requirementId));
  const count = (status: GapStatus) => rows.filter((row) => row.status === status).length;
  const counts = {
    total: rows.length, met: count("met"), below: count("below"), upcoming: count("upcoming"), notStudied: count("not_studied"),
    noData: count("no_data"), withData: rows.length - count("no_data"),
  };
  const scored = rows.filter((row) => row.score !== null);
  const coefficients = scored.reduce((sum, row) => sum + row.coefficient, 0);
  const fitCode = FIT_CODES[scoring.careerFit];
  return {
    ...career, requirements: rows, counts,
    summaryText: `Đạt ${counts.met}/${counts.total} kỹ năng · ${counts.upcoming} sắp học · ${counts.noData} chưa đủ dữ liệu`,
    dataText: `${counts.withData}/${counts.total} kỹ năng có dữ liệu`,
    fit: null, fitCode, fitLabel: FIT_LABELS[fitCode],
    weightedMeanScore: coefficients > 0 ? floorScore(scored.reduce((sum, row) => sum + row.coefficient * row.score!, 0) / coefficients) : null,
    weightedMeanCount: scored.length,
  };
}

/**
 * Course plans keep the engine's course lists; a plan stays only while the AI's score still calls for it
 * (strengthen: below Khá; deepen: a met career skill below Thành thạo) and shows the AI's score.
 */
function mergePlans(plans: readonly SkillPlan[] | undefined, skillsByKey: ReadonlyMap<string, SkillResult>, career: CareerResult | null): SkillPlan[] {
  const metCareerKeys = new Set((career?.requirements ?? []).filter((row) => row.status === "met").map((row) => row.skillKey));
  return (plans ?? []).flatMap((plan) => {
    const skill = skillsByKey.get(plan.skillKey);
    if (!skill || skill.score === null) return [];
    const keep = plan.purpose === "deepen"
      ? skill.score < LEVEL_THRESHOLDS.proficient && metCareerKeys.has(plan.skillKey)
      : skill.score < LEVEL_THRESHOLDS.good;
    return keep ? [{ ...plan, score: skill.score, level: skill.level, levelLabel: skill.levelLabel }] : [];
  });
}

export function mergeAiScoring(computed: AssessmentResult, scoring: AiScoring): AssessmentResult {
  const merged = computed.skills.map((skill) => mergeSkill(skill, scoring.skills[skill.key] ?? null));
  const skills = [...merged].sort((a, b) => compareSkills({ score: a.score, evidence: a.evidence, key: a.key }, { score: b.score, evidence: b.evidence, key: b.key }));
  const skillsByKey = new Map(skills.map((skill) => [skill.key, skill]));
  const groups = computed.groups.map((group) => mergeGroup(group, scoring.groups[group.key] ?? null, skills.filter((skill) => skill.groupKey === group.key)));
  const counted = skills.filter((skill) => !skill.conditionOnly);
  const overallLevel = levelOf(scoring.overall, scoring.overall === null && computed.overall.level === "exempt");
  const career = mergeCareer(computed.career, scoring, skillsByKey);

  // Highlights and the commentary prompt's selection, like calculate.ts but on the AI's scores.
  const ranked = skills.filter((skill) => skill.status === "scored" && !skill.conditionOnly);
  const belowGood = (skill: SkillResult) => skill.score! < LEVEL_THRESHOLDS.good;
  const weakestFirst = (a: SkillResult, b: SkillResult) => a.score! - b.score! || b.evidence - a.evidence || compareCode(a.key, b.key);
  const careerSkillKeys = computed.promptSelection.careerSkillKeys;
  const rest = ranked.filter((skill) => !careerSkillKeys.includes(skill.key));
  const topSkillKeys = rest.slice(0, HIGHLIGHT_COUNT).map((skill) => skill.key);

  return {
    ...computed,
    overall: {
      ...computed.overall, score: scoring.overall, level: overallLevel, levelLabel: LEVEL_LABELS[overallLevel],
      confidence: null, confidenceLabel: null, coverage: null,
      groupsWithScore: groups.filter((group) => group.score !== null).length,
      basis: {
        ...computed.overall.basis,
        skillsWithEvidence: counted.filter(hasEvidence).length,
        applicableSkills: counted.filter((skill) => skill.status !== "not_applicable").length,
      },
    },
    groups,
    skills,
    highlights: {
      strengths: ranked.filter((skill) => !belowGood(skill)).slice(0, HIGHLIGHT_COUNT).map((skill) => skill.key),
      improvements: ranked.filter(belowGood).sort(weakestFirst).slice(0, HIGHLIGHT_COUNT).map((skill) => skill.key),
    },
    promptSelection: {
      careerSkillKeys,
      topSkillKeys,
      bottomSkillKeys: rest.slice(-HIGHLIGHT_COUNT).map((skill) => skill.key).filter((key) => !topSkillKeys.includes(key)),
    },
    career,
    skillPlans: mergePlans(computed.skillPlans, skillsByKey, career),
  };
}
