import { CALC_VERSION } from "../competency-assessment/constants.js";
import {
  courseKey, currentTermCode, estimateProgramCredits, isConditionOnly, isPassedState, printedCumulativeCredits,
} from "../competency-assessment/course-state.js";
import {
  assessGraduationStandard, countsInGpa, gpaAttempt, graduationInputs, standardCodesAmbiguous, standardCourseCredits, type GraduationInputs,
} from "../competency-assessment/graduation.js";
import type { CurriculumCourseInput, GraduationStandardInput } from "../competency-assessment/types.js";
import type { TranscriptData } from "../student/transcript-parser.js";
import type { GraduationData } from "./model.js";

// The graduation page's verdict (design §3), computed on the server from the same core as the
// competency assessment (assessGraduationStandard), so groups, credits and GPA are identical numbers.
// Pure: the DB loader (student-graduation.ts) reads the inputs. The web mirrors these types.

export type GradStatus = "pass" | "fail" | "unknown";
export type GradCourseState = "passed" | "exempt" | "failed" | "in_progress" | "graded_unknown" | "not_taken";

export interface GraduationCourseRow {
  /** courseKey(code) */
  code: string;
  /** Standard course name (as stored; may contain "(*)"). */
  name: string;
  /** E3: standard → CTĐT → transcript credit of the selected attempt (> 0) → null. */
  credits: number | null;
  conditionOnly: boolean;
  groupId: string;
  state: GradCourseState;
  /** The pass/fail state rests on a letter-grade inference. */
  inferred: boolean;
  /** Transcript attempts for this code (0 when not_taken). */
  attempts: number;
  /** Selected attempt (MT: null). */
  score10: number | null;
  score4: number | null;
  /** "MT" for an exemption. */
  letter: string | null;
  /** Selected attempt HKyyS; null for "Điểm bảo lưu" or not taken. */
  term: string | null;
}

export interface GraduationGroupEvaluation {
  id: string;
  name: string;
  /** E1 label (a repeated name adds its size and first code). */
  label: string;
  kind: "mandatory" | "elective";
  /** "TC306" from the name, else null. */
  code: string | null;
  /** CTĐT elective code with the same courses, e.g. "TC406". */
  curriculumElectiveCode: string | null;
  unit: "môn" | "TC";
  required: number | null;
  lower: number | null;
  upper: number | null;
  /** status !== "pass" && required !== null && lower !== null ? max(0, required − lower) : null */
  remaining: number | null;
  status: GradStatus;
  /** Standard group credits (informational). */
  minimumCredits: number | null;
  /** Certain, non-(*) credits. */
  accumulatedCredits: number | null;
  courseCount: number;
  passedCount: number;
  /** Every standard course of the group, in standard order. */
  courses: GraduationCourseRow[];
}

export type GraduationWarningCode =
  | "results_inferred" | "credits_mismatch" | "printed_credits_unreadable" | "ocr_needs_review" | "standard_ambiguous_codes";

export interface GraduationWarning {
  code: GraduationWarningCode;
  count?: number;
  printed?: number;
  computedLower?: number;
  computedUpper?: number;
}

export interface GraduationImprovementCandidate {
  code: string;
  name: string;
  /** E3 credits (> 0). */
  credits: number;
  /** Best grade on the GPA's scale: the grade the GPA estimate counts. */
  score: number;
  scale: 4 | 10;
  letter: string | null;
  /** "passed": retake to improve ("học cải thiện"); "failed", never passed: retake ("học lại"). */
  state: "passed" | "failed";
}

