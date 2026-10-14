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
  improvementCourses: 2,
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

/** A course the model picked from the list of one skill, with a short reason. */
export type AiCourseChoice = { courseCode: string; reason: string };

/** C5: the AI commentary stored in stu_comp_assessments.ai_output. */
export type AiOutput = {
  summary: string;
  groupInsights: { groupKey: string; comment: string }[];
  strengths: { skillKey: string; comment: string }[];
  /** courses since comp-v4 ([] for a job queued before it); outputs stored before comp-v4 have none. */
  improvements: { skillKey: string; priority: AiPriority; courses: AiCourseChoice[]; comment: string }[];
  careerFit: { comment: string };
  gaps: {
    skillKey: string;
    priority: AiPriority;
    explanation: string;
    courses: AiCourseChoice[];
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
  /**
   * Sent skills below Khá or below a career threshold (improvements enum); since comp-v4 only those
   * with a course plan or a career gap.
   */
  improvementKeys: string[];
  /** comp-v4: the course codes allowed for each improvement key ([] = none; schemas before comp-v4 allow none). */
  improvementSkills: { key: string; courseCodes: string[] }[];
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
/** At most `max` courses of this skill's own list; closed (maxItems 0) when it has none. */
const courseList = (courseCodes: readonly string[], max: number): JsonSchema => ({
  type: "array",
  maxItems: courseCodes.length ? Math.min(max, courseCodes.length) : 0,
  items: object({ courseCode: keyOf(courseCodes), reason: text(L.courseReason) })
});

function gapBranch(key: string, courseCodes: readonly string[]): JsonSchema {
  return object({
    skillKey: { const: key },
    priority,
    explanation: text(L.gapExplanation),
    courses: courseList(courseCodes, L.gapCourses),
    selfStudy: { type: "array", maxItems: L.selfStudy, items: text(L.selfStudyItem) }
  });
}

/** comp-v4: the courses come before the comment, so the comment talks about the courses picked. */
function improvementBranch(key: string, courseCodes: readonly string[]): JsonSchema {
  return object({
    skillKey: { const: key },
    priority,
    courses: courseList(courseCodes, L.improvementCourses),
    comment: text(L.skillComment)
  });
}

export function buildOutputSchema(context: OutputSchemaContext): JsonSchema {
  const groups = [...new Set(context.groupKeys)];
  const strengths = [...new Set(context.strengthKeys)];
  const improvements = [...new Set(context.improvementKeys)];
  const improvementCodes = new Map(context.improvementSkills.map((skill) => [skill.key, skill.courseCodes]));
  const improvementItems: JsonSchema = improvements.length
    ? { anyOf: improvements.map((key) => improvementBranch(key, [...new Set(improvementCodes.get(key) ?? [])])) }
    : improvementBranch("", []);
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
      items: improvementItems
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

type SkillCourses = { key: string; courseCodes: string[] };

/** Per-skill anyOf branches: { skillKey: { const }, courses: { items: { courseCode: enum } } }. */
function branchSkills(branches: unknown): SkillCourses[] | null {
  if (!Array.isArray(branches)) return null;
  const skills: SkillCourses[] = [];
  for (const branch of branches) {
    const key = prop(branch, "properties", "skillKey", "const");
    const codes = stringEnum(prop(branch, "properties", "courses", "items", "properties", "courseCode"));
    if (typeof key !== "string" || !codes) return null;
    skills.push({ key, courseCodes: codes });
  }
  return skills;
}

/** comp-v4: one branch per key; comp-v1–v3: one object with a skillKey enum and no courses. */
function improvementSkillsOf(improvements: unknown): SkillCourses[] | null {
  const items = prop(improvements, "items");
  if (!isRecord(items)) return null;
  if (prop(improvements, "maxItems") === 0) return [];
  if (items.anyOf !== undefined) return branchSkills(items.anyOf);
  const keys = stringEnum(prop(items, "properties", "skillKey"));
  return keys ? keys.map((key) => ({ key, courseCodes: [] })) : null;
}

/**
 * Inverse of buildOutputSchema; null when the schema does not have the expected shape. Schemas of
 * jobs queued before comp-v4 still read: their improvements allow no course, and a comp-v1 schema
 * (one shared skill enum) reads back with that enum in both lists.
 */
export function schemaContext(schema: unknown): OutputSchemaContext | null {
  const groupKeys = stringEnum(prop(schema, "properties", "groupInsights", "items", "properties", "groupKey"));
  const strengthKeys = stringEnum(prop(schema, "properties", "strengths", "items", "properties", "skillKey"));
  const improvementSkills = improvementSkillsOf(prop(schema, "properties", "improvements"));
  const gapsItems = prop(schema, "properties", "gaps", "items");
  const gapsMax = prop(schema, "properties", "gaps", "maxItems");
  if (!groupKeys || !strengthKeys || !improvementSkills || !isRecord(gapsItems)) return null;
  let gapSkills: SkillCourses[] = [];
  if (gapsMax !== 0) {
    const branches = branchSkills(gapsItems.anyOf);
    if (!branches) return null;
    gapSkills = branches;
  }
  return { groupKeys, strengthKeys, improvementKeys: improvementSkills.map((skill) => skill.key), improvementSkills, gapSkills };
}
