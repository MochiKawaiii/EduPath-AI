import type { CourseOutcome, CourseResult } from "./transcript-results";

/** Plan rows "GDTC 1"/"GDTC 2" have placeholder codes; slot n is met by n distinct passed PE electives. */
function physicalEducationSlot(name: string): number | null {
  const folded = name.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toUpperCase();
  const slot = /^(?:GDTC|GIAO DUC THE CHAT)\s*([12])$/.exec(folded);
  return slot ? Number(slot[1]) : null;
}

export function passedPhysicalEducationCourses(
  courseCodes: string[],
  results: ReadonlyMap<string, CourseResult>,
): number {
  const codes = new Set(courseCodes.map((code) => code.trim().toUpperCase()));
  return [...codes].filter((code) => code && results.get(code) === "pass").length;
}

export function studentPlanResult(
  item: { code: string; name: string },
  results: ReadonlyMap<string, CourseResult>,
  passedPhysicalEducation: number,
): CourseResult | undefined {
  const slot = physicalEducationSlot(item.name);
  if (slot) {
    return passedPhysicalEducation >= slot ? "pass" : undefined;
  }
  return results.get(item.code.trim().toUpperCase());
}

export type PhysicalEducationProgress = { passed: number; confirmed: number };
export type PlanResult = { result: CourseResult; inferred: boolean };

/** Distinct passed PE electives, and how many of those passes are confirmed by
    a printed result or MT rather than inferred from a letter grade. */
export function physicalEducationProgress(
  courseCodes: string[],
  outcomes: ReadonlyMap<string, CourseOutcome>,
): PhysicalEducationProgress {
  let passed = 0, confirmed = 0;
  for (const code of new Set(courseCodes.map((value) => value.trim().toUpperCase()))) {
    const outcome = code ? outcomes.get(code) : undefined;
    if (outcome?.status !== "pass") continue;
    passed++;
    if (!outcome.inferred) confirmed++;
  }
  return { passed, confirmed };
}

/** Like studentPlanResult, and also says whether the result relies on a letter grade. */
export function studentPlanOutcome(
  item: { code: string; name: string },
  outcomes: ReadonlyMap<string, CourseOutcome>,
  physicalEducation: PhysicalEducationProgress,
): PlanResult | undefined {
  const slot = physicalEducationSlot(item.name);
  if (slot) {
    return physicalEducation.passed >= slot
      ? { result: "pass", inferred: physicalEducation.confirmed < slot } : undefined;
  }
  const outcome = outcomes.get(item.code.trim().toUpperCase());
  return outcome?.status === "pass" || outcome?.status === "fail"
    ? { result: outcome.status, inferred: outcome.inferred } : undefined;
}
