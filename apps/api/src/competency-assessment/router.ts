import { Router, type ErrorRequestHandler } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import { activeConsentVersion, recordConsent, TRANSCRIPT_POLICY_VERSION, withdrawConsent } from "../student/consent.js";
import { calculateAssessment } from "./calculate.js";
import { AssessmentError, loadAssessmentInputs } from "./inputs.js";
import {
  deleteCompetencyData, findAssessment, insertAssessment, latestAssessment, latestAssessmentStatus,
  pruneAssessments, REGENERABLE_AI_STATUSES, withinCooldown, type AiStatus,
} from "./repository.js";
import type { AssessmentInputs, AssessmentResult } from "./types.js";

/**
 * The AI queue hook (contract C2). Implemented by createCompetencyAiQueue() in ./ai/queue.ts;
 * declared structurally here so the student API works (with AI 'disabled') without it.
 */
export interface CompetencyAiQueueHook {
  enabled: boolean;
  enqueue(client: PoolClient, input: { assessmentId: string; userId: string; result: AssessmentResult }): Promise<"queued" | "deferred">;
  regenerate(client: PoolClient, input: { assessmentId: string; userId: string; result: AssessmentResult }): Promise<"queued" | "deferred">;
  cancel(client: PoolClient, input: { assessmentId: string; userId: string }): Promise<boolean>;
  workerOnline(db: Pick<DatabasePool, "query">): Promise<boolean>;
}

export type CompetencyAssessmentRouterOptions = {
  /** Copied into meta.promptVersion (the AI prompt module's PROMPT_VERSION when AI is wired). */
  promptVersion?: string;
  /** Test seams; default to the real snapshot reader and engine. */
  loadInputs?: (pool: DatabasePool, userId: string, options: { promptVersion?: string }) => Promise<AssessmentInputs>;
  calculate?: (inputs: AssessmentInputs) => AssessmentResult;
};

const assessmentId = z.uuid();

/** Locks the student's user row for the write transaction and re-checks that the account is active. */
async function lockStudent(client: PoolClient, user: AuthenticatedUser) {
  const active = await client.query("SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active FOR UPDATE", [user.userId, user.tenantId]);
  if (!active.rowCount) throw new AssessmentError("account_unavailable", 403);
}

