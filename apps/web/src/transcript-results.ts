import type { Transcript } from "./StudentTranscript";
import { academicSections, latestResultSection } from "./student-overview-data";

type ResultCourse = {
  code: string;
  result: string | null;
  letter?: string | null;
  score10?: number | null;
  score4?: number | null;
};
export type CourseResult = "pass" | "fail";
/** "unknown": graded, but the result cannot be read. "pending": registered, no grade yet. */
export type ResultStatus = CourseResult | "unknown" | "pending";
export type CourseOutcome = {
  status: ResultStatus;
  /** Pass/fail comes from the official letter grade because the printed result cell is blank. */
  inferred: boolean;
  /** An MT (miễn thi/công nhận) attempt decides the course. */
  exempt: boolean;
};

/** Passing letter grades; the OCR pipeline uses the same set (services/ocr/test_ocr.py PASS_LETTERS). */
export const PASS_LETTERS: readonly string[] = ["A+", "A", "B+", "B", "C+", "C", "D+", "D"];
export const INFERRED_RESULT_NOTE = "suy ra từ điểm chữ";

const key = (code: string) => code.trim().toUpperCase();
const failedText = /^(không|khong|chưa|chua|ko)\s*đạt|^(rớt|trượt)|^[✗✘×x]$/;
const passedText = /^đạt|^[✓✔v]$/;

/** One transcript row. A printed result always wins; only a blank result cell
    falls back to the letter grade (icon-only results are stored as blank). */
export function attemptOutcome(course: ResultCourse): CourseOutcome {
  const letter = course.letter?.trim().toUpperCase() ?? "";
  if (letter === "MT") return { status: "pass", inferred: false, exempt: true };
  const text = (course.result ?? "").normalize("NFC").trim().toLowerCase();
  if (text) {
    const status = failedText.test(text) ? "fail" : passedText.test(text) ? "pass" : "unknown";
    return { status, inferred: false, exempt: false };
  }
  if (PASS_LETTERS.includes(letter)) return { status: "pass", inferred: true, exempt: false };
  if (letter === "F") return { status: "fail", inferred: true, exempt: false };
  const graded = letter !== "" || (course.score10 ?? null) !== null || (course.score4 ?? null) !== null;
  return { status: graded ? "unknown" : "pending", inferred: false, exempt: false };
}

const rank: Record<ResultStatus, number> = { pass: 3, unknown: 2, fail: 1, pending: 0 };
/** Passing any attempt satisfies the course. A graded attempt with an unreadable
    result may still be a pass, so it outranks a failed one. */
function merge(current: CourseOutcome | undefined, next: CourseOutcome): CourseOutcome {
  if (!current || rank[next.status] > rank[current.status]) return next;
  if (rank[next.status] < rank[current.status]) return current;
  // The same status from a printed result or MT confirms an inferred one.
  return { status: current.status, inferred: current.inferred && next.inferred, exempt: current.exempt || next.exempt };
}

/** Outcome per normalized course code across all attempts, including "Điểm bảo lưu". */
export function transcriptOutcomes(sections: { courses: ResultCourse[] }[]) {
  const outcomes = new Map<string, CourseOutcome>();
  for (const course of sections.flatMap((section) => section.courses)) {
    const code = key(course.code);
    if (code) outcomes.set(code, merge(outcomes.get(code), attemptOutcome(course)));
  }
  return outcomes;
}

/** Known pass/fail per normalized course code; unknown and ungraded courses are left out. */
export function transcriptResults(sections: { courses: ResultCourse[] }[]) {
  const results = new Map<string, CourseResult>();
  for (const [code, outcome] of transcriptOutcomes(sections))
    if (outcome.status === "pass" || outcome.status === "fail") results.set(code, outcome.status);
  return results;
}

/** GDTC/GDQP: no academic credits. Matches the OCR adapter's 71NAD/71PE rule. */
export const conditionalCourseCode = /^(71NAD|71PE)/;
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ");

export type CreditCheck = {
  /** "Tổng số tín chỉ tích lũy" of the latest graded term; null when missing or unclear. */
  printed: number | null;
  /** Passed credits that count, without condition-only courses, each course once. */
  computed: number;
  /** Passed "Điểm bảo lưu" credits that count only if the course belongs to the programme. */
  uncertain: number;
  /** Credits of graded courses whose result cannot be read. */
  undecided: number;
  /** Counted courses whose pass comes from a letter grade. */
  inferredCourses: number;
  status: "match" | "mismatch" | "unavailable";
};

/**
 * Cross-checks the per-course results against the school's printed cumulative
 * credits. Passes from regular terms always count. A transferred pass counts
 * when it is in `programCodes`; without that list it may or may not count
 * (e.g. preparatory English), so it widens the accepted range instead.
 */
export function transcriptCreditCheck(
  transcript: Transcript | null,
  options: { conditionCodes?: Iterable<string>; programCodes?: Iterable<string> } = {},
): CreditCheck {
  const conditionCodes = new Set([...(options.conditionCodes ?? [])].map(key));
  const programCodes = options.programCodes ? new Set([...options.programCodes].map(key)) : null;
  const terms = academicSections(transcript);
  const courses = new Map<string, { outcome: CourseOutcome; credits: number; inTerm: boolean; conditional: boolean }>();
  for (const section of transcript?.data.sections ?? []) {
    const inTerm = terms.includes(section);
    for (const course of section.courses) {
      const code = key(course.code);
      if (!code) continue;
      const attempt = attemptOutcome(course);
      const current = courses.get(code);
      const outcome = merge(current?.outcome, attempt);
      courses.set(code, {
        outcome,
        credits: Math.max(current?.credits ?? 0, Number.isFinite(course.credits) && course.credits > 0 ? course.credits : 0),
        inTerm: (current?.outcome.status === outcome.status && current.inTerm) || (attempt.status === outcome.status && inTerm),
        conditional: Boolean(current?.conditional || course.conditional || conditionalCourseCode.test(code) || conditionCodes.has(code)),
      });
    }
  }
  let computed = 0, uncertain = 0, undecided = 0, inferredCourses = 0;
  for (const [code, course] of courses) {
    if (course.conditional) continue;
    const counts = course.inTerm || programCodes?.has(code);
    if (!counts && programCodes) continue; // A transferred course outside the programme.
    if (course.outcome.status === "pass") {
      if (counts) {
        computed += course.credits;
        if (course.outcome.inferred) inferredCourses++;
      } else uncertain += course.credits;
    } else if (course.outcome.status === "unknown") undecided += course.credits;
  }
  // Only the latest graded term's cumulative line, as for the cumulative GPA.
  const values = latestResultSection(terms)?.summaries
    .filter((summary) => /so tin chi tich luy/.test(fold(summary.label)))
    .map((summary) => summary.value?.trim().replace(",", ".") ?? "") ?? [];
  const printed = values.length && values.every((value) => /^\d+(?:\.\d+)?$/.test(value)) &&
    new Set(values.map(Number)).size === 1 ? Number(values[0]) : null;
  const status = !transcript || printed === null ? "unavailable"
    : printed + 1e-9 >= computed && printed <= computed + uncertain + 1e-9 ? "match" : "mismatch";
  return { printed, computed, uncertain, undecided, inferredCourses, status };
}
