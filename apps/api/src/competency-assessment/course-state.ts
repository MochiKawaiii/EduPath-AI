import type { GraduationData } from "../graduation/model.js";
import type { TranscriptData, TranscriptSection } from "../student/transcript-parser.js";
import { CONDITION_ONLY_BLOCK, CONDITION_ONLY_CODE_PATTERN, EXEMPT_LETTER, FAIL_LETTERS, PASS_LETTERS } from "./constants.js";
import { fold } from "./specialty.js";
import type { AttemptOutcome, CourseState, CreditCheck, CurriculumCourseInput } from "./types.js";

/** Course codes are compared trimmed and upper-case everywhere. */
export const courseKey = (code: string) => code.trim().toUpperCase();

const FAILED_TEXT = /^(không|khong|chưa|chua|ko)\s*đạt|^(rớt|trượt)|^[✗✘×x]$/;
const PASSED_TEXT = /^đạt|^[✓✔v]$/;

/**
 * Result of one transcript attempt (spec §5). A printed result text always wins;
 * only when it is empty is the official letter grade used (inferred=true).
 * MT is an exemption and counts as passed (not inferred).
 */
export function attemptOutcome(result: string | null | undefined, letter: string | null | undefined): { outcome: AttemptOutcome; inferred: boolean; exempt: boolean } {
  const grade = (letter ?? "").trim().toUpperCase();
  if (grade === EXEMPT_LETTER) return { outcome: "pass", inferred: false, exempt: true };
  const text = (result ?? "").normalize("NFC").trim().toLowerCase();
  if (text) {
    if (FAILED_TEXT.test(text)) return { outcome: "fail", inferred: false, exempt: false };
    return { outcome: PASSED_TEXT.test(text) ? "pass" : "unknown", inferred: false, exempt: false };
  }
  if (PASS_LETTERS.includes(grade)) return { outcome: "pass", inferred: true, exempt: false };
  if (FAIL_LETTERS.includes(grade)) return { outcome: "fail", inferred: true, exempt: false };
  return { outcome: "unknown", inferred: false, exempt: false };
}

/** "2025-2026" + "HK03" → "HK253"; the "Điểm bảo lưu" section has no term. */
export function termCode(section: { academicYear: string | null; semester: string | null }): string | null {
  const year = /^(\d{4})\s*-\s*\d{4}$/.exec(section.academicYear?.trim() ?? "");
  const semester = Number(/(\d+)/.exec(section.semester ?? "")?.[1]);
  if (!year || !Number.isInteger(semester) || semester < 1 || semester > 3) return null;
  return `HK${year[1]!.slice(2)}${semester}`;
}

/** CTĐT year/semester → HKyyS using the curriculum admission year. */
export function curriculumTermCode(admissionYear: number | null, studyYear: number | null, semester: number | null): string | null {
  if (!admissionYear || !studyYear || !semester || semester < 1 || semester > 3) return null;
  return `HK${String((admissionYear + studyYear - 1) % 100).padStart(2, "0")}${semester}`;
}

/** Terms with an academic year and semester, oldest first (port of student-overview-data.ts). */
export function academicSections(data: TranscriptData): TranscriptSection[] {
  return data.sections
    .filter((section) => section.academicYear !== null && section.semester !== null)
    .slice()
    .sort((a, b) => a.academicYear!.localeCompare(b.academicYear!) ||
      Number(a.semester!.replace(/\D/g, "")) - Number(b.semester!.replace(/\D/g, "")));
}

const hasScore = (section: TranscriptSection) => section.courses.some((course) => course.score10 !== null || course.score4 !== null);

/** Latest term that has grades, or undefined. */
export function latestGradedSection(data: TranscriptData): TranscriptSection | undefined {
  return [...academicSections(data)].reverse().find(hasScore);
}

/** Port of latestResultSection: the latest graded term, else the latest term (for printed summaries). */
export function latestResultSection(data: TranscriptData): TranscriptSection | undefined {
  const sections = academicSections(data);
  return [...sections].reverse().find(hasScore) ?? sections.at(-1);
}

/** "Học kỳ hiện tại": the newest term with grades as HKyyS. */
export function currentTermCode(data: TranscriptData): string | null {
  const section = latestGradedSection(data);
  return section ? termCode(section) : null;
}

