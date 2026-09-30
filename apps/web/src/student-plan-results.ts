import type { CourseResult } from "./transcript-results";

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
  const name = item.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toUpperCase();
  const slot = /^(?:GDTC|GIAO DUC THE CHAT)\s*([12])$/.exec(name);
  if (slot) {
    return passedPhysicalEducation >= Number(slot[1]) ? "pass" : undefined;
  }
  return results.get(item.code.trim().toUpperCase());
}
