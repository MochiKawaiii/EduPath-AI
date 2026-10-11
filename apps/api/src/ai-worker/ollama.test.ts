import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiWorkerError,
  GenerationAbortedError,
  NdjsonAccumulator,
  buildChatBody,
  getOllamaModelInfo,
  ollamaChat,
  parseAiOutput,
  parseCareerSuggestionOutput,
  parseJobOutput,
  type FetchLike,
  type OllamaJob,
  type OllamaRuntime
} from "./ollama.js";

const runtime: OllamaRuntime = { ollamaUrl: "http://127.0.0.1:11434", model: "gemma4:e4b", contextLength: 16384, timeoutMs: 600_000 };
const job: OllamaJob = {
  system: "Hệ thống thử",
  user: "Dữ liệu thử",
  schema: { type: "object" },
  options: { num_ctx: 16384, num_predict: 4096, temperature: 0.4, top_p: 0.95, top_k: 64, shift: true, seed: "x" }
};

const validOutput = {
  summary: "Bạn có nền tảng lập trình ổn.",
  groupInsights: [],
  strengths: [],
  improvements: [],
  careerFit: { comment: "Phù hợp một phần." },
  gaps: [],
  progress: "Đúng tiến độ.",
  nextSteps: ["Ôn SQL", "Làm dự án nhỏ", "Học kiểm thử"]
};

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const doneLine = (reason = "stop") =>
  line({ done: true, done_reason: reason, prompt_eval_count: 5000, eval_count: 2000, eval_duration: 1e9, total_duration: 2e9, load_duration: 3e8, prompt_eval_duration: 5 });

function streamResponse(chunks: string[], init: { status?: number; hang?: boolean } = {}): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++] as string));
        return;
      }
      if (init.hang) return new Promise<void>(() => undefined);
      controller.close();
      return;
    }
  });
  return new Response(body, { status: init.status ?? 200 });
}

function fetchReturning(response: Response): { fetch: FetchLike; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return response;
    }
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("buildChatBody", () => {
  it("sends think:false as a boolean, stream, truncate:false, keep_alive and only whitelisted options", () => {
    const body = buildChatBody(runtime, job);
    expect(body.think).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.truncate).toBe(false);
    expect(body.keep_alive).toBe("15m");
    expect(body.format).toEqual({ type: "object" });
    expect(body.options).toEqual({ num_ctx: 16384, num_predict: 4096, temperature: 0.4, top_p: 0.95, top_k: 64 });
    expect(JSON.stringify(body)).not.toContain("shift");
    expect(body.messages).toEqual([
      { role: "system", content: "Hệ thống thử" },
      { role: "user", content: "Dữ liệu thử" }
    ]);
  });

  it("adds num_gpu when configured and falls back to the configured context", () => {
    const body = buildChatBody({ ...runtime, numGpu: 34 }, { ...job, options: {} });
    expect(body.options).toEqual({ num_ctx: 16384, num_gpu: 34 });
  });
});

describe("NdjsonAccumulator", () => {
  it("joins message.content across lines split at arbitrary chunk boundaries, including CRLF", () => {
    const acc = new NdjsonAccumulator();
    const text = line({ message: { content: "{\"a\":" } }).replace("\n", "\r\n") + line({ message: { content: "\"Tiếng Việt\"}" } }) + doneLine();
    for (let i = 0; i < text.length; i += 7) acc.push(text.slice(i, i + 7));
    acc.end();
    expect(acc.content).toBe("{\"a\":\"Tiếng Việt\"}");
    expect(acc.done?.done_reason).toBe("stop");
  });

  it("accepts a final done line without a trailing newline", () => {
    const acc = new NdjsonAccumulator();
    acc.push(line({ message: { content: "x" } }) + doneLine().trimEnd());
    acc.end();
    expect(acc.content).toBe("x");
  });

  it("fails on an {error} line, on a non-JSON line and on a stream without done", () => {
    expect(() => new NdjsonAccumulator().push(line({ error: "model runner crashed" }))).toThrowError(expect.objectContaining({ code: "ai_failed" }));
    expect(() => new NdjsonAccumulator().push("not json\n")).toThrowError(expect.objectContaining({ code: "ai_failed" }));
    const acc = new NdjsonAccumulator();
    acc.push(line({ message: { content: "x" } }));
    expect(() => acc.end()).toThrowError(expect.objectContaining({ code: "ai_failed", detail: "stream_incomplete" }));
  });

  it("caps the accumulated output", () => {
    const acc = new NdjsonAccumulator(10);
    expect(() => acc.push(line({ message: { content: "x".repeat(11) } }))).toThrowError(expect.objectContaining({ detail: "output_too_large" }));
  });
});

