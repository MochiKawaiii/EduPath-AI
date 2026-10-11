import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerApiError, type ClaimedJob, type CompleteBody, type WorkerClient } from "./client.js";
import { AiWorkerError, GenerationAbortedError, type OllamaChatResult, type OllamaJob } from "./ollama.js";
import { processJob, runWorker, type OllamaPort, type WorkerDeps } from "./worker.js";

const job: ClaimedJob = {
  id: "11111111-1111-4111-8111-111111111111",
  leaseToken: "lease-1",
  promptVersion: "comp-v1",
  system: "BÍ MẬT HỆ THỐNG",
  user: "BÍ MẬT DỮ LIỆU",
  schema: { type: "object" },
  options: { num_ctx: 16384 }
};
const info = { version: "0.40.2", digest: "dc35e8d9c606" };
const validOutput = {
  summary: "Tóm tắt",
  groupInsights: [],
  strengths: [],
  improvements: [],
  careerFit: { comment: "Nhận xét" },
  gaps: [],
  progress: "Tiến độ",
  nextSteps: ["a", "b", "c"]
};
const ok = (content: string): OllamaChatResult => ({ content, doneReason: "stop", metrics: { prompt_eval_count: 10, eval_count: 20 } });

function fakeClient(overrides: Partial<WorkerClient> = {}) {
  const completions: { id: string; body: CompleteBody }[] = [];
  const client: WorkerClient = {
    heartbeat: vi.fn(async () => undefined),
    claim: vi.fn(async () => null),
    extend: vi.fn(async () => ({ leaseUntil: "2026-10-11T00:00:00Z" })),
    complete: vi.fn(async (id: string, body: CompleteBody) => {
      completions.push({ id, body });
    }),
    ...overrides
  };
  return { client, completions };
}

function deps(client: WorkerClient, chat: OllamaPort["chat"], logs: string[] = []): WorkerDeps {
  return {
    client,
    ollama: { chat, modelInfo: async () => info },
    log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
    model: "gemma4:e4b",
    timings: { errorBackoffMs: 1, idlePollMs: 1, heartbeatMs: 20_000, extendEveryMs: 180_000, completeRetries: 2 }
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("processJob retry policy", () => {
  it("retries once after unparseable JSON and completes with the output, model, digest and version", async () => {
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValueOnce(ok("{\"summary\":")).mockResolvedValueOnce(ok(JSON.stringify(validOutput)));
    const outcome = await processJob(job, info, deps(client, chat), new AbortController().signal);
    expect(outcome).toBe("completed");
    expect(chat).toHaveBeenCalledTimes(2);
    expect(completions).toEqual([
      {
        id: job.id,
        body: { leaseToken: "lease-1", model: "gemma4:e4b", digest: "dc35e8d9c606", ollamaVersion: "0.40.2", metrics: { prompt_eval_count: 10, eval_count: 20 }, output: validOutput }
      }
    ]);
  });

  it("reports invalid_ai_output after the second bad answer", async () => {
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok("không phải JSON"));
    expect(await processJob(job, info, deps(client, chat), new AbortController().signal)).toBe("failed");
    expect(chat).toHaveBeenCalledTimes(2);
    expect(completions[0]?.body).toEqual({ leaseToken: "lease-1", error: "invalid_ai_output" });
  });

  it.each(["ai_output_truncated", "ai_timeout", "ollama_unavailable", "ai_failed"] as const)("does not retry %s", async (code) => {
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockRejectedValue(new AiWorkerError(code));
    expect(await processJob(job, info, deps(client, chat), new AbortController().signal)).toBe("failed");
    expect(chat).toHaveBeenCalledTimes(1);
    expect(completions[0]?.body).toEqual({ leaseToken: "lease-1", error: code });
  });

  it("maps unexpected errors to ai_failed and never logs the prompt or output", async () => {
    const logs: string[] = [];
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockRejectedValue(new Error("BÍ MẬT DỮ LIỆU"));
    await processJob(job, info, deps(client, chat, logs), new AbortController().signal);
    expect(completions[0]?.body).toEqual({ leaseToken: "lease-1", error: "ai_failed" });
    expect(logs.join("\n")).not.toContain("BÍ MẬT");
  });

  it("retries complete on server errors but gives up on 409 job_expired", async () => {
    const complete = vi.fn<WorkerClient["complete"]>().mockRejectedValueOnce(new WorkerApiError(503, "database_required")).mockResolvedValueOnce(undefined);
    const { client } = fakeClient({ complete });
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok(JSON.stringify(validOutput)));
    expect(await processJob(job, info, deps(client, chat), new AbortController().signal)).toBe("completed");
    expect(complete).toHaveBeenCalledTimes(2);

    const expired = vi.fn<WorkerClient["complete"]>().mockRejectedValue(new WorkerApiError(409, "job_expired"));
    const second = fakeClient({ complete: expired });
    expect(await processJob(job, info, deps(second.client, chat), new AbortController().signal)).toBe("abandoned");
    expect(expired).toHaveBeenCalledTimes(1);
  });
});

