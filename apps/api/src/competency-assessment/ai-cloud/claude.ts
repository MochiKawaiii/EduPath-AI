// Claude API client for the competency "AI 100%" mode (comp-ai-v1). Every call is one streamed Messages
// request whose reply must follow a per-job JSON schema (structured outputs). Claude Haiku 5.5 thinks
// adaptively by default and rejects non-default sampling parameters, so neither `thinking` nor
// `temperature` is sent. The API key never appears in an error or a log line.
import Anthropic from "@anthropic-ai/sdk";
import type { JsonSchema } from "../ai/schema.js";

export const CLOUD_AI_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type CloudAiEffort = (typeof CLOUD_AI_EFFORTS)[number];
export const CLOUD_AI_DEFAULT_MODEL = "claude-haiku-5-5";
/** Room for adaptive thinking plus one row per skill (80+ on K29); the call is streamed, so no HTTP timeout. */
export const CLOUD_AI_MAX_TOKENS = 64_000;
const CALL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_RETRIES = 4;

export type CloudAiErrorCode = "ai_timeout" | "ai_output_truncated" | "invalid_ai_output" | "ai_failed";

export class CloudAiError extends Error {
  constructor(readonly code: CloudAiErrorCode, readonly detail: string) {
    super(`${code}: ${detail}`);
    this.name = "CloudAiError";
  }
}

export type CloudAiUsage = { inputTokens: number; outputTokens: number; thinkingTokens: number | null; durationMs: number };
export type CloudJsonRequest = { system: string; user: string; schema: JsonSchema };
export type CloudJsonReply = { value: unknown; usage: CloudAiUsage };
/** One structured-output call; throws CloudAiError. */
export type CloudJsonCaller = (request: CloudJsonRequest) => Promise<CloudJsonReply>;

/** The slice of the SDK this module uses, so tests can pass a fake. */
export type ClaudeMessagesApi = Pick<Anthropic["messages"], "stream">;

export type ClaudeCallerOptions = {
  apiKey: string;
  /** Needed by keys that are not scoped to a workspace ("sk-ant-usr-…"). */
  workspaceId?: string | undefined;
  model: string;
  effort: CloudAiEffort;
  /** Test seam; defaults to a real client. */
  messages?: ClaudeMessagesApi;
};

export function createClaudeClient(options: { apiKey: string; workspaceId?: string | undefined }): Anthropic {
  return new Anthropic({
    apiKey: options.apiKey,
    maxRetries: MAX_RETRIES,
    timeout: CALL_TIMEOUT_MS,
    ...(options.workspaceId ? { defaultHeaders: { "anthropic-workspace-id": options.workspaceId } } : {}),
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Keywords Claude structured outputs reject; the server-side validators enforce these limits instead. */
const UNSUPPORTED_KEYWORDS = new Set([
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern",
  "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties",
]);

/**
 * A copy of the schema that Claude accepts: unsupported keywords removed, and every object closed
 * (`additionalProperties: false`) with all of its properties required. Property names are kept as they are.
 */
export function sanitizeSchemaForClaude(schema: JsonSchema): JsonSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!isRecord(node)) return node;
    const copy: Record<string, unknown> = {};
    for (const [keyword, value] of Object.entries(node)) {
      if (UNSUPPORTED_KEYWORDS.has(keyword)) continue;
      copy[keyword] = (keyword === "properties" || keyword === "$defs" || keyword === "definitions") && isRecord(value)
        ? Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, walk(sub)]))
        : walk(value);
    }
    if (copy.type === "object") {
      copy.additionalProperties = false;
      if (isRecord(copy.properties)) copy.required = Object.keys(copy.properties);
    }
    return copy;
  };
  return walk(schema) as JsonSchema;
}

/** The JSON object of a reply (a stray code fence or text around it is ignored). */
export function parseJsonReply(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new CloudAiError("invalid_ai_output", "reply_not_json");
  }
}

export function createClaudeJsonCaller(options: ClaudeCallerOptions): CloudJsonCaller {
  const messages = options.messages ?? createClaudeClient(options).messages;
  const mask = (text: string) => (options.apiKey ? text.split(options.apiKey).join("***") : text);
  return async ({ system, user, schema }) => {
    const started = Date.now();
    let message: Anthropic.Message;
    try {
      message = await messages.stream({
        model: options.model,
        max_tokens: CLOUD_AI_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort: options.effort, format: { type: "json_schema", schema: sanitizeSchemaForClaude(schema) } },
      }).finalMessage();
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) throw new CloudAiError("ai_timeout", "timeout");
      const name = error instanceof Error ? error.constructor.name : typeof error;
      const status = error instanceof Anthropic.APIError && error.status !== undefined ? ` ${error.status}` : "";
      throw new CloudAiError("ai_failed", mask(`${name}${status}`));
    }
    if (message.stop_reason === "refusal") throw new CloudAiError("ai_failed", `refusal ${message.stop_details?.category ?? ""}`.trim());
    if (message.stop_reason === "max_tokens") throw new CloudAiError("ai_output_truncated", "max_tokens");
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return {
      value: parseJsonReply(text),
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        thinkingTokens: message.usage.output_tokens_details?.thinking_tokens ?? null,
        durationMs: Date.now() - started,
      },
    };
  };
}
