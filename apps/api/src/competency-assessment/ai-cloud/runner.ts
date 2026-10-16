// In-process runner of the competency "AI 100%" jobs (runner 'cloud', comp-ai-v1). It claims one job at a
// time from stu_comp_ai_jobs with the same lease and attempt rules as the laptop worker, asks the model for
// the scores, merges them into the engine result, asks for the comments (comp-v5 on the merged result) and
// stores both in one transaction. A job whose lease was lost (cancelled, replaced, expired) is dropped
// without writing. One log line per job, with no student data and no key.
import { randomUUID } from "node:crypto";
import type { DatabasePool } from "../../db/pool.js";
import type { AssessmentResult } from "../types.js";
import { cleanAiOutputKeys, keyNamesFrom } from "../ai/key-cleanup.js";
import { buildAiInput } from "../ai/prompt.js";
import { validateAiOutput, validationContextFromAiInput } from "../ai/validate.js";
import { createCompetencyAiExpiry } from "../ai/worker-router.js";
import { AI_JOB_MAX_ATTEMPTS } from "../ai/worker-protocol.js";
import { CloudAiError, type CloudAiUsage, type CloudJsonCaller } from "./claude.js";
import { mergeAiScoring } from "./merge.js";
import type { ScoringAiInput } from "./scoring-prompt.js";
import { validateScoring, type AiScoring } from "./scoring-validate.js";

/** A cloud job takes a few minutes (two calls with adaptive thinking); the lease leaves ample room. */
export const CLOUD_JOB_LEASE_MINUTES = 30;
const POLL_MS = 5000;
/** One more call when the model's answer fails validation. */
const CALLS_PER_STEP = 2;
/**
 * Claude's structured outputs cannot carry maxLength, so comment lengths are only asked for in the prompt
 * (plus this reminder) and validated with this slack.
 */
export const CLOUD_COMMENT_LENGTH_FACTOR = 1.5;
export const CLOUD_COMMENT_LENGTH_NOTE = "\n\nĐộ dài là bắt buộc: mỗi trường văn bản phải ngắn hơn số ký tự tối đa đã nêu ở trên; viết gọn, mỗi ý một câu.";

type Metrics = Record<string, number | string | null>;

export type CloudJobOutcome =
  | { ok: true; scoring: AiScoring; output: unknown; commentaryError: string | null; promptVersion: string; metrics: Metrics }
  | { ok: false; errorCode: string; metrics: Metrics };

const recordUsage = (metrics: Metrics, step: string, call: number, usage: CloudAiUsage) => {
  metrics[`${step}${call}Ms`] = usage.durationMs;
  metrics[`${step}${call}InputTokens`] = usage.inputTokens;
  metrics[`${step}${call}OutputTokens`] = usage.outputTokens;
  metrics[`${step}${call}ThinkingTokens`] = usage.thinkingTokens;
};

/** The two model steps of one job; throws only on a programming error (CloudAiError is reported in the outcome). */
export async function runCloudJob(input: ScoringAiInput, computed: AssessmentResult, caller: CloudJsonCaller): Promise<CloudJobOutcome> {
  const metrics: Metrics = {};
  let scoring: AiScoring | null = null;
  let errorCode = "invalid_ai_output";
  for (let call = 1; call <= CALLS_PER_STEP && !scoring; call++) {
    try {
      const reply = await caller({ system: input.system, user: input.user, schema: input.schema });
      recordUsage(metrics, "scoring", call, reply.usage);
      const checked = validateScoring(reply.value, input.keys);
      if (checked.ok) scoring = checked.scoring;
      else { errorCode = "invalid_ai_output"; metrics[`scoring${call}Rejected`] = `${checked.reason}:${checked.path}`.slice(0, 120); }
    } catch (error) {
      if (!(error instanceof CloudAiError)) throw error;
      errorCode = error.code;
      metrics[`scoring${call}Error`] = error.code;
      if (error.code !== "invalid_ai_output") break;
    }
  }
  if (!scoring) return { ok: false, errorCode, metrics };

  const merged = mergeAiScoring(computed, scoring);
  const aiInput = buildAiInput(merged);
  const context = validationContextFromAiInput({ schema: aiInput.schema, user: aiInput.user });
  let output: unknown = null;
  let commentaryError: string | null = "invalid_ai_output";
  for (let call = 1; call <= CALLS_PER_STEP && output === null; call++) {
    try {
      const reply = await caller({ system: aiInput.system + CLOUD_COMMENT_LENGTH_NOTE, user: aiInput.user, schema: aiInput.schema });
      recordUsage(metrics, "commentary", call, reply.usage);
      const checked = context ? validateAiOutput(reply.value, context, { lengthFactor: CLOUD_COMMENT_LENGTH_FACTOR }) : null;
      if (checked?.ok) {
        output = cleanAiOutputKeys(checked.output, keyNamesFrom(merged.skillDirectory, merged.groups));
        commentaryError = null;
      } else {
        metrics[`commentary${call}Rejected`] = checked && !checked.ok ? `${checked.error.reason}:${checked.error.path}`.slice(0, 120) : "no_context";
      }
    } catch (error) {
      if (!(error instanceof CloudAiError)) throw error;
      commentaryError = error.code;
      metrics[`commentary${call}Error`] = error.code;
      if (error.code !== "invalid_ai_output") break;
    }
  }
  return { ok: true, scoring, output, commentaryError, promptVersion: `${input.promptVersion}+${aiInput.promptVersion}`, metrics };
}

