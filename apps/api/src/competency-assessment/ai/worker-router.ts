// Worker API for the local AI commentary (contract C3, spec §8). Mounted at
// /api/worker/competency-assessments BEFORE the global JSON parser: the key is checked
// before any body is read, then this router parses JSON itself (512 kB).
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import express, { Router, type ErrorRequestHandler, type RequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../../db/pool.js";
import { cleanAiOutputKeys, keyNamesFrom } from "./key-cleanup.js";
import { validateAiOutput, validationContextFromAiInput } from "./validate.js";

export const AI_JOB_LEASE_MINUTES = 15;
export const AI_JOB_MAX_ATTEMPTS = 2;
export const AI_HOUSEKEEPING_INTERVAL_MS = 60_000;
export const AI_WORKER_ERROR_CODES = ["ai_timeout", "ai_output_truncated", "invalid_ai_output", "ollama_unavailable", "ai_failed"] as const;

class WorkerError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

const leaseBody = z.object({ leaseToken: z.uuid() }).strict();
const metricsSchema = z.record(z.string().max(64), z.union([z.number(), z.string().max(200), z.boolean(), z.null()]))
  .refine((value) => Object.keys(value).length <= 32, "too_many_metrics");
const completeBody = z.union([
  z.object({
    leaseToken: z.uuid(),
    model: z.string().min(1).max(200),
    digest: z.string().max(200),
    ollamaVersion: z.string().max(64),
    metrics: metricsSchema,
    output: z.unknown()
  }).strict(),
  z.object({ leaseToken: z.uuid(), error: z.enum(AI_WORKER_ERROR_CODES) }).strict()
]);

type JobRow = {
  status: string;
  lease_token: string | null;
  valid: boolean | null;
  assessment_id: string;
  user_id: string;
  ai_input: { schema?: unknown; user?: unknown; promptVersion?: unknown } | null;
};

/**
 * Fails stuck jobs and marks their assessments failed, then deletes old terminal JOBS.
 * Stuck = a processing job whose lease expired after the last attempt, or any pending job
 * older than 24 hours (a processing one only once its lease has expired, so a running job
 * is never cut off). ai_input is cleared with the failure. Assessments are never deleted here.
 */
export async function expireCompetencyAiJobs(db: Pick<DatabasePool, "query">): Promise<void> {
  await db.query(`WITH failed AS (
      UPDATE stu_comp_ai_jobs SET status='failed',error_code='worker_timeout',ai_input=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
      WHERE (status='queued' AND created_at<now()-interval '24 hours')
        OR (status='processing' AND lease_until<now() AND (attempts>=$1 OR created_at<now()-interval '24 hours'))
      RETURNING assessment_id)
    UPDATE stu_comp_assessments a SET ai_status='failed',ai_error_code='worker_timeout'
      FROM failed f WHERE a.id=f.assessment_id AND a.ai_status IN ('queued','processing')`, [AI_JOB_MAX_ATTEMPTS]);
  await db.query(`DELETE FROM stu_comp_ai_jobs WHERE status IN ('completed','failed','cancelled') AND updated_at<now()-interval '7 days'`);
}

/**
 * Rate-limited expiry (at most once per interval per returned function). The worker router
 * runs it on /claim and the student API on its reads and writes, so stuck jobs also expire
 * while the worker is offline.
 */
export function createCompetencyAiExpiry(intervalMs: number = AI_HOUSEKEEPING_INTERVAL_MS) {
  let last = Number.NEGATIVE_INFINITY;
  return async (db: Pick<DatabasePool, "query">): Promise<boolean> => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    await expireCompetencyAiJobs(db);
    return true;
  };
}

