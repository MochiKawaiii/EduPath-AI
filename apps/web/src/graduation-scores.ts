import type { GraduationData } from "./graduation-types";
import type { Transcript } from "./StudentTranscript";
import { academicSections, latestResultSection } from "./student-overview-data";
import { transcriptResults } from "./transcript-results";

type Course = Transcript["data"]["sections"][number]["courses"][number];
type Standard = Pick<GraduationData, "minimumGpa" | "gpaScale"> & {
  courses: Pick<GraduationData["courses"][number], "code" | "conditionOnly">[];
};
const key = (code: string) => code.trim().toUpperCase();
const exempt = (course: Course) => course.letter?.trim().toUpperCase() === "MT";
const numeric = (n: number | null, max: number): n is number => n !== null && Number.isFinite(n) && n >= 0 && n <= max;
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();

function attemptsByCode(transcript: Transcript | null) {
  const attempts = new Map<string, Course[]>();
  for (const course of transcript?.data.sections.flatMap((section) => section.courses) ?? []) {
    const code = key(course.code);
    if (code) attempts.set(code, [...(attempts.get(code) ?? []), course]);
  }
  return attempts;
}

export function graduationCourseScores(transcript: Transcript | null) {
  const grades = new Map<string, Course & { attemptCount: number }>();
  for (const [code, attempts] of attemptsByCode(transcript)) {
    const mt = attempts.find(exempt);
    const passing = attempts.filter((course) => transcriptResults([{ courses: [course] }]).get(code) === "pass");
    const candidates = passing.length ? passing : attempts;
    const best = mt ?? [...candidates].sort((a, b) =>
      (b.score10 ?? -1) - (a.score10 ?? -1) || (b.score4 ?? -1) - (a.score4 ?? -1))[0]!;
    grades.set(code, { ...best, attemptCount: attempts.length });
  }
  return grades;
}

export type GpaAssessment = {
  actual: number | null;
  required: number | null;
  scale: 4 | 10 | null;
  status: "pass" | "fail" | "unknown";
  source: "printed" | "calculated" | null;
  reason: string;
};

export function assessGraduationGpa(standard: Standard, transcript: Transcript | null): GpaAssessment {
  const scale = standard.gpaScale ?? null;
  const unknown = (reason: string): GpaAssessment => ({
    actual: null, required: standard.minimumGpa, scale, status: "unknown", source: null, reason,
  });
  if (!transcript) return unknown("Chưa có bảng điểm để đối chiếu.");
  if (standard.minimumGpa === null) return unknown("Tiêu chuẩn chưa có điểm trung bình tối thiểu.");
  if (!scale) return unknown("Tiêu chuẩn chưa chọn hệ 4 hoặc hệ 10. Cần quản trị viên bổ sung thang điểm.");
  if (!numeric(standard.minimumGpa, scale)) return unknown("Ngưỡng điểm trung bình chưa phù hợp với thang điểm đã chọn.");
  const result = (actual: number, source: "printed" | "calculated"): GpaAssessment => ({
    actual, required: standard.minimumGpa, scale, source,
    status: actual + 1e-9 >= standard.minimumGpa! ? "pass" : "fail", reason: "",
  });

  // Only use the latest graded term's cumulative summary, never a semester GPA
  // or an older cumulative value when the newest term lacks that summary.
  const latest = latestResultSection(academicSections(transcript));
  const summaries = latest?.summaries.filter((summary) => {
    const label = fold(summary.label);
    return /diem (?:tb|trung binh) tich luy/.test(label) &&
      new RegExp(`(?:he|thang(?: diem)?)\\s*${scale}\\b`).test(label);
  }) ?? [];
  if (summaries.length) {
    const values = summaries.map(({ value }) => value?.trim().replace(",", ".") ?? "");
    if (values.some((value) => !/^\d+(?:\.\d+)?$/.test(value) || !numeric(Number(value), scale)) || new Set(values.map(Number)).size !== 1)
      return unknown("Điểm trung bình tích lũy trong bảng điểm chưa rõ hoặc không khớp. Hãy kiểm tra PDF gốc.");
    return result(Number(values[0]), "printed");
  }

  // A same-scale estimate when the PDF has no printed cumulative GPA: use
  // credit weights, the highest recorded grade once per code, and omit MT/*.
  const conditionCodes = new Set(standard.courses.filter((course) => course.conditionOnly).map((course) => key(course.code)));
  let total = 0, credits = 0;
  for (const [code, attempts] of attemptsByCode(transcript)) {
    if (conditionCodes.has(code) || attempts.some((course) => course.conditional || exempt(course))) continue;
    const graded = attempts.filter((course) => course.score10 !== null || course.score4 !== null || course.result || course.letter);
    if (!graded.length) continue; // Future/ungraded registrations do not enter GPA.
    const field = scale === 4 ? "score4" : "score10";
    const best = [...graded].sort((a, b) => (b[field] ?? -1) - (a[field] ?? -1))[0]!;
    if (!Number.isFinite(best.credits) || best.credits < 0 || !numeric(best[field], scale))
      return unknown(`Chưa có đủ điểm hệ ${scale} hoặc tín chỉ của môn ${code} để tính điểm trung bình.`);
    if (best.credits === 0) continue;
    credits += best.credits;
    total += best[field]! * best.credits;
  }
  if (!credits) return unknown(`Chưa có điểm các môn tính điểm trung bình hệ ${scale}.`);
  return result(total / credits, "calculated");
}
