// Server-side check of a career skill suggestion before it is stored. Strict on the shape
// (anything unparseable fails the job with invalid_ai_output) but lenient per item: an item
// with an unknown or repeated key, or with a link/email/HTML in its text, is dropped and the
// rest are kept, because the admin reviews every row before anything is saved.
import { z } from "zod";
import { sanitizeText } from "../../competency-assessment/ai/prompt.js";
import { cleanKeyText } from "../../competency-assessment/ai/key-cleanup.js";
import { hasForbiddenContent } from "../../competency-assessment/ai/validate.js";
import { fold } from "../shared.js";
import { CAREER_PRIORITIES, CAREER_SUGGESTION_LIMITS as L, type CatalogKey } from "./prompt.js";

/** One validated suggestion, as stored in career_ai_suggestions.result.items. */
export type StoredSuggestionItem = {
  /** null = a new skill that is not in the catalog. */
  skillId: string | null;
  skillName: string;
  isNewSkill: boolean;
  isRequired: boolean;
  title: string;
  description: string;
  reason: string;
};
export type StoredSuggestionResult = {
  items: StoredSuggestionItem[];
  /** Items the model returned (suggestions + newSkills) and how many of them were dropped. */
  returned: number;
  dropped: number;
};
export type CareerSuggestionContext = { catalog: CatalogKey[]; linked: { id: string; name: string }[] };
export type CareerSuggestionValidation =
  | { ok: true; result: StoredSuggestionResult }
  | { ok: false; reason: "schema" | "no_valid_items"; path: string };

const raw = z.string().max(4000);
const details = { priority: z.enum(CAREER_PRIORITIES), title: raw, description: raw, reason: raw };
export const careerSuggestionOutputSchema = z.object({
  suggestions: z.array(z.object({ skillKey: z.string().max(16), ...details }).strict()).max(L.suggestions),
  newSkills: z.array(z.object({ name: raw, ...details }).strict()).max(L.newSkills)
}).strict();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Key map and linked skills read back from the stored ai_input; null when it is malformed. */
export function suggestionContextFromAiInput(input: unknown): CareerSuggestionContext | null {
  if (!isRecord(input) || !Array.isArray(input.catalog) || !Array.isArray(input.linked)) return null;
  const catalog: CatalogKey[] = [];
  for (const entry of input.catalog) {
    if (!isRecord(entry) || typeof entry.key !== "string" || typeof entry.id !== "string" || typeof entry.name !== "string") return null;
    catalog.push({ key: entry.key, id: entry.id, name: entry.name });
  }
  const linked: CareerSuggestionContext["linked"] = [];
  for (const entry of input.linked) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string") return null;
    linked.push({ id: entry.id, name: entry.name });
  }
  return { catalog, linked };
}

export function validateCareerSuggestionOutput(output: unknown, context: CareerSuggestionContext): CareerSuggestionValidation {
  const parsed = careerSuggestionOutputSchema.safeParse(output);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: "schema", path: issue ? issue.path.join(".") : "" };
  }
  const { suggestions, newSkills } = parsed.data;
  const byKey = new Map(context.catalog.map((entry) => [entry.key, entry]));
  const byName = new Map(context.catalog.map((entry) => [fold(entry.name.trim()), entry]));
  const linkedNames = new Set(context.linked.map((skill) => fold(skill.name.trim())));
  const names = new Map(context.catalog.map((entry) => [entry.key, entry.name]));
  // Keys written into prose become names; then control tokens are stripped and lengths capped.
  const clean = (value: string, max: number) => sanitizeText(cleanKeyText(value, names), max);

  const items: StoredSuggestionItem[] = [];
  const usedSkills = new Set<string>();
  const usedNewNames = new Set<string>();
  const texts = (item: { priority: string; title: string; description: string; reason: string }) => {
    const title = clean(item.title, L.title);
    const description = clean(item.description, L.description);
    const reason = clean(item.reason, L.reason);
    if (!title || [title, description, reason].some(hasForbiddenContent)) return null;
    return { isRequired: item.priority === "required", title, description, reason };
  };

  for (const item of suggestions) {
    const entry = byKey.get(item.skillKey);
    if (!entry || usedSkills.has(entry.id)) continue;
    const body = texts(item);
    if (!body) continue;
    usedSkills.add(entry.id);
    items.push({ skillId: entry.id, skillName: entry.name, isNewSkill: false, ...body });
  }
  for (const item of newSkills) {
    const name = clean(item.name, L.skillName);
    const key = fold(name);
    if (!name || hasForbiddenContent(name) || linkedNames.has(key)) continue;
    // A "new" name that is already in the catalog becomes that catalog skill.
    const existing = byName.get(key);
    if (existing ? usedSkills.has(existing.id) : usedNewNames.has(key)) continue;
    const body = texts(item);
    if (!body) continue;
    if (existing) {
      usedSkills.add(existing.id);
      items.push({ skillId: existing.id, skillName: existing.name, isNewSkill: false, ...body });
    } else {
      usedNewNames.add(key);
      items.push({ skillId: null, skillName: name, isNewSkill: true, ...body });
    }
  }

  const returned = suggestions.length + newSkills.length;
  if (returned > 0 && !items.length) return { ok: false, reason: "no_valid_items", path: "" };
  return { ok: true, result: { items, returned, dropped: returned - items.length } };
}
