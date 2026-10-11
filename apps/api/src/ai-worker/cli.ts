import { fileURLToPath } from "node:url";
import { AiWorkerConfigError, loadAiWorkerConfig, readAiWorkerEnv } from "./config.js";
import { createWorkerClient } from "./client.js";
import { getOllamaModelInfo, ollamaChat, warmUpOllama, type OllamaRuntime } from "./ollama.js";
import { errorFields, runWorker, type LogFields } from "./worker.js";

/** services/ai/.env relative to apps/api/src/ai-worker/cli.ts */
const ENV_FILE = fileURLToPath(new URL("../../../../services/ai/.env", import.meta.url));

function log(event: string, fields: LogFields = {}): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`);
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadAiWorkerConfig(await readAiWorkerEnv(ENV_FILE));
  } catch (error) {
    if (error instanceof AiWorkerConfigError) {
      process.stderr.write(`Cấu hình AI worker không hợp lệ: ${error.message}\nChạy "node scripts/setup-ai-worker.mjs" hoặc kiểm tra services/ai/.env.\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const runtime: OllamaRuntime = {
    ollamaUrl: config.ollamaUrl,
    model: config.model,
    contextLength: config.contextLength,
    timeoutMs: config.timeoutMs
  };
  if (config.numGpu !== undefined) runtime.numGpu = config.numGpu;

  const controller = new AbortController();
  const stop = (signalName: string) => {
    if (controller.signal.aborted) process.exit(130);
    log("shutdown", { signal: signalName });
    controller.abort();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  log("starting", {
    api: config.apiUrl,
    model: config.model,
    contextLength: config.contextLength,
    numGpu: config.numGpu ?? null,
    timeoutMs: config.timeoutMs
  });

  try {
    const started = Date.now();
    await warmUpOllama(runtime, {}, controller.signal);
    log("warmed_up", { ms: Date.now() - started });
  } catch (error) {
    log("warm_up_failed", errorFields(error));
  }

  await runWorker(
    {
      client: createWorkerClient({ apiUrl: config.apiUrl, workerKey: config.workerKey }),
      ollama: {
        chat: (job, signal) => ollamaChat(runtime, job, {}, signal),
        modelInfo: () => getOllamaModelInfo(runtime)
      },
      log,
      model: config.model
    },
    controller.signal
  );
  log("stopped");
}

main().catch((error: unknown) => {
  log("fatal", errorFields(error));
  process.exitCode = 1;
});
