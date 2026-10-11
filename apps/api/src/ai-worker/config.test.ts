import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AiWorkerConfigError, loadAiWorkerConfig, parseAiWorkerEnvFile, readAiWorkerEnv, type AiWorkerEnv } from "./config.js";

const key = "k".repeat(40);
const base: AiWorkerEnv = { AI_API_URL: "http://localhost:4000", AI_WORKER_KEY: key };

describe("parseAiWorkerEnvFile", () => {
  it("keeps only whitelisted keys, strips quotes and ignores comments", () => {
    const env = parseAiWorkerEnvFile(
      "﻿# comment\nAI_API_URL=\"http://localhost:4000\"\r\nOCR_WORKER_KEY=secret\nDATABASE_URL=postgres://x\nexport OLLAMA_MODEL='gemma4:e4b'\nOLLAMA_NUM_GPU = 34\n"
    );
    expect(env).toEqual({ AI_API_URL: "http://localhost:4000", OLLAMA_MODEL: "gemma4:e4b", OLLAMA_NUM_GPU: "34" });
  });
});

describe("loadAiWorkerConfig", () => {
  it("applies defaults", () => {
    expect(loadAiWorkerConfig(base)).toEqual({
      apiUrl: "http://localhost:4000",
      workerKey: key,
      ollamaUrl: "http://127.0.0.1:11434",
      model: "gemma4:e4b",
      contextLength: 16384,
      timeoutMs: 600_000
    });
  });

  it("accepts HTTPS APIs, loopback Ollama variants and OLLAMA_NUM_GPU", () => {
    const config = loadAiWorkerConfig({ ...base, AI_API_URL: "https://api.example.edu", OLLAMA_URL: "http://[::1]:11434", OLLAMA_NUM_GPU: "38", AI_TIMEOUT_MS: "900000" });
    expect(config).toMatchObject({ apiUrl: "https://api.example.edu", ollamaUrl: "http://[::1]:11434", numGpu: 38, timeoutMs: 900_000 });
    expect(loadAiWorkerConfig({ ...base, OLLAMA_URL: "http://localhost:11434" }).ollamaUrl).toBe("http://localhost:11434");
  });

  it.each<[string, AiWorkerEnv]>([
    ["missing API URL", { AI_WORKER_KEY: key }],
    ["plain HTTP to a remote API", { ...base, AI_API_URL: "http://api.example.edu" }],
    ["API URL with credentials", { ...base, AI_API_URL: "https://user:pw@api.example.edu" }],
    ["API URL with a path", { ...base, AI_API_URL: "https://api.example.edu/api" }],
    ["short key", { ...base, AI_WORKER_KEY: "short" }],
    ["non-loopback Ollama", { ...base, OLLAMA_URL: "http://192.168.1.10:11434" }],
    ["Ollama on 0.0.0.0", { ...base, OLLAMA_URL: "http://0.0.0.0:11434" }],
    ["remote Ollama over HTTPS", { ...base, OLLAMA_URL: "https://ollama.com" }],
    ["cloud model", { ...base, OLLAMA_MODEL: "gpt-oss:120b-cloud" }],
    ["model with spaces", { ...base, OLLAMA_MODEL: "gemma 4" }],
    ["context too small", { ...base, OLLAMA_CONTEXT: "2048" }],
    ["timeout not a number", { ...base, AI_TIMEOUT_MS: "10m" }],
    ["negative GPU layers", { ...base, OLLAMA_NUM_GPU: "-1" }]
  ])("fails closed on %s", (_name, env) => {
    expect(() => loadAiWorkerConfig(env)).toThrowError(AiWorkerConfigError);
  });
});

describe("readAiWorkerEnv", () => {
  it("reads the file, lets whitelisted process variables override it and tolerates a missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-worker-config-"));
    try {
      const file = join(dir, ".env");
      await writeFile(file, `AI_API_URL=http://localhost:4000\nAI_WORKER_KEY=${key}\nOLLAMA_NUM_GPU=34\n`, "utf8");
      const env = await readAiWorkerEnv(file, { OLLAMA_NUM_GPU: "38", DATABASE_URL: "postgres://x" });
      expect(env).toEqual({ AI_API_URL: "http://localhost:4000", AI_WORKER_KEY: key, OLLAMA_NUM_GPU: "38" });
      expect(await readAiWorkerEnv(join(dir, "missing.env"), {})).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
