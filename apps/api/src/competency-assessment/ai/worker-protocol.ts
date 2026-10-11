// Constants of the AI worker protocol (/api/worker/competency-assessments), shared by the
// competency job handlers in worker-router.ts and the career suggestion jobs in
// careers/ai-suggestions/jobs.ts. Kept apart so neither module imports the other.

export const AI_JOB_LEASE_MINUTES = 15;
export const AI_JOB_MAX_ATTEMPTS = 2;
export const AI_HOUSEKEEPING_INTERVAL_MS = 60_000;
export const AI_WORKER_ERROR_CODES = ["ai_timeout", "ai_output_truncated", "invalid_ai_output", "ollama_unavailable", "ai_failed"] as const;
export type AiWorkerErrorCode = (typeof AI_WORKER_ERROR_CODES)[number];

/**
 * Job kinds a worker can advertise on /heartbeat and /claim. A worker that sends no kinds
 * (every worker released before career suggestions) only handles competency assessments.
 */
export const COMPETENCY_ASSESSMENT_KIND = "competency_assessment";
export const CAREER_SKILL_SUGGESTION_KIND = "career_skill_suggestion";
export const AI_JOB_KINDS = [COMPETENCY_ASSESSMENT_KIND, CAREER_SKILL_SUGGESTION_KIND] as const;
export type AiJobKind = (typeof AI_JOB_KINDS)[number];

/** Known kinds only, without repeats; missing or empty means competency assessments only. */
export function normalizeJobKinds(value: unknown): AiJobKind[] {
  const kinds = Array.isArray(value)
    ? AI_JOB_KINDS.filter((kind) => value.includes(kind))
    : [];
  return kinds.length ? kinds : [COMPETENCY_ASSESSMENT_KIND];
}

/** What a worker sends on /complete (already parsed). */
export type WorkerCompletion =
  | { leaseToken: string; model: string; digest: string; ollamaVersion: string; metrics: Record<string, unknown>; output: unknown }
  | { leaseToken: string; error: AiWorkerErrorCode };
