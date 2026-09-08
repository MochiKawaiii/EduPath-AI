import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import type { AuthenticatedUser } from "../auth/types.js";
import { requireRole } from "../middleware/authorization.js";
import { AccountError, type AdminAccountRepository } from "./accounts.js";

export interface StudentProfileQuery {
  q: string; page: number; pageSize: number;
  cohortYear?: number | undefined;
  semester?: number | undefined;
  active?: "true" | "false" | undefined;
  profileStatus?: "missing" | "incomplete" | "complete" | undefined;
}
export interface StudentProfileSummary {
  id: string; name: string; email: string | null; isActive: boolean;
  studentCode: string | null; cohortYear: number | null; currentSemester: number | null;
  profileStatus: "missing" | "incomplete" | "complete";
}
export interface StudentProfileDetail extends StudentProfileSummary {
  username: string | null; careerGoal: string | null;
  accountCreatedAt: string; firstLoginAt: string; lastLoginAt: string;
  profileCreatedAt: string | null; profileUpdatedAt: string | null;
}
export interface StudentProfilePage { items: StudentProfileSummary[]; total: number; cohortYears: number[] }
export interface StudentProfileRepository {
  list(actor: AuthenticatedUser, query: StudentProfileQuery): Promise<StudentProfilePage>;
  detail(actor: AuthenticatedUser, id: string): Promise<StudentProfileDetail>;
}
const profileStatus = `CASE WHEN p.user_id IS NULL THEN 'missing' WHEN p.onboarding_completed THEN 'complete' ELSE 'incomplete' END`;
const summaryColumns = `u.id, u.display_name AS name, u.email, u.is_active AS "isActive",
  p.student_code AS "studentCode", p.cohort_year AS "cohortYear", p.current_semester AS "currentSemester",
  ${profileStatus} AS "profileStatus"`;
const studentScope = `u.entra_tenant_id = $1 AND COALESCE(u.role_override, u.role) = 'student'`;

export class PostgresStudentProfileRepository implements StudentProfileRepository {
  constructor(private readonly pool: DatabasePool) {}
  async list(actor: AuthenticatedUser, query: StudentProfileQuery): Promise<StudentProfilePage> {
    const result = await this.pool.query<StudentProfilePage>(`WITH students AS (
      SELECT ${summaryColumns}, concat_ws(' ', u.display_name, u.email, u.username, p.student_code, p.career_goal) AS search_text
      FROM users u LEFT JOIN student_profiles p ON p.user_id = u.id WHERE ${studentScope}
    ), filtered AS (
      SELECT id, name, email, "isActive", "studentCode", "cohortYear", "currentSemester", "profileStatus" FROM students
      WHERE ($2 = '' OR strpos(lower(search_text), lower($2)) > 0)
        AND ($3::int IS NULL OR "cohortYear" = $3)
        AND ($4::int IS NULL OR "currentSemester" = $4)
        AND ($5::boolean IS NULL OR "isActive" = $5)
        AND ($6::text IS NULL OR "profileStatus" = $6)
    ), paged AS (SELECT * FROM filtered ORDER BY name, id LIMIT $7 OFFSET $8)
    SELECT COALESCE((SELECT json_agg(paged ORDER BY name, id) FROM paged), '[]'::json) AS items,
      (SELECT count(*)::int FROM filtered) AS total,
      COALESCE((SELECT json_agg(year ORDER BY year DESC) FROM (SELECT DISTINCT "cohortYear" AS year FROM students WHERE "cohortYear" IS NOT NULL) years), '[]'::json) AS "cohortYears"`,
    [actor.tenantId, query.q, query.cohortYear ?? null, query.semester ?? null, query.active ?? null, query.profileStatus ?? null, query.pageSize, (query.page - 1) * query.pageSize]);
    return result.rows[0] ?? { items: [], total: 0, cohortYears: [] };
  }
  async detail(actor: AuthenticatedUser, id: string): Promise<StudentProfileDetail> {
    const result = await this.pool.query<StudentProfileDetail>(`SELECT ${summaryColumns}, u.username,
      p.career_goal AS "careerGoal", u.created_at AS "accountCreatedAt", u.first_login_at AS "firstLoginAt",
      u.last_login_at AS "lastLoginAt", p.created_at AS "profileCreatedAt", p.updated_at AS "profileUpdatedAt"
      FROM users u LEFT JOIN student_profiles p ON p.user_id = u.id
      WHERE ${studentScope} AND u.id = $2`, [actor.tenantId, id]);
    if (!result.rows[0]) throw new AccountError("student_not_found", 404);
    return result.rows[0];
  }
}

export function createStudentProfilesRouter(repository: StudentProfileRepository | undefined, authorization: Pick<AdminAccountRepository, "isAdmin"> | undefined) {
  const router = Router();
  router.use(requireRole("admin"));
  router.use(async (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    if (!repository || !authorization) { response.status(503).json({ error: "database_required" }); return; }
    if (!await authorization.isAdmin(request.session.user!)) { response.status(403).json({ error: "insufficient_role" }); return; }
    next();
  });
  router.get("/", async (request, response) => {
    const input = z.object({
      q: z.string().trim().max(120).default(""),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(10),
      cohortYear: z.coerce.number().int().min(2000).max(2100).optional(),
      semester: z.coerce.number().int().min(1).max(20).optional(),
      active: z.enum(["true", "false"]).optional(),
      profileStatus: z.enum(["missing", "incomplete", "complete"]).optional()
    }).strict().safeParse(request.query);
    if (!input.success) { response.status(400).json({ error: "invalid_query" }); return; }
    response.json({ ...await repository!.list(request.session.user!, input.data), page: input.data.page, pageSize: input.data.pageSize });
  });
  router.get("/:id", async (request, response) => {
    const id = z.uuid().safeParse(request.params.id);
    if (!id.success) { response.status(400).json({ error: "invalid_input" }); return; }
    response.json({ student: await repository!.detail(request.session.user!, id.data) });
  });
  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof AccountError) { res.status(error.status).json({ error: error.code }); return; }
    next(error);
  };
  router.use(errorHandler);
  return router;
}
