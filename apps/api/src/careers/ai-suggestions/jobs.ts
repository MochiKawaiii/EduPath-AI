// Career skill suggestion jobs. A row of career_ai_suggestions is queued inside the admin
// transaction and handed to the same AI worker as the competency assessments
// (/api/worker/competency-assessments, kind "career_skill_suggestion"); the worker router
// calls the claim/extend/complete functions below. Rows are never deleted: they are the audit
// record of what the AI proposed and what the admin saved.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../../db/pool.js";
import {
  AI_HOUSEKEEPING_INTERVAL_MS,
  AI_JOB_LEASE_MINUTES,
  AI_JOB_MAX_ATTEMPTS,
  type WorkerCompletion
} from "../../competency-assessment/ai/worker-protocol.js";
import { CareerError } from "../shared.js";
import { buildCareerSuggestionInput, type CareerSuggestionSource } from "./prompt.js";
import { suggestionContextFromAiInput, validateCareerSuggestionOutput, type StoredSuggestionResult } from "./validate.js";

/** At most this many queued/processing career suggestions system-wide. */
export const MAX_PENDING_CAREER_SUGGESTIONS = 10;
/** Serializes the pending check and the queue-size check of concurrent requests. */
export const CAREER_SUGGESTION_QUEUE_LOCK = "edupath:career-ai-suggestions";

type Db = Pick<DatabasePool, "query">;
const PENDING = "('queued','processing')";

/**
 * Fails stuck suggestions: queued for more than 24 hours, or processing with an expired lease
 * after the last attempt (or older than 24 hours). ai_input is cleared with the failure.
 */
export async function expireCareerSuggestions(db: Db): Promise<void> {
  await db.query(`UPDATE career_ai_suggestions SET status='failed',error_code=$2,ai_input=NULL,lease_token=NULL,lease_until=NULL,
      completed_at=now(),updated_at=now()
    WHERE (status='queued' AND created_at<now()-interval '24 hours')
      OR (status='processing' AND lease_until<now() AND (attempts>=$1 OR created_at<now()-interval '24 hours'))`,
  [AI_JOB_MAX_ATTEMPTS, "worker_timeout"]);
}

/** Rate-limited expiry (at most once per interval per returned function), run from the worker and admin routers. */
export function createCareerSuggestionExpiry(intervalMs: number = AI_HOUSEKEEPING_INTERVAL_MS) {
  let last = Number.NEGATIVE_INFINITY;
  return async (db: Db): Promise<boolean> => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    await expireCareerSuggestions(db);
    return true;
  };
}

/** Reads the career, its requirements and the skill catalog; career_not_found (404) when it is gone. */
export async function loadCareerSuggestionSource(client: PoolClient, careerPositionId: string): Promise<CareerSuggestionSource> {
  const career = await client.query<{ code: string; nameVi: string; nameEn: string; description: string; fieldName: string; fieldDescription: string }>(
    `SELECT c.code,c.name_vi AS "nameVi",c.name_en AS "nameEn",c.description,f.name AS "fieldName",f.description AS "fieldDescription"
      FROM career_positions c JOIN career_fields f ON f.code=c.category
      WHERE c.id=$1 AND c.deleted_at IS NULL AND f.deleted_at IS NULL FOR SHARE OF c`, [careerPositionId]);
  const row = career.rows[0];
  if (!row) throw new CareerError("career_not_found", 404);
  const requirements = await client.query<{ skillId: string | null; skillName: string | null; title: string; isRequired: boolean }>(
    `SELECT r.skill_id AS "skillId",s.name AS "skillName",r.title,r.is_required AS "isRequired"
      FROM career_requirements r LEFT JOIN career_skills s ON s.id=r.skill_id AND s.deleted_at IS NULL
      WHERE r.career_position_id=$1 AND r.deleted_at IS NULL ORDER BY r.is_required DESC,r.title,r.id`, [careerPositionId]);
  const catalog = await client.query<{ id: string; name: string; description: string }>(
    "SELECT id,name,description FROM career_skills WHERE deleted_at IS NULL ORDER BY name,id");
  return {
    career: row,
    otherRequirements: requirements.rows.filter((item) => !item.skillId).map((item) => item.title),
    linkedSkills: requirements.rows.filter((item) => item.skillId && item.skillName)
      .map((item) => ({ id: item.skillId!, name: item.skillName!, isRequired: item.isRequired })),
    catalog: catalog.rows
  };
}

/**
 * Queues a suggestion for the career, or returns the one already pending (created=false).
 * Called inside the admin write transaction; ai_queue_full (429) when the global cap is reached.
 */
