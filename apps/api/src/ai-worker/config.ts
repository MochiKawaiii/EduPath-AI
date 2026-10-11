import { readFile } from "node:fs/promises";

/** Keys the AI worker reads from services/ai/.env. Anything else in that file is ignored. */
export const AI_WORKER_ENV_KEYS = [
  "AI_API_URL",
  "AI_WORKER_KEY",
  "OLLAMA_URL",
  "OLLAMA_MODEL",
  "OLLAMA_CONTEXT",
  "OLLAMA_NUM_GPU",
  "AI_TIMEOUT_MS"
] as const;

export type AiWorkerEnvKey = (typeof AI_WORKER_ENV_KEYS)[number];
export type AiWorkerEnv = Partial<Record<AiWorkerEnvKey, string>>;

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "gemma4:e4b";
export const DEFAULT_OLLAMA_CONTEXT = 16384;
export const DEFAULT_AI_TIMEOUT_MS = 600_000;

export interface AiWorkerConfig {
  /** Origin of the EduPath API, e.g. http://localhost:4000 or https://api.example.com. */
  apiUrl: string;
  workerKey: string;
  /** Origin of the local Ollama server (loopback only). */
  ollamaUrl: string;
  model: string;
  contextLength: number;
  numGpu?: number;
  timeoutMs: number;
}

export class AiWorkerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiWorkerConfigError";
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const LOCAL_API_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Parses a dotenv-style file, keeping only whitelisted keys. Values are never logged. */
export function parseAiWorkerEnvFile(text: string): AiWorkerEnv {
  const allowed = new Set<string>(AI_WORKER_ENV_KEYS);
  const result: AiWorkerEnv = {};
  for (const rawLine of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] as string;
    if (!allowed.has(key)) continue;
    let value = (match[2] ?? "").trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    result[key as AiWorkerEnvKey] = value;
  }
  return result;
}

function parseUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AiWorkerConfigError(`${name} is not a valid URL.`);
  }
  if (url.username || url.password) throw new AiWorkerConfigError(`${name} must not contain credentials.`);
  if (url.search || url.hash) throw new AiWorkerConfigError(`${name} must not contain a query or fragment.`);
  if (url.pathname !== "/" && url.pathname !== "") throw new AiWorkerConfigError(`${name} must be an origin without a path.`);
  return url;
}

function parseInteger(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value.trim())) throw new AiWorkerConfigError(`${name} must be a whole number.`);
  const parsed = Number(value.trim());
  if (parsed < min || parsed > max) throw new AiWorkerConfigError(`${name} must be between ${min} and ${max}.`);
  return parsed;
}

/** Validates the worker settings and fails closed on anything unsafe. */
export function loadAiWorkerConfig(env: AiWorkerEnv): AiWorkerConfig {
  const apiValue = env.AI_API_URL?.trim();
  if (!apiValue) throw new AiWorkerConfigError("AI_API_URL is required.");
  const api = parseUrl("AI_API_URL", apiValue);
  const apiIsLocal = api.protocol === "http:" && LOCAL_API_HOSTS.has(api.hostname);
  if (api.protocol !== "https:" && !apiIsLocal) {
    throw new AiWorkerConfigError("AI_API_URL must use HTTPS, or http://localhost / http://127.0.0.1.");
  }

  const workerKey = env.AI_WORKER_KEY?.trim() ?? "";
  if (workerKey.length < 32) throw new AiWorkerConfigError("AI_WORKER_KEY must have at least 32 characters.");
  if (/\s/.test(workerKey)) throw new AiWorkerConfigError("AI_WORKER_KEY must not contain whitespace.");

  const ollama = parseUrl("OLLAMA_URL", env.OLLAMA_URL?.trim() || DEFAULT_OLLAMA_URL);
  if (ollama.protocol !== "http:" || !LOOPBACK_HOSTS.has(ollama.hostname)) {
    throw new AiWorkerConfigError("OLLAMA_URL must point to this machine (http://127.0.0.1, localhost or [::1]).");
  }

  const model = env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) throw new AiWorkerConfigError("OLLAMA_MODEL has an invalid name.");
  if (/cloud/i.test(model)) throw new AiWorkerConfigError("OLLAMA_MODEL must be a local model; cloud models are not allowed.");

  const contextLength = parseInteger("OLLAMA_CONTEXT", env.OLLAMA_CONTEXT, DEFAULT_OLLAMA_CONTEXT, 4096, 131072);
  const timeoutMs = parseInteger("AI_TIMEOUT_MS", env.AI_TIMEOUT_MS, DEFAULT_AI_TIMEOUT_MS, 60_000, 1_800_000);
  const numGpuValue = env.OLLAMA_NUM_GPU?.trim();
  const config: AiWorkerConfig = {
    apiUrl: api.origin,
    workerKey,
    ollamaUrl: ollama.origin,
    model,
    contextLength,
    timeoutMs
  };
  if (numGpuValue) config.numGpu = parseInteger("OLLAMA_NUM_GPU", numGpuValue, 0, 0, 999);
  return config;
}

/**
 * Reads services/ai/.env (whitelisted keys only). Whitelisted variables that are set in the
 * process environment take precedence over the file.
 */
export async function readAiWorkerEnv(file: string, processEnv: NodeJS.ProcessEnv = process.env): Promise<AiWorkerEnv> {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const env = parseAiWorkerEnvFile(text);
  for (const key of AI_WORKER_ENV_KEYS) {
    const value = processEnv[key];
    if (value !== undefined && value.trim() !== "") env[key] = value;
  }
  return env;
}