/** Printed summary values of one term whose folded label matches; null when missing, NaN when unreadable or conflicting. */
export function printedSummaryNumber(section: TranscriptSection | undefined, label: (folded: string) => boolean, max: number): number | null {
  const values = (section?.summaries ?? []).filter((summary) => label(fold(summary.label)))
    .map((summary) => summary.value?.trim().replace(",", ".") ?? "");
  if (!values.length) return null;
  if (values.some((value) => !/^\d+(?:\.\d+)?$/.test(value) || Number(value) > max) || new Set(values.map(Number)).size !== 1) return Number.NaN;
  return Number(values[0]);
}

/**
 * Folded label of the printed cumulative credits (E5). Both parsers keep the printed text before
 * the colon as the label: transcript-parser.ts splits each "- label: value" line into its two
 * columns, ocr-adapter.ts splits every raw summary cell line the same way. The VLU layout prints,
 * per term, "Số tín chỉ đạt học kỳ", "Tổng số tín chỉ đăng ký", "Tổng số tín chỉ tích lũy",
 * "Điểm TB học kỳ/học tập/tích lũy (Hệ 4|10)" and the "Xếp loại …" lines (the OCR pipeline's
 * SUMMARY_FIELDS in services/ocr/test_ocr.py lists the same set; the test fixtures use "Tổng số tín
 * chỉ tích lũy", "Số tín chỉ đạt học kỳ" and "Điểm TB … (Hệ 4|10)"). Accepted: "Tổng số tín chỉ
 * tích lũy" and "Số tín chỉ tích lũy" (also "TC" for "tín chỉ" and "đã tích lũy"), with the spaces
 * OCR may drop; never a per-term line ("… đạt học kỳ", "… đăng ký", or any "tích lũy … học kỳ/HK").
 */
export const CUMULATIVE_CREDITS_LABEL = /^[^a-z0-9]*(?:tong\s*)?so\s*(?:tin\s*chi|tc)\s*(?:da\s*)?tich\s*luy(?![a-z])(?!.*(?:hoc\s*ky|\bhk))/;

/** "Tổng số tín chỉ tích lũy" printed on the latest graded term; null when missing, NaN when unreadable or conflicting. */
export const printedCumulativeCredits = (data: TranscriptData) =>
  printedSummaryNumber(latestResultSection(data), (label) => CUMULATIVE_CREDITS_LABEL.test(label), 1000);

export type Attempt = {
  code: string;
  credits: number;
  score10: number | null;
  score4: number | null;
  letter: string | null;
  result: string | null;
  conditional: boolean;
  /** HKyyS, or null for "Điểm bảo lưu". */
  termCode: string | null;
  outcome: AttemptOutcome;
  inferred: boolean;
  exempt: boolean;
  /** Has a score, letter or result; otherwise it is a registration without grades. */
  graded: boolean;
};

export type TranscriptCourseState = Exclude<CourseState, "not_taken" | "not_in_curriculum">;

export type TranscriptCourseRecord = {
  code: string;
  attempts: Attempt[];
  /** MT first, then the best passing attempt, then the best attempt. */
  selected: Attempt;
  state: TranscriptCourseState;
  /** The pass/fail state rests on a letter-grade inference. */
  inferred: boolean;
};

const numeric = (value: unknown, max: number): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : null;

/** The attempt used for a course: MT, else the best passing attempt, else the best attempt. */
export function selectAttempt(attempts: readonly Attempt[]): Attempt {
  const exempt = attempts.find((attempt) => attempt.exempt);
  if (exempt) return exempt;
  const passing = attempts.filter((attempt) => attempt.outcome === "pass");
  const candidates = passing.length ? passing : attempts;
  return [...candidates].sort((a, b) => (b.score10 ?? -1) - (a.score10 ?? -1) || (b.score4 ?? -1) - (a.score4 ?? -1))[0]!;
}

/** Course state from all attempts: MT > passed > graded with unknown result > registered > failed. */
export function courseState(attempts: readonly Attempt[]): TranscriptCourseState {
  if (attempts.some((attempt) => attempt.exempt)) return "exempt";
  if (attempts.some((attempt) => attempt.outcome === "pass")) return "passed";
  if (attempts.some((attempt) => attempt.graded && attempt.outcome === "unknown")) return "graded_unknown";
  if (attempts.some((attempt) => !attempt.graded)) return "in_progress";
  return "failed";
}

