import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { requireAuthentication } from "../middleware/authorization.js";
import type { GraduationData } from "./model.js";
import { loadStudentGraduation, type StudentGraduation } from "./student-graduation.js";

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
    gpaScale: data.gpaScale ?? 4,
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

/**
 * GET /api/student/graduation (design §4): the student's own standard only — resolved from the
 * cohort in the account and the specialty in the profile — with the server-side evaluation. There
 * is no way to read another cohort's or specialty's standard (the former GET /:id is gone).
 */
export function studentGraduationResponse(loaded: StudentGraduation) {
  const standard = loaded.standard;
  return {
    profile: loaded.profile,
    resolution: loaded.resolution,
    standard: standard
      ? { id: standard.id, revisionId: standard.revisionId, version: standard.version, ...studentGraduationData(standard.data) }
      : null,
    transcript: loaded.transcript,
    evaluation: loaded.evaluation,
    specialtySuggestion: loaded.specialtySuggestion,
  };
}

/** Body of GET /api/student/graduation (the web mirrors it). */
export type StudentGraduationResponse = ReturnType<typeof studentGraduationResponse>;

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
    res.json(studentGraduationResponse(await loadStudentGraduation(pool!, req.session.user!.userId)));
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
