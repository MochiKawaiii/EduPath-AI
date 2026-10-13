import { describe, expect, it } from "vitest";
import { buildGraduationAdviceSchema, focusValues, GENERAL_FOCUS, GRADUATION_ADVICE_LIMITS } from "./schema.js";
import { buildGraduationAdviceInput } from "./prompt.js";
import { syntheticGraduation } from "./test-fixture.js";

// Same keyword rules as competency-assessment/ai/schema.test.ts (Ollama's json-schema-to-grammar subset).
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

describe("buildGraduationAdviceSchema", () => {
  const schema = buildGraduationAdviceInput(syntheticGraduation()).schema;

  it("requires summary, advice and nextSteps and forbids extra properties", () => {
    expect(schema).toMatchObject({ type: "object", additionalProperties: false, required: ["summary", "advice", "nextSteps"] });
    expect(get(schema, "properties", "advice", "items")).toMatchObject({ type: "object", additionalProperties: false, required: ["focus", "text"] });
  });

  it("restricts focus to the condition keys of the job plus GENERAL and caps lengths and counts", () => {
    expect(get(schema, "properties", "advice", "items", "properties", "focus")).toEqual({
      type: "string", enum: ["G1", "G2", "G3", "G4", "G5", "CREDITS", "GPA", "GENERAL"],
    });
    expect(get(schema, "properties", "summary")).toEqual({ type: "string", minLength: 1, maxLength: 500 });
    expect(get(schema, "properties", "advice")).toMatchObject({ type: "array", minItems: 1, maxItems: 6 });
    expect(get(schema, "properties", "advice", "items", "properties", "text")).toEqual({ type: "string", minLength: 1, maxLength: 400 });
    expect(get(schema, "properties", "nextSteps")).toEqual({ type: "array", minItems: 1, maxItems: 5, items: { type: "string", minLength: 1, maxLength: 240 } });
    expect(GRADUATION_ADVICE_LIMITS).toMatchObject({ summary: 500, adviceMax: 6, adviceText: 400, nextStepsMax: 5, nextStep: 240 });
  });

  it("uses only grammar-safe keywords, non-empty enums and limits <= 2000", () => {
    for (const candidate of [schema, buildGraduationAdviceSchema([]), buildGraduationAdviceSchema(["G1", "G1", GENERAL_FOCUS, ""])]) {
      walk(candidate, (node) => {
        const isSchemaNode = "type" in node || "const" in node || "anyOf" in node;
        if (!isSchemaNode) return;
        for (const keyword of FORBIDDEN_KEYWORDS) expect(Object.keys(node)).not.toContain(keyword);
        for (const limit of ["maxLength", "maxItems", "minItems", "minLength"]) {
          if (limit in node) expect(node[limit] as number).toBeLessThanOrEqual(2000);
        }
        if ("enum" in node) expect((node.enum as unknown[]).length).toBeGreaterThan(0);
        if (node.type === "object") {
          expect(node.additionalProperties).toBe(false);
          expect(node.required).toEqual(Object.keys(node.properties as object));
        }
      });
    }
  });

  it("always offers GENERAL once, without blank or repeated keys", () => {
    expect(focusValues([])).toEqual(["GENERAL"]);
    expect(focusValues(["G1", "G1", "", "GENERAL", "GPA"])).toEqual(["G1", "GPA", "GENERAL"]);
  });
});