/** Groups every attempt by code (including "Điểm bảo lưu") and decides one state per course. */
export function transcriptCourses(data: TranscriptData): Map<string, TranscriptCourseRecord> {
  const attempts = new Map<string, Attempt[]>();
  for (const section of data.sections) {
    const term = termCode(section);
    for (const course of section.courses) {
      const code = courseKey(course.code ?? "");
      if (!code) continue;
      const letter = course.letter?.trim() ? course.letter.trim().toUpperCase() : null;
      const result = course.result?.trim() ? course.result.trim() : null;
      const score10 = numeric(course.score10, 10);
      const score4 = numeric(course.score4, 4);
      const decided = attemptOutcome(result, letter);
      attempts.set(code, [...(attempts.get(code) ?? []), {
        code, credits: numeric(course.credits, 1000) ?? 0, score10, score4, letter, result,
        conditional: Boolean(course.conditional), termCode: term, ...decided,
        graded: score10 !== null || score4 !== null || letter !== null || result !== null,
      }]);
    }
  }
  const records = new Map<string, TranscriptCourseRecord>();
  for (const [code, list] of attempts) {
    const selected = selectAttempt(list);
    const state = courseState(list);
    // Inferred only when no printed result confirms the same outcome.
    const deciding = state === "passed" ? list.filter((attempt) => attempt.outcome === "pass")
      : state === "failed" ? list.filter((attempt) => attempt.outcome === "fail") : [];
    records.set(code, { code, attempts: list, selected, state, inferred: deciding.length > 0 && deciding.every((attempt) => attempt.inferred) });
  }
  return records;
}

export type ElectiveGroup = {
  /** "TC002", "TC309" … from curriculum_courses.course_type. */
  code: string;
  /** "(n TC)" written in the course type, or null. */
  requiredCredits: number | null;
  courseCodes: string[];
};

/** Elective group code of a course type ("TC102 (2TC)" → "TC102"), or null for mandatory types. */
export const electiveCodeOf = (type: string): string | null => /^(TC\d*)/i.exec(type.trim())?.[1]?.toUpperCase() ?? null;

/** Elective groups from course types, as curricula/model.ts rebuild() derives them (first "(n TC)" wins). */
export function deriveElectiveGroups(courses: readonly Pick<CurriculumCourseInput, "code" | "type">[]): ElectiveGroup[] {
  const groups = new Map<string, ElectiveGroup>();
  for (const course of courses) {
    const code = electiveCodeOf(course.type);
    if (!code) continue;
    const explicit = /\((\d+)\s*TC\)/i.exec(course.type);
    const group = groups.get(code) ?? { code, requiredCredits: null, courseCodes: [] };
    if (group.requiredCredits === null && explicit) group.requiredCredits = Number(explicit[1]);
    const key = courseKey(course.code);
    if (!group.courseCodes.includes(key)) group.courseCodes.push(key);
    groups.set(code, group);
  }
  return [...groups.values()];
}

export const isPassedState = (state: CourseState) => state === "passed" || state === "exempt";
/** Has evidence for coverage: graded (any result) or exempt. */
export const isStudiedState = (state: CourseState) => state === "passed" || state === "exempt" || state === "failed" || state === "graded_unknown";
/** Any attempt at all, including a registration without grades. */
export const isAttemptedState = (state: CourseState) => isStudiedState(state) || state === "in_progress";

/**
 * Condition-only courses (GDTC/GDQP): conditionOnly of the selected standard; without
 * a standard, the CTĐT block "Giáo dục thể chất và giáo dục quốc phòng" or codes 71NAD/71PE.
 * The transcript's own `conditional` flag is not used (the native parser never sets it for these).
 */
export function conditionOnlyCodes(standard: Pick<GraduationData, "courses"> | null, courses: readonly CurriculumCourseInput[]): Set<string> {
  const fromStandard = new Set((standard?.courses ?? []).filter((course) => course.conditionOnly).map((course) => courseKey(course.code)));
  if (fromStandard.size) return fromStandard;
  return new Set(courses.filter((course) => {
    const block = fold(course.block);
    return block === CONDITION_ONLY_BLOCK || block.includes("giao duc the chat") || block.includes("giao duc quoc phong") ||
      CONDITION_ONLY_CODE_PATTERN.test(courseKey(course.code));
  }).map((course) => courseKey(course.code)));
}

