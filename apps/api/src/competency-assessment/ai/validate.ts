// Server-side check of the AI commentary before it is stored (spec §10).
// Nothing is dropped silently: any problem returns a typed error and the job fails
// with invalid_ai_output.
import { z } from "zod";
import { AI_OUTPUT_LIMITS as L, AI_PRIORITIES, schemaContext, type AiOutput, type OutputSchemaContext } from "./schema.js";

export type { AiOutput } from "./schema.js";

export type AiValidationReason =
  | "schema"
  | "unknown_group_key"
  | "unknown_skill_key"
  | "unknown_gap_skill"
  | "foreign_course"
  | "duplicate"
  | "conflicting_skill"
  | "forbidden_content"
  | "invented_number";

export type AiValidationError = { code: "invalid_ai_output"; reason: AiValidationReason; path: string };
export type AiValidationResult = { ok: true; output: AiOutput } | { ok: false; error: AiValidationError };

export type AiValidationContext = OutputSchemaContext & {
  /** Every numeric value that appears in the data block sent to the model. */
  numbers: ReadonlySet<number>;
  /** Every course-code-like token of the data block; free text may name only these. */
  courseCodes: ReadonlySet<string>;
};

const text = (max: number) => z.string().max(max).refine((value) => value.trim().length > 0, "empty");
const priority = z.enum(AI_PRIORITIES);

export const aiOutputSchema = z.object({
  summary: text(L.summary),
  groupInsights: z.array(z.object({ groupKey: z.string().max(16), comment: text(L.groupComment) }).strict()).max(L.groupInsights),
  strengths: z.array(z.object({ skillKey: z.string().max(16), comment: text(L.skillComment) }).strict()).max(L.strengths),
  improvements: z.array(z.object({ skillKey: z.string().max(16), priority, comment: text(L.skillComment) }).strict()).max(L.improvements),
  careerFit: z.object({ comment: text(L.careerFit) }).strict(),
  gaps: z.array(z.object({
    skillKey: z.string().max(16),
    priority,
    explanation: text(L.gapExplanation),
    courses: z.array(z.object({ courseCode: z.string().max(32), reason: text(L.courseReason) }).strict()).max(L.gapCourses),
    selfStudy: z.array(text(L.selfStudyItem)).max(L.selfStudy)
  }).strict()).max(L.gaps),
  progress: text(L.progress),
  nextSteps: z.array(text(L.nextStep)).min(L.nextStepsMin).max(L.nextStepsMax)
}).strict();

/* ------------------------------------------------------------------------ */

const NUMBER_PATTERN = /\d+(?:[.,]\d+)?/g;

/** Numeric tokens of a text ("72,5" and "72.5" both read as 72.5; "HK253" gives 253). */
export function numbersIn(value: string): number[] {
  return (value.match(NUMBER_PATTERN) ?? []).map((token) => Number(token.replace(",", ".")));
}

export function numberSet(value: string): Set<number> {
  return new Set(numbersIn(value));
}

const TERM_WORDS_PATTERN = /học kỳ (\d) năm học (\d{4})\s*[–-]\s*\d{4}/g;
/**
 * The HKyyS codes of the terms the data block writes in words ("học kỳ 3 năm học 2025–2026" → 253),
 * so a model that still writes "HK253" for a term it was given is not rejected, while an
 * invented term code still is.
 */
export function termCodeNumbers(value: string): number[] {
  return [...value.normalize("NFC").matchAll(TERM_WORDS_PATTERN)].map((match) => Number(`${Number(match[2]) % 100}${match[1]}`));
}

const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /\b(?:https?|ftp):\/\//i,
  /\bwww\./i,
  /\b[\p{L}\d-]+\.(?:com|vn|org|edu|gov|info)(?:\.[a-z]{2})?(?:\/|\b)/iu,
  /[\p{L}\d._%+-]+@[\p{L}\d-]+\.[\p{L}\d.-]+/u,
  /<\/?[a-z!][^>]*>/i,
  /&(?:[a-z]+|#\d+|#x[\da-f]+);/i,
  /<\||\|>/
];

/** Course-code-like tokens ("71ITSE30103", "71ENG010012"; also a mangled "ITSE30103"). */
const COURSE_CODE_PATTERN = /\b\d{0,2}[A-Z]{2,6}\d{4,6}\b/g;
export function courseCodesIn(value: string): string[] {
  return value.match(COURSE_CODE_PATTERN) ?? [];
}

export function hasForbiddenContent(value: string): boolean {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(value));
}