describe("ollamaChat", () => {
  it("streams, posts to /api/chat and returns content plus the five metrics", async () => {
    const { fetch, calls } = fetchReturning(streamResponse([line({ message: { content: "{\"ok\"" } }), line({ message: { content: ":1}" } }), doneLine()]));
    const result = await ollamaChat(runtime, job, { fetch });
    expect(result.content).toBe("{\"ok\":1}");
    expect(result.doneReason).toBe("stop");
    expect(result.metrics).toEqual({ prompt_eval_count: 5000, eval_count: 2000, eval_duration: 1e9, total_duration: 2e9, load_duration: 3e8 });
    expect(calls[0]?.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(calls[0]?.init?.redirect).toBe("error");
    expect(JSON.parse(String(calls[0]?.init?.body)).think).toBe(false);
  });

  it("maps done_reason length to ai_output_truncated", async () => {
    const { fetch } = fetchReturning(streamResponse([line({ message: { content: "{\"summary\":\"cắt" } }), doneLine("length")]));
    await expect(ollamaChat(runtime, job, { fetch })).rejects.toMatchObject({ code: "ai_output_truncated" });
  });

  it("maps an unexpected done_reason and an {error} line to ai_failed", async () => {
    await expect(ollamaChat(runtime, job, fetchReturning(streamResponse([doneLine("load")])))).rejects.toMatchObject({ code: "ai_failed" });
    await expect(ollamaChat(runtime, job, fetchReturning(streamResponse([line({ error: "boom" })])))).rejects.toMatchObject({ code: "ai_failed" });
  });

  it("maps connection refused to ollama_unavailable and HTTP errors to ai_failed / ollama_unavailable", async () => {
    const refused: FetchLike = async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    };
    await expect(ollamaChat(runtime, job, { fetch: refused })).rejects.toMatchObject({ code: "ollama_unavailable" });
    await expect(ollamaChat(runtime, job, fetchReturning(new Response("{\"error\":\"x\"}", { status: 404 })))).rejects.toMatchObject({ code: "ollama_unavailable" });
    await expect(ollamaChat(runtime, job, fetchReturning(new Response("{\"error\":\"x\"}", { status: 500 })))).rejects.toMatchObject({ code: "ai_failed" });
  });

  it("aborts with ai_timeout after 120 s without new data", async () => {
    vi.useFakeTimers();
    const { fetch } = fetchReturning(streamResponse([line({ message: { content: "{" } })], { hang: true }));
    const assertion = expect(ollamaChat(runtime, job, { fetch })).rejects.toMatchObject({ code: "ai_timeout", detail: "inactivity_timeout" });
    await vi.advanceTimersByTimeAsync(119_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
  });

  it("does not apply the inactivity timer while the model is still loading (before the first chunk)", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(encoder.encode(line({ message: { content: "{}" } }) + doneLine()));
          controller.close();
        }, 150_000);
      }
    });
    const pending = ollamaChat(runtime, job, fetchReturning(new Response(body)));
    await vi.advanceTimersByTimeAsync(151_000);
    await expect(pending).resolves.toMatchObject({ content: "{}" });
  });

  it("aborts with ai_timeout at the overall deadline even while data keeps arriving", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        return new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            controller.enqueue(encoder.encode(line({ message: { content: "x" } })));
            resolve();
          }, 60_000);
        });
      },
      cancel() {
        clearTimeout(timer);
      }
    });
    const { fetch } = fetchReturning(new Response(body));
    const assertion = expect(ollamaChat({ ...runtime, timeoutMs: 300_000 }, job, { fetch })).rejects.toMatchObject({ code: "ai_timeout", detail: "overall_timeout" });
    await vi.advanceTimersByTimeAsync(301_000);
    await assertion;
  });

  it("throws GenerationAbortedError when the caller aborts", async () => {
    const controller = new AbortController();
    const { fetch } = fetchReturning(streamResponse([line({ message: { content: "{" } })], { hang: true }));
    const pending = ollamaChat(runtime, job, { fetch }, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toBeInstanceOf(GenerationAbortedError);
  });
});