export async function enqueueCareerSuggestion(
  client: PoolClient,
  input: { careerPositionId: string; requestedBy: string }
): Promise<{ id: string; created: boolean }> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [CAREER_SUGGESTION_QUEUE_LOCK]);
  const source = await loadCareerSuggestionSource(client, input.careerPositionId);
  const pending = await client.query<{ id: string }>(
    `SELECT id FROM career_ai_suggestions WHERE career_position_id=$1 AND status IN ${PENDING}`, [input.careerPositionId]);
  if (pending.rows[0]) return { id: pending.rows[0].id, created: false };
  const count = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM career_ai_suggestions WHERE status IN ${PENDING}`);
  if ((count.rows[0]?.count ?? 0) >= MAX_PENDING_CAREER_SUGGESTIONS) throw new CareerError("ai_queue_full", 429);
  const id = randomUUID();
  const aiInput = buildCareerSuggestionInput(source);
  await client.query(
    `INSERT INTO career_ai_suggestions(id,career_position_id,requested_by,status,ai_input,prompt_version) VALUES($1,$2,$3,'queued',$4::jsonb,$5)`,
    [id, input.careerPositionId, input.requestedBy, JSON.stringify(aiInput), aiInput.promptVersion]);
  return { id, created: true };
}

/** Claims the oldest runnable suggestion (SKIP LOCKED, 15 minute lease, at most 2 attempts). */
export async function claimCareerSuggestion(db: Db, leaseToken: string): Promise<{ id: string; leaseToken: string; aiInput: Record<string, unknown> } | null> {
  const result = await db.query<{ id: string; leaseToken: string; aiInput: Record<string, unknown> }>(`WITH candidate AS (
      SELECT id FROM career_ai_suggestions
      WHERE ai_input IS NOT NULL AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts<$2))
      ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE career_ai_suggestions j SET status='processing',lease_token=$1,lease_until=now()+make_interval(mins => $3),attempts=j.attempts+1,updated_at=now()
      FROM candidate c WHERE j.id=c.id RETURNING j.id,j.lease_token AS "leaseToken",j.ai_input AS "aiInput"`,
  [leaseToken, AI_JOB_MAX_ATTEMPTS, AI_JOB_LEASE_MINUTES]);
  return result.rows[0] ?? null;
}

/** Extends a live lease; null when the suggestion is not processing under this lease. */
export async function extendCareerSuggestion(db: Db, id: string, leaseToken: string): Promise<Date | null> {
  const result = await db.query<{ leaseUntil: Date }>(
    `UPDATE career_ai_suggestions SET lease_until=now()+make_interval(mins => $3),updated_at=now()
      WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>now() RETURNING lease_until AS "leaseUntil"`,
    [id, leaseToken, AI_JOB_LEASE_MINUTES]);
  return result.rows[0]?.leaseUntil ?? null;
}

type LockedSuggestion = { status: string; lease_token: string | null; valid: boolean | null; ai_input: Record<string, unknown> | null };

/**
 * Stores the worker's result inside the worker router's transaction. Returns 'missing' when no
 * suggestion has this id, 'expired' for another or lost lease (a cancelled suggestion stays
 * cancelled), and 'ok' when stored or already stored under the same lease.
 */
export async function completeCareerSuggestion(client: PoolClient, id: string, input: WorkerCompletion): Promise<"ok" | "expired" | "missing"> {
  const locked = await client.query<LockedSuggestion>(
    "SELECT status,lease_token,lease_until>now() AS valid,ai_input FROM career_ai_suggestions WHERE id=$1 FOR UPDATE", [id]);
  const job = locked.rows[0];
  if (!job) return "missing";
  if ((job.status === "completed" || job.status === "failed") && job.lease_token === input.leaseToken) return "ok";
  if (job.status !== "processing" || job.lease_token !== input.leaseToken || job.valid !== true) return "expired";

  let errorCode: string | null = "error" in input ? input.error : null;
  let result: StoredSuggestionResult | null = null;
  if (!("error" in input)) {
    const context = suggestionContextFromAiInput(job.ai_input);
    const checked = context ? validateCareerSuggestionOutput(input.output, context) : null;
    if (checked?.ok) result = checked.result;
    else errorCode = "invalid_ai_output";
  }
  const model = "error" in input ? null : input;
  const promptVersion = typeof job.ai_input?.promptVersion === "string" ? job.ai_input.promptVersion : null;
  await client.query(
    `UPDATE career_ai_suggestions SET status=$2,error_code=$3,result=$4::jsonb,metrics=$5::jsonb,ai_model=$6,ai_model_digest=$7,
      ollama_version=$8,prompt_version=COALESCE($9,prompt_version),ai_input=NULL,lease_until=NULL,completed_at=now(),updated_at=now() WHERE id=$1`,
    [id, errorCode ? "failed" : "completed", errorCode, result ? JSON.stringify(result) : null,
      model ? JSON.stringify(model.metrics) : null, model?.model ?? null, model?.digest || null, model?.ollamaVersion || null, promptVersion]);
  return "ok";
}
