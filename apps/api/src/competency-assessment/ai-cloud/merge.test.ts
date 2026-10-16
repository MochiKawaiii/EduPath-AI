import { describe, expect, it } from "vitest";
import { calculateAssessment } from "../calculate.js";
import { syntheticInputs } from "../fixtures/synthetic-k29.js";
import type { AssessmentResult } from "../types.js";
import { mergeAiScoring } from "./merge.js";
import { requirementKey } from "./scoring-prompt.js";
import type { AiScoring } from "./scoring-validate.js";

/** An AI answer that agrees with the engine except where a test changes it. */
function scoringFrom(result: AssessmentResult): AiScoring {
  const status = { met: "dat", below: "duoi_nguong", not_studied: "chua_co_diem", upcoming: "chua_co_diem", no_data: "chua_co_diem" } as const;
  return {
    promptVersion: "comp-ai-v1",
    skills: Object.fromEntries(result.skills.map((skill) => [skill.key, skill.score])),
    groups: Object.fromEntries(result.groups.map((group) => [group.key, group.score])),
    overall: result.overall.score,
    career: Object.fromEntries((result.career?.requirements ?? []).filter((req) => req.skillKey !== null)
      .map((req, index) => [requirementKey(index), { status: status[req.status], deficit: req.deficit }])),
    careerFit: "kha_phu_hop",
  };
}

describe("mergeAiScoring", () => {
  const computed = calculateAssessment(syntheticInputs());

  it("shows the AI's numbers, derives levels from them and clears what the AI does not compute", () => {
    const scoring = scoringFrom(computed);
    const weakest = computed.skills.filter((skill) => skill.score !== null && !skill.conditionOnly).at(-1)!;
    scoring.skills[weakest.key] = 90.5;
    scoring.groups[computed.groups[0]!.key] = 49.99;
    scoring.overall = 66.66;
    const merged = mergeAiScoring(computed, scoring);
    const skill = merged.skills.find((item) => item.key === weakest.key)!;
    expect(skill).toMatchObject({ score: 90.5, level: "proficient", levelLabel: "Thành thạo", status: "scored", confidence: null, coverage: null });
    expect(merged.skills[0]!.key).toBe(weakest.key);
    expect(merged.groups[0]).toMatchObject({ score: 49.99, level: "needs_work", confidence: null, coverage: null });
    expect(merged.overall).toMatchObject({ score: 66.66, level: "basic", levelLabel: "Cơ bản", confidence: null, coverage: null });
    expect(merged.history).toBe(computed.history);
    expect(merged.graduation).toBe(computed.graduation);
    expect(merged.highlights.strengths).toContain(weakest.key);
  });

  it("a skill the AI did not score has no evidence, and a skill it scored counts as evidence", () => {
    const scoring = scoringFrom(computed);
    const scored = computed.skills.find((skill) => skill.status === "scored")!;
    scoring.skills[scored.key] = null;
    const merged = mergeAiScoring(computed, scoring);
    expect(merged.skills.find((item) => item.key === scored.key)).toMatchObject({ score: null, status: "no_evidence", level: "no_evidence" });
    expect(merged.overall.basis.skillsWithEvidence).toBe(computed.overall.basis.skillsWithEvidence - (scored.conditionOnly ? 0 : 1));
  });

  it("takes the career statuses, deficits and fit from the AI and recounts", () => {
    const scoring = scoringFrom(computed);
    const career = computed.career!;
    const firstKey = requirementKey(0);
    const first = career.requirements.filter((req) => req.skillKey !== null)[0]!;
    const skillScore = computed.skills.find((skill) => skill.key === first.skillKey)?.score ?? null;
    if (skillScore !== null) {
      scoring.career[firstKey] = { status: "dat", deficit: null };
    }
    scoring.careerFit = "phu_hop";
    const merged = mergeAiScoring(computed, scoring);
    expect(merged.career).toMatchObject({ fit: null, fitCode: "fit", fitLabel: "Phù hợp" });
    expect(merged.career!.counts.total).toBe(career.counts.total);
    if (skillScore !== null) {
      const row = merged.career!.requirements.find((req) => req.requirementId === first.requirementId)!;
      expect(row).toMatchObject({ status: "met", statusLabel: "Đạt ngưỡng", deficit: null, fitCredit: null });
      expect(merged.career!.counts.met).toBe(career.counts.met + (first.status === "met" ? 0 : 1));
    }
  });

  it("keeps a course plan only while the AI's score still calls for it", () => {
    const withoutCareer = calculateAssessment(syntheticInputs({ career: null }));
    const plan = withoutCareer.skillPlans[0];
    if (!plan) return;
    const scoring = scoringFrom(withoutCareer);
    expect(mergeAiScoring(withoutCareer, scoring).skillPlans.map((item) => item.skillKey)).toContain(plan.skillKey);
    scoring.skills[plan.skillKey] = 75;
    expect(mergeAiScoring(withoutCareer, scoring).skillPlans.map((item) => item.skillKey)).not.toContain(plan.skillKey);
  });
});