export interface GraduationEvaluation {
  calcVersion: string;
  status: GradStatus;
  groupStatus: GradStatus;
  /** Groups pass, GPA fails. */
  needsImprovement: boolean;
  asOf: { transcriptVersion: string; transcriptUpdatedAt: string; latestTerm: string | null };
  groups: GraduationGroupEvaluation[];
  /** Null when the standard has no minimumCredits. */
  credits: {
    lower: number | null; upper: number | null; required: number; status: GradStatus;
    source: "printed" | "calculated"; remaining: number | null;
  } | null;
  gpa: {
    actual: number | null; required: number | null; scale: 4 | 10; status: GradStatus;
    source: "printed" | "calculated" | null; reason: string; remaining: number | null;
  };
  creditCheck: { status: "match" | "mismatch" | "unavailable"; printed: number | null; computedLower: number; computedUpper: number };
  /** Only when gpa.status === "fail" (see improvementCandidates()). */
  improvementCandidates: GraduationImprovementCandidate[];
  /** Standard courses in progress (max MAX_LISTED_COURSES). */
  inProgress: GraduationCourseRow[];
  /** Standard courses graded with an unreadable result (max MAX_LISTED_COURSES). */
  unknownResults: GraduationCourseRow[];
  warnings: GraduationWarning[];
}

export type GraduationEvaluationInput = {
  /** The resolved standard (gpaScale already defaulted by the resolver; a missing one reads 4 anyway). */
  standard: Pick<GraduationStandardInput, "data">;
  transcript: { version: string; updatedAt: string; data: TranscriptData };
  /** Courses of the cohort's single active CTĐT, current revision; [] when it is missing or ambiguous. */
  curriculumCourses: readonly CurriculumCourseInput[];
};

export const MAX_IMPROVEMENT_CANDIDATES = 8;
export const MAX_LISTED_COURSES = 20;
/** Tolerance of the printed-credit range check (E7). */
const CREDIT_TOLERANCE = 1e-6;

type StandardCourse = GraduationData["courses"][number];

const compareCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function evaluateGraduation(input: GraduationEvaluationInput): GraduationEvaluation {
  const data = input.standard.data;
  const transcript = input.transcript.data;
  const core = graduationInputs(data, input.curriculumCourses, transcript);
  const { records, programCredits, conditionCodes } = core;
  const result = assessGraduationStandard(data, core);

  const row = (course: StandardCourse): GraduationCourseRow => {
    const code = courseKey(course.code);
    const record = records.get(code);
    const selected = record?.selected;
    const exempt = record?.state === "exempt";
    return {
      code, name: course.name, credits: standardCourseCredits(course, programCredits, record),
      conditionOnly: course.conditionOnly || isConditionOnly(code, conditionCodes), groupId: course.groupId,
      state: record?.state ?? "not_taken", inferred: record?.inferred ?? false, attempts: record?.attempts.length ?? 0,
      score10: selected && !exempt ? selected.score10 : null, score4: selected && !exempt ? selected.score4 : null,
      letter: selected?.letter ?? null, term: selected?.termCode ?? null,
    };
  };
  const rows = data.courses.map(row);
  // One row per code for the lists outside the groups (a code repeated in the standard is listed once).
  const listed = new Set<string>();
  const distinct = rows.filter((item) => !listed.has(item.code) && Boolean(listed.add(item.code)));

  const groups: GraduationGroupEvaluation[] = data.groups.map((group, index) => {
    const check = result.groups[index]!;
    const courses = rows.filter((item) => item.groupId === group.id);
    return {
      id: group.id, name: group.name, label: check.label, kind: group.kind, code: check.code,
      curriculumElectiveCode: check.curriculumElectiveCode, unit: check.unit,
      required: check.required, lower: check.lower, upper: check.upper,
      remaining: check.status !== "pass" && check.required !== null && check.lower !== null ? Math.max(0, check.required - check.lower) : null,
      status: check.status, minimumCredits: group.minimumCredits, accumulatedCredits: check.accumulatedCredits,
      courseCount: courses.length, passedCount: courses.filter((item) => isPassedState(item.state)).length, courses,
    };
  });

  const credits = result.credits && {
    ...result.credits,
    remaining: result.credits.status === "fail" && result.credits.lower !== null ? result.credits.required - result.credits.lower : null,
  };
  const gpa = {
    ...result.gpa,
    remaining: result.gpa.status === "fail" && result.gpa.actual !== null && result.gpa.required !== null ? result.gpa.required - result.gpa.actual : null,
  };

  // E7: the printed total matches when it lies within the program estimate's bounds.
  const estimate = estimateProgramCredits(records, programCredits, conditionCodes);
  const printedValue = printedCumulativeCredits(transcript);
  const printed = printedValue === null || Number.isNaN(printedValue) ? null : printedValue;
  const computedLower = estimate.certain, computedUpper = estimate.certain + estimate.unknown;
  const creditCheck: GraduationEvaluation["creditCheck"] = {
    status: printed === null ? "unavailable"
      : computedLower - CREDIT_TOLERANCE <= printed && printed <= computedUpper + CREDIT_TOLERANCE ? "match" : "mismatch",
    printed, computedLower, computedUpper,
  };

  const warnings: GraduationWarning[] = [];
  // Counted on the standard's courses: the rows the page marks "suy ra từ điểm chữ".
  const inferred = distinct.filter((item) => item.inferred).length;
  if (inferred) warnings.push({ code: "results_inferred", count: inferred });
  if (creditCheck.status === "mismatch") warnings.push({ code: "credits_mismatch", printed: printed!, computedLower, computedUpper });
  if (printedValue !== null && Number.isNaN(printedValue)) warnings.push({ code: "printed_credits_unreadable" });
  if (transcript.ocr?.needsReview) warnings.push({ code: "ocr_needs_review" });
  if (standardCodesAmbiguous(data)) warnings.push({ code: "standard_ambiguous_codes" });

  return {
    calcVersion: CALC_VERSION,
    status: result.status,
    groupStatus: result.groupStatus,
    needsImprovement: result.needsImprovement,
    asOf: { transcriptVersion: input.transcript.version, transcriptUpdatedAt: input.transcript.updatedAt, latestTerm: currentTermCode(transcript) },
    groups,
    credits,
    gpa,
    creditCheck,
    improvementCandidates: gpa.status === "fail" && gpa.required !== null ? improvementCandidates(data, core, gpa.required, gpa.scale) : [],
    inProgress: distinct.filter((item) => item.state === "in_progress").slice(0, MAX_LISTED_COURSES),
    unknownResults: distinct.filter((item) => item.state === "graded_unknown").slice(0, MAX_LISTED_COURSES),
    warnings,
  };
}

