// Per-job JSON schema of the graduation advice for Ollama structured output (design §5.6).
// Same grammar-safe subset as competency-assessment/ai/schema.ts: no pattern/format/minimum/
// maximum/uniqueItems/$ref, every limit <= 2000, non-empty enums, additionalProperties false and
// every property required. The focus enum is exactly the condition keys of this job + GENERAL.
import type { JsonSchema } from "../../competency-assessment/ai/schema.js";

/** Output limits (characters / items), shared by the schema, the prompt and the validator. */
export const GRADUATION_ADVICE_LIMITS = {
  summary: 500,
  adviceMin: 1,
  adviceMax: 6,
  adviceText: 400,
  nextStepsMin: 1,
  nextStepsMax: 5,
  nextStep: 240,
} as const;

/** Focus of an advice item that is not about one condition. */
export const GENERAL_FOCUS = "GENERAL";

/** What the model returns (before the server cleans it). */
export type GraduationAdviceModelOutput = {
  summary: string;
  advice: { focus: string; text: string }[];
  nextSteps: string[];
};

const L = GRADUATION_ADVICE_LIMITS;

const text = (maxLength: number): JsonSchema => ({ type: "string", minLength: 1, maxLength });
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

/** The focus values a job allows: its condition keys (G1…, CREDITS, GPA) in order, then GENERAL. */
export const focusValues = (conditionKeys: readonly string[]): string[] =>
  [...new Set([...conditionKeys.filter((key) => key && key !== GENERAL_FOCUS), GENERAL_FOCUS])];

export function buildGraduationAdviceSchema(conditionKeys: readonly string[]): JsonSchema {
  return object({
    summary: text(L.summary),
    advice: {
      type: "array",
      minItems: L.adviceMin,
      maxItems: L.adviceMax,
      items: object({ focus: { type: "string", enum: focusValues(conditionKeys) }, text: text(L.adviceText) }),
    },
    nextSteps: { type: "array", minItems: L.nextStepsMin, maxItems: L.nextStepsMax, items: text(L.nextStep) },
  });
}
