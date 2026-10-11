import type { GraduationData } from "../graduation/model.js";
import type { TranscriptData } from "../student/transcript-parser.js";
import {
  courseKey, isConditionOnly, isPassedState, latestResultSection, passedCurriculumCredits, printedCumulativeCredits, printedSummaryNumber,
  type ElectiveGroup, type TranscriptCourseRecord,
} from "./course-state.js";
import type {
  GraduationCredits, GraduationGpa, GraduationGroupCheck, GraduationResolution, GraduationStandardInput, GraduationSummary, TriState,
} from "./types.js";

type StandardGroup = GraduationData["groups"][number];
type StandardCourse = GraduationData["courses"][number];

export const GRADUATION_STATUS_LABELS: Record<TriState, string> = {
  pass: "Đạt các điều kiện (tham khảo)",
  fail: "Chưa đủ điều kiện",
  unknown: "Chưa xác định",
};

const UNRESOLVED_REASONS: Record<GraduationResolution, string> = {
  specialty: "Chưa có tiêu chuẩn xét tốt nghiệp phù hợp với chuyên ngành của bạn.",
  general: "Chưa có tiêu chuẩn xét tốt nghiệp chung cho khóa của bạn.",
  specialty_unset: "Khóa của bạn có tiêu chuẩn tốt nghiệp riêng cho từng chuyên ngành. Hãy chọn chuyên ngành trong hồ sơ để đối chiếu.",
  not_found: "Chưa có tiêu chuẩn xét tốt nghiệp đang áp dụng cho khóa và chuyên ngành của bạn.",
  ambiguous: "Có nhiều tiêu chuẩn xét tốt nghiệp cùng phù hợp nên chưa chọn được tiêu chuẩn để đối chiếu.",
};

/** Overlap of two code lists: accepted when each side shares at least half of its codes. */
function overlap(a: readonly string[], b: readonly string[]): { shared: number; difference: number } | null {
  const left = new Set(a.map(courseKey)), right = new Set(b.map(courseKey));
  const shared = [...left].filter((code) => right.has(code)).length;
  if (!shared || shared * 2 < left.size || shared * 2 < right.size) return null;
  return { shared, difference: left.size + right.size - 2 * shared };
}

const standardGroupCodes = (standard: Pick<GraduationData, "courses">, groupId: string) =>
  standard.courses.filter((course) => course.groupId === groupId).map((course) => courseKey(course.code));

/** Standard elective group with the same courses as a CTĐT elective group (TC309 ≡ TC209), matched by codes, never by name. */
export function matchStandardElectiveGroup(courseCodes: readonly string[], standard: Pick<GraduationData, "groups" | "courses"> | null): StandardGroup | null {
  let best: { group: StandardGroup; shared: number; difference: number } | null = null;
  for (const group of standard?.groups ?? []) {
    if (group.kind !== "elective") continue;
    const match = overlap(courseCodes, standardGroupCodes(standard!, group.id));
    if (match && (!best || match.shared > best.shared || (match.shared === best.shared && match.difference < best.difference))) best = { group, ...match };
  }
  return best?.group ?? null;
}

/** CTĐT elective code of a standard group (the inverse match). */
export function matchCurriculumElective(group: StandardGroup, standard: Pick<GraduationData, "courses">, electives: readonly ElectiveGroup[]): string | null {
  const codes = standardGroupCodes(standard, group.id);
  let best: { code: string; shared: number; difference: number } | null = null;
  for (const elective of electives) {
    const match = overlap(codes, elective.courseCodes);
    if (match && (!best || match.shared > best.shared || (match.shared === best.shared && match.difference < best.difference))) best = { code: elective.code, ...match };
  }
  return best?.code ?? null;
}

export type ElectiveQuota = {
  code: string;
  courseCodes: string[];
  /** Credits the student must choose in this group, or null when unknown. */
  quota: number | null;
  source: "standard" | "curriculum" | null;
};

/** Quota per CTĐT elective group: standard minimumCredits by course membership, else "(n TC)" in the CTĐT, else null. */
export function electiveQuotas(electives: readonly ElectiveGroup[], standard: Pick<GraduationData, "groups" | "courses"> | null): Map<string, ElectiveQuota> {
  const quotas = new Map<string, ElectiveQuota>();
  for (const elective of electives) {
    const fromStandard = matchStandardElectiveGroup(elective.courseCodes, standard)?.minimumCredits ?? null;
    quotas.set(elective.code, {
      code: elective.code, courseCodes: elective.courseCodes,
      quota: fromStandard ?? elective.requiredCredits,
      source: fromStandard !== null ? "standard" : elective.requiredCredits !== null ? "curriculum" : null,
    });
  }
  return quotas;
}

