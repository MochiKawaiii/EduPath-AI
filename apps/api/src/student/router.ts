import express, { Router, type ErrorRequestHandler } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import type { AuthenticatedUser } from "../auth/types.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { parseTranscript, TranscriptError, type TranscriptData } from "./transcript-parser.js";
import { enqueueTranscript, expireJobs, jobColumns } from "./transcript-jobs.js";

const transcriptColumns = `version, filename, file_size AS "fileSize", parsed_data AS data,
  created_at AS "createdAt", updated_at AS "updatedAt"`;
type TranscriptRow = { version: string; filename: string; fileSize: number; data: TranscriptData; createdAt: string; updatedAt: string };
async function lockStudent(client: PoolClient, user: AuthenticatedUser) {
  const active = await client.query(`SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2
    AND is_active FOR UPDATE`, [user.userId, user.tenantId]);
  if (!active.rowCount) throw new TranscriptError("insufficient_role", 403);
}

export function createStudentDataRouter(pool: DatabasePool | undefined, webOrigin: string, ocrEnabled = false) {
  const router = Router();
  router.use(requireAuthentication);
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) { res.status(503).json({ error: "database_required" }); return; }
    if (!["GET", "HEAD"].includes(req.method) && req.get("origin") !== webOrigin) { res.status(403).json({ error: "invalid_origin" }); return; }
    next();
  });

  router.patch("/profile", async (req, res) => {
    const input = z.object({
      className: z.string().trim().max(32).regex(/^[\p{L}\p{N} _.-]*$/u).nullable().optional(),
      interests: z.string().trim().max(2000).nullable(),
      careerGoal: z.string().trim().max(2000).nullable().optional(),
      careerPositionId: z.uuid().nullable().optional(),
      currentSemester: z.number().int().min(1).max(3).nullable().optional()
    }).strict().safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "invalid_profile" }); return; }
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await lockStudent(client, req.session.user!);
      await client.query(`INSERT INTO student_profiles (user_id,class_name,interests,career_goal,current_semester)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET
        interests=EXCLUDED.interests,current_semester=COALESCE(EXCLUDED.current_semester,student_profiles.current_semester),updated_at=CURRENT_TIMESTAMP`,
        [req.session.user!.userId, null, input.data.interests || null, null, input.data.currentSemester ?? null]);
      if (input.data.careerPositionId !== undefined) {
        const selected = input.data.careerPositionId;
        if (selected) {
          const career = await client.query("SELECT deleted_at FROM career_positions WHERE id=$1 FOR SHARE", [selected]);
          const previous = await client.query("SELECT career_position_id FROM student_profiles WHERE user_id=$1", [req.session.user!.userId]);
          if (!career.rowCount || (career.rows[0].deleted_at && previous.rows[0]?.career_position_id !== selected))
            throw new TranscriptError("career_unavailable", 409);
        }
        await client.query("UPDATE student_profiles SET career_position_id=$2 WHERE user_id=$1", [req.session.user!.userId, selected]);
      }
      await client.query("COMMIT");
      res.json({ saved: true });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  router.get("/transcript", async (req, res) => {
    await expireJobs(pool!);
    const result = await pool!.query<TranscriptRow>(`SELECT ${transcriptColumns} FROM student_transcripts WHERE user_id=$1`, [req.session.user!.userId]);
    const jobs = await pool!.query(`SELECT ${jobColumns} FROM transcript_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [req.session.user!.userId]);
    const worker = await pool!.query<{ online: boolean }>("SELECT seen_at>now()-interval '60 seconds' AS online FROM transcript_worker_status WHERE id=1");
    res.json({ transcript: result.rows[0] ?? null, job: jobs.rows[0] ?? null, workerOnline: worker.rows[0]?.online ?? false, ocrEnabled });
  });
  router.delete("/transcript/job", async (req, res) => {
    const input = z.object({ id: z.uuid() }).safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "invalid_input" }); return; }
    const client = await pool!.connect();
    try {
      await client.query("BEGIN"); await lockStudent(client, req.session.user!);
      await client.query("UPDATE transcript_jobs SET status='cancelled',pdf_data=NULL,lease_token=NULL,updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('queued','processing')", [input.data.id, req.session.user!.userId]);
      await client.query("COMMIT"); res.json({ cancelled: true });
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  });
  router.get("/transcript/file", async (req, res) => {
    const result = await pool!.query<{ filename: string; pdf: Buffer }>(`SELECT filename,pdf_data AS pdf FROM student_transcripts WHERE user_id=$1`, [req.session.user!.userId]);
    const file = result.rows[0];
    if (!file) { res.status(404).json({ error: "transcript_not_found" }); return; }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="bang-diem.pdf"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.pdf);
  });
  router.post("/transcript", express.raw({ type: "application/pdf", limit: "5mb" }), async (req, res) => {
    if (req.get("x-confirm-own-transcript") !== "true") { res.status(400).json({ error: "ownership_confirmation_required" }); return; }
    if (!Buffer.isBuffer(req.body) || req.body.length < 8 || req.body.subarray(0, 5).toString("ascii") !== "%PDF-") { res.status(400).json({ error: "invalid_pdf" }); return; }
    const rawVersion = req.get("x-transcript-version");
    if (rawVersion && !z.uuid().safeParse(rawVersion).success) { res.status(400).json({ error: "invalid_version" }); return; }
    let filename: string;
    try { filename = decodeURIComponent(req.get("x-file-name") ?? "bang-diem.pdf").normalize("NFC").replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 200); }
    catch { res.status(400).json({ error: "invalid_filename" }); return; }
    if (!filename.toLowerCase().endsWith(".pdf")) { res.status(400).json({ error: "invalid_pdf" }); return; }
    if (ocrEnabled) await expireJobs(pool!);
    const data = ocrEnabled ? undefined : await parseTranscript(req.body);
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await lockStudent(client, req.session.user!);
      const existing = await client.query<{ version: string }>("SELECT version FROM student_transcripts WHERE user_id=$1 FOR UPDATE", [req.session.user!.userId]);
      if ((existing.rows[0]?.version ?? undefined) !== rawVersion) throw new TranscriptError("transcript_changed", 409);
      if (ocrEnabled) {
        const job = await enqueueTranscript(client, req.session.user!.userId, filename, req.body, rawVersion);
        await client.query("COMMIT"); res.status(202).json({ job }); return;
      }
      const result = await client.query<TranscriptRow>(`INSERT INTO student_transcripts
        (user_id,version,filename,pdf_data,file_size,sha256,parsed_data) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
        ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,filename=EXCLUDED.filename,
        pdf_data=EXCLUDED.pdf_data,file_size=EXCLUDED.file_size,sha256=EXCLUDED.sha256,parsed_data=EXCLUDED.parsed_data,updated_at=CURRENT_TIMESTAMP
        RETURNING ${transcriptColumns}`, [req.session.user!.userId, randomUUID(), filename, req.body, req.body.length, createHash("sha256").update(req.body).digest("hex"), JSON.stringify(data)]);
      await client.query("COMMIT");
      res.status(existing.rowCount ? 200 : 201).json({ transcript: result.rows[0] });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
  router.delete("/transcript", async (req, res) => {
    const input = z.object({ version: z.uuid(), confirmed: z.literal(true) }).strict().safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "invalid_input" }); return; }
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await lockStudent(client, req.session.user!);
      await client.query("UPDATE transcript_jobs SET status='cancelled',pdf_data=NULL,lease_token=NULL,updated_at=now() WHERE user_id=$1 AND status IN ('queued','processing')", [req.session.user!.userId]);
      const deleted = await client.query("DELETE FROM student_transcripts WHERE user_id=$1 AND version=$2", [req.session.user!.userId, input.data.version]);
      if (!deleted.rowCount) throw new TranscriptError("transcript_changed", 409);
      await client.query("COMMIT"); res.json({ deleted: true });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof TranscriptError) { res.status(error.status).json({ error: error.code }); return; }
    if (error?.type === "entity.too.large") { res.status(413).json({ error: "pdf_too_large" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
