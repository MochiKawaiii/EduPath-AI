// Student API for the AI graduation advice (design §5.7), mounted at
// /api/student/graduation/advice BEFORE the read-only graduation router. Advice is generated
// automatically: the page calls POST /ensure (idempotent per evaluation fingerprint) and a
// transcript import queues it best-effort (jobs.ts ensureGraduationAdviceAfterImport). There is
// no consent header, no cancel and no delete endpoint: advice goes with the transcript, and staff
// never read it.
import { Router, type ErrorRequestHandler } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { WORKER_ONLINE_SECONDS } from "../../competency-assessment/ai/queue.js";
import { GRADUATION_ADVICE_KIND } from "../../competency-assessment/ai/worker-protocol.js";
import type { DatabasePool } from "../../db/pool.js";
import { requireAuthentication } from "../../middleware/authorization.js";
import { readStudentGraduation } from "../student-graduation.js";
import {
  adviceNeeded,
  createGraduationAdviceExpiry,
  currentAdvice,
  ensureGraduationAdvice,
  GraduationAdviceError,
  readGraduationAdviceRows,
  retryGraduationAdvice,
  type AdviceOutcome,
  type GraduationAdviceReader,
  type GraduationAdviceRow,
  type GraduationAdviceStatus,
} from "./jobs.js";
import type { GraduationAdviceOutput } from "./validate.js";

/** One advice as the page sees it. "deferred" (queue full) is never stored: its id and createdAt are null. */
export type StoredGraduationAdvice = {
  id: string | null;
  status: GraduationAdviceStatus | "deferred";
  errorCode: string | null;
  createdAt: string | null;
  completedAt: string | null;
  /** Ollama model tag, e.g. "gemma4:e4b". */
  model: string | null;
  standardVersion: number;
  /** Only for a completed advice. */
  output: GraduationAdviceOutput | null;
};

export type AdviceWorkerStatus = { online: boolean; supportsAdvice: boolean };

export type GraduationAdviceRouterOptions = {
  /** AI_WORKER_KEY is configured; otherwise nothing is queued. */
  enabled: boolean;
  /** Test seam; readStudentGraduation by default. */
  read?: GraduationAdviceReader;
};

const emptyObject = z.object({}).strict();
const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());

export function presentGraduationAdvice(row: GraduationAdviceRow): StoredGraduationAdvice {
  return {
    id: row.id,
    status: row.status,
    errorCode: row.errorCode,
    createdAt: iso(row.createdAt),
    completedAt: iso(row.completedAt),
    model: row.model,
    standardVersion: row.standardVersion,
    output: row.status === "completed" ? row.output ?? null : null,
  };
}

/** The advice an ensure/retry answers with; null when there is nothing to advise on. */
export function outcomeAdvice(outcome: AdviceOutcome): StoredGraduationAdvice | null {
  if (outcome.kind === "unavailable") return null;
  if (outcome.kind === "stored") return presentGraduationAdvice(outcome.row);
  return {
    id: null, status: "deferred", errorCode: null, createdAt: null, completedAt: null, model: null,
    standardVersion: outcome.graduation.standard.version, output: null,
  };
}

async function inTransaction<T>(pool: DatabasePool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function createGraduationAdviceRouter(pool: DatabasePool | undefined, webOrigin: string, options: GraduationAdviceRouterOptions) {
  const router = Router();
  const enabled = options.enabled;
  const read = options.read ?? readStudentGraduation;
  // Stuck jobs also expire while the worker is offline (rate-limited to once per 60 s); a failed
  // expiry never breaks a read.
  const expire = createGraduationAdviceExpiry();
  const expireQuietly = () => expire(pool!).catch(() => false);

  const workerStatus = async (): Promise<AdviceWorkerStatus> => {
    if (!enabled) return { online: false, supportsAdvice: false };
    const status = await pool!.query<{ online: boolean; kinds: string[] | null }>(
      "SELECT seen_at>now()-make_interval(secs => $1) AS online,kinds FROM stu_comp_ai_worker_status WHERE id=1", [WORKER_ONLINE_SECONDS]);
    const row = status.rows[0];
    const online = row?.online === true;
    return { online, supportsAdvice: online && (row?.kinds ?? []).includes(GRADUATION_ADVICE_KIND) };
  };

  router.use(requireAuthentication);
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) { res.status(503).json({ error: "database_required" }); return; }
    if (!["GET", "HEAD"].includes(req.method) && req.get("origin") !== webOrigin) { res.status(403).json({ error: "invalid_origin" }); return; }
    const user = req.session.user!;
    const active = await pool.query("SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active", [user.userId, user.tenantId]);
    if (!active.rowCount) { res.status(403).json({ error: "account_unavailable" }); return; }
    next();
  });

  // The current advice: the newest row for the current facts, else the newest row (stale).
  router.get("/", async (req, res) => {
    emptyObject.parse(req.query);
    const userId = req.session.user!.userId;
    await expireQuietly();
    const client = await pool!.connect();
    let snapshot: { fingerprint: string | null; rows: GraduationAdviceRow[] };
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const graduation = await read(client, userId);
      snapshot = { fingerprint: graduation.fingerprint, rows: await readGraduationAdviceRows(client, userId) };
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const { fingerprint, rows } = snapshot;
    const advice = currentAdvice(rows, fingerprint) ?? rows[0] ?? null;
    res.json({
      advice: advice && presentGraduationAdvice(advice),
      stale: advice !== null && advice.fingerprint !== fingerprint,
      needsAdvice: enabled && adviceNeeded(rows, fingerprint),
      aiEnabled: enabled,
      worker: await workerStatus(),
      fingerprint,
    });
  });

  // Cheap poll (every 2.5 s while queued/processing): the student's newest row.
  router.get("/status", async (req, res) => {
    emptyObject.parse(req.query);
    await expireQuietly();
    const found = await pool!.query<{ id: string; status: GraduationAdviceStatus; errorCode: string | null }>(
      `SELECT id,status,error_code AS "errorCode" FROM stu_grad_advice WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,
      [req.session.user!.userId]);
    const row = found.rows[0];
    res.json({ id: row?.id ?? null, status: row?.status ?? null, errorCode: row?.errorCode ?? null, worker: await workerStatus() });
  });

  router.post("/ensure", async (req, res) => {
    if (!emptyObject.safeParse(req.body ?? {}).success) { res.status(400).json({ error: "invalid_input" }); return; }
    if (!enabled) { res.json({ advice: null }); return; }
    const outcome = await inTransaction(pool!, (client) => ensureGraduationAdvice(client, req.session.user!.userId, { expire, read }));
    res.json({ advice: outcomeAdvice(outcome) });
  });

  router.post("/retry", async (req, res) => {
    if (!emptyObject.safeParse(req.body ?? {}).success) { res.status(400).json({ error: "invalid_input" }); return; }
    if (!enabled) { res.status(409).json({ error: "ai_disabled" }); return; }
    const outcome = await inTransaction(pool!, (client) => retryGraduationAdvice(client, req.session.user!.userId, { expire, read }));
    res.status(201).json({ advice: outcomeAdvice(outcome) });
  });

  // Nothing under /advice falls through to the read-only graduation router.
  router.use((_req, res) => { res.status(404).json({ error: "not_found" }); });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof GraduationAdviceError) { res.status(error.status).json({ error: error.code }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: "invalid_input" }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
