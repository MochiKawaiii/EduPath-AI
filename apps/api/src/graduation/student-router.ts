import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import type { GraduationData } from "./model.js";

/** Only the conditions a student needs; source workbook details and review notes stay in the admin portal. */
export function studentGraduationData(data: GraduationData) {
  return {
    name: data.name,
    cohortCode: data.cohortCode,
    classBlock: data.classBlock,
    major: data.major,
    specialty: data.specialty,
    educationSystem: data.educationSystem,
    faculty: data.faculty,
    minimumCredits: data.minimumCredits,
    mandatoryCredits: data.mandatoryCredits,
    electiveCredits: data.electiveCredits,
    freeElectiveCredits: data.freeElectiveCredits,
    minimumGpa: data.minimumGpa,
    notes: data.notes,
    groups: data.groups.map(({ id, name, kind, minimumCredits }) => ({
      id,
      name,
      kind,
      minimumCredits,
    })),
    courses: data.courses.map(
      ({ id, groupId, code, name, credits, conditionOnly }) => ({
        id,
        groupId,
        code,
        name,
        credits,
        conditionOnly,
      }),
    ),
  };
}

export function createStudentGraduationRouter(pool: DatabasePool | undefined) {
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
      pool!.query(`SELECT c.id,c.cohort_code AS "cohortCode",r.data->>'name' AS name,
        r.data->>'major' AS major,r.data->>'specialty' AS specialty,
        r.data->>'classBlock' AS "classBlock",(r.data->>'minimumCredits')::numeric AS "minimumCredits"
        FROM graduation_standards c JOIN graduation_revisions r ON r.id=c.current_revision
        WHERE c.is_active ORDER BY c.cohort_code DESC,r.data->>'name',c.id`),
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
      data: GraduationData;
    }>(
      `SELECT c.id,r.version,r.data FROM graduation_standards c JOIN graduation_revisions r ON r.id=c.current_revision
       WHERE c.id=$1 AND c.is_active`,
      [id],
    );
    const current = result.rows[0];
    if (!current) {
      res.status(404).json({ error: "standard_unavailable" });
      return;
    }
    res.json({
      id: current.id,
      version: current.version,
      ...studentGraduationData(current.data),
    });
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "invalid_graduation_query" });
      return;
    }
    next(error);
  };
  router.use(errors);
  return router;
}
