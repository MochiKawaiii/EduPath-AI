import { describe, expect, it } from "vitest";
import type { ScoringKeys } from "./scoring-prompt.js";
import { readStoredScoring, validateScoring } from "./scoring-validate.js";

const keys: ScoringKeys = {
  skillKeys: ["S01", "S02", "S03"],
  groupKeys: ["G1", "G2"],
  career: [
    { key: "Y1", skillKey: "S01", threshold: 85 },
    { key: "Y2", skillKey: "S02", threshold: 70 },
    { key: "Y3", skillKey: "S09", threshold: 70 },
  ],
};

const answer = () => ({
  skills: [
    { skillKey: "S01", score: 80.004, level: "Khá" },
    { skillKey: "S02", score: 72.5, level: "Khá" },
    { skillKey: "S03", score: null, level: "Chưa có điểm" },
  ],
  groups: [{ groupKey: "G1", score: 78.1, level: "Khá" }, { groupKey: "G2", score: 61.9, level: "Cơ bản" }],
  overall: { score: 70, level: "Khá" },
  career: [
    { requirementKey: "Y1", status: "duoi_nguong", deficit: 5 },
    { requirementKey: "Y2", status: "dat", deficit: null },
    { requirementKey: "Y3", status: "chua_co_diem", deficit: null },
  ],
  careerFit: "kha_phu_hop",
});

describe("validateScoring", () => {
  it("accepts a complete, self-consistent answer and keeps 2 decimals", () => {
    const checked = validateScoring(answer(), keys);
    expect(checked).toEqual({
      ok: true,
      scoring: {
        promptVersion: "comp-ai-v1",
        skills: { S01: 80, S02: 72.5, S03: null },
        groups: { G1: 78.1, G2: 61.9 },
        overall: 70,
        career: { Y1: { status: "duoi_nguong", deficit: 5 }, Y2: { status: "dat", deficit: null }, Y3: { status: "chua_co_diem", deficit: null } },
        careerFit: "kha_phu_hop",
      },
    });
  });

  it.each([
    ["an unknown key", (a: ReturnType<typeof answer>) => { a.skills[2]!.skillKey = "S99"; }, "unknown_key"],
    ["a duplicate key", (a: ReturnType<typeof answer>) => { a.groups[1]!.groupKey = "G1"; }, "duplicate"],
    ["a missing key", (a: ReturnType<typeof answer>) => { a.career.pop(); }, "missing_key"],
    ["a score out of range", (a: ReturnType<typeof answer>) => { a.skills[1]!.score = 101; }, "score_range"],
    ["an overall that is not the mean of the groups", (a: ReturnType<typeof answer>) => { a.overall.score = 75; }, "overall_mean"],
    ["a status that contradicts the model's own score", (a: ReturnType<typeof answer>) => { a.career[1]!.status = "duoi_nguong"; a.career[1]!.deficit = 1; }, "career_status"],
    ["a deficit that is not threshold − score", (a: ReturnType<typeof answer>) => { a.career[0]!.deficit = 4; }, "deficit"],
    ["a deficit on a met requirement", (a: ReturnType<typeof answer>) => { a.career[1]!.deficit = 3; }, "deficit"],
    ["an extra field", (a: ReturnType<typeof answer>) => { Object.assign(a, { note: "x" }); }, "schema"],
    ["a wrong status word", (a: ReturnType<typeof answer>) => { (a.career[2] as { status: string }).status = "unknown"; }, "schema"],
  ])("rejects %s", (_name, change, reason) => {
    const value = answer();
    change(value);
    expect(validateScoring(value, keys)).toMatchObject({ ok: false, reason });
  });

  it("needs chua_co_diem for a requirement whose skill the model did not score", () => {
    const value = answer();
    value.career[2] = { requirementKey: "Y3", status: "dat", deficit: null };
    expect(validateScoring(value, keys)).toMatchObject({ ok: false, reason: "career_status", path: "career.Y3" });
  });

  it("reads a stored value back and refuses another shape", () => {
    const checked = validateScoring(answer(), keys);
    if (!checked.ok) throw new Error("expected a valid answer");
    expect(readStoredScoring(JSON.parse(JSON.stringify(checked.scoring)))).toEqual(checked.scoring);
    expect(readStoredScoring({ promptVersion: "comp-ai-v0" })).toBeNull();
    expect(readStoredScoring(null)).toBeNull();
  });
});
