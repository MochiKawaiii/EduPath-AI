// Server-side check of a graduation advice before it is stored (design §5.6). Strict on the
// shape: anything that is not { summary, advice[{ focus, text }], nextSteps[] } fails the job with
// invalid_ai_output. Lenient per item: an advice item or next step with forbidden content
// (link, email, HTML, special token), a number or a course code that is not in the data block,
// an unknown condition key or an unknown focus is dropped and the rest are kept. Condition keys
// written into prose ([G1], G1, CREDITS, GPA) become their names. The job fails only when the
// summary is unusable or no advice item or no next step remains.
import { z } from "zod";
import { sanitizeText } from "../../competency-assessment/ai/prompt.js";
import { courseCodesIn, hasForbiddenContent, numbersIn, termCodeNumbers } from "../../competency-assessment/ai/validate.js";
import { CREDITS_KEY, CREDITS_LABEL, GENERAL_LABEL, GPA_KEY, GPA_LABEL, type GraduationAdviceKey } from "./prompt.js";
import { GENERAL_FOCUS, GRADUATION_ADVICE_LIMITS as L } from "./schema.js";

/** One stored advice item: the condition key, its name for the student and the text. */
export type GraduationAdviceItem = { focus: string; label: string; text: string };
/** The cleaned advice stored in stu_grad_advice.ai_output (the web mirrors it). */
export type GraduationAdviceOutput = { summary: string; advice: GraduationAdviceItem[]; nextSteps: string[] };

export type GraduationAdviceContext = {
  /** Condition keys of the job (G1…, CREDITS, GPA) with their labels. */
  keys: GraduationAdviceKey[];
  /** Every number of the data block, plus the HKyyS codes of the terms it writes in words. */
  numbers: ReadonlySet<number>;
  /** Every course-code-like token of the data block. */
  courseCodes: ReadonlySet<string>;
};

export type GraduationAdviceValidation =
  | { ok: true; output: GraduationAdviceOutput; dropped: number }
  | { ok: false; reason: "schema" | "summary" | "no_advice" | "no_next_steps"; path: string };

const raw = z.string().max(4000);
/** The shape only; lengths and counts are capped by the grammar and trimmed below. */
export const graduationAdviceOutputSchema = z.object({
  summary: raw,
  advice: z.array(z.object({ focus: z.string().max(64), text: raw }).strict()).max(20),
  nextSteps: z.array(raw).max(20),
}).strict();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Key map and allowlists read back from the stored ai_input; null when it is malformed. */
export function graduationAdviceContextFromAiInput(input: unknown): GraduationAdviceContext | null {
  if (!isRecord(input) || typeof input.user !== "string" || !Array.isArray(input.keys)) return null;
  const keys: GraduationAdviceKey[] = [];
  for (const entry of input.keys) {
    if (!isRecord(entry) || typeof entry.key !== "string" || !entry.key || typeof entry.label !== "string" ||
      !(entry.groupId === null || typeof entry.groupId === "string")) return null;
    keys.push({ key: entry.key, groupId: entry.groupId, label: entry.label });
  }
  return {
    keys,
    numbers: new Set([...numbersIn(input.user), ...termCodeNumbers(input.user)]),
    courseCodes: new Set(courseCodesIn(input.user)),
  };
}