describe("processJob lease handling", () => {
  function slowChat(): OllamaPort["chat"] {
    return (_job: OllamaJob, signal: AbortSignal) =>
      new Promise<OllamaChatResult>((resolve, reject) => {
        const timer = setTimeout(() => resolve(ok(JSON.stringify(validOutput))), 400_000);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new GenerationAbortedError());
        });
      });
  }

  it("extends the lease about every 3 minutes while generating", async () => {
    vi.useFakeTimers();
    const { client, completions } = fakeClient();
    const pending = processJob(job, info, deps(client, slowChat()), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(400_000);
    expect(await pending).toBe("completed");
    expect(client.extend).toHaveBeenCalledTimes(2);
    expect(client.extend).toHaveBeenCalledWith(job.id, "lease-1");
    expect(completions).toHaveLength(1);
  });

  it("abandons the job without completing when the lease is lost", async () => {
    vi.useFakeTimers();
    const { client, completions } = fakeClient({ extend: vi.fn(async () => Promise.reject(new WorkerApiError(409, "job_expired"))) });
    const pending = processJob(job, info, deps(client, slowChat()), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(181_000);
    expect(await pending).toBe("abandoned");
    expect(completions).toHaveLength(0);
  });

  it("abandons the job when the worker shuts down", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { client, completions } = fakeClient();
    const pending = processJob(job, info, deps(client, slowChat()), controller.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    expect(await pending).toBe("abandoned");
    expect(completions).toHaveLength(0);
  });
});

describe("runWorker", () => {
  it("claims, processes a job, polls when idle and stops on abort", async () => {
    const controller = new AbortController();
    let claims = 0;
    const { client, completions } = fakeClient({
      claim: vi.fn(async () => {
        claims += 1;
        if (claims === 3) controller.abort();
        return claims === 1 ? job : null;
      })
    });
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok(JSON.stringify(validOutput)));
    await runWorker(deps(client, chat), controller.signal);
    expect(completions).toHaveLength(1);
    expect(claims).toBe(3);
  });

  it("does not claim while Ollama is unavailable", async () => {
    const controller = new AbortController();
    const { client } = fakeClient();
    let checks = 0;
    const d = deps(client, vi.fn());
    d.ollama.modelInfo = async () => {
      checks += 1;
      if (checks === 3) controller.abort();
      throw new AiWorkerError("ollama_unavailable");
    };
    await runWorker(d, controller.signal);
    expect(client.claim).not.toHaveBeenCalled();
  });

  it("sends a heartbeat every 20 s while Ollama is reachable", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { client } = fakeClient();
    const d = deps(client, vi.fn());
    d.timings = { ...d.timings, idlePollMs: 5_000 };
    const running = runWorker(d, controller.signal);
    await vi.advanceTimersByTimeAsync(61_000);
    controller.abort();
    await running;
    expect(client.heartbeat).toHaveBeenCalledTimes(3);
    expect((client.claim as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(12);
  });
});

describe("processJob job kinds", () => {
  const careerJob: ClaimedJob = { ...job, kind: "career_skill_suggestion", promptVersion: "career-skill-v1" };
  const careerOutput = {
    suggestions: [{ skillKey: "S001", priority: "required", title: "Viết truy vấn SQL", description: "Mô tả", reason: "Lý do" }],
    newSkills: []
  };

  it("checks a career job with the career shape and logs the kind without any prompt or output text", async () => {
    const logs: string[] = [];
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok(JSON.stringify(careerOutput)));
    expect(await processJob(careerJob, info, deps(client, chat, logs), new AbortController().signal)).toBe("completed");
    expect(completions[0]?.body).toMatchObject({ leaseToken: "lease-1", output: careerOutput });
    const events = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
    for (const name of ["job_claimed", "generation_finished", "job_finished"]) {
      expect(events.find((event) => event.event === name)).toMatchObject({ kind: "career_skill_suggestion" });
    }
    expect(logs.join("\n")).not.toMatch(/BÍ MẬT|Viết truy vấn/);
  });

  it("retries once and fails a career job that returned the competency shape", async () => {
    const { client, completions } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok(JSON.stringify(validOutput)));
    expect(await processJob(careerJob, info, deps(client, chat), new AbortController().signal)).toBe("failed");
    expect(chat).toHaveBeenCalledTimes(2);
    expect(completions[0]?.body).toEqual({ leaseToken: "lease-1", error: "invalid_ai_output" });
  });

  it("treats a job without kind as a competency assessment", async () => {
    const logs: string[] = [];
    const { client } = fakeClient();
    const chat = vi.fn<OllamaPort["chat"]>().mockResolvedValue(ok(JSON.stringify(validOutput)));
    expect(await processJob(job, info, deps(client, chat, logs), new AbortController().signal)).toBe("completed");
    expect(JSON.parse(logs[0]!)).toMatchObject({ event: "job_claimed", kind: "competency_assessment" });
  });
});