export function createCompetencyWorkerRouter(pool: DatabasePool | undefined, aiWorkerKey: string | undefined) {
  const router = Router();
  const hash = (value: string) => createHash("sha256").update(value).digest();
  const expected = aiWorkerKey ? hash(`Bearer ${aiWorkerKey}`) : null;
  const housekeeping = createCompetencyAiExpiry();

  const authenticate: RequestHandler = (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!expected || !pool) { res.status(503).json({ error: "worker_disabled" }); return; }
    if (!timingSafeEqual(hash(req.get("authorization") ?? ""), expected)) { res.status(401).json({ error: "unauthorized" }); return; }
    next();
  };
  router.use(authenticate);
  router.use(express.json({ limit: "512kb" }));
  const db = pool!;

  const heartbeat = () => db.query("INSERT INTO stu_comp_ai_worker_status(id,seen_at) VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET seen_at=now()");
  const jobId = (value: unknown) => {
    const parsed = z.uuid().safeParse(value);
    if (!parsed.success) throw new WorkerError("invalid_input", 400);
    return parsed.data;
  };

  router.post("/heartbeat", async (_req, res) => {
    await heartbeat();
    res.json({ ok: true });
  });

  router.post("/claim", async (_req, res) => {
    await heartbeat();
    await housekeeping(db);
    const result = await db.query<{ id: string; leaseToken: string; aiInput: Record<string, unknown> }>(`WITH candidate AS (
        SELECT id FROM stu_comp_ai_jobs
        WHERE ai_input IS NOT NULL AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts<$2))
        ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1),
      claimed AS (
        UPDATE stu_comp_ai_jobs j SET status='processing',lease_token=$1,lease_until=now()+make_interval(mins => $3),attempts=j.attempts+1,updated_at=now()
        FROM candidate c WHERE j.id=c.id RETURNING j.id,j.assessment_id,j.lease_token,j.ai_input),
      marked AS (
        UPDATE stu_comp_assessments a SET ai_status='processing' FROM claimed c WHERE a.id=c.assessment_id AND a.ai_status='queued')
      SELECT id,lease_token AS "leaseToken",ai_input AS "aiInput" FROM claimed`,
      [randomUUID(), AI_JOB_MAX_ATTEMPTS, AI_JOB_LEASE_MINUTES]);
    const row = result.rows[0];
    if (!row) { res.json({ job: null }); return; }
    const input = row.aiInput;
    res.json({ job: {
      id: row.id,
      leaseToken: row.leaseToken,
      promptVersion: input.promptVersion,
      system: input.system,
      user: input.user,
      schema: input.schema,
      options: input.options
    } });
  });

  router.post("/:id/extend", async (req, res) => {
    const id = jobId(req.params.id);
    const body = leaseBody.safeParse(req.body);
    if (!body.success) throw new WorkerError("invalid_input", 400);
    const result = await db.query<{ leaseUntil: Date }>(
      `UPDATE stu_comp_ai_jobs SET lease_until=now()+make_interval(mins => $3),updated_at=now()
        WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>now() RETURNING lease_until AS "leaseUntil"`,
      [id, body.data.leaseToken, AI_JOB_LEASE_MINUTES]);
    const row = result.rows[0];
    if (!row) throw new WorkerError("job_expired", 409);
    res.json({ leaseUntil: new Date(row.leaseUntil).toISOString() });
  });

  router.post("/:id/complete", async (req, res) => {
    const id = jobId(req.params.id);
    const body = completeBody.safeParse(req.body);
    if (!body.success) throw new WorkerError("invalid_input", 400);
    const input = body.data;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<JobRow>(
        `SELECT status,lease_token,lease_until>now() AS valid,assessment_id,user_id,ai_input FROM stu_comp_ai_jobs WHERE id=$1 FOR UPDATE`, [id]);
      const job = locked.rows[0];
      if (job && (job.status === "completed" || job.status === "failed") && job.lease_token === input.leaseToken) {
        await client.query("COMMIT");
        res.json({ ok: true });
        return;
      }
      if (!job || job.status !== "processing" || job.lease_token !== input.leaseToken || job.valid !== true) {
        throw new WorkerError("job_expired", 409);
      }

      let errorCode: string | null = "error" in input ? input.error : null;
      let output: unknown = null;
      if (!("error" in input)) {
        const context = job.ai_input ? validationContextFromAiInput({ schema: job.ai_input.schema, user: job.ai_input.user }) : null;
        const checked = context ? validateAiOutput(input.output, context) : null;
        if (checked?.ok) {
          // Keys the model wrote into prose are replaced by names before storing (comp-v3).
          const names = await client.query<{ skills: unknown; groups: unknown }>(
            `SELECT computed->'skillDirectory' AS skills,computed->'groups' AS groups FROM stu_comp_assessments WHERE id=$1 AND user_id=$2`,
            [job.assessment_id, job.user_id]);
          const row = names.rows[0];
          output = cleanAiOutputKeys(checked.output, keyNamesFrom(row?.skills, row?.groups));
        } else errorCode = "invalid_ai_output";
      }
      const promptVersion = typeof job.ai_input?.promptVersion === "string" ? job.ai_input.promptVersion : null;
      if (errorCode === null && !("error" in input)) {
        await client.query(
          `UPDATE stu_comp_assessments SET ai_status='completed',ai_output=$3::jsonb,ai_model=$4,ai_model_digest=$5,ollama_version=$6,
            prompt_version=$7,ai_error_code=NULL,ai_completed_at=now() WHERE id=$1 AND user_id=$2`,
          [job.assessment_id, job.user_id, JSON.stringify(output), input.model, input.digest || null, input.ollamaVersion || null, promptVersion]);
      } else {
        await client.query(
          `UPDATE stu_comp_assessments SET ai_status='failed',ai_error_code=$3,ai_output=NULL WHERE id=$1 AND user_id=$2`,
          [job.assessment_id, job.user_id, errorCode]);
      }
      await client.query(
        `UPDATE stu_comp_ai_jobs SET status=$2,error_code=$3,metrics=$4::jsonb,ai_input=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`,
        [id, errorCode ? "failed" : "completed", errorCode, "metrics" in input ? JSON.stringify(input.metrics) : null]);
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof WorkerError) { res.status(error.status).json({ error: error.code }); return; }
    const type = (error as { type?: unknown } | null)?.type;
    if (type === "entity.too.large") { res.status(413).json({ error: "payload_too_large" }); return; }
    if (type === "entity.parse.failed") { res.status(400).json({ error: "invalid_json" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
