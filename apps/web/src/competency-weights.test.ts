import { describe, expect, it } from "vitest";
import { assessAllocations } from "./competency-weights";

describe("competency weight entry", () => {
  it("converts percentages and permits explicit zero-contribution links", () => {
    const result = assessAllocations([{ skillId: "a", percent: "0" }, { skillId: "b", percent: "33.3" }, { skillId: "c", percent: "66.7" }]);
    expect(result.canActivate).toBe(true);
    expect(result.links[0].weight).toBe(0);
    expect(result.links[1].weight).toBeCloseTo(0.333);
  });
  it("allows an incomplete draft while refusing activation", () => {
    const result = assessAllocations([{ skillId: "a", percent: "20" }]);
    expect(result.errors).toEqual([]);
    expect(result.canActivate).toBe(false);
    expect(assessAllocations([]).canActivate).toBe(false);
  });
  it.each(["", " ", "-1", "101", "NaN", "Infinity"])("rejects invalid percentages %s", percent => {
    const result = assessAllocations([{ skillId: "a", percent }]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.canActivate).toBe(false);
  });
  it("rejects a duplicate or missing skill even when the total is 100%", () => {
    expect(assessAllocations([{ skillId: "a", percent: "50" }, { skillId: "a", percent: "50" }]).canActivate).toBe(false);
    expect(assessAllocations([{ skillId: "", percent: "100" }]).canActivate).toBe(false);
  });
  it("accepts floating point sums only within the backend tolerance", () => {
    expect(assessAllocations([{ skillId: "a", percent: "99.99999" }]).canActivate).toBe(true);
    expect(assessAllocations([{ skillId: "a", percent: "99.99" }]).canActivate).toBe(false);
  });
  it("refuses allocations above the API row limit", () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({ skillId: String(index), percent: index === 0 ? "100" : "0" }));
    expect(assessAllocations(rows).canActivate).toBe(false);
  });
});
