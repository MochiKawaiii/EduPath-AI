// Server-side check of the "AI 100%" scoring answer (comp-ai-v1) before it is stored. Structured outputs
// already force the shape and the keys; this checks what the schema cannot: every key exactly once,
// scores in 0–100, and that the answer agrees with itself (each career status and deficit with the
// model's own skill score and the threshold, the overall score with the mean of its own group scores).
// It never recomputes a score from the data. Nothing is repaired: any problem rejects the answer.
import { z } from "zod";
import { SCORING_FITS, SCORING_PROMPT_VERSION, SCORING_STATUSES, type ScoringKeys } from "./scoring-prompt.js";

export type ScoringStatus = (typeof SCORING_STATUSES)[number];
export type ScoringFit = (typeof SCORING_FITS)[number];

/** Stored in stu_comp_assessments.ai_scoring. Scores keep 2 decimals; the model's levels are not kept (the page derives them from its scores). */
export type AiScoring = {
  promptVersion: typeof SCORING_PROMPT_VERSION;
  skills: Record<string, number | null>;
  groups: Record<string, number | null>;
  overall: number | null;
  /** By requirement key Y1, Y2 … */
  career: Record<string, { status: ScoringStatus; deficit: number | null }>;
  careerFit: ScoringFit;
};

export type ScoringValidationReason =
  | "schema" | "unknown_key" | "missing_key" | "duplicate" | "score_range" | "deficit" | "career_status" | "overall_mean";

/** How far the model's own numbers may disagree (its 2-decimal rounding). */
export const SCORING_TOLERANCE = 0.05;
export type ScoringValidationResult = { ok: true; scoring: AiScoring } | { ok: false; reason: ScoringValidationReason; path: string };

const score = z.union([z.number().finite(), z.null()]);
const answerSchema = z.object({
  skills: z.array(z.object({ skillKey: z.string(), score, level: z.string() }).strict()),
  groups: z.array(z.object({ groupKey: z.string(), score, level: z.string() }).strict()),
  overall: z.object({ score, level: z.string() }).strict(),
  career: z.array(z.object({ requirementKey: z.string(), status: z.enum(SCORING_STATUSES), deficit: score }).strict()),
  careerFit: z.enum(SCORING_FITS),
}).strict();

const round2 = (value: number) => Math.round(value * 100) / 100;
const inRange = (value: number | null) => value === null || (value >= 0 && value <= 100);

/** Every expected key exactly once, nothing else; returns the failing reason or a key → item map. */
function byKey<T>(items: readonly T[], keyOf: (item: T) => string, expected: readonly string[], field: string) {
  const allowed = new Set(expected);
  const map = new Map<string, T>();
  for (const [index, item] of items.entries()) {
    const key = keyOf(item);
    if (!allowed.has(key)) return { ok: false as const, reason: "unknown_key" as const, path: `${field}.${index}` };
    if (map.has(key)) return { ok: false as const, reason: "duplicate" as const, path: `${field}.${index}` };
    map.set(key, item);
  }
  const missing = expected.find((key) => !map.has(key));
  if (missing !== undefined) return { ok: false as const, reason: "missing_key" as const, path: `${field}.${missing}` };
  return { ok: true as const, map };
}

export function validateScoring(raw: unknown, keys: ScoringKeys): ScoringValidationResult {
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "schema", path: parsed.error.issues[0]?.path.join(".") ?? "" };
  const answer = parsed.data;
  const skills = byKey(answer.skills, (item) => item.skillKey, keys.skillKeys, "skills");
  if (!skills.ok) return skills;
  const groups = byKey(answer.groups, (item) => item.groupKey, keys.groupKeys, "groups");
  if (!groups.ok) return groups;
  const career = byKey(answer.career, (item) => item.requirementKey, keys.career.map((req) => req.key), "career");
  if (!career.ok) return career;

  for (const [key, item] of skills.map) if (!inRange(item.score)) return { ok: false, reason: "score_range", path: `skills.${key}` };
  for (const [key, item] of groups.map) if (!inRange(item.score)) return { ok: false, reason: "score_range", path: `groups.${key}` };
  if (!inRange(answer.overall.score)) return { ok: false, reason: "score_range", path: "overall" };

  // The overall score is the mean of the model's own group scores.
  const groupScores = [...groups.map.values()].map((item) => item.score).filter((value): value is number => value !== null);
  const mean = groupScores.length ? groupScores.reduce((sum, value) => sum + value, 0) / groupScores.length : null;
  if ((mean === null) !== (answer.overall.score === null) || (mean !== null && Math.abs(mean - answer.overall.score!) > SCORING_TOLERANCE)) {
    return { ok: false, reason: "overall_mean", path: "overall" };
  }

  // Each requirement's status and deficit follow the model's own score of that skill.
  for (const req of keys.career) {
    const item = career.map.get(req.key)!;
    const skillScore = skills.map.get(req.skillKey)?.score ?? null;
    const expected: ScoringStatus = skillScore === null ? "chua_co_diem" : skillScore >= req.threshold ? "dat" : "duoi_nguong";
    if (item.status !== expected) return { ok: false, reason: "career_status", path: `career.${req.key}` };
    if (item.status === "duoi_nguong") {
      if (item.deficit === null || Math.abs(item.deficit - (req.threshold - skillScore!)) > SCORING_TOLERANCE) {
        return { ok: false, reason: "deficit", path: `career.${req.key}` };
      }
    } else if (item.deficit !== null && item.deficit !== 0) {
      return { ok: false, reason: "deficit", path: `career.${req.key}` };
    }
  }

  const scores = (map: Map<string, { score: number | null }>) =>
    Object.fromEntries([...map].map(([key, item]) => [key, item.score === null ? null : round2(item.score)]));
  return {
    ok: true,
    scoring: {
      promptVersion: SCORING_PROMPT_VERSION,
      skills: scores(skills.map),
      groups: scores(groups.map),
      overall: answer.overall.score === null ? null : round2(answer.overall.score),
      career: Object.fromEntries([...career.map].map(([key, item]) => [key, {
        status: item.status,
        deficit: item.status === "duoi_nguong" && item.deficit !== null ? round2(item.deficit) : null,
      }])),
      careerFit: answer.careerFit,
    },
  };
}

/** A stored ai_scoring value read back (jsonb); null when it does not have the expected shape. */
export function readStoredScoring(value: unknown): AiScoring | null {
  const stored = z.object({
    promptVersion: z.literal(SCORING_PROMPT_VERSION),
    skills: z.record(z.string(), score),
    groups: z.record(z.string(), score),
    overall: score,
    career: z.record(z.string(), z.object({ status: z.enum(SCORING_STATUSES), deficit: score })),
    careerFit: z.enum(SCORING_FITS),
  }).safeParse(value);
  return stored.success ? stored.data : null;
}
