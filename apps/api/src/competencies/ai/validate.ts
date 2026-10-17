// Server-side check of a course proposal before it is stored. Strict on the shape (anything
// unparseable fails the job with invalid_ai_output) but lenient per item: an unknown or repeated
// key is dropped and the rest is kept, because an admin reviews or confirms every proposal before
// anything is saved. Percentages are clamped to 0–100, rounded and scaled to a total of exactly 100
// (the grammar cannot enforce a sum), and a weights proposal always covers every linked skill.
import { z } from "zod";
import { sanitizeText } from "../../competency-assessment/ai/prompt.js";
import { cleanKeyText } from "../../competency-assessment/ai/key-cleanup.js";
import { hasForbiddenContent } from "../../competency-assessment/ai/validate.js";
import { fold } from "../../careers/shared.js";
import { cleanNewSkillName } from "../../careers/ai-suggestions/validate.js";
import { COURSE_AI_LIMITS as L, COURSE_AI_MODES, type CourseAiMode, type GroupKey, type SkillKey } from "./prompt.js";

/** One validated proposal row, as stored in ad_comp_ai_suggestions.result.items. */
export type StoredCourseAiItem = {
  /** null = a new skill that is not in the catalog (links mode only). */
  skillId: string | null;
  skillName: string;
  /** The profile's group, or for a career skill / new skill the group the model chose. */
  groupId: string | null;
  /** false for a career skill without a profile and for a new skill: applying creates the profile. */
  hasProfile: boolean;
  isNewSkill: boolean;
  /** weights and full: whole percent, all items together exactly 100. null in links. */
  percent: number | null;
  reason: string;
};
export type StoredCourseAiResult = {
  mode: CourseAiMode;
  items: StoredCourseAiItem[];
  /** Items the model returned and how many of them were dropped. */
  returned: number;
  dropped: number;
  /** weights and full: the model's own total before scaling to 100 (null in links). */
  modelTotal: number | null;
};
export type CourseAiContext = { mode: CourseAiMode; skills: SkillKey[]; groups: GroupKey[]; linked: { id: string; name: string }[] };
export type CourseAiValidation =
  | { ok: true; result: StoredCourseAiResult }
  | { ok: false; reason: "schema" | "no_valid_items"; path: string };

const raw = z.string().max(4000);
const key = z.string().max(16);
const percent = z.number();
const linksOutput = z.object({
  links: z.array(z.object({ skillKey: key, groupKey: key, reason: raw }).strict()).max(L.links),
  newSkills: z.array(z.object({ name: raw, groupKey: key, reason: raw }).strict()).max(L.newSkills)
}).strict();
const weightsOutput = z.object({ weights: z.array(z.object({ skillKey: key, percent, reason: raw }).strict()).max(300) }).strict();
const fullOutput = z.object({ links: z.array(z.object({ skillKey: key, groupKey: key, percent, reason: raw }).strict()).max(L.links) }).strict();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Key maps read back from the stored ai_input; null when it is malformed. */
export function courseAiContextFromInput(input: unknown): CourseAiContext | null {
  if (!isRecord(input) || !COURSE_AI_MODES.includes(input.mode as CourseAiMode)) return null;
  if (!Array.isArray(input.skills) || !Array.isArray(input.groups) || !Array.isArray(input.linked)) return null;
  const skills: SkillKey[] = [];
  for (const entry of input.skills) {
    if (!isRecord(entry) || typeof entry.key !== "string" || typeof entry.id !== "string" || typeof entry.name !== "string"
      || !(entry.groupId === null || typeof entry.groupId === "string")) return null;
    skills.push({ key: entry.key, id: entry.id, name: entry.name, groupId: entry.groupId });
  }
  const groups: GroupKey[] = [];
  for (const entry of input.groups) {
    if (!isRecord(entry) || typeof entry.key !== "string" || typeof entry.id !== "string" || typeof entry.name !== "string") return null;
    groups.push({ key: entry.key, id: entry.id, name: entry.name });
  }
  const linked: CourseAiContext["linked"] = [];
  for (const entry of input.linked) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string") return null;
    linked.push({ id: entry.id, name: entry.name });
  }
  return { mode: input.mode as CourseAiMode, skills, groups, linked };
}

/**
 * Whole percentages that add up to exactly 100: each value is clamped to 0–100, the list is scaled
 * to 100 and rounded by largest remainder (ties go to the earlier item). All zeros split evenly.
 */
export function normalizePercents(values: readonly number[]): number[] {
  if (!values.length) return [];
  const clean = values.map((value) => (Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0));
  const sum = clean.reduce((total, value) => total + value, 0);
  const base = sum > 0 ? clean : clean.map(() => 1);
  const total = sum > 0 ? sum : clean.length;
  const exact = base.map((value) => (value / total) * 100);
  const result = exact.map(Math.floor);
  let rest = 100 - result.reduce((acc, value) => acc + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - result[index]! }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (rest <= 0) break;
    result[index]! += 1;
    rest -= 1;
  }
  return result;
}

