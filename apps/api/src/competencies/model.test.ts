import { describe, expect, it } from "vitest";
import { validateWeights } from "./model.js";

const skillId = "11111111-1111-4111-8111-111111111111";
const secondSkillId = "22222222-2222-4222-8222-222222222222";
const thirdSkillId = "33333333-3333-4333-8333-333333333333";

describe("validateWeights", () => {
  it("accepts only a complete active total, with floating-point tolerance; drafts may be incomplete", () => {
    expect(validateWeights([{ skillId, weight: 0.1 }, { skillId: secondSkillId, weight: 0.2 }, { skillId: thirdSkillId, weight: 0.7 }], "active")).toBeCloseTo(1);
    expect(validateWeights([{ skillId, weight: 0.4 }], "draft")).toBe(0.4);
    for (const weight of [0.9, 1.1]) expect(() => validateWeights([{ skillId, weight }], "active")).toThrow();
    expect(() => validateWeights([], "active")).toThrow("weight_total_invalid");
    expect(() => validateWeights([{ skillId, weight: 0.5 }, { skillId, weight: 0.5 }], "active")).toThrow("duplicate_skill_link");
  });

  it("rejects weights outside 0–1", () => {
    for (const weight of [-0.1, 1.5, Number.NaN]) expect(() => validateWeights([{ skillId, weight }], "draft")).toThrow("invalid_weight");
  });
});
