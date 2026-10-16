import { describe, expect, it, vi } from "vitest";
import { buildAiInput } from "../ai/prompt.js";
import { calculateAssessment } from "../calculate.js";
import { syntheticInputs } from "../fixtures/synthetic-k29.js";
import type { AssessmentResult } from "../types.js";
import { CloudAiError, type CloudJsonCaller, type CloudJsonRequest } from "./claude.js";
import { mergeAiScoring } from "./merge.js";
import { runCloudJob } from "./runner.js";
import { buildScoringInput, requirementKey } from "./scoring-prompt.js";
import { validateScoring } from "./scoring-validate.js";

const inputs = syntheticInputs();
const computed = calculateAssessment(inputs);
const scoringInput = buildScoringInput(inputs, computed);

/** A self-consistent scoring answer equal to the engine's numbers. */
function engineAnswer(result: AssessmentResult) {
  const status = { met: "dat", below: "duoi_nguong", not_studied: "chua_co_diem", upcoming: "chua_co_diem", no_data: "chua_co_diem" } as const;
  return {
    skills: result.skills.map((skill) => ({ skillKey: skill.key, score: skill.score, level: "Khá" })),
    groups: result.groups.map((group) => ({ groupKey: group.key, score: group.score, level: "Khá" })),
    overall: { score: result.overall.score, level: "Khá" },
    career: (result.career?.requirements ?? []).filter((req) => req.skillKey !== null)
      .map((req, index) => ({ requirementKey: requirementKey(index), status: status[req.status], deficit: req.deficit })),
    careerFit: "kha_phu_hop",
  };
}

const comments = {
  summary: "Bạn có nền tảng lập trình tốt.",
  groupInsights: [],
  strengths: [],
  improvements: [],
  careerFit: { comment: "Bạn đang tiến gần yêu cầu của nghề." },
  gaps: [],
  progress: "Bạn đang theo kịp kế hoạch đào tạo.",
  nextSteps: ["Ôn lại kiến thức lập trình.", "Đăng ký học phần theo kế hoạch.", "Làm một dự án nhỏ."],
};

const usage = { inputTokens: 10, outputTokens: 20, thinkingTokens: 5, durationMs: 7 };
function caller(...replies: (unknown | Error)[]) {
  const requests: CloudJsonRequest[] = [];
  const call = vi.fn(async (request: CloudJsonRequest) => {
    requests.push(request);
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return { value: next, usage };
  }) as unknown as CloudJsonCaller & ReturnType<typeof vi.fn>;
  return { call, requests };
}

describe("runCloudJob", () => {
  it("scores, then comments on the merged result, and reports both", async () => {
    const { call, requests } = caller(engineAnswer(computed), comments);
    const outcome = await runCloudJob(scoringInput, computed, call);
    expect(outcome).toMatchObject({ ok: true, commentaryError: null, promptVersion: `comp-ai-v1+${buildAiInput(computed).promptVersion}` });
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.output).toMatchObject({ summary: comments.summary });
    expect(requests[0]).toEqual({ system: scoringInput.system, user: scoringInput.user, schema: scoringInput.schema });
    const checked = validateScoring(engineAnswer(computed), scoringInput.keys);
    if (!checked.ok) throw new Error("expected a valid answer");
    expect(requests[1]!.user).toBe(buildAiInput(mergeAiScoring(computed, checked.scoring)).user);
    expect(outcome.metrics).toMatchObject({ scoring1OutputTokens: 20, commentary1Ms: 7 });
  });

  it("asks once more when the scoring answer is invalid, then gives up", async () => {
    const broken = { ...engineAnswer(computed), skills: [] };
    const retried = await runCloudJob(scoringInput, computed, caller(broken, engineAnswer(computed), comments).call);
    expect(retried).toMatchObject({ ok: true, metrics: { scoring1Rejected: expect.stringContaining("missing_key") } });
    const failed = await runCloudJob(scoringInput, computed, caller(broken, broken).call);
    expect(failed).toMatchObject({ ok: false, errorCode: "invalid_ai_output" });
  });

  it("stops at a call error that another call would not fix", async () => {
    const { call } = caller(new CloudAiError("ai_timeout", "timeout"));
    expect(await runCloudJob(scoringInput, computed, call)).toMatchObject({ ok: false, errorCode: "ai_timeout" });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("keeps the scores when only the comments fail", async () => {
    const outcome = await runCloudJob(scoringInput, computed, caller(engineAnswer(computed), { summary: 1 }, { summary: 2 }).call);
    expect(outcome).toMatchObject({ ok: true, output: null, commentaryError: "invalid_ai_output" });
  });
});