/** Allowlists for one job, read back from the stored ai_input; null when it is malformed. */
export function validationContextFromAiInput(input: { schema: unknown; user: unknown }): AiValidationContext | null {
  const context = schemaContext(input.schema);
  if (!context || typeof input.user !== "string") return null;
  return { ...context, numbers: new Set([...numbersIn(input.user), ...termCodeNumbers(input.user)]), courseCodes: new Set(courseCodesIn(input.user)) };
}

const fail = (reason: AiValidationReason, path: string): AiValidationResult => ({ ok: false, error: { code: "invalid_ai_output", reason, path } });

export function validateAiOutput(raw: unknown, context: AiValidationContext): AiValidationResult {
  const parsed = aiOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("schema", issue ? issue.path.join(".") : "");
  }
  const output = parsed.data as AiOutput;
  const groups = new Set(context.groupKeys);
  const strengthKeys = new Set(context.strengthKeys);
  const improvementKeys = new Set(context.improvementKeys);
  const gapCourses = new Map(context.gapSkills.map((gap) => [gap.key, new Set(gap.courseCodes)]));

  const seen = (values: readonly string[]) => values.findIndex((value, index) => values.indexOf(value) !== index);

  for (const [index, item] of output.groupInsights.entries()) if (!groups.has(item.groupKey)) return fail("unknown_group_key", `groupInsights.${index}.groupKey`);
  for (const [index, item] of output.strengths.entries()) if (!strengthKeys.has(item.skillKey)) return fail("unknown_skill_key", `strengths.${index}.skillKey`);
  for (const [index, item] of output.improvements.entries()) if (!improvementKeys.has(item.skillKey)) return fail("unknown_skill_key", `improvements.${index}.skillKey`);
  for (const [index, gap] of output.gaps.entries()) {
    const allowed = gapCourses.get(gap.skillKey);
    if (!allowed) return fail("unknown_gap_skill", `gaps.${index}.skillKey`);
    for (const [courseIndex, course] of gap.courses.entries()) {
      if (!allowed.has(course.courseCode)) return fail("foreign_course", `gaps.${index}.courses.${courseIndex}.courseCode`);
    }
    const duplicateCourse = seen(gap.courses.map((course) => course.courseCode));
    if (duplicateCourse >= 0) return fail("duplicate", `gaps.${index}.courses.${duplicateCourse}.courseCode`);
  }
  // A skill named as a strength must not also be one to improve or a gap.
  const weak = new Set([...output.improvements, ...output.gaps].map((item) => item.skillKey));
  for (const [index, item] of output.strengths.entries()) if (weak.has(item.skillKey)) return fail("conflicting_skill", `strengths.${index}.skillKey`);
  const duplicates: [string, string[]][] = [
    ["groupInsights", output.groupInsights.map((item) => item.groupKey)],
    ["strengths", output.strengths.map((item) => item.skillKey)],
    ["improvements", output.improvements.map((item) => item.skillKey)],
    ["gaps", output.gaps.map((item) => item.skillKey)]
  ];
  for (const [field, keys] of duplicates) {
    const index = seen(keys);
    if (index >= 0) return fail("duplicate", `${field}.${index}`);
  }

  const texts: [string, string][] = [
    ["summary", output.summary],
    ...output.groupInsights.map((item, i): [string, string] => [`groupInsights.${i}.comment`, item.comment]),
    ...output.strengths.map((item, i): [string, string] => [`strengths.${i}.comment`, item.comment]),
    ...output.improvements.map((item, i): [string, string] => [`improvements.${i}.comment`, item.comment]),
    ["careerFit.comment", output.careerFit.comment],
    ...output.gaps.flatMap((gap, i): [string, string][] => [
      [`gaps.${i}.explanation`, gap.explanation],
      ...gap.courses.map((course, j): [string, string] => [`gaps.${i}.courses.${j}.reason`, course.reason]),
      ...gap.selfStudy.map((item, j): [string, string] => [`gaps.${i}.selfStudy.${j}`, item])
    ]),
    ["progress", output.progress],
    ...output.nextSteps.map((item, i): [string, string] => [`nextSteps.${i}`, item])
  ];
  for (const [path, value] of texts) {
    if (hasForbiddenContent(value)) return fail("forbidden_content", path);
    if (numbersIn(value).some((number) => !context.numbers.has(number))) return fail("invented_number", path);
    if (courseCodesIn(value).some((code) => !context.courseCodes.has(code))) return fail("foreign_course", path);
  }
  return { ok: true, output };
}