export function validateCourseAiOutput(output: unknown, context: CourseAiContext): CourseAiValidation {
  const byKey = new Map(context.skills.map((entry) => [entry.key, entry]));
  const groupIds = new Map(context.groups.map((entry) => [entry.key, entry.id]));
  const fallbackGroup = context.groups[0]?.id ?? null;
  const linkedIds = new Set(context.linked.map((skill) => skill.id));
  const names = new Map<string, string>([
    ...context.skills.map((entry) => [entry.key, entry.name] as const),
    ...context.groups.map((entry) => [entry.key, entry.name] as const)
  ]);
  // Keys written into prose become names; then control tokens are stripped and lengths capped. A
  // reason with a link or HTML is blanked, never a reason to drop the row.
  const reasonOf = (value: string) => {
    const reason = sanitizeText(cleanKeyText(value, names), L.reason);
    return hasForbiddenContent(reason) ? "" : reason;
  };
  const groupOf = (entry: SkillKey, groupKey: string) => entry.groupId ?? groupIds.get(groupKey) ?? fallbackGroup;
  const fail = (issue: z.ZodError): CourseAiValidation => ({ ok: false, reason: "schema", path: issue.issues[0]?.path.join(".") ?? "" });

  if (context.mode === "weights") {
    const parsed = weightsOutput.safeParse(output);
    if (!parsed.success) return fail(parsed.error);
    const given = new Map<string, { percent: number; reason: string }>();
    for (const item of parsed.data.weights) {
      const entry = byKey.get(item.skillKey);
      if (!entry || given.has(entry.id)) continue;
      given.set(entry.id, { percent: item.percent, reason: reasonOf(item.reason) });
    }
    const returned = parsed.data.weights.length;
    if (!given.size) return { ok: false, reason: "no_valid_items", path: "" };
    // Every linked skill is covered; one the model left out gets 0 before scaling.
    const modelTotal = [...given.values()].reduce((sum, item) => sum + (Number.isFinite(item.percent) ? item.percent : 0), 0);
    const percents = normalizePercents(context.skills.map((entry) => given.get(entry.id)?.percent ?? 0));
    const items = context.skills.map((entry, index) => ({
      skillId: entry.id, skillName: entry.name, groupId: entry.groupId, hasProfile: true, isNewSkill: false,
      percent: percents[index]!, reason: given.get(entry.id)?.reason ?? ""
    }));
    return { ok: true, result: { mode: "weights", items, returned, dropped: returned - given.size, modelTotal } };
  }

  const items: StoredCourseAiItem[] = [];
  const used = new Set<string>();
  const folded = (name: string) => fold(name.replace(/\s+/g, " ").trim());
  const byName = new Map(context.skills.map((entry) => [folded(entry.name), entry]));

  if (context.mode === "full") {
    const parsed = fullOutput.safeParse(output);
    if (!parsed.success) return fail(parsed.error);
    const kept: { entry: SkillKey; percent: number; groupId: string | null; reason: string }[] = [];
    for (const item of parsed.data.links) {
      const entry = byKey.get(item.skillKey);
      if (!entry || used.has(entry.id) || linkedIds.has(entry.id)) continue;
      used.add(entry.id);
      kept.push({ entry, percent: item.percent, groupId: groupOf(entry, item.groupKey), reason: reasonOf(item.reason) });
    }
    const returned = parsed.data.links.length;
    if (returned > 0 && !kept.length) return { ok: false, reason: "no_valid_items", path: "" };
    const modelTotal = kept.reduce((sum, item) => sum + (Number.isFinite(item.percent) ? item.percent : 0), 0);
    const percents = normalizePercents(kept.map((item) => item.percent));
    kept.forEach((item, index) => items.push({
      skillId: item.entry.id, skillName: item.entry.name, groupId: item.groupId, hasProfile: item.entry.groupId !== null,
      isNewSkill: false, percent: percents[index]!, reason: item.reason
    }));
    return { ok: true, result: { mode: "full", items, returned, dropped: returned - items.length, modelTotal: kept.length ? modelTotal : null } };
  }

  const parsed = linksOutput.safeParse(output);
  if (!parsed.success) return fail(parsed.error);
  const linkedNames = new Set(context.linked.map((skill) => folded(skill.name)));
  const newNames = new Set<string>();
  for (const item of parsed.data.links) {
    const entry = byKey.get(item.skillKey);
    if (!entry || used.has(entry.id) || linkedIds.has(entry.id)) continue;
    used.add(entry.id);
    items.push({ skillId: entry.id, skillName: entry.name, groupId: groupOf(entry, item.groupKey), hasProfile: entry.groupId !== null,
      isNewSkill: false, percent: null, reason: reasonOf(item.reason) });
  }
  for (const item of parsed.data.newSkills) {
    const name = cleanNewSkillName(sanitizeText(cleanKeyText(item.name, names), L.skillName));
    const key = folded(name);
    if (!name || hasForbiddenContent(name) || linkedNames.has(key)) continue;
    // A "new" name that is already a candidate becomes that skill.
    const existing = byName.get(key);
    if (existing ? used.has(existing.id) || linkedIds.has(existing.id) : newNames.has(key)) continue;
    if (existing) {
      used.add(existing.id);
      items.push({ skillId: existing.id, skillName: existing.name, groupId: groupOf(existing, item.groupKey), hasProfile: existing.groupId !== null,
        isNewSkill: false, percent: null, reason: reasonOf(item.reason) });
    } else {
      newNames.add(key);
      items.push({ skillId: null, skillName: name, groupId: groupIds.get(item.groupKey) ?? fallbackGroup, hasProfile: false,
        isNewSkill: true, percent: null, reason: reasonOf(item.reason) });
    }
  }
  const returned = parsed.data.links.length + parsed.data.newSkills.length;
  if (returned > 0 && !items.length) return { ok: false, reason: "no_valid_items", path: "" };
  return { ok: true, result: { mode: "links", items, returned, dropped: returned - items.length, modelTotal: null } };
}