const numericIn = (value: number | null | undefined, max: number): value is number =>
  value !== null && value !== undefined && Number.isFinite(value) && value >= 0 && value <= max;

/**
 * Port of graduation-scores.ts assessGraduationGpa: the printed cumulative GPA of the latest
 * graded term on the standard's scale (default 4), else a credit-weighted estimate of the best
 * grade per code, without condition-only and MT courses.
 */
export function assessGraduationGpa(
  standard: Pick<GraduationData, "minimumGpa" | "gpaScale">,
  transcript: TranscriptData,
  records: ReadonlyMap<string, TranscriptCourseRecord>,
  conditionCodes: ReadonlySet<string>,
): GraduationGpa {
  const scale: 4 | 10 = standard.gpaScale ?? 4;
  const required = standard.minimumGpa;
  const unknown = (reason: string): GraduationGpa => ({ actual: null, required, scale, status: "unknown", source: null, reason });
  if (required === null) return unknown("Tiêu chuẩn chưa có điểm trung bình tối thiểu.");
  if (!numericIn(required, scale)) return unknown("Ngưỡng điểm trung bình chưa phù hợp với thang điểm đã chọn.");
  const result = (actual: number, source: "printed" | "calculated"): GraduationGpa => ({
    actual, required, scale, source, status: actual + 1e-9 >= required ? "pass" : "fail", reason: "",
  });
  const printed = printedSummaryNumber(latestResultSection(transcript),
    (label) => /diem (?:tb|trung binh) tich luy/.test(label) && new RegExp(`(?:he|thang(?: diem)?)\\s*${scale}\\b`).test(label), scale);
  if (printed !== null) {
    return Number.isNaN(printed)
      ? unknown("Điểm trung bình tích lũy trong bảng điểm chưa rõ hoặc không khớp. Hãy kiểm tra PDF gốc.")
      : result(printed, "printed");
  }
  let total = 0, credits = 0;
  for (const record of records.values()) {
    if (isConditionOnly(record.code, conditionCodes) || record.attempts.some((attempt) => attempt.conditional || attempt.exempt)) continue;
    const graded = record.attempts.filter((attempt) => attempt.score10 !== null || attempt.score4 !== null || attempt.result || attempt.letter);
    if (!graded.length) continue; // Registrations without grades do not enter the GPA.
    const field = scale === 4 ? "score4" : "score10";
    const best = [...graded].sort((a, b) => (b[field] ?? -1) - (a[field] ?? -1))[0]!;
    const value = best[field];
    if (!numericIn(value, scale)) return unknown(`Chưa có đủ điểm hệ ${scale} hoặc tín chỉ của môn ${record.code} để tính điểm trung bình.`);
    if (best.credits === 0) continue;
    credits += best.credits;
    total += value * best.credits;
  }
  if (!credits) return unknown(`Chưa có điểm các môn tính điểm trung bình hệ ${scale}.`);
  return result(total / credits, "calculated");
}

const decide = (lower: number | null, upper: number | null, required: number | null): TriState =>
  lower === null || upper === null || required === null ? "unknown"
    : lower + 1e-9 >= required ? "pass" : upper + 1e-9 < required ? "fail" : "unknown";

/** Total credits: the printed "Tổng số tín chỉ tích lũy", else an estimate with lower/upper bounds. */
export function assessGraduationCredits(
  required: number,
  transcript: TranscriptData,
  records: ReadonlyMap<string, TranscriptCourseRecord>,
  curriculumCredits: ReadonlyMap<string, number>,
  conditionCodes: ReadonlySet<string>,
): GraduationCredits {
  const printed = printedCumulativeCredits(transcript);
  if (printed !== null) {
    if (Number.isNaN(printed)) return { lower: null, upper: null, required, status: "unknown", source: "printed" };
    return { lower: printed, upper: printed, required, status: decide(printed, printed, required), source: "printed" };
  }
  const { certain, unknown } = passedCurriculumCredits(records, curriculumCredits, conditionCodes);
  return { lower: certain, upper: certain + unknown, required, status: decide(certain, certain + unknown, required), source: "calculated" };
}

