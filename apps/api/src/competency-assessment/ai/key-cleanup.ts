// Removes internal skill/group keys (S01…, G1…) that the model wrote into prose despite the
// prompt rule. Applied to the validated output before it is stored; the web page runs the
// same cleanup (apps/web/src/student-competency-data.ts cleanKeyText) as a safety net.
import type { AiOutput } from "./schema.js";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEY_PATTERN = /(?<![\p{L}\p{N}])[SG]\d{1,3}(?![\p{L}\p{N}])/gu;
/** Separator between a name and its key: dash, colon, comma, slash, or plain spaces. */
const SEP = "(?:\\s*[-–—:,/]\\s*|\\s+)";
const OPEN = "[(\\[]";
const CLOSE = "[)\\]]";

/**
 * A key next to its own name is dropped with its separator ("API (S12)" → "API",
 * "(API - S12)" → "(API)", "S12 - API" → "API"); a bracketed key elsewhere is dropped;
 * a bare key elsewhere becomes the name. Unknown keys are left as they are.
 */
export function cleanKeyText(text: string, names: ReadonlyMap<string, string>): string {
  let out = text;
  const keys = [...new Set(out.match(KEY_PATTERN) ?? [])].filter((key) => names.has(key));
  if (!keys.length) return text;
  for (const key of keys) {
    const name = names.get(key)!.trim();
    const k = `(?<![\\p{L}\\p{N}])${key}(?![\\p{L}\\p{N}])`;
    if (name) {
      const n = `((?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}]))`;
      const rules = [
        `${n}\\s*${OPEN}\\s*${k}\\s*${CLOSE}`, // API (S12)
        `${n}${SEP}${k}`, // API - S12, (API, S12)
        `${OPEN}\\s*${k}\\s*${CLOSE}\\s*${n}`, // (S12) API
        `${k}\\s*${OPEN}\\s*${n}\\s*${CLOSE}`, // S12 (API)
        `${k}${SEP}${n}` // S12 - API, (S12: API)
      ];
      for (const rule of rules) out = out.replace(new RegExp(rule, "giu"), "$1");
    }
    out = out.replace(new RegExp(`\\s*${OPEN}\\s*${k}\\s*${CLOSE}`, "gu"), "");
    if (name) out = out.replace(new RegExp(k, "gu"), name);
  }
  return out.replace(/ {2,}/g, " ").replace(/\s+([.,;:!?)])/g, "$1").trim();
}

/** Skill and group names of a stored result (computed->skillDirectory and computed->groups). */
export function keyNamesFrom(skills: unknown, groups: unknown): Map<string, string> {
  const names = new Map<string, string>();
  for (const list of [skills, groups]) {
    if (!Array.isArray(list)) continue;
    for (const item of list as { key?: unknown; name?: unknown }[]) {
      if (typeof item?.key === "string" && typeof item.name === "string" && item.name.trim()) names.set(item.key, item.name);
    }
  }
  return names;
}

/** The same output with every prose field cleaned; keys in skillKey/groupKey/courseCode stay. */
export function cleanAiOutputKeys(output: AiOutput, names: ReadonlyMap<string, string>): AiOutput {
  if (!names.size) return output;
  const clean = (value: string) => cleanKeyText(value, names);
  return {
    summary: clean(output.summary),
    groupInsights: output.groupInsights.map((item) => ({ ...item, comment: clean(item.comment) })),
    strengths: output.strengths.map((item) => ({ ...item, comment: clean(item.comment) })),
    improvements: output.improvements.map((item) => ({ ...item, comment: clean(item.comment) })),
    careerFit: { comment: clean(output.careerFit.comment) },
    gaps: output.gaps.map((gap) => ({
      ...gap,
      explanation: clean(gap.explanation),
      courses: gap.courses.map((course) => ({ ...course, reason: clean(course.reason) })),
      selfStudy: gap.selfStudy.map(clean)
    })),
    progress: clean(output.progress),
    nextSteps: output.nextSteps.map(clean)
  };
}
