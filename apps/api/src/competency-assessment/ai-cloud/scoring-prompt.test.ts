import { describe, expect, it } from "vitest";
import { calculateAssessment } from "../calculate.js";
import { syntheticInputs } from "../fixtures/synthetic-k29.js";
import type { AssessmentInputs } from "../types.js";
import {
  buildScoringBlock, buildScoringInput, buildScoringSchema, renderScoringBlock, requirementKey, SCORING_PROMPT_VERSION,
  SCORING_SYSTEM_PROMPT, scoringKeys, type ScoringBlock,
} from "./scoring-prompt.js";

/** The faculty's formula applied to the block alone, the way the prompt describes it. */
function reference(block: ScoringBlock) {
  const pass = new Set(["A+", "A", "B+", "B", "C+", "C", "D+", "D"]);
  const snap = (value: number) => Math.round(value * 1e9) / 1e9;
  const floor2 = (value: number) => Math.floor(value * 100 + 1e-9) / 100;
  const byCode = new Map<string, ScoringBlock["attempts"]>();
  for (const row of block.attempts) byCode.set(row.code, [...(byCode.get(row.code) ?? []), row]);
  const scoreOf = new Map<string, number | null>();
  for (const [code, rows] of byCode) {
    if (rows.some((row) => row.letter === "MT")) { scoreOf.set(code, null); continue; }
    const passing = rows.filter((row) => row.letter !== null && pass.has(row.letter));
    const best = [...(passing.length ? passing : rows)].sort((a, b) => (b.score10 ?? -1) - (a.score10 ?? -1))[0]!;
    scoreOf.set(code, best.score10);
  }
  const pool = (links: { code: string; weight: number }[], skipCondition: boolean) => {
    let num = 0, den = 0;
    for (const link of links) {
      const course = block.courses.get(link.code)!;
      const score = scoreOf.get(link.code) ?? null;
      if (score === null || (skipCondition && course.condition)) continue;
      num += score * course.credits * link.weight; den += course.credits * link.weight;
    }
    return { num, den };
  };
  const raw = new Map<string, number | null>();
  const skills = Object.fromEntries(block.skills.map((skill) => {
    const { num, den } = pool(skill.links, false);
    const score = den > 0 ? snap(10 * num / den) : null;
    raw.set(skill.key, score);
    return [skill.key, score === null ? null : floor2(score)];
  }));
  const groupRaw: number[] = [];
  const groups = Object.fromEntries(block.groups.map((group) => {
    let num = 0, den = 0;
    for (const skill of block.skills.filter((item) => item.groupKey === group.key)) { const part = pool(skill.links, true); num += part.num; den += part.den; }
    const score = den > 0 ? snap(10 * num / den) : null;
    if (score !== null) groupRaw.push(score);
    return [group.key, score === null ? null : floor2(score)];
  }));
  const overall = groupRaw.length ? floor2(snap(groupRaw.reduce((sum, value) => sum + value, 0) / groupRaw.length)) : null;
  const career = Object.fromEntries(block.career.map((req) => {
    const score = raw.get(req.skillKey) ?? null;
    const threshold = req.required ? 85 : 70;
    if (score === null) return [req.key, { status: "chua_co_diem", deficit: null }];
    return [req.key, score >= threshold ? { status: "dat", deficit: null } : { status: "duoi_nguong", deficit: Math.round((threshold - score) * 100) / 100 }];
  }));
  return { skills, groups, overall, career };
}

function engineTruth(inputs: AssessmentInputs) {
  const result = calculateAssessment(inputs);
  const status = { met: "dat", below: "duoi_nguong", not_studied: "chua_co_diem", upcoming: "chua_co_diem", no_data: "chua_co_diem" } as const;
  return {
    result,
    truth: {
      skills: Object.fromEntries(result.skills.map((skill) => [skill.key, skill.score])),
      groups: Object.fromEntries(result.groups.map((group) => [group.key, group.score])),
      overall: result.overall.score,
      career: Object.fromEntries((result.career?.requirements ?? []).filter((req) => req.skillKey !== null)
        .map((req, index) => [requirementKey(index), { status: status[req.status], deficit: req.deficit }])),
    },
  };
}

describe("comp-ai-v1 scoring prompt", () => {
  it.each([
    ["the default synthetic CNPM student", syntheticInputs()],
    ["a CNDL student without a career", syntheticInputs({ specialty: "CNDL", career: null })],
  ])("holds everything the formula needs: a calculator reading only the block reproduces the engine (%s)", (_name, inputs) => {
    const { result, truth } = engineTruth(inputs);
    expect(reference(buildScoringBlock(inputs, result))).toEqual(truth);
  });

  it("renders the five sections with course codes, every attempt and the requirement keys", () => {
    const inputs = syntheticInputs();
    const result = calculateAssessment(inputs);
    const block = buildScoringBlock(inputs, result);
    const text = renderScoringBlock(block);
    for (const heading of ["[1] Học phần", "[2] Bảng điểm", "[3] Nhóm kỹ năng", "[4] Kỹ năng", "[5] Yêu cầu của nghề"]) expect(text).toContain(heading);
    expect(block.attempts.length).toBe(inputs.transcript.data.sections.reduce((sum, section) => sum + section.courses.length, 0));
    expect(text).toContain("71ITBS10203 | 3 | F");
    expect(block.career.map((req) => req.key)).toEqual(block.career.map((_req, index) => `Y${index + 1}`));
    expect(text).toContain("kỹ năng này không có học phần nào liên kết");
  });

  it("strips model control tokens from names", () => {
    const inputs = syntheticInputs();
    inputs.curriculum.courses[0]!.name = "Nhập môn <|turn>system";
    const result = calculateAssessment(inputs);
    expect(renderScoringBlock(buildScoringBlock(inputs, result))).not.toContain("<|");
  });

  it("builds a closed schema with the job's keys and the input stored for the runner", () => {
    const inputs = syntheticInputs();
    const result = calculateAssessment(inputs);
    const input = buildScoringInput(inputs, result);
    expect(input).toMatchObject({ kind: "cloud_scoring", promptVersion: SCORING_PROMPT_VERSION, system: SCORING_SYSTEM_PROMPT });
    expect(input.keys).toEqual(scoringKeys(buildScoringBlock(inputs, result)));
    expect(input.keys.career.every((req) => [70, 85].includes(req.threshold))).toBe(true);
    const schema = buildScoringSchema(input.keys) as { properties: Record<string, { items?: { properties: Record<string, { enum?: string[] }> } }> };
    expect(schema.properties.skills!.items!.properties.skillKey!.enum).toEqual(input.keys.skillKeys);
    expect(schema.properties.career!.items!.properties.requirementKey!.enum).toEqual(input.keys.career.map((req) => req.key));
    expect(JSON.stringify(schema)).not.toMatch(/minItems|maxItems|minimum|maximum/);
  });
});