type ClaimedJob = { id: string; assessmentId: string; userId: string; aiInput: unknown; computed: AssessmentResult };

/** Oldest claimable cloud job: queued, or processing with an expired lease and attempts left. */
export async function claimCloudJob(pool: Pick<DatabasePool, "query">, leaseToken: string): Promise<ClaimedJob | null> {
  const result = await pool.query<ClaimedJob>(`WITH candidate AS (
      SELECT id FROM stu_comp_ai_jobs
      WHERE runner='cloud' AND ai_input IS NOT NULL AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts<$2))
      ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1),
    claimed AS (
      UPDATE stu_comp_ai_jobs j SET status='processing',lease_token=$1,lease_until=now()+make_interval(mins => $3),attempts=j.attempts+1,updated_at=now()
      FROM candidate c WHERE j.id=c.id RETURNING j.id,j.assessment_id,j.user_id,j.ai_input),
    marked AS (
      UPDATE stu_comp_assessments a SET ai_status='processing' FROM claimed c WHERE a.id=c.assessment_id AND a.ai_status='queued')
    SELECT c.id,c.assessment_id AS "assessmentId",c.user_id AS "userId",c.ai_input AS "aiInput",a.computed
    FROM claimed c JOIN stu_comp_assessments a ON a.id=c.assessment_id`,
  [leaseToken, AI_JOB_MAX_ATTEMPTS, CLOUD_JOB_LEASE_MINUTES]);
  return result.rows[0] ?? null;
}

const isScoringInput = (value: unknown): value is ScoringAiInput => {
  const input = value as Partial<ScoringAiInput> | null;
  return Boolean(input && input.kind === "cloud_scoring" && typeof input.system === "string" && typeof input.user === "string" &&
    input.schema && input.keys && Array.isArray(input.keys.skillKeys) && Array.isArray(input.keys.groupKeys) && Array.isArray(input.keys.career));
};

/** Stores the outcome if the lease is still ours; false when the job was cancelled, replaced or expired meanwhile. */
export async function finishCloudJob(pool: DatabasePool, job: Pick<ClaimedJob, "id" | "assessmentId" | "userId">, leaseToken: string,
  outcome: CloudJobOutcome, model: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ status: string; lease_token: string | null }>(
      "SELECT status,lease_token FROM stu_comp_ai_jobs WHERE id=$1 FOR UPDATE", [job.id]);
    const row = locked.rows[0];
    if (!row || row.status !== "processing" || row.lease_token !== leaseToken) {
      await client.query("ROLLBACK");
      return false;
    }
    if (outcome.ok) {
      await client.query(
        `UPDATE stu_comp_assessments SET ai_status='completed',ai_scoring=$3::jsonb,ai_output=$4::jsonb,ai_model=$5,ai_model_digest=NULL,
          ollama_version=NULL,prompt_version=$6,ai_error_code=$7,ai_completed_at=now() WHERE id=$1 AND user_id=$2`,
        [job.assessmentId, job.userId, JSON.stringify(outcome.scoring), outcome.output === null ? null : JSON.stringify(outcome.output),
          model, outcome.promptVersion, outcome.commentaryError]);
    } else {
      await client.query(
        "UPDATE stu_comp_assessments SET ai_status='failed',ai_error_code=$3,ai_output=NULL,ai_scoring=NULL WHERE id=$1 AND user_id=$2",
        [job.assessmentId, job.userId, outcome.errorCode]);
    }
    await client.query(
      `UPDATE stu_comp_ai_jobs SET status=$2,error_code=$3,metrics=$4::jsonb,ai_input=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`,
      [job.id, outcome.ok ? "completed" : "failed", outcome.ok ? outcome.commentaryError : outcome.errorCode, JSON.stringify(outcome.metrics)]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type CloudRunner = { kick(): void; stop(): void };

export function startCloudCompetencyRunner(options: {
  pool: DatabasePool;
  caller: CloudJsonCaller;
  model: string;
  pollMs?: number;
  log?: (line: string) => void;
}): CloudRunner {
  const log = options.log ?? ((line: string) => console.log(line));
  const expire = createCompetencyAiExpiry();
  let stopped = false;
  let busy = false;

  const handle = async (job: ClaimedJob, leaseToken: string) => {
    const started = Date.now();
    const outcome: CloudJobOutcome = isScoringInput(job.aiInput)
      ? await runCloudJob(job.aiInput, job.computed, options.caller)
      : { ok: false, errorCode: "ai_failed", metrics: { input: "malformed" } };
    const stored = await finishCloudJob(options.pool, job, leaseToken, outcome, options.model);
    const seconds = Math.round((Date.now() - started) / 1000);
    const result = outcome.ok ? (outcome.commentaryError ? `scores ok, comments ${outcome.commentaryError}` : "completed") : `failed ${outcome.errorCode}`;
    log(`[COMPETENCY-AI] job ${job.id} ${stored ? result : "dropped (lease lost)"} in ${seconds} s`);
  };

  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      await expire(options.pool).catch(() => false);
      while (!stopped) {
        const leaseToken = randomUUID();
        const job = await claimCloudJob(options.pool, leaseToken);
        if (!job) break;
        await handle(job, leaseToken);
      }
    } catch (error) {
      log(`[COMPETENCY-AI] runner error ${error instanceof Error ? error.name : typeof error}`);
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void tick(), options.pollMs ?? POLL_MS);
  timer.unref?.();
  void tick();
  return {
    kick: () => void tick(),
    stop: () => { stopped = true; clearInterval(timer); },
  };
}
