import type { GraduationData } from "./graduation-types";
import type { Transcript } from "./StudentTranscript";
import { academicSections } from "./student-overview-data";
import { transcriptResults } from "./transcript-results";

type Standard = Pick<GraduationData, "minimumCredits" | "mandatoryCredits" | "electiveCredits" | "freeElectiveCredits" | "minimumGpa"> & {
  groups: Omit<GraduationData["groups"][number], "sourceRow">[];
  courses: Omit<GraduationData["courses"][number], "sourceRow">[];
};
type Status = "pass" | "fail" | "unknown";
export type GraduationCheck = { label: string; actual: number | null; required: number | null; status: Status };
const key = (code: string) => code.trim().toUpperCase();
export function assessGraduation(standard: Standard, transcript: Transcript | null) {
  const results = transcriptResults(transcript?.data.sections ?? []);
  const passed = (code: string) => results.get(key(code)) === "pass";
  const checks: GraduationCheck[] = [];
  const add = (label: string, actual: number | null, required: number | null) => {
    checks.push({ label, actual, required, status: !transcript || actual === null || required === null ? "unknown" : actual >= required ? "pass" : "fail" });
  };
  const unique = [...new Map(standard.courses.map((course) => [key(course.code), course])).values()];
  const credits = (courses: typeof unique) => courses.some((c) => !c.conditionOnly && passed(c.code) && c.credits === null)
    ? null : courses.reduce((sum, c) => sum + (!c.conditionOnly && passed(c.code) ? c.credits ?? 0 : 0), 0);
  const ofKind = (kind: "mandatory" | "elective") => unique.filter((c) => standard.groups.some((g) => g.id === c.groupId && g.kind === kind));
  add("Tín chỉ tích lũy thuộc tiêu chuẩn", credits(unique), standard.minimumCredits);
  add("Tín chỉ bắt buộc", credits(ofKind("mandatory")), standard.mandatoryCredits);
  add("Tín chỉ nhóm tự chọn", credits(ofKind("elective")), standard.electiveCredits);
  // The standard has no explicit free-elective membership: do not treat arbitrary
  // transcript courses as approved free electives.
  add("Tín chỉ tự chọn tự do (cần xác nhận nếu có yêu cầu)", standard.freeElectiveCredits === 0 ? 0 : null, standard.freeElectiveCredits);
  const latest = academicSections(transcript).at(-1);
  const gpaText = latest?.summaries.find((s) => {
    const label = s.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d");
    return /diem (tb|trung binh).*tich luy/.test(label) && /he\s*4/.test(label);
  })?.value?.trim().replace(",", ".");
  const gpa = gpaText && /^\d+(\.\d+)?$/.test(gpaText) && Number(gpaText) <= 4 ? Number(gpaText) : null;
  add("Điểm TB tích lũy hệ 4 theo bảng điểm mới nhất", gpa, standard.minimumGpa);
  for (const group of standard.groups) {
    const courses = unique.filter((c) => c.groupId === group.id);
    add(`${group.name} — tín chỉ`, courses.length ? credits(courses) : null, group.minimumCredits);
    const required = courses.filter((c) => group.kind === "mandatory" || c.conditionOnly);
    if (required.length) add(`${group.name} — môn phải đạt (gồm môn điều kiện)`, required.filter((c) => passed(c.code)).length, required.length);
  }
  const ambiguous = unique.length !== standard.courses.length || !unique.length || unique.some((c) => !key(c.code) || !standard.groups.some((g) => g.id === c.groupId));
  if (ambiguous) add("Cấu trúc tiêu chuẩn cần rà soát (mã trùng, thiếu môn hoặc nhóm)", null, null);
  const status: Status = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "unknown") ? "unknown" : "pass";
  return { results, checks, status };
}
