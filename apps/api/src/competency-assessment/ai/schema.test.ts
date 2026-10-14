import { describe, expect, it } from "vitest";
import { buildPromptContext } from "./prompt.js";
import { buildOutputSchema, schemaContext, type JsonSchema } from "./schema.js";
import { syntheticResult, withCompV3Improvements } from "./test-fixture.js";

const FORBIDDEN_KEYWORDS = ["uniqueItems", "not", "if", "then", "else", "patternProperties", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "$ref", "pattern", "format"];

function walk(value: unknown, visit: (node: Record<string, unknown>) => void) {
  if (Array.isArray(value)) { value.forEach((item) => walk(item, visit)); return; }
  if (value && typeof value === "object") {
    visit(value as Record<string, unknown>);
    for (const child of Object.values(value)) walk(child, visit);
  }
}

const get = (schema: unknown, ...path: (string | number)[]): any =>
  path.reduce<any>((node, key) => (node === undefined || node === null ? undefined : node[key]), schema);

const EMPTY = { groupKeys: [], strengthKeys: [], improvementKeys: [], improvementSkills: [], gapSkills: [] };

describe("buildOutputSchema", () => {
  const context = buildPromptContext(syntheticResult());
  const schema = buildOutputSchema(context);

  it("requires every field and forbids extra properties", () => {
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["summary", "groupInsights", "strengths", "improvements", "careerFit", "gaps", "progress", "nextSteps"]);
  });

  it("restricts keys to this job's enums", () => {
    expect(get(schema, "properties", "groupInsights", "items", "properties", "groupKey", "enum")).toEqual(["G1", "G2"]);
    // Strengths and improvements have their own enums (comp-v2): S03 is below its career threshold.
    expect(get(schema, "properties", "strengths", "items", "properties", "skillKey", "enum")).toEqual(["S01", "S02"]);
    expect(get(schema, "properties", "strengths", "maxItems")).toBe(2);
    const improvements = get(schema, "properties", "improvements", "items", "anyOf") as unknown[];
    expect(improvements.map((branch) => get(branch, "properties", "skillKey", "const"))).toEqual(["S03", "S07", "S06"]);
    expect(get(schema, "properties", "improvements", "maxItems")).toBe(3);
    for (const branch of improvements) expect(get(branch, "properties", "priority", "enum")).toEqual(["high", "medium", "low"]);
    expect(get(schema, "properties", "nextSteps")).toMatchObject({ minItems: 3, maxItems: 5 });
    expect(get(schema, "properties", "summary")).toMatchObject({ minLength: 1, maxLength: 600 });
  });

  it("builds one improvement branch per skill with its own course enum, courses before the comment (comp-v4)", () => {
    const branches = get(schema, "properties", "improvements", "items", "anyOf");
    // Career gap S03: its career courses; S07: a plan without any course; S06: plan take + improve, at most 2 picked.
    expect(get(branches, 0, "properties", "courses", "items", "properties", "courseCode", "enum")).toEqual(["TST201", "TST202"]);
    expect(get(branches, 0, "properties", "courses", "maxItems")).toBe(2);
    expect(get(branches, 1, "properties", "courses", "maxItems")).toBe(0);
    expect(get(branches, 1, "properties", "courses", "items", "properties", "courseCode", "enum")).toBeUndefined();
    expect(get(branches, 2, "properties", "courses", "items", "properties", "courseCode", "enum")).toEqual(["TST310", "TST150", "TST120"]);
    expect(get(branches, 2, "properties", "courses", "maxItems")).toBe(2);
    expect(get(branches, 2, "properties", "courses", "items", "properties", "reason")).toEqual({ type: "string", minLength: 1, maxLength: 100 });
    expect(get(branches, 2, "required")).toEqual(["skillKey", "priority", "courses", "comment"]);
    // An improvement key without an entry in improvementSkills gets no course.
    const missing = buildOutputSchema({ ...EMPTY, improvementKeys: ["S09"] });
    expect(get(missing, "properties", "improvements", "items", "anyOf", 0, "properties", "courses", "maxItems")).toBe(0);
  });

  it("builds one anyOf branch per gap skill with a const key and its own course enum", () => {
    const branches = get(schema, "properties", "gaps", "items", "anyOf");
    expect(branches).toHaveLength(2);
    expect(get(branches, 0, "properties", "skillKey")).toEqual({ const: "S03" });
    expect(get(branches, 0, "properties", "courses", "items", "properties", "courseCode", "enum")).toEqual(["TST201", "TST202"]);
    expect(get(branches, 0, "properties", "courses", "maxItems")).toBe(2);
    expect(get(branches, 1, "properties", "skillKey")).toEqual({ const: "S05" });
    expect(get(branches, 1, "properties", "courses", "maxItems")).toBe(0);
    expect(get(branches, 1, "properties", "courses", "items", "properties", "courseCode", "enum")).toBeUndefined();
    expect(get(schema, "properties", "gaps", "maxItems")).toBe(2);
  });

  it("closes gaps with maxItems 0 when there is no candidate", () => {
    const empty = buildOutputSchema(EMPTY);
    expect(get(empty, "properties", "gaps", "maxItems")).toBe(0);
    expect(get(empty, "properties", "gaps", "items", "anyOf")).toBeUndefined();
    expect(get(empty, "properties", "groupInsights", "maxItems")).toBe(0);
    expect(get(empty, "properties", "strengths", "maxItems")).toBe(0);
    expect(get(empty, "properties", "improvements", "maxItems")).toBe(0);
    expect(get(empty, "properties", "improvements", "items", "anyOf")).toBeUndefined();
  });

  it("uses only supported keywords, non-empty enums and limits <= 2000", () => {
    for (const candidate of [schema, buildOutputSchema(EMPTY)]) {
      walk(candidate, (node) => {
        const isSchemaNode = "type" in node || "const" in node || "anyOf" in node;
        if (!isSchemaNode) return;
        for (const keyword of FORBIDDEN_KEYWORDS) expect(Object.keys(node)).not.toContain(keyword);
        for (const limit of ["maxLength", "maxItems", "minItems", "minLength"]) {
          if (limit in node) expect(node[limit] as number).toBeLessThanOrEqual(2000);
        }
        if ("enum" in node) expect((node.enum as unknown[]).length).toBeGreaterThan(0);
        if (node.type === "object") expect(node.additionalProperties).toBe(false);
      });
    }
  });

  it("can be read back into the allowlists", () => {
    const { skillKeys: _sent, ...allowlists } = context;
    expect(schemaContext(schema)).toEqual(allowlists);
    expect(schemaContext(buildOutputSchema(EMPTY))).toEqual(EMPTY);
    expect(schemaContext(JSON.parse(JSON.stringify(schema)) as JsonSchema)).toEqual(allowlists);
    expect(schemaContext({})).toBeNull();
    expect(schemaContext(null)).toBeNull();
  });

  it("still reads a schema stored before comp-v4: its improvements allow no course", () => {
    const { skillKeys: _sent, ...allowlists } = context;
    const legacy = JSON.parse(JSON.stringify(withCompV3Improvements(schema, ["S03", "S06"]))) as JsonSchema;
    expect(schemaContext(legacy)).toEqual({
      ...allowlists, improvementKeys: ["S03", "S06"], improvementSkills: [{ key: "S03", courseCodes: [] }, { key: "S06", courseCodes: [] }]
    });
    expect(schemaContext(withCompV3Improvements(schema, []))).toMatchObject({ improvementKeys: [], improvementSkills: [] });
    // A malformed improvement branch makes the whole schema unreadable.
    const broken = structuredClone(schema) as any;
    broken.properties.improvements.items.anyOf[0].properties.skillKey = { type: "string" };
    expect(schemaContext(broken)).toBeNull();
  });
});