export const isConditionOnly = (code: string, codes: ReadonlySet<string>) =>
  codes.has(courseKey(code)) || CONDITION_ONLY_CODE_PATTERN.test(courseKey(code));

/** One row per CTĐT code (the first one), rows without a code dropped: the competency table and the graduation page agree. */
export function uniqueCurriculumCourses<T extends Pick<CurriculumCourseInput, "code">>(courses: readonly T[]): T[] {
  const seen = new Set<string>();
  return courses.filter((course) => {
    const code = courseKey(course.code);
    if (!code || seen.has(code)) return false;
    seen.add(code);
    return true;
  });
}

/** CTĐT credit per code (first row per code); a missing, negative or non-finite credit reads 0, as in the competency table. */
export const curriculumCreditMap = (courses: readonly Pick<CurriculumCourseInput, "code" | "credits">[]) =>
  new Map(uniqueCurriculumCourses(courses).map((course) =>
    [courseKey(course.code), Number.isFinite(course.credits) && course.credits > 0 ? course.credits : 0] as const));

/**
 * E4 credit estimate when no total is printed: passed/MT (certain) and graded-with-unknown-result
 * credits of the codes in the program (standard ∪ CTĐT, see programCreditMap in graduation.ts),
 * condition-only courses and conditional attempts excluded. Credits: the program credit (standard
 * ?? CTĐT), else the transcript credit of the selected attempt; codes outside the program (AV0,
 * transferred rows of other programs) are not accumulated, as on the printed transcript.
 */
export function estimateProgramCredits(
  records: ReadonlyMap<string, TranscriptCourseRecord>,
  programCredits: ReadonlyMap<string, number | null>,
  conditionCodes: ReadonlySet<string>,
): { certain: number; unknown: number } {
  let certain = 0, unknown = 0;
  for (const record of records.values()) {
    if (!programCredits.has(record.code) || isConditionOnly(record.code, conditionCodes) || record.attempts.some((attempt) => attempt.conditional)) continue;
    const credits = programCredits.get(record.code) ?? (record.selected.credits > 0 ? record.selected.credits : 0);
    if (isPassedState(record.state)) certain += credits;
    else if (record.state === "graded_unknown") unknown += credits;
  }
  return { certain, unknown };
}

/**
 * Credits of the CTĐT courses that are certainly passed (passed/MT) and of those graded with
 * an unknown result, with CTĐT credits; condition-only courses and codes outside the CTĐT
 * (AV0, 0-credit rows) are not accumulated, as on the printed transcript.
 */
export function passedCurriculumCredits(
  records: ReadonlyMap<string, TranscriptCourseRecord>,
  curriculumCredits: ReadonlyMap<string, number>,
  conditionCodes: ReadonlySet<string>,
): { certain: number; unknown: number } {
  let certain = 0, unknown = 0;
  for (const record of records.values()) {
    const credits = curriculumCredits.get(record.code);
    if (credits === undefined || isConditionOnly(record.code, conditionCodes) || record.attempts.some((attempt) => attempt.conditional)) continue;
    if (isPassedState(record.state)) certain += credits;
    else if (record.state === "graded_unknown") unknown += credits;
  }
  return { certain, unknown };
}

/**
 * Cross-check for letter-grade inference (spec §5): credits of the passed CTĐT courses,
 * condition-only courses excluded, against the printed "Tổng số tín chỉ tích lũy".
 */
export function creditCrossCheck(
  data: TranscriptData,
  records: ReadonlyMap<string, TranscriptCourseRecord>,
  curriculumCredits: ReadonlyMap<string, number>,
  conditionCodes: ReadonlySet<string>,
): CreditCheck {
  const computed = passedCurriculumCredits(records, curriculumCredits, conditionCodes).certain;
  const printed = printedCumulativeCredits(data);
  if (printed === null || Number.isNaN(printed)) return { computed, printed: null, status: "unavailable" };
  return { computed, printed, status: Math.abs(computed - printed) < 1e-6 ? "match" : "mismatch" };
}
