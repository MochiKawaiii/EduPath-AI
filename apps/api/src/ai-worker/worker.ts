import { WorkerApiError, type ClaimedJob, type CompleteBody, type WorkerClient } from "./client.js";
import {
  AiWorkerError,
  GenerationAbortedError,
  parseAiOutput,
  type OllamaChatResult,
  type OllamaJob,
  type OllamaMetrics,
  type OllamaModelInfo
} from "./ollama.js";

export type LogFields = Record<string, string | number | boolean | null | undefined>;
/** Structured logger. Callers only pass ids, codes and numbers — never prompts or outputs. */
export type WorkerLogger = (event: string, fields?: LogFields) => void;

export interface OllamaPort {
  chat(job: OllamaJob, signal: AbortSignal): Promise<OllamaChatResult>;
  modelInfo(): Promise<OllamaModelInfo>;
}

export interface WorkerTimings {
  heartbeatMs: number;
  idlePollMs: number;
  errorBackoffMs: number;
  extendEveryMs: number;
  completeRetries: number;
}

export const DEFAULT_TIMINGS: WorkerTimings = {
  heartbeatMs: 20_000,
  idlePollMs: 5_000,
  errorBackoffMs: 15_000,
  extendEveryMs: 180_000,
  completeRetries: 3
};

export interface WorkerDeps {
  client: WorkerClient;
  ollama: OllamaPort;
  log: WorkerLogger;
  model: string;
  timings?: Partial<WorkerTimings>;
}

/** Resolves after ms, or immediately when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export function errorFields(error: unknown): LogFields {
  if (error instanceof AiWorkerError) return { error: error.code, detail: error.detail };
  if (error instanceof WorkerApiError) return { error: "worker_api", status: error.status, code: error.code ?? null };
  if (error instanceof Error) {
    const code = (error as { code?: unknown; cause?: { code?: unknown } }).code ?? (error as { cause?: { code?: unknown } }).cause?.code;
    return { error: error.name, code: typeof code === "string" ? code : null };
  }
  return { error: "unknown" };
}

export interface GenerationResult {
  output: Record<string, unknown>;
  metrics: OllamaMetrics;
  attempts: number;
}

/**
 * Runs the chat call and the local output check. Retries exactly once when the model returned
 * unparseable or mis-shaped JSON; never retries truncation (done_reason "length"), timeouts or other errors.
 */
export async function generateWithRetry(ollama: OllamaPort, job: OllamaJob, signal: AbortSignal, log: WorkerLogger, jobId: string): Promise<GenerationResult> {
  const maxAttempts = 2;
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    const result = await ollama.chat(job, signal);
    log("generation_finished", {
      job: jobId,
      attempt,
      ms: Date.now() - started,
      prompt_eval_count: result.metrics.prompt_eval_count,
      eval_count: result.metrics.eval_count
    });
    try {
      return { output: parseAiOutput(result.content), metrics: result.metrics, attempts: attempt };
    } catch (error) {
      if (!(error instanceof AiWorkerError) || error.code !== "invalid_ai_output" || attempt >= maxAttempts || signal.aborted) throw error;
      log("generation_retry", { job: jobId, attempt, reason: error.detail });
    }
  }
}

export type JobOutcome = "completed" | "failed" | "abandoned";

async function completeWithRetry(deps: WorkerDeps, timings: WorkerTimings, jobId: string, body: CompleteBody, signal: AbortSignal): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      await deps.client.complete(jobId, body);
      return true;
    } catch (error) {
      const retriable = !(error instanceof WorkerApiError) || error.status >= 500 || error.status === 429;
      deps.log("complete_failed", { job: jobId, attempt: attempt + 1, ...errorFields(error) });
      if (!retriable || attempt >= timings.completeRetries || signal.aborted) return false;
      await sleep(timings.errorBackoffMs, signal);
    }
  }
}