async function inTransaction<T>(pool: DatabasePool, work: (client: PoolClient) => Promise<T>) {
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

/** Student competency assessment API (spec §8, contract C4), mounted at /api/student/competency-assessments. */
export function createCompetencyAssessmentRouter(
  pool: DatabasePool | undefined,
  webOrigin: string,
  aiQueue?: CompetencyAiQueueHook,
  options: CompetencyAssessmentRouterOptions = {},
) {
  const router = Router();
  const loadInputs = options.loadInputs ?? loadAssessmentInputs;
  const calculate = options.calculate ?? calculateAssessment;
  const aiEnabled = Boolean(aiQueue?.enabled);
  const workerOnline = async () => aiEnabled ? aiQueue!.workerOnline(pool!) : false;

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

  router.post("/", async (req, res) => {
    const consentVersion = req.get("x-consent-policy-version");
    if (!consentVersion) { res.status(400).json({ error: "consent_required" }); return; }
    if (consentVersion !== TRANSCRIPT_POLICY_VERSION) { res.status(409).json({ error: "policy_outdated" }); return; }
    if (!z.object({}).strict().safeParse(req.body ?? {}).success) { res.status(400).json({ error: "invalid_input" }); return; }
    const user = req.session.user!;
    // Cheap pre-check so a repeated click does not compute a snapshot; the write transaction re-checks.
    if (await withinCooldown(pool!, user.userId)) { res.status(429).json({ error: "assessment_too_frequent" }); return; }
    const inputs = await loadInputs(pool!, user.userId, options.promptVersion ? { promptVersion: options.promptVersion } : {});
    const result = calculate(inputs);
    const assessment = await inTransaction(pool!, async (client) => {
      await lockStudent(client, user);
      const transcript = await client.query<{ version: string }>("SELECT version FROM student_transcripts WHERE user_id=$1", [user.userId]);
      if (transcript.rows[0]?.version !== inputs.transcript.version) throw new AssessmentError("transcript_changed", 409);
      if (await withinCooldown(client, user.userId)) throw new AssessmentError("assessment_too_frequent", 429);
      await recordConsent(client, user.userId, "competency_assessment");
      const id = await insertAssessment(client, { userId: user.userId, transcriptVersion: inputs.transcript.version, result });
      if (aiEnabled) await aiQueue!.enqueue(client, { assessmentId: id, userId: user.userId, result });
      await pruneAssessments(client, user.userId);
      return findAssessment(client, user.userId, id);
    });
    res.status(201).json({ assessment });
  });

  // consentVersion: the active 'competency_assessment' consent of THIS student, so the page
  // asks again on a shared browser, after a withdrawal elsewhere, or after a policy change.
  router.get("/latest", async (req, res) => {
    const userId = req.session.user!.userId;
    const consentVersion = await activeConsentVersion(pool!, userId, "competency_assessment");
    const assessment = await latestAssessment(pool!, userId);
    res.json({ assessment, aiEnabled, workerOnline: await workerOnline(), consentVersion });
  });

  router.get("/latest/status", async (req, res) => {
    const status = await latestAssessmentStatus(pool!, req.session.user!.userId);
    res.json({ ...status, workerOnline: await workerOnline() });
  });

  router.post("/:id/ai", async (req, res) => {
    if (!aiEnabled) { res.status(409).json({ error: "ai_disabled" }); return; }
    const id = assessmentId.safeParse(req.params.id);
    if (!id.success) { res.status(404).json({ error: "assessment_not_found" }); return; }
    const user = req.session.user!;
    const outcome = await inTransaction(pool!, async (client) => {
      await lockStudent(client, user);
      const found = await client.query<{ id: string; ai_status: AiStatus; computed: AssessmentResult; latest: boolean }>(
        `SELECT a.id,a.ai_status,a.computed,a.id=(SELECT l.id FROM stu_comp_assessments l WHERE l.user_id=$2
           ORDER BY l.created_at DESC,l.id DESC LIMIT 1) AS latest
         FROM stu_comp_assessments a WHERE a.id=$1 AND a.user_id=$2 FOR UPDATE OF a`, [id.data, user.userId]);
      const row = found.rows[0];
      if (!row) throw new AssessmentError("assessment_not_found", 404);
      // Only the newest result shows comments; regenerating an older one would cancel its job.
      if (!row.latest || !REGENERABLE_AI_STATUSES.includes(row.ai_status)) throw new AssessmentError("ai_not_regenerable", 409);
      return aiQueue!.regenerate(client, { assessmentId: row.id, userId: user.userId, result: row.computed });
    });
    if (outcome === "deferred") { res.status(429).json({ error: "queue_full" }); return; }
    res.status(202).json({ aiStatus: outcome });
  });

  router.delete("/:id/ai", async (req, res) => {
    const id = assessmentId.safeParse(req.params.id);
    if (!id.success) { res.status(404).json({ error: "assessment_not_found" }); return; }
    const user = req.session.user!;
    const cancelled = await inTransaction(pool!, async (client) => {
      await lockStudent(client, user);
      const found = await client.query("SELECT id FROM stu_comp_assessments WHERE id=$1 AND user_id=$2", [id.data, user.userId]);
      if (!found.rowCount) throw new AssessmentError("assessment_not_found", 404);
      return aiQueue ? aiQueue.cancel(client, { assessmentId: id.data, userId: user.userId }) : false;
    });
    res.json({ cancelled });
  });

  // Withdraw consent: removes every result and AI job of the student (spec §3).
  router.delete("/", async (req, res) => {
    if (!z.object({ confirmed: z.literal(true) }).strict().safeParse(req.body).success) { res.status(400).json({ error: "invalid_input" }); return; }
    const user = req.session.user!;
    await inTransaction(pool!, async (client) => {
      await lockStudent(client, user);
      await deleteCompetencyData(client, user.userId);
      await withdrawConsent(client, user.userId, "competency_assessment");
    });
    res.json({ deleted: true });
  });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof AssessmentError) { res.status(error.status).json({ error: error.code }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
