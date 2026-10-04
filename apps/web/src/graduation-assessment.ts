import type { GraduationData } from "./graduation-types";
import type { Transcript } from "./StudentTranscript";
import { transcriptResults } from "./transcript-results";
import { assessGraduationGpa, graduationCourseScores } from "./graduation-scores";

type Standard = Pick<GraduationData, "minimumGpa" | "gpaScale"> & {
  groups: Omit<GraduationData["groups"][number], "sourceRow">[];
  courses: Omit<GraduationData["courses"][number], "sourceRow">[];
};
type Status = "pass" | "fail" | "unknown";
export type GraduationCheck = {
  groupId: string;
  label: string;
  actual: number | null;
  required: number | null;
  unit: "môn" | "TC";
  accumulatedCredits: number | null;
  status: Status;
};
const key = (code: string) => code.trim().toUpperCase();

export function assessGraduation(standard: Standard, transcript: Transcript | null) {
  const results = transcriptResults(transcript?.data.sections ?? []);
  const passed = (code: string) => results.get(key(code)) === "pass";
  const codes = standard.courses.map((course) => key(course.code));
  const ambiguous = !codes.length || new Set(codes).size !== codes.length ||
    codes.some((code) => !code) || standard.courses.some((course) =>
      !standard.groups.some((group) => group.id === course.groupId));
  const checks: GraduationCheck[] = standard.groups.map((group) => {
    const courses = standard.courses.filter((course) => course.groupId === group.id);
    const completed = courses.filter((course) => passed(course.code));
    const sumCredits = (items: typeof courses) => items.some((course) => course.credits === null)
      ? null : items.reduce((sum, course) => sum + course.credits!, 0);
    const mandatory = group.kind === "mandatory";
    // Starred courses satisfy elective quotas, but not accumulated academic credits.
    const actual = mandatory ? completed.length : sumCredits(completed);
    const required = mandatory ? courses.length : group.minimumCredits;
    return {
      groupId: group.id,
      label: group.name,
      actual,
      required,
      unit: mandatory ? "môn" : "TC",
      accumulatedCredits: sumCredits(completed.filter((course) => !course.conditionOnly)),
      status: !transcript || !courses.length || ambiguous || actual === null || required === null
        ? "unknown" : actual >= required ? "pass" : "fail",
    };
  });
  const groupStatus: Status = checks.some((check) => check.status === "fail") ? "fail"
    : !checks.length || checks.some((check) => check.status === "unknown") ? "unknown" : "pass";
  const gpa = assessGraduationGpa(standard, transcript);
  const status: Status = groupStatus === "fail" || gpa.status === "fail" ? "fail"
    : groupStatus === "unknown" || gpa.status === "unknown" ? "unknown" : "pass";
  return {
    results, scores: graduationCourseScores(transcript), checks, groupStatus, gpa, status,
    needsImprovement: groupStatus === "pass" && gpa.status === "fail",
  };
}
