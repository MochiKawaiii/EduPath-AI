import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import type { PlanData } from "./model.js";

export function studentPlanData(data: PlanData) {
  return {
    name: data.name,
    major: data.major,
    cohortCode: data.cohortCode,
    admissionYear: data.admissionYear,
    totalCredits: data.totalCredits,
    terms: data.terms.map(({ code, semester, studyYear, sourceCredits }) => ({
      code,
      semester,
      studyYear,
      sourceCredits,
    })),
    sections: data.sections.map(({ id, termCode, label, kind }) => ({
      id,
      termCode,
      label,
      kind,
    })),
    items: data.items.map(
      ({
        id,
        code,
        name,
        credits,
        type,
        termCode,
        semester,
        studyYear,
        sectionId,
        prerequisite,
        prior,
        hours,
        notes,
      }) => ({
        id,
        code,
        name,
        credits,
        type,
        termCode,
        semester,
        studyYear,
        sectionId,
        prerequisite,
        prior,
        hours,
        notes,
      }),
    ),
  };
}

export function createStudentPlansRouter(pool: DatabasePool | undefined) {
  const router = Router();
  router.use(requireAuthentication);
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) {
      res.status(503).json({ error: "database_required" });
      return;
    }
    const user = req.session.user!;
    const active = await pool.query(
      "SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active",
      [user.userId, user.tenantId],
    );
    if (!active.rowCount) {
      res.status(403).json({ error: "account_unavailable" });
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.setHeader("Allow", "GET, HEAD");
      res.status(405).json({ error: "read_only" });
      return;
    }
    next();
  });
  router.get("/", async (req, res) => {
    z.object({}).strict().parse(req.query);
    const [result, profile] = await Promise.all([
      pool!
        .query(`SELECT c.id,c.cohort_code AS "cohortCode",r.data->>'name' AS name,
        r.data->>'major' AS major,(r.data->>'totalCredits')::numeric AS "totalCredits",
        jsonb_array_length(r.data->'items') AS "itemCount",r.version
        FROM training_plans c JOIN training_plan_revisions r ON r.id=c.current_revision
        WHERE c.is_active ORDER BY c.cohort_code DESC,r.data->>'major',c.id`),
      pool!.query("SELECT cohort_code FROM student_profiles WHERE user_id=$1", [
        req.session.user!.userId,
      ]),
    ]);
    const profileCohort = profile.rows[0]?.cohort_code ?? null;
    const matches = result.rows.filter(
      (row) => row.cohortCode === profileCohort,
    );
    res.json({
      items: result.rows,
      profileCohort,
      suggestedId: matches.length === 1 ? matches[0]!.id : null,
    });
  });
  router.get("/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    z.object({}).strict().parse(req.query);
    const result = await pool!.query<{
      id: string;
      version: number;
      data: PlanData;
    }>(
      `SELECT c.id,r.version,r.data FROM training_plans c JOIN training_plan_revisions r ON r.id=c.current_revision
       WHERE c.id=$1 AND c.is_active`,
      [id],
    );
    const current = result.rows[0];
    if (!current) {
      res.status(404).json({ error: "plan_unavailable" });
      return;
    }
    res.json({
      id: current.id,
      version: current.version,
      ...studentPlanData(current.data),
    });
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "invalid_plan_query" });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