describe("parseAiOutput", () => {
  it("accepts a well-shaped object", () => {
    expect(parseAiOutput(JSON.stringify(validOutput))).toMatchObject({ summary: validOutput.summary });
  });

  it.each([
    ["not json", "{\"summary\":"],
    ["array", "[]"],
    ["missing summary", JSON.stringify({ ...validOutput, summary: "" })],
    ["gaps not array", JSON.stringify({ ...validOutput, gaps: {} })],
    ["careerFit missing", JSON.stringify({ ...validOutput, careerFit: null })],
    ["nextSteps not strings", JSON.stringify({ ...validOutput, nextSteps: [1] })]
  ])("rejects %s as invalid_ai_output", (_name, content) => {
    expect(() => parseAiOutput(content)).toThrowError(AiWorkerError);
    expect(() => parseAiOutput(content)).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
  });
});

describe("parseCareerSuggestionOutput", () => {
  const career = {
    suggestions: [{ skillKey: "S001", priority: "required", title: "Viết truy vấn SQL", description: "Mô tả", reason: "Lý do" }],
    newSkills: []
  };

  it("accepts an object with suggestions and newSkills arrays, also when both are empty", () => {
    expect(parseCareerSuggestionOutput(JSON.stringify(career))).toEqual(career);
    expect(parseCareerSuggestionOutput(JSON.stringify({ suggestions: [], newSkills: [] }))).toEqual({ suggestions: [], newSkills: [] });
  });

  it.each([
    ["not json", "{\"suggestions\":"],
    ["array", "[]"],
    ["missing newSkills", JSON.stringify({ suggestions: [] })],
    ["suggestions not array", JSON.stringify({ suggestions: {}, newSkills: [] })],
    ["item not an object", JSON.stringify({ suggestions: ["SQL"], newSkills: [] })]
  ])("rejects %s as invalid_ai_output", (_name, content) => {
    expect(() => parseCareerSuggestionOutput(content)).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
  });

  it("parseJobOutput runs the check of the job kind", () => {
    expect(parseJobOutput("career_skill_suggestion", JSON.stringify(career))).toEqual(career);
    expect(() => parseJobOutput("competency_assessment", JSON.stringify(career))).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
    expect(() => parseJobOutput("career_skill_suggestion", JSON.stringify(validOutput))).toThrowError(expect.objectContaining({ code: "invalid_ai_output" }));
  });
});

describe("getOllamaModelInfo", () => {
  const tagsFetch =
    (models: unknown[]): FetchLike =>
    async (url) =>
      url.endsWith("/api/version") ? Response.json({ version: "0.40.2" }) : Response.json({ models });

  it("reads the version and the digest of the configured model", async () => {
    const info = await getOllamaModelInfo(runtime, { fetch: tagsFetch([{ name: "other:1b", digest: "aaa" }, { name: "gemma4:e4b", model: "gemma4:e4b", digest: "dc35e8d9c606" }]) });
    expect(info).toEqual({ version: "0.40.2", digest: "dc35e8d9c606" });
  });

  it("fails when the model is missing or remote", async () => {
    await expect(getOllamaModelInfo(runtime, { fetch: tagsFetch([]) })).rejects.toMatchObject({ code: "ollama_unavailable", detail: "model_missing" });
    await expect(getOllamaModelInfo(runtime, { fetch: tagsFetch([{ name: "gemma4:e4b", digest: "x", remote_host: "https://ollama.com" }]) })).rejects.toMatchObject({
      detail: "model_is_remote"
    });
  });
});