/** Generates the AI output for one claimed job, extending the lease while it runs, then reports the result. */
export async function processJob(job: ClaimedJob, info: OllamaModelInfo, deps: WorkerDeps, signal: AbortSignal): Promise<JobOutcome> {
  const timings = { ...DEFAULT_TIMINGS, ...deps.timings };
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  signal.addEventListener("abort", onParentAbort, { once: true });
  if (signal.aborted) controller.abort();
  let leaseLost = false;
  let extending = false;
  const extendTimer = setInterval(() => {
    if (extending || controller.signal.aborted) return;
    extending = true;
    deps.client
      .extend(job.id, job.leaseToken)
      .then(() => deps.log("lease_extended", { job: job.id }))
      .catch((error: unknown) => {
        deps.log("lease_extend_failed", { job: job.id, ...errorFields(error) });
        if (error instanceof WorkerApiError && (error.status === 409 || error.status === 404)) {
          leaseLost = true;
          controller.abort();
        }
      })
      .finally(() => {
        extending = false;
      });
  }, timings.extendEveryMs);

  deps.log("job_claimed", { job: job.id, promptVersion: job.promptVersion });
  let body: CompleteBody;
  try {
    const result = await generateWithRetry(deps.ollama, job, controller.signal, deps.log, job.id);
    body = { leaseToken: job.leaseToken, model: deps.model, digest: info.digest, ollamaVersion: info.version, metrics: result.metrics, output: result.output };
  } catch (error) {
    if (error instanceof GenerationAbortedError || controller.signal.aborted) {
      deps.log("job_abandoned", { job: job.id, leaseLost });
      return "abandoned";
    }
    deps.log("generation_failed", { job: job.id, ...errorFields(error) });
    body = { leaseToken: job.leaseToken, error: error instanceof AiWorkerError ? error.code : "ai_failed" };
  } finally {
    clearInterval(extendTimer);
    signal.removeEventListener("abort", onParentAbort);
  }

  const reported = await completeWithRetry(deps, timings, job.id, body, signal);
  const outcome: JobOutcome = !reported ? "abandoned" : "output" in body ? "completed" : "failed";
  deps.log("job_finished", { job: job.id, outcome });
  return outcome;
}

/** Main loop: heartbeat every 20 s while Ollama is reachable, claim, generate, complete; idle poll 5 s, error backoff 15 s. */
export async function runWorker(deps: WorkerDeps, signal: AbortSignal): Promise<void> {
  const timings = { ...DEFAULT_TIMINGS, ...deps.timings };
  let ollamaHealthy = false;
  let reportedDown = false;
  let beating = false;
  const heartbeatTimer = setInterval(() => {
    if (!ollamaHealthy || beating || signal.aborted) return;
    beating = true;
    deps.client
      .heartbeat()
      .catch((error: unknown) => deps.log("heartbeat_failed", errorFields(error)))
      .finally(() => {
        beating = false;
      });
  }, timings.heartbeatMs);

  try {
    while (!signal.aborted) {
      let info: OllamaModelInfo;
      try {
        info = await deps.ollama.modelInfo();
        if (!ollamaHealthy) deps.log("ollama_ready", { ollamaVersion: info.version });
        ollamaHealthy = true;
        reportedDown = false;
      } catch (error) {
        if (!reportedDown) deps.log("ollama_unavailable", errorFields(error));
        reportedDown = true;
        ollamaHealthy = false;
        await sleep(timings.errorBackoffMs, signal);
        continue;
      }

      let job: ClaimedJob | null;
      try {
        job = await deps.client.claim();
      } catch (error) {
        deps.log("claim_failed", errorFields(error));
        await sleep(timings.errorBackoffMs, signal);
        continue;
      }
      if (!job) {
        await sleep(timings.idlePollMs, signal);
        continue;
      }

      try {
        await processJob(job, info, deps, signal);
      } catch (error) {
        deps.log("job_error", { job: job.id, ...errorFields(error) });
        await sleep(timings.errorBackoffMs, signal);
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
  }
}
