import type { GraduationResolution, SpecialtyCode, SpecialtySuggestion } from "./types.js";

/** Lower-case, accent-free, single-spaced text for comparisons. */
export const fold = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim();

export type SpecialtyInfo = {
  code: SpecialtyCode;
  label: string;
  /** Program code matched in graduation standards (data.specialty / classBlock / standardCode). */
  programCode: string;
  /** Folded curriculum_courses.specialty value. */
  curriculumName: string;
  /** Training-plan section label (display only; applicability never uses it). */
  planSectionLabel: string;
};

/** Specialty mapping (spec §4). The web keeps a copy of the labels. */
export const SPECIALTIES: readonly SpecialtyInfo[] = [
  { code: "CNPM", label: "Công nghệ phần mềm", programCode: "7480201-03", curriculumName: "cong nghe phan mem", planSectionLabel: "Chuyên ngành CNPM" },
  { code: "CNDL", label: "Công nghệ dữ liệu", programCode: "7480201-02", curriculumName: "cong nghe du lieu", planSectionLabel: "Chuyên ngành CNDL" },
  { code: "TTNT", label: "Trí tuệ nhân tạo", programCode: "7480201-04", curriculumName: "tri tue nhan tao", planSectionLabel: "Chuyên ngành Trí tuệ Nhân tạo" },
];

export const isSpecialtyCode = (value: unknown): value is SpecialtyCode =>
  typeof value === "string" && SPECIALTIES.some((item) => item.code === value);

export const specialtyLabel = (code: SpecialtyCode | null): string | null =>
  SPECIALTIES.find((item) => item.code === code)?.label ?? null;

/** Folded curriculum specialty values that mean "học phần chung". */
export const COMMON_SPECIALTY_VALUES: readonly string[] = ["", "0", "tu chon chuyen nganh", "hoc phan thay the do an tot nghiep"];

export type CurriculumSpecialtyClass =
  | { kind: "common"; known: boolean }
  | { kind: "specialty"; code: SpecialtyCode };

/**
 * Classifies curriculum_courses.specialty. '', '0', 'Tự chọn Chuyên ngành' and
 * 'Học phần thay thế Đồ án tốt nghiệp' are common; the three specialty names map
 * to their codes; any other value is treated as common with known=false (warn).
 */
export function classifyCurriculumSpecialty(raw: string): CurriculumSpecialtyClass {
  const value = fold(raw);
  if (COMMON_SPECIALTY_VALUES.includes(value) || value.startsWith("hoc phan thay the")) return { kind: "common", known: true };
  const match = SPECIALTIES.find((item) => value === item.curriculumName || value === fold(item.code) || value.includes(item.curriculumName));
  return match ? { kind: "specialty", code: match.code } : { kind: "common", known: false };
}

/** Specialty named at the start of a text: "CNPM", "Công nghệ phần mềm …", "Trí tuệ Nhân tạo". */
export function specialtyAtStart(text: string): SpecialtyCode | null {
  const value = fold(text).replace(/^[\s:.,;()-]+/, "");
  const match = SPECIALTIES.find((item) => {
    const short = fold(item.code);
    return value.startsWith(item.curriculumName) || value === short || new RegExp(`^${short}(?![a-z0-9])`).test(value);
  });
  return match?.code ?? null;
}

/** Specialty of a graduation standard: a code, "other" (e.g. 7480201-01) or null for a general standard. */
export function standardSpecialty(data: { specialty: string; classBlock: string; standardCode: string }): SpecialtyCode | "other" | null {
  const text = `${data.specialty} ${data.classBlock} ${data.standardCode}`;
  const codes = [...text.matchAll(/(?<!\d)(\d{7}-\d{2})(?!\d)/g)].map((match) => match[1]!);
  if (!codes.length) return null;
  return SPECIALTIES.find((item) => codes.includes(item.programCode))?.code ?? "other";
}

