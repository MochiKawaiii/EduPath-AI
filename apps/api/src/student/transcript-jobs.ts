import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import express, { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { TranscriptError } from "./transcript-parser.js";
import { mapOcrTranscript } from "./ocr-adapter.js";

export const jobColumns = `id,filename,status,error_code AS "errorCode",created_at AS "createdAt",updated_at AS "updatedAt"`;
export async function expireJobs(pool: Pick<DatabasePool, "query">) {
  await pool.query(`UPDATE transcript_jobs SET status='failed',error_code='worker_timeout',pdf_data=NULL,lease_token=NULL,updated_at=now()
    WHERE (status='processing' AND lease_until<now() AND attempts>=2) OR (status IN ('queued','processing') AND created_at<now()-interval '24 hours')`);
  await pool.query(`DELETE FROM transcript_jobs WHERE status NOT IN ('queued','processing') AND updated_at<now()-interval '7 days'`);
}
// Caller holds the user's row lock and checks the current transcript version.
export async function enqueueTranscript(client: PoolClient, userId: string, filename: string, pdf: Buffer, version: string | undefined) {
  await client.query("SELECT pg_advisory_xact_lock(1946032027)");
  const pending = await client.query("SELECT id FROM transcript_jobs WHERE user_id=$1 AND status IN ('queued','processing')", [userId]);
  if (pending.rowCount) throw new TranscriptError("import_pending", 409);
  const count = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM transcript_jobs WHERE status IN ('queued','processing')");
  if ((count.rows[0]?.count ?? 0) >= 25) throw new TranscriptError("queue_full", 429);
  const result = await client.query(`INSERT INTO transcript_jobs(id,user_id,filename,pdf_data,expected_version) VALUES($1,$2,$3,$4,$5) RETURNING ${jobColumns}`,
    [randomUUID(), userId, filename, pdf, version ?? null]);
  return result.rows[0];
}

export function createTranscriptWorkerRouter(pool: DatabasePool | undefined, key: string | undefined) {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!key || !pool) { res.status(503).json({ error: "worker_disabled" }); return; }
    const supplied = req.get("authorization") ?? "";
    const hash = (s: string) => createHash("sha256").update(s).digest();
    if (!timingSafeEqual(hash(supplied), hash(`Bearer ${key}`))) { res.status(401).json({ error: "unauthorized" }); return; }
    next();
  });
  router.use(express.json({ limit: "2mb" }));
  const heartbeat = () => pool!.query("INSERT INTO transcript_worker_status(id,seen_at) VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET seen_at=now()");
  router.post("/heartbeat", async (_req, res) => { await heartbeat(); res.json({ ok: true }); });
  router.post("/claim", async (_req, res) => {
    await heartbeat(); await expireJobs(pool!);
    const result = await pool!.query<{ id: string; filename: string; pdf: Buffer; leaseToken: string }>(`WITH candidate AS (
      SELECT id FROM transcript_jobs WHERE status='queued' OR (status='processing' AND lease_until<now() AND attempts<2)
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE transcript_jobs j SET status='processing',lease_token=$1,lease_until=now()+interval '10 minutes',attempts=attempts+1,updated_at=now()
      FROM candidate c WHERE j.id=c.id RETURNING j.id,j.filename,j.pdf_data AS pdf,j.lease_token AS "leaseToken"`, [randomUUID()]);
    const job = result.rows[0];
    res.json({ job: job ? { id: job.id, filename: job.filename, leaseToken: job.leaseToken, pdf: job.pdf.toString("base64") } : null });
  });
  router.post("/:id/complete", async (req, res) => {
    const input = z.object({ leaseToken: z.uuid(), result: z.unknown().optional(), error: z.enum(["invalid_pdf", "encrypted_pdf", "too_many_pages", "unsupported_layout", "unreadable_rows", "parse_timeout", "ocr_failed"]).optional() }).safeParse(req.body);
    if (!z.uuid().safeParse(req.params.id).success || !input.success || (input.data.error ? input.data.result !== undefined : input.data.result === undefined)) { res.status(400).json({ error: "invalid_input" }); return; }
    let parsed: ReturnType<typeof mapOcrTranscript> | undefined;
    let errorCode: string | undefined = input.data.error;
    if (!errorCode) { try { parsed = mapOcrTranscript(input.data.result); } catch (e) { if (e instanceof TranscriptError) errorCode = e.code; else throw e; } }
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const owner = await client.query<{ user_id: string }>("SELECT user_id FROM transcript_jobs WHERE id=$1", [req.params.id]);
      if (!owner.rowCount) throw new TranscriptError("job_expired", 409);
      const uid = owner.rows[0]!.user_id;
      const user = await client.query<{ is_active: boolean }>("SELECT is_active FROM users WHERE id=$1 FOR UPDATE", [uid]);
      const locked = await client.query<{ status: string; lease_token: string | null; valid: boolean; filename: string; pdf_data: Buffer | null; expected_version: string | null }>(
        "SELECT *,lease_until>now() AS valid FROM transcript_jobs WHERE id=$1 FOR UPDATE", [req.params.id]);
      const job = locked.rows[0];
      if (job?.status === 'completed' && job.lease_token === input.data.leaseToken) { await client.query("COMMIT"); res.json({ ok: true }); return; }
      if (!job || job.status !== "processing" || job.lease_token !== input.data.leaseToken || !job.valid || !job.pdf_data) throw new TranscriptError("job_expired", 409);
      if (!user.rows[0]?.is_active) errorCode = "insufficient_role";
      const current = await client.query<{ version: string }>("SELECT version FROM student_transcripts WHERE user_id=$1 FOR UPDATE", [uid]);
      if ((current.rows[0]?.version ?? null) !== job.expected_version) errorCode = "transcript_changed";
      if (!errorCode && parsed) {
        await client.query(`INSERT INTO student_transcripts(user_id,version,filename,pdf_data,file_size,sha256,parsed_data)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,filename=EXCLUDED.filename,pdf_data=EXCLUDED.pdf_data,
          file_size=EXCLUDED.file_size,sha256=EXCLUDED.sha256,parsed_data=EXCLUDED.parsed_data,updated_at=now()`,
          [uid, randomUUID(), job.filename, job.pdf_data, job.pdf_data.length, createHash("sha256").update(job.pdf_data).digest("hex"), JSON.stringify(parsed)]);
      }
      await client.query("UPDATE transcript_jobs SET status=$2,error_code=$3,pdf_data=NULL,updated_at=now() WHERE id=$1", [req.params.id, errorCode ? "failed" : "completed", errorCode ?? null]);
      await client.query("COMMIT"); res.json({ ok: true });
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  });
  const errors: ErrorRequestHandler = (e, _req, res, next) => { if (e instanceof TranscriptError) { res.status(e.status).json({ error: e.code }); return; } next(e); };
  router.use(errors);
  return router;
}
