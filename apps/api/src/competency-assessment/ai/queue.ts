// AI commentary queue hook (contract C2). Called inside the student router's write
// transactions; the caller already holds the student's row lock.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../../db/pool.js";
import type { AssessmentResult } from "../types.js";
import { COMPETENCY_AI_QUEUE_LOCK } from "../repository.js";
import { buildAiInput } from "./prompt.js";
import { createCompetencyAiExpiry } from "./worker-router.js";

/**
 * Transaction-level advisory lock serializing the global queue-size check. The key is shared
 * with repository.ts (never 1946032027, used by the OCR queue and the AD-COMP catalog lock).
 */
export const COMPETENCY_AI_QUEUE_LOCK_KEY = COMPETENCY_AI_QUEUE_LOCK;
/** At most this many queued/processing jobs system-wide; beyond it new work is deferred. */
export const MAX_PENDING_AI_JOBS = 25;
/** The worker counts as online when its heartbeat is newer than this. */
export const WORKER_ONLINE_SECONDS = 60;

export type QueueInput = { assessmentId: string; userId: string; result: AssessmentResult };

export interface CompetencyAiQueue {
  enabled: boolean;
  /** POST /: cancels the user's pending job, then queues (or defers when the queue is full). */
  enqueue(client: PoolClient, input: QueueInput): Promise<"queued" | "deferred">;
  /** POST /:id/ai: queues again; when the queue is full nothing changes and 'deferred' is returned. */
  regenerate(client: PoolClient, input: QueueInput): Promise<"queued" | "deferred">;
  /** DELETE /:id/ai: cancels the assessment's pending job. */
  cancel(client: PoolClient, input: { assessmentId: string; userId: string }): Promise<boolean>;
  workerOnline(db: Pick<DatabasePool, "query">): Promise<boolean>;
}

const PENDING = "('queued','processing')";

async function cancelPending(client: PoolClient, userId: string, assessmentId?: string): Promise<number> {
  const params: unknown[] = [userId];
  let filter = "";
  if (assessmentId) { params.push(assessmentId); filter = " AND assessment_id=$2"; }
  const cancelled = await client.query<{ assessment_id: string }>(
    `UPDATE stu_comp_ai_jobs SET status='cancelled',ai_input=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
      WHERE user_id=$1 AND status IN ${PENDING}${filter} RETURNING assessment_id`, params);
  const ids = cancelled.rows.map((row) => row.assessment_id);
  if (ids.length) {
    await client.query(
      `UPDATE stu_comp_assessments SET ai_status='cancelled' WHERE user_id=$1 AND id=ANY($2::uuid[]) AND ai_status IN ${PENDING}`,
      [userId, ids]);
  }
  return ids.length;
}

async function othersPending(client: PoolClient, userId: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM stu_comp_ai_jobs WHERE status IN ${PENDING} AND user_id<>$1`, [userId]);
  return result.rows[0]?.count ?? 0;
}

async function insertJob(client: PoolClient, input: QueueInput): Promise<"queued"> {
  const aiInput = buildAiInput(input.result);
  await client.query(
    "INSERT INTO stu_comp_ai_jobs(id,assessment_id,user_id,status,ai_input) VALUES($1,$2,$3,'queued',$4::jsonb)",
    [randomUUID(), input.assessmentId, input.userId, JSON.stringify(aiInput)]);
  await client.query(
    `UPDATE stu_comp_assessments SET ai_status='queued',ai_error_code=NULL,ai_output=NULL,ai_model=NULL,ai_model_digest=NULL,
      ollama_version=NULL,prompt_version=NULL,ai_completed_at=NULL WHERE id=$1 AND user_id=$2`,
    [input.assessmentId, input.userId]);
  return "queued";
}

export function createCompetencyAiQueue(options: { enabled: boolean }): CompetencyAiQueue {
  const enabled = options.enabled;
  // Expiry also runs from the student API, so stale jobs do not fill the queue (or keep their
  // ai_input) while the worker is offline. Rate-limited to once per 60 s per queue.
  const expire = createCompetencyAiExpiry();
  const requireEnabled = () => { if (!enabled) throw new Error("competency_ai_disabled"); };
  return {
    enabled,
    async enqueue(client, input) {
      requireEnabled();
      await client.query("SELECT pg_advisory_xact_lock($1)", [COMPETENCY_AI_QUEUE_LOCK_KEY]);
      await cancelPending(client, input.userId);
      await expire(client);
      if (await othersPending(client, input.userId) >= MAX_PENDING_AI_JOBS) {
        await client.query("UPDATE stu_comp_assessments SET ai_status='deferred',ai_error_code=NULL WHERE id=$1 AND user_id=$2",
          [input.assessmentId, input.userId]);
        return "deferred";
      }
      return insertJob(client, input);
    },
    async regenerate(client, input) {
      requireEnabled();
      await client.query("SELECT pg_advisory_xact_lock($1)", [COMPETENCY_AI_QUEUE_LOCK_KEY]);
      await expire(client);
      if (await othersPending(client, input.userId) >= MAX_PENDING_AI_JOBS) return "deferred";
      await cancelPending(client, input.userId);
      return insertJob(client, input);
    },
    async cancel(client, input) {
      if (!enabled) return false;
      await client.query("SELECT pg_advisory_xact_lock($1)", [COMPETENCY_AI_QUEUE_LOCK_KEY]);
      return (await cancelPending(client, input.userId, input.assessmentId)) > 0;
    },
    async workerOnline(db) {
      if (!enabled) return false;
      const result = await db.query<{ online: boolean }>(
        `SELECT seen_at > now() - make_interval(secs => $1) AS online FROM stu_comp_ai_worker_status WHERE id=1`,
        [WORKER_ONLINE_SECONDS]);
      // Called by GET /latest and /latest/status; a failed expiry must not break the read.
      await expire(db).catch(() => false);
      return result.rows[0]?.online === true;
    }
  };
}
