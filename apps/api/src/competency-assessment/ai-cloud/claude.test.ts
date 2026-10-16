import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { CloudAiError, createClaudeJsonCaller, parseJsonReply, sanitizeSchemaForClaude, type ClaudeMessagesApi } from "./claude.js";

const KEY = "sk-ant-test-0123456789abcdefghij";

function fakeMessages(reply: (() => Promise<unknown>) | unknown) {
  const calls: Record<string, unknown>[] = [];
  const messages = {
    stream: (params: Record<string, unknown>) => {
      calls.push(params);
      return { finalMessage: async () => (typeof reply === "function" ? (reply as () => Promise<unknown>)() : reply) };
    },
  } as unknown as ClaudeMessagesApi;
  return { messages, calls };
}

const message = (text: string, stop: string = "end_turn") => ({
  content: [{ type: "thinking", thinking: "" }, { type: "text", text }],
  stop_reason: stop,
  stop_details: stop === "refusal" ? { type: "refusal", category: "cyber", explanation: "" } : null,
  usage: { input_tokens: 120, output_tokens: 900, output_tokens_details: { thinking_tokens: 800 } },
});

const request = { system: "sys", user: "data", schema: { type: "object", properties: { a: { type: "string", maxLength: 5 } }, required: [] } };

describe("sanitizeSchemaForClaude", () => {
  it("drops unsupported keywords, closes every object and requires all of its properties", () => {
    const schema = sanitizeSchemaForClaude({
      type: "object",
      additionalProperties: true,
      required: ["a"],
      properties: {
        a: { type: "string", minLength: 1, maxLength: 9 },
        list: { type: "array", maxItems: 3, minItems: 1, items: { type: "object", properties: { pattern: { type: "string", pattern: "x" } } } },
        n: { anyOf: [{ type: "number", minimum: 0, maximum: 100 }, { type: "null" }] },
      },
    });
    expect(schema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["a", "list", "n"],
      properties: {
        a: { type: "string" },
        list: { type: "array", items: { type: "object", properties: { pattern: { type: "string" } }, additionalProperties: false, required: ["pattern"] } },
        n: { anyOf: [{ type: "number" }, { type: "null" }] },
      },
    });
  });
});

describe("parseJsonReply", () => {
  it("reads plain JSON and JSON wrapped in a fence, and rejects the rest", () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonReply('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(() => parseJsonReply("không có JSON")).toThrow(CloudAiError);
  });
});

describe("createClaudeJsonCaller", () => {
  it("streams one structured-output request with the effort and no sampling or thinking parameters", async () => {
    const { messages, calls } = fakeMessages(message('{"ok":true}'));
    const call = createClaudeJsonCaller({ apiKey: KEY, model: "claude-haiku-5-5", effort: "high", messages });
    const reply = await call(request);
    expect(reply.value).toEqual({ ok: true });
    expect(reply.usage).toMatchObject({ inputTokens: 120, outputTokens: 900, thinkingTokens: 800 });
    const params = calls[0]!;
    expect(params).toMatchObject({ model: "claude-haiku-5-5", system: "sys", messages: [{ role: "user", content: "data" }] });
    expect(params.output_config).toEqual({ effort: "high", format: { type: "json_schema", schema: sanitizeSchemaForClaude(request.schema) } });
    for (const field of ["temperature", "top_p", "top_k", "thinking"]) expect(params).not.toHaveProperty(field);
  });

  it.each([
    ["a refusal", () => Promise.resolve(message("{}", "refusal")), "ai_failed"],
    ["a reply cut by max_tokens", () => Promise.resolve(message('{"a":', "max_tokens")), "ai_output_truncated"],
    ["a reply that is not JSON", () => Promise.resolve(message("xin chào")), "invalid_ai_output"],
    ["a timeout", () => Promise.reject(new Anthropic.APIConnectionTimeoutError()), "ai_timeout"],
    ["any other API error", () => Promise.reject(new Error(`failed with ${KEY}`)), "ai_failed"],
  ])("maps %s to %s without leaking the key", async (_name, reply, code) => {
    const { messages } = fakeMessages(reply);
    const call = createClaudeJsonCaller({ apiKey: KEY, model: "claude-haiku-5-5", effort: "high", messages });
    const error = await call(request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CloudAiError);
    expect((error as CloudAiError).code).toBe(code);
    expect(String((error as CloudAiError).message)).not.toContain(KEY);
  });
});