/* ------------------------------------------------------------------------ */
/* Condition keys in prose → names. */

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}_])";
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}_])";
/** Tokens that look like a condition key; one that is not a key of the job makes the text invalid. */
const KEY_TOKEN = new RegExp(`${NOT_WORD_BEFORE}(?:G\\d{1,3}|${CREDITS_KEY}|${GPA_KEY}|${GENERAL_FOCUS})${NOT_WORD_AFTER}`, "gu");
const SECTION_REFERENCE = /\[\s*\d{1,2}\s*\]|(?<![\p{L}\p{N}_])mục\s*\[?\s*\d/iu;
const OPEN = "[(\\[]";
const CLOSE = "[)\\]]";
const SEP = "\\s*[-–—:]\\s*";

type KeyReplacement = { key: string; inline: string; names: string[] };

function replacements(keys: readonly GraduationAdviceKey[]): KeyReplacement[] {
  const list: KeyReplacement[] = keys.filter((item) => item.key !== CREDITS_KEY && item.key !== GPA_KEY).map((item) => ({
    key: item.key,
    inline: item.label,
    // A model that writes "nhóm TC306 (G5)" names the group by its code.
    names: [item.label, ...new Set(item.label.match(/\bTC\d{3}\b/gi) ?? [])],
  }));
  // CREDITS and GPA always read as their fixed names, also in a job without a credit condition.
  list.push(
    { key: CREDITS_KEY, inline: CREDITS_LABEL.toLocaleLowerCase("vi"), names: [CREDITS_LABEL, "số tín chỉ tích lũy", "tín chỉ tích lũy", "tín chỉ"] },
    { key: GPA_KEY, inline: GPA_LABEL.toLocaleLowerCase("vi"), names: [GPA_LABEL, "điểm trung bình"] },
  );
  return list.sort((a, b) => b.key.length - a.key.length);
}

/** Starts a sentence when nothing, or the end of a sentence, comes before it. */
const sentenceStart = (text: string, offset: number) => {
  const before = text.slice(0, offset).trimEnd();
  return before === "" || /[.!?]$/.test(before);
};
const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase("vi") + value.slice(1);

/**
 * Replaces the condition keys of the job written into prose by their names: a key next to its
 * own name is dropped with its brackets or separator ("Nhóm tự chọn TC306 (G5)" → "Nhóm tự chọn
 * TC306", "[G5] Nhóm tự chọn TC306" → "Nhóm tự chọn TC306"); any other key, bracketed or bare,
 * becomes the name ("[GPA]" → "điểm trung bình tích lũy", capitalised at the start of a sentence).
 */
export function replaceConditionKeys(text: string, keys: readonly GraduationAdviceKey[]): string {
  let out = text;
  for (const item of replacements(keys)) {
    const k = `${NOT_WORD_BEFORE}${item.key}${NOT_WORD_AFTER}`;
    if (!new RegExp(k, "iu").test(out)) continue;
    const names = [...item.names].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
    const n = `(${NOT_WORD_BEFORE}(?:${names})${NOT_WORD_AFTER})`;
    const rules = [
      `${n}\\s*${OPEN}\\s*${k}\\s*${CLOSE}`, // Nhóm tự chọn TC306 (G5)
      `${OPEN}\\s*${k}\\s*${CLOSE}(?:${SEP}|\\s*)${n}`, // [G5] Nhóm tự chọn TC306, (G5): Nhóm …
      `${k}(?:${SEP}|\\s+)${n}`, // G5: Nhóm tự chọn TC306, G5 Nhóm …
      `${n}(?:${SEP}|\\s+)${k}`, // Nhóm tự chọn TC306 - G5, điểm trung bình GPA
    ];
    for (const rule of rules) out = out.replace(new RegExp(rule, "giu"), "$1");
    // "điểm GPA" → "điểm trung bình tích lũy", keeping the case of "điểm".
    if (item.key === GPA_KEY) out = out.replace(new RegExp(`${NOT_WORD_BEFORE}(điểm)\\s+${k}`, "giu"), "$1 trung bình tích lũy");
    const name = (_match: string, offset: number, whole: string) => (sentenceStart(whole, offset) ? capitalize(item.inline) : item.inline);
    out = out.replace(new RegExp(`${OPEN}\\s*${k}\\s*${CLOSE}`, "giu"), name);
    out = out.replace(new RegExp(k, "giu"), name);
  }
  return out.replace(/ {2,}/g, " ").replace(/\s+([.,;:!?)\]])/g, "$1").trim();
}

/* ------------------------------------------------------------------------ */

/**
 * One prose field as stored: sanitized, keys replaced by names, length capped (with room for
 * the names), or null when it must be dropped.
 */
function cleanText(value: string, max: number, context: GraduationAdviceContext, known: ReadonlySet<string>): string | null {
  // Special tokens, links and markup in the raw text already disqualify it (sanitizeText would hide them).
  if (hasForbiddenContent(value)) return null;
  // "mục [4]", "[6]": section numbers of the data block mean nothing to the student.
  if (SECTION_REFERENCE.test(value)) return null;
  const sanitized = sanitizeText(value, 4000);
  if ((sanitized.match(KEY_TOKEN) ?? []).some((token) => !known.has(token))) return null;
  const text = sanitizeText(replaceConditionKeys(sanitized, context.keys), max * 2);
  if (!text || hasForbiddenContent(text)) return null;
  if (numbersIn(text).some((number) => !context.numbers.has(number))) return null;
  if (courseCodesIn(text).some((code) => !context.courseCodes.has(code))) return null;
  return text;
}

export function validateGraduationAdviceOutput(output: unknown, context: GraduationAdviceContext): GraduationAdviceValidation {
  const parsed = graduationAdviceOutputSchema.safeParse(output);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: "schema", path: issue ? issue.path.join(".") : "" };
  }
  const labels = new Map(context.keys.map((item) => [item.key, item.label]));
  // Keys a text may name: the job's condition keys and the fixed CREDITS/GPA names (GENERAL is a focus only).
  const known = new Set([...labels.keys(), CREDITS_KEY, GPA_KEY]);
  const summary = cleanText(parsed.data.summary, L.summary, context, known);
  if (!summary) return { ok: false, reason: "summary", path: "summary" };

  const advice: GraduationAdviceItem[] = [];
  for (const item of parsed.data.advice) {
    const label = item.focus === GENERAL_FOCUS ? GENERAL_LABEL : labels.get(item.focus);
    if (!label) continue;
    const text = cleanText(item.text, L.adviceText, context, known);
    if (text) advice.push({ focus: item.focus, label, text });
  }
  const nextSteps = parsed.data.nextSteps
    .map((step) => cleanText(step, L.nextStep, context, known))
    .filter((step): step is string => Boolean(step));
  if (!advice.length) return { ok: false, reason: "no_advice", path: "advice" };
  if (!nextSteps.length) return { ok: false, reason: "no_next_steps", path: "nextSteps" };

  const kept = { summary, advice: advice.slice(0, L.adviceMax), nextSteps: nextSteps.slice(0, L.nextStepsMax) };
  const returned = parsed.data.advice.length + parsed.data.nextSteps.length;
  return { ok: true, output: kept, dropped: returned - kept.advice.length - kept.nextSteps.length };
}