/**
 * Port of graduation-assessment.ts with the §7.9 changes: each group has a lower bound
 * (certainly completed) and an upper bound (+ graded with an unknown result); pass when
 * lower ≥ required, fail when upper < required, otherwise unknown.
 */
export function assessGraduationGroups(
  standard: Pick<GraduationData, "groups" | "courses">,
  records: ReadonlyMap<string, TranscriptCourseRecord>,
  curriculumCredits: ReadonlyMap<string, number>,
  electives: readonly ElectiveGroup[],
): GraduationGroupCheck[] {
  const state = (code: string) => records.get(courseKey(code))?.state;
  const codes = standard.courses.map((course) => courseKey(course.code));
  const ambiguous = !codes.length || new Set(codes).size !== codes.length || codes.some((code) => !code) ||
    standard.courses.some((course) => !standard.groups.some((group) => group.id === course.groupId));
  const creditOf = (course: StandardCourse) => course.credits ?? curriculumCredits.get(courseKey(course.code)) ?? null;
  const sumCredits = (items: StandardCourse[]) =>
    items.some((course) => creditOf(course) === null) ? null : items.reduce((sum, course) => sum + creditOf(course)!, 0);
  return standard.groups.map((group) => {
    const courses = standard.courses.filter((course) => course.groupId === group.id);
    const certain = courses.filter((course) => { const value = state(course.code); return value !== undefined && isPassedState(value); });
    const possible = [...certain, ...courses.filter((course) => state(course.code) === "graded_unknown")];
    const mandatory = group.kind === "mandatory";
    // Starred courses satisfy elective quotas, but not accumulated academic credits.
    const lower = mandatory ? certain.length : sumCredits(certain);
    const upper = mandatory ? possible.length : sumCredits(possible);
    const required = mandatory ? courses.length : group.minimumCredits;
    return {
      groupId: group.id,
      label: group.name,
      kind: group.kind,
      unit: mandatory ? "môn" : "TC",
      lower,
      upper,
      required,
      status: !courses.length || ambiguous ? "unknown" : decide(lower, upper, required),
      accumulatedCredits: sumCredits(certain.filter((course) => !course.conditionOnly)),
      curriculumElectiveCode: mandatory ? null : matchCurriculumElective(group, standard, electives),
    };
  });
}

export function assessGraduation(args: {
  resolution: GraduationResolution;
  standard: GraduationStandardInput | null;
  transcript: TranscriptData;
  records: ReadonlyMap<string, TranscriptCourseRecord>;
  curriculumCredits: ReadonlyMap<string, number>;
  electives: readonly ElectiveGroup[];
  conditionCodes: ReadonlySet<string>;
}): GraduationSummary {
  const { standard } = args;
  if (!standard) {
    return {
      resolution: args.resolution, standard: null, status: "unknown", statusLabel: GRADUATION_STATUS_LABELS.unknown,
      reason: UNRESOLVED_REASONS[args.resolution], groups: [], groupStatus: "unknown", gpa: null, credits: null, needsImprovement: false,
    };
  }
  const data = standard.data;
  const groups = assessGraduationGroups(data, args.records, args.curriculumCredits, args.electives);
  const groupStatus: TriState = groups.some((check) => check.status === "fail") ? "fail"
    : !groups.length || groups.some((check) => check.status === "unknown") ? "unknown" : "pass";
  const gpa = assessGraduationGpa(data, args.transcript, args.records, args.conditionCodes);
  const credits = data.minimumCredits === null ? null
    : assessGraduationCredits(data.minimumCredits, args.transcript, args.records, args.curriculumCredits, args.conditionCodes);
  const statuses = [groupStatus, gpa.status, ...(credits ? [credits.status] : [])];
  const status: TriState = statuses.includes("fail") ? "fail" : statuses.includes("unknown") ? "unknown" : "pass";
  const reason = status !== "unknown" ? null
    : groupStatus === "unknown" ? "Chưa đủ dữ liệu để kết luận một số nhóm học phần (có học phần chưa xác định kết quả)."
      : gpa.status === "unknown" ? gpa.reason
        : "Chưa xác định được tổng số tín chỉ tích lũy.";
  return {
    resolution: args.resolution,
    standard: { id: standard.id, name: data.name, version: standard.version, specialty: data.specialty, classBlock: data.classBlock },
    status, statusLabel: GRADUATION_STATUS_LABELS[status], reason, groups, groupStatus, gpa, credits,
    needsImprovement: groupStatus === "pass" && gpa.status === "fail",
  };
}