/**
 * Courses whose retake would raise a failing GPA (§3, revised): standard courses that count in the
 * GPA — not (*) or condition-only, no conditional or MT attempt, credits > 0, graded on the GPA's
 * scale — whose best grade on that scale, the grade the GPA estimate counts (gpaAttempt), is below
 * the required GPA: passed ones ("học cải thiện") and failed, never passed ones ("học lại"; the
 * estimate counts their F). A course retaken now (in progress) or graded without a readable result
 * is not listed. Lowest score first, then more credits, then code; at most MAX_IMPROVEMENT_CANDIDATES.
 */
function improvementCandidates(
  data: Pick<GraduationData, "courses">,
  core: GraduationInputs,
  required: number,
  scale: 4 | 10,
): GraduationImprovementCandidate[] {
  const seen = new Set<string>();
  const candidates: GraduationImprovementCandidate[] = [];
  for (const course of data.courses) {
    const code = courseKey(course.code);
    if (seen.has(code)) continue;
    seen.add(code);
    const record = core.records.get(code);
    const state = record?.state;
    if (!record || (state !== "passed" && state !== "failed") || course.conditionOnly || !countsInGpa(record, core.conditionCodes)) continue;
    const best = gpaAttempt(record, scale);
    const score = best ? (scale === 4 ? best.score4 : best.score10) : null;
    // A 0-credit attempt does not enter the GPA estimate.
    if (!best || score === null || score >= required || best.credits <= 0) continue;
    const credits = standardCourseCredits(course, core.programCredits, record) ?? best.credits;
    if (credits <= 0) continue;
    candidates.push({ code, name: course.name, credits, score, scale, letter: best.letter, state });
  }
  return candidates
    .sort((a, b) => a.score - b.score || b.credits - a.credits || compareCode(a.code, b.code))
    .slice(0, MAX_IMPROVEMENT_CANDIDATES);
}
