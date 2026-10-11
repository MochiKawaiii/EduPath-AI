import type { GraduationData } from "./graduation-types";
import type { Transcript } from "./StudentTranscript";
import { transcriptCreditCheck, transcriptOutcomes, transcriptResults } from "./transcript-results";
import { assessGraduationGpa, graduationCourseScores } from "./graduation-scores";

type Standard = Pick<GraduationData, "minimumGpa" | "gpaScale"> & Partial<Pick<GraduationData, "minimumCredits">> & {
  groups: Omit<GraduationData["groups"][number], "sourceRow">[];
  courses: Omit<GraduationData["courses"][number], "sourceRow">[];
};
type Status = "pass" | "fail" | "unknown";
export type GraduationCheck = {
  groupId: string;
  label: string;
  /** Known passes (courses or credits): the lower bound. */
  actual: number | null;
  /** Known passes plus graded courses whose result cannot be read: the upper bound. */
  possible: number | null;
  required: number | null;
  unit: "môn" | "TC";
  accumulatedCredits: number | null;
  /** Graded courses in the group whose result cannot be read. */
  unknownCourses: number;
  /** Some counted pass comes from a letter grade. */
  inferred: boolean;
  status: Status;
};
export type CreditRequirement = {
  /** The printed "Tổng số tín chỉ tích lũy", or the calculated lower bound. */
  actual: number | null;
  possible: number | null;
  required: number;
  source: "printed" | "calculated" | null;
  status: Status;
};
const key = (code: string) => code.trim().toUpperCase();
/** Pass once the lower bound meets the requirement, fail once even the upper bound cannot. */
const decide = (actual: number | null, possible: number | null, required: number | null): Status =>
  actual === null || required === null ? "unknown"
    : actual >= required ? "pass" : possible !== null && possible < required ? "fail" : "unknown";

/** Groups are matched by their member courses, never by name. A name can repeat
    (K29 CNDL has two "Nhóm tự chọn TC102"), so repeated names show their members. */
function groupLabels(standard: Standard) {
  const names = new Map<string, number>();
  for (const group of standard.groups) names.set(group.name.trim(), (names.get(group.name.trim()) ?? 0) + 1);
  return new Map(standard.groups.map((group) => {
    if ((names.get(group.name.trim()) ?? 0) < 2) return [group.id, group.name];
    const codes = standard.courses.filter((course) => course.groupId === group.id).map((course) => key(course.code));
    return [group.id, `${group.name} · ${codes.length} học phần${codes[0] ? `, gồm ${codes[0]}` : ""}`];
  }));
}

export function assessGraduation(standard: Standard, transcript: Transcript | null) {
  const sections = transcript?.data.sections ?? [];
  const outcomes = transcriptOutcomes(sections);
  const results = transcriptResults(sections);
  const outcome = (code: string) => outcomes.get(key(code));
  const codes = standard.courses.map((course) => key(course.code));
  const ambiguous = !codes.length || new Set(codes).size !== codes.length ||
    codes.some((code) => !code) || standard.courses.some((course) =>
      !standard.groups.some((group) => group.id === course.groupId));
  const labels = groupLabels(standard);
  const checks: GraduationCheck[] = standard.groups.map((group) => {
    const courses = standard.courses.filter((course) => course.groupId === group.id);
    const completed = courses.filter((course) => outcome(course.code)?.status === "pass");
    const undecided = courses.filter((course) => outcome(course.code)?.status === "unknown");
    const sumCredits = (items: typeof courses) => items.some((course) => course.credits === null)
      ? null : items.reduce((sum, course) => sum + course.credits!, 0);
    const mandatory = group.kind === "mandatory";
    // Starred courses satisfy elective quotas, but not accumulated academic credits.
    const actual = mandatory ? completed.length : sumCredits(completed);
    const possible = mandatory ? completed.length + undecided.length : sumCredits([...completed, ...undecided]);
    const required = mandatory ? courses.length : group.minimumCredits;
    return {
      groupId: group.id,
      label: labels.get(group.id) ?? group.name,
      actual,
      possible,
      required,
      unit: mandatory ? "môn" : "TC",
      accumulatedCredits: sumCredits(completed.filter((course) => !course.conditionOnly)),
      unknownCourses: undecided.length,
      inferred: completed.some((course) => outcome(course.code)?.inferred),
      status: !transcript || !courses.length || ambiguous ? "unknown" : decide(actual, possible, required),
    };
  });
  const groupStatus: Status = checks.some((check) => check.status === "fail") ? "fail"
    : !checks.length || checks.some((check) => check.status === "unknown") ? "unknown" : "pass";
  // Total credits without condition-only courses: prefer the school's printed
  // cumulative total, otherwise an estimate from the per-course results.
  const creditCheck = transcriptCreditCheck(transcript, {
    conditionCodes: standard.courses.filter((course) => course.conditionOnly).map((course) => course.code),
    programCodes: codes,
  });
  const minimumCredits = standard.minimumCredits ?? null;
  const credits: CreditRequirement | null = minimumCredits === null ? null
    : !transcript ? { actual: null, possible: null, required: minimumCredits, source: null, status: "unknown" }
      : creditCheck.printed !== null
        ? { actual: creditCheck.printed, possible: creditCheck.printed, required: minimumCredits, source: "printed",
          status: decide(creditCheck.printed, creditCheck.printed, minimumCredits) }
        : { actual: creditCheck.computed, possible: creditCheck.computed + creditCheck.uncertain + creditCheck.undecided,
          required: minimumCredits, source: "calculated",
          status: decide(creditCheck.computed, creditCheck.computed + creditCheck.uncertain + creditCheck.undecided, minimumCredits) };
  const gpa = assessGraduationGpa(standard, transcript);
  const parts: Status[] = [groupStatus, gpa.status, ...(credits ? [credits.status] : [])];
  const status: Status = parts.includes("fail") ? "fail" : parts.includes("unknown") ? "unknown" : "pass";
  return {
    results, outcomes, scores: graduationCourseScores(transcript), checks, groupStatus, credits, creditCheck, gpa, status,
    needsImprovement: groupStatus === "pass" && gpa.status === "fail",
  };
}
