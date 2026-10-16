import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { mergeAiScoring } from "./ai-cloud/merge.js";
import { readStoredScoring } from "./ai-cloud/scoring-validate.js";
import type { AssessmentMeta, AssessmentResult } from "./types.js";

/** Most recent assessments kept per student (spec §8); older ones are removed on insert. */
export const MAX_ASSESSMENTS_PER_USER = 20;
/** One new assessment per student per 60 seconds. */
export const ASSESSMENT_COOLDOWN_SECONDS = 60;
/**
 * Advisory lock key for the competency AI queue. Never reuse 1946032027 (shared by the OCR queue
 * and the AD-COMP catalog lock) or 1946032026 (migrations).
 */
export const COMPETENCY_AI_QUEUE_LOCK = 1_946_032_031;

export type AiStatus = "disabled" | "deferred" | "queued" | "processing" | "completed" | "failed" | "cancelled";
/** ai_status values a student may ask to regenerate from (POST /:id/ai). */
export const REGENERABLE_AI_STATUSES: readonly AiStatus[] = ["failed", "cancelled", "deferred", "disabled"];

/** Response shape of every student endpoint that returns an assessment (contract C4). */
export type StoredAssessment = {
  id: string;
  createdAt: string;
  meta: AssessmentMeta;
  /** The engine result (term history, plan progress, course facts; the numbers of a "system" assessment). */
  result: AssessmentResult;
  /** "ai" = AI 100% (comp-ai-v1): the numbers shown are the model's, in aiResult. */
  scoring: "system" | "ai";
  /** The engine result with the model's validated numbers merged in; null until the AI scoring has finished. */
  aiResult: AssessmentResult | null;
  ai: { status: AiStatus; errorCode: string | null; model: string | null; completedAt: string | null; output: unknown | null };
};

type Queryable = Pick<DatabasePool, "query"> | PoolClient;

type AssessmentRow = {
  id: string; created_at: Date | string; meta: AssessmentMeta; computed: AssessmentResult;
  ai_status: AiStatus; ai_error_code: string | null; ai_model: string | null;
  ai_completed_at: Date | string | null; ai_output: unknown | null;
  scoring_mode?: "system" | "ai" | null; ai_scoring?: unknown | null;
};
const assessmentColumns = "id,created_at,meta,computed,ai_status,ai_error_code,ai_model,ai_completed_at,ai_output,scoring_mode,ai_scoring";
const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();

export function toStoredAssessment(row: AssessmentRow): StoredAssessment {
  const scoring = row.scoring_mode === "ai" ? "ai" : "system";
  const aiScoring = scoring === "ai" && row.ai_status === "completed" ? readStoredScoring(row.ai_scoring) : null;
  return {
    id: row.id,
    createdAt: iso(row.created_at)!,
    meta: row.meta,
    result: row.computed,
    scoring,
    aiResult: aiScoring ? mergeAiScoring(row.computed, aiScoring) : null,
    ai: {
      status: row.ai_status,
      errorCode: row.ai_error_code,
      model: row.ai_model,
      completedAt: iso(row.ai_completed_at),
      output: row.ai_status === "completed" ? row.ai_output ?? null : null,
    },
  };
}

/** Removes every stu_comp_* row of the student (jobs first, then results). Caller holds the user's row lock. */
export async function deleteCompetencyData(client: Queryable, userId: string) {
  await client.query("DELETE FROM stu_comp_ai_jobs WHERE user_id=$1", [userId]);
  await client.query("DELETE FROM stu_comp_assessments WHERE user_id=$1", [userId]);
}

/** True when the student created an assessment within the cooldown window. */
export async function withinCooldown(db: Queryable, userId: string) {
  const result = await db.query<{ recent: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM stu_comp_assessments WHERE user_id=$1
      AND created_at>now()-make_interval(secs=>$2)) AS recent`, [userId, ASSESSMENT_COOLDOWN_SECONDS]);
  return Boolean(result.rows[0]?.recent);
}

/** Inserts a computed assessment with ai_status 'disabled'; the AI queue may change it in the same transaction. */
export async function insertAssessment(client: PoolClient, input: { userId: string; transcriptVersion: string; result: AssessmentResult }) {
  const id = randomUUID();
  await client.query(`INSERT INTO stu_comp_assessments(id,user_id,transcript_version,meta,computed,ai_status)
    VALUES($1,$2,$3,$4::jsonb,$5::jsonb,'disabled')`,
  [id, input.userId, input.transcriptVersion, JSON.stringify(input.result.meta), JSON.stringify(input.result)]);
  return id;
}

/** Keeps the newest MAX_ASSESSMENTS_PER_USER results of the student (their AI jobs go with them). */
export async function pruneAssessments(client: PoolClient, userId: string) {
  await client.query(`DELETE FROM stu_comp_assessments WHERE user_id=$1 AND id NOT IN (
    SELECT id FROM stu_comp_assessments WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2)`, [userId, MAX_ASSESSMENTS_PER_USER]);
}

export async function findAssessment(db: Queryable, userId: string, id: string) {
  const result = await db.query<AssessmentRow>(`SELECT ${assessmentColumns} FROM stu_comp_assessments WHERE id=$1 AND user_id=$2`, [id, userId]);
  return result.rows[0] ? toStoredAssessment(result.rows[0]) : null;
}

export async function latestAssessment(db: Queryable, userId: string) {
  const result = await db.query<AssessmentRow>(`SELECT ${assessmentColumns} FROM stu_comp_assessments
    WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [userId]);
  return result.rows[0] ? toStoredAssessment(result.rows[0]) : null;
}

export async function latestAssessmentStatus(db: Queryable, userId: string) {
  const result = await db.query<{ id: string; ai_status: AiStatus; ai_error_code: string | null }>(
    `SELECT id,ai_status,ai_error_code FROM stu_comp_assessments WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [userId]);
  const row = result.rows[0];
  return { id: row?.id ?? null, aiStatus: row?.ai_status ?? null, aiErrorCode: row?.ai_error_code ?? null };
}