/**
 * Picks the graduation standard for a student among the active, current standards of
 * the cohort (spec §6). With a specialty: match the program code; fall back to a single
 * general standard. Without one: a single general standard, otherwise "specialty_unset"
 * (K29 has only per-specialty standards) — never blocking.
 */
export function resolveGraduationStandard<T>(
  candidates: readonly T[],
  specialty: SpecialtyCode | null,
  identity: (candidate: T) => { specialty: string; classBlock: string; standardCode: string },
): { standard: T | null; resolution: GraduationResolution } {
  const classified = candidates.map((candidate) => ({ candidate, specialty: standardSpecialty(identity(candidate)) }));
  const general = classified.filter((item) => item.specialty === null);
  const pick = (items: typeof classified, resolution: GraduationResolution) =>
    items.length === 1 ? { standard: items[0]!.candidate, resolution }
      : items.length > 1 ? { standard: null, resolution: "ambiguous" as const } : null;
  if (specialty) {
    return pick(classified.filter((item) => item.specialty === specialty), "specialty")
      ?? pick(general, "general") ?? { standard: null, resolution: "not_found" };
  }
  return pick(general, "general")
    ?? { standard: null, resolution: candidates.length ? "specialty_unset" : "not_found" };
}

/**
 * Splits a relation text written as "SV chuyên ngành CNPM … SV chuyên ngành CNDL …"
 * (71ITGR40203/40303) into one text block per specialty. Null when the text has no such heading.
 */
export function specialtyBlocks(raw: string): Map<SpecialtyCode, string> | null {
  const blocks = new Map<SpecialtyCode, string[]>();
  let current: SpecialtyCode | null = null;
  let headings = 0;
  for (const line of raw.split(/\r?\n/)) {
    const heading = /^\s*sv\s+chuyen\s+nganh\b(.*)$/i.exec(fold(line));
    if (heading) {
      headings++;
      current = specialtyAtStart(heading[1] ?? "");
      if (current && !blocks.has(current)) blocks.set(current, []);
      // Keep anything written after the heading on the same line.
      const rest = line.replace(/^\s*SV\s+chuy[eê]n\s+ng[aà]nh\s*/iu, "");
      if (current) blocks.get(current)!.push(rest);
      continue;
    }
    if (current) blocks.get(current)!.push(line);
  }
  return headings ? new Map([...blocks].map(([code, lines]) => [code, lines.join("\n")])) : null;
}

export type SpecialtyCounts = Record<SpecialtyCode, number>;

/** Passed (or MT) mandatory specialty courses per specialty. */
export function specialtyCounts(courses: readonly { type: string; specialty: CurriculumSpecialtyClass; passed: boolean }[]): SpecialtyCounts {
  const counts: SpecialtyCounts = { CNPM: 0, CNDL: 0, TTNT: 0 };
  for (const course of courses) {
    if (course.passed && course.specialty.kind === "specialty" && /^BB/i.test(course.type.trim())) counts[course.specialty.code]++;
  }
  return counts;
}

/** "Gợi ý: <chuyên ngành> (x học phần chuyên ngành đã học)" — only one specialty with passes, none elsewhere. */
export function suggestSpecialty(counts: SpecialtyCounts): SpecialtySuggestion | null {
  const withPasses = SPECIALTIES.filter((item) => counts[item.code] > 0);
  if (withPasses.length !== 1) return null;
  const item = withPasses[0]!;
  const passedCount = counts[item.code];
  return { code: item.code, label: item.label, passedCount, text: `Gợi ý: ${item.label} (${passedCount} học phần chuyên ngành đã học)` };
}

/** Another specialty with at least as many passed mandatory courses as the declared one. */
export function specialtyConflict(declared: SpecialtyCode, counts: SpecialtyCounts): { code: SpecialtyCode; count: number } | null {
  const others = SPECIALTIES.filter((item) => item.code !== declared && counts[item.code] > 0 && counts[item.code] >= counts[declared])
    .sort((a, b) => counts[b.code] - counts[a.code] || (a.code < b.code ? -1 : 1));
  const other = others[0];
  return other ? { code: other.code, count: counts[other.code] } : null;
}
