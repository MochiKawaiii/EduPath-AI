// Constants of the AI worker protocol (/api/worker/competency-assessments), shared by the
// competency job handlers in worker-router.ts, the career suggestion jobs in
// careers/ai-suggestions/jobs.ts, the graduation advice jobs in graduation/advice/jobs.ts and the
// course proposal jobs in competencies/ai/jobs.ts. Kept apart so none of these modules imports another.

export const AI_JOB_LEASE_MINUTES = 15;
export const AI_JOB_MAX_ATTEMPTS = 2;
export const AI_HOUSEKEEPING_INTERVAL_MS = 60_000;
export const AI_WORKER_ERROR_CODES = ["ai_timeout", "ai_output_truncated", "invalid_ai_output", "ollama_unavailable", "ai_failed"] as const;
export type AiWorkerErrorCode = (typeof AI_WORKER_ERROR_CODES)[number];

/**
 * Job kinds a worker can advertise on /heartbeat and /claim. A worker that sends no kinds
 * (every worker released before career suggestions) only handles competency assessments, and
 * a worker released before graduation advice never advertises (or receives) that kind.
 */
export const COMPETENCY_ASSESSMENT_KIND = "competency_assessment";
export const CAREER_SKILL_SUGGESTION_KIND = "career_skill_suggestion";
export const GRADUATION_ADVICE_KIND = "graduation_advice";
/**
 * AI proposals for the admin "Năng lực" pages: skill links and weights of the courses of a CTĐT and
 * skills for the catalog. v2 (2026-10-17): these jobs ask for Gemma's thinking mode (`think: true`
 * on the claimed job). Workers released before that always sent think:false and advertise the old
 * "competency_course_suggestion", so they never receive these jobs until they are restarted.
 */
export const COMPETENCY_COURSE_SUGGESTION_KIND = "competency_course_suggestion_v2";
export const AI_JOB_KINDS = [COMPETENCY_ASSESSMENT_KIND, CAREER_SKILL_SUGGESTION_KIND, GRADUATION_ADVICE_KIND, COMPETENCY_COURSE_SUGGESTION_KIND] as const;
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
