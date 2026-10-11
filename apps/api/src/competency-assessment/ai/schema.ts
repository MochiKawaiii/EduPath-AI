// Per-job JSON schema for Ollama structured output (spec §10). The grammar built from it
// restricts keys and course codes to the ones of this job. Only keywords that Ollama's
// json-schema-to-grammar supports are used: no uniqueItems/not/if/patternProperties and
// no numeric minimum/maximum; every maxLength/maxItems stays <= 2000.

export type JsonSchema = { [key: string]: unknown };

/** Output limits (characters / items), shared by the schema, the validator and the prompt. */
export const AI_OUTPUT_LIMITS = {
  summary: 600,
  groupInsights: 6,
  groupComment: 280,
  strengths: 4,
  improvements: 4,
  skillComment: 280,
  careerFit: 500,
  gaps: 4,
  gapExplanation: 300,
  gapCourses: 3,
  courseReason: 100,
  selfStudy: 3,
  selfStudyItem: 100,
  progress: 500,
  nextStepsMin: 3,
  nextStepsMax: 5,
  nextStep: 180
} as const;

export const AI_PRIORITIES = ["high", "medium", "low"] as const;
export type AiPriority = (typeof AI_PRIORITIES)[number];

/** C5: the AI commentary stored in stu_comp_assessments.ai_output. */
export type AiOutput = {
  summary: string;
  groupInsights: { groupKey: string; comment: string }[];
  strengths: { skillKey: string; comment: string }[];
  improvements: { skillKey: string; priority: AiPriority; comment: string }[];
  careerFit: { comment: string };
  gaps: {
    skillKey: string;
    priority: AiPriority;
    explanation: string;
    courses: { courseCode: string; reason: string }[];
    selfStudy: string[];
  }[];
  progress: string;
  nextSteps: string[];
};

/** Keys and codes one job may use. */
export type OutputSchemaContext = {
  /** AssessmentResult.groups[].key */
  groupKeys: string[];
  /** Sent skills the engine rates Khá or above with no career gap (strengths enum). */
  strengthKeys: string[];
  /** Sent skills below Khá or below a career threshold (improvements enum). */
  improvementKeys: string[];
  /** Gap candidates with the course codes suggested for exactly that skill. */
  gapSkills: { key: string; courseCodes: string[] }[];
};

const L = AI_OUTPUT_LIMITS;
const KEY_FALLBACK_LENGTH = 16;

const text = (maxLength: number): JsonSchema => ({ type: "string", minLength: 1, maxLength });
const keyOf = (values: readonly string[]): JsonSchema =>
  values.length ? { type: "string", enum: [...values] } : { type: "string", maxLength: KEY_FALLBACK_LENGTH };
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties
});
const priority: JsonSchema = { type: "string", enum: [...AI_PRIORITIES] };

function gapBranch(key: string, courseCodes: readonly string[]): JsonSchema {
  return object({
    skillKey: { const: key },
    priority,
    explanation: text(L.gapExplanation),
    courses: {
      type: "array",
      maxItems: courseCodes.length ? Math.min(L.gapCourses, courseCodes.length) : 0,
      items: object({ courseCode: keyOf(courseCodes), reason: text(L.courseReason) })
    },
    selfStudy: { type: "array", maxItems: L.selfStudy, items: text(L.selfStudyItem) }
  });
}

export function buildOutputSchema(context: OutputSchemaContext): JsonSchema {
  const groups = [...new Set(context.groupKeys)];
  const strengths = [...new Set(context.strengthKeys)];
  const improvements = [...new Set(context.improvementKeys)];
  const gapItems: JsonSchema = context.gapSkills.length
    ? { anyOf: context.gapSkills.map((gap) => gapBranch(gap.key, [...new Set(gap.courseCodes)])) }
    : gapBranch("", []);
  return object({
    summary: text(L.summary),
    groupInsights: {
      type: "array",
      maxItems: groups.length ? Math.min(L.groupInsights, groups.length) : 0,
      items: object({ groupKey: keyOf(groups), comment: text(L.groupComment) })
    },
    strengths: {
      type: "array",
      maxItems: strengths.length ? Math.min(L.strengths, strengths.length) : 0,
      items: object({ skillKey: keyOf(strengths), comment: text(L.skillComment) })
    },
    improvements: {
      type: "array",
      maxItems: improvements.length ? Math.min(L.improvements, improvements.length) : 0,
      items: object({ skillKey: keyOf(improvements), priority, comment: text(L.skillComment) })
    },
    careerFit: object({ comment: text(L.careerFit) }),
    gaps: {
      type: "array",
      maxItems: context.gapSkills.length ? Math.min(L.gaps, context.gapSkills.length) : 0,
      items: gapItems
    },
    progress: text(L.progress),
    nextSteps: { type: "array", minItems: L.nextStepsMin, maxItems: L.nextStepsMax, items: text(L.nextStep) }
  });
}

/* ------------------------------------------------------------------------ */
/* Reading the allowlists back from a stored schema (stu_comp_ai_jobs.ai_input). */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const prop = (value: unknown, ...path: string[]): unknown => {
  let current = value;
  for (const key of path) current = isRecord(current) ? current[key] : undefined;
  return current;
};
const stringEnum = (value: unknown): string[] | null => {
  if (!isRecord(value)) return null;
  if (value.enum === undefined) return value.type === "string" ? [] : null;
  return Array.isArray(value.enum) && value.enum.every((item) => typeof item === "string") ? (value.enum as string[]) : null;
};

/**
 * Inverse of buildOutputSchema; null when the schema does not have the expected shape.
 * A comp-v1 schema (one shared skill enum) reads back with that enum in both lists.
 */
export function schemaContext(schema: unknown): OutputSchemaContext | null {
  const groupKeys = stringEnum(prop(schema, "properties", "groupInsights", "items", "properties", "groupKey"));
  const strengthKeys = stringEnum(prop(schema, "properties", "strengths", "items", "properties", "skillKey"));
  const improvementKeys = stringEnum(prop(schema, "properties", "improvements", "items", "properties", "skillKey"));
  const gapsItems = prop(schema, "properties", "gaps", "items");
  const gapsMax = prop(schema, "properties", "gaps", "maxItems");
  if (!groupKeys || !strengthKeys || !improvementKeys || !isRecord(gapsItems)) return null;
  const gapSkills: OutputSchemaContext["gapSkills"] = [];
  if (gapsMax !== 0) {
    const branches = gapsItems.anyOf;
    if (!Array.isArray(branches)) return null;
    for (const branch of branches) {
      const key = prop(branch, "properties", "skillKey", "const");
      const codes = stringEnum(prop(branch, "properties", "courses", "items", "properties", "courseCode"));
      if (typeof key !== "string" || !codes) return null;
      gapSkills.push({ key, courseCodes: codes });
    }
  }
  return { groupKeys, strengthKeys, improvementKeys, gapSkills };
}
