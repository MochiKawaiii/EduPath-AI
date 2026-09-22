import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import type { AuthenticatedUser } from "../auth/types.js";
import { requireAdminAccess } from "../middleware/authorization.js";
import { AccountError, type AdminAccountRepository } from "./accounts.js";

export interface StudentProfileQuery {
  q: string; page: number; pageSize: number;
  cohortYear?: number | undefined;
  cohortCode?: string | undefined;
  active?: "true" | "false" | undefined;
  profileStatus?: "missing" | "incomplete" | "complete" | undefined;
}
export interface StudentProfileSummary {
  id: string; name: string; email: string | null; isActive: boolean;
  studentCode: string | null; cohortYear: number | null;
  cohortCode: string | null; className: string | null;
  profileStatus: "missing" | "incomplete" | "complete";
}
export interface StudentProfileDetail extends StudentProfileSummary {
  careerPositionId?: string | null;
  careerPosition?: { id: string; nameVi: string; nameEn: string; deletedAt: string | null } | null;
  interests: string | null;
  username: string | null; careerGoal: string | null;
  accountCreatedAt: string; firstLoginAt: string; lastLoginAt: string;
  profileCreatedAt: string | null; profileUpdatedAt: string | null;
}
export interface StudentProfilePage { items: StudentProfileSummary[]; total: number; cohortYears: number[]; cohortCodes: string[] }
export interface StudentProfileRepository {
  list(actor: AuthenticatedUser, query: StudentProfileQuery): Promise<StudentProfilePage>;
  detail(actor: AuthenticatedUser, id: string): Promise<StudentProfileDetail>;
}
// Derive completion from saved data so profile edits and transcript deletion stay in sync.
const profileStatus = `CASE WHEN p.user_id IS NULL THEN 'missing'
  WHEN NULLIF(btrim(p.interests), '') IS NOT NULL
    AND p.career_position_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM student_transcripts t WHERE t.user_id = p.user_id)
  THEN 'complete' ELSE 'incomplete' END`;
const summaryColumns = `u.id, COALESCE(p.full_name, u.display_name) AS name, u.email, u.is_active AS "isActive",
  p.cohort_code AS "cohortCode", p.class_name AS "className",
  p.student_code AS "studentCode", p.cohort_year AS "cohortYear",
  ${profileStatus} AS "profileStatus"`;
const studentScope = `(COALESCE(u.role_override, u.role) = 'student' OR u.is_student)`;

export class PostgresStudentProfileRepository implements StudentProfileRepository {
  constructor(private readonly pool: DatabasePool) {}
  async list(_actor: AuthenticatedUser, query: StudentProfileQuery): Promise<StudentProfilePage> {
    const result = await this.pool.query<StudentProfilePage>(`WITH students AS (
      SELECT ${summaryColumns}, concat_ws(' ', u.display_name, p.full_name, u.email, u.username, p.student_code, p.cohort_code, p.class_name, p.career_goal) AS search_text
      FROM users u LEFT JOIN student_profiles p ON p.user_id = u.id WHERE ${studentScope}
    ), filtered AS (
      SELECT id, name, email, "isActive", "studentCode", "cohortCode", "className", "cohortYear", "profileStatus" FROM students
      WHERE ($1 = '' OR strpos(lower(search_text), lower($1)) > 0)
        AND ($2::int IS NULL OR "cohortYear" = $2)
        AND ($3::text IS NULL OR "cohortCode" = $3)
        AND ($4::boolean IS NULL OR "isActive" = $4)
        AND ($5::text IS NULL OR "profileStatus" = $5)
    ), paged AS (SELECT * FROM filtered ORDER BY name, id LIMIT $6 OFFSET $7)
    SELECT COALESCE((SELECT json_agg(paged ORDER BY name, id) FROM paged), '[]'::json) AS items,
      (SELECT count(*)::int FROM filtered) AS total,
      COALESCE((SELECT json_agg(year ORDER BY year DESC) FROM (SELECT DISTINCT "cohortYear" AS year FROM students WHERE "cohortYear" IS NOT NULL) years), '[]'::json) AS "cohortYears",
      COALESCE((SELECT json_agg(code ORDER BY code DESC) FROM (SELECT DISTINCT "cohortCode" AS code FROM students WHERE "cohortCode" IS NOT NULL) codes), '[]'::json) AS "cohortCodes"`,
    [query.q, query.cohortYear ?? null, query.cohortCode ?? null, query.active ?? null, query.profileStatus ?? null, query.pageSize, (query.page - 1) * query.pageSize]);
    return result.rows[0] ?? { items: [], total: 0, cohortYears: [], cohortCodes: [] };
  }
  async detail(_actor: AuthenticatedUser, id: string): Promise<StudentProfileDetail> {
    const result = await this.pool.query<StudentProfileDetail>(`SELECT ${summaryColumns}, u.username,
      p.career_goal AS "careerGoal", p.career_position_id AS "careerPositionId",
      (SELECT json_build_object('id',c.id,'nameVi',c.name_vi,'nameEn',c.name_en,'deletedAt',c.deleted_at) FROM career_positions c WHERE c.id=p.career_position_id) AS "careerPosition", p.interests, u.created_at AS "accountCreatedAt", u.first_login_at AS "firstLoginAt",
      u.last_login_at AS "lastLoginAt", p.created_at AS "profileCreatedAt", p.updated_at AS "profileUpdatedAt"
      FROM users u LEFT JOIN student_profiles p ON p.user_id = u.id
      WHERE (${studentScope} OR u.id = $2::uuid) AND u.id = $1`, [id, _actor.userId === id ? id : null]);
    if (!result.rows[0]) throw new AccountError("student_not_found", 404);
    return result.rows[0];
  }
}

export function createStudentProfilesRouter(repository: StudentProfileRepository | undefined, authorization: Pick<AdminAccountRepository, "canAccessAdmin"> | undefined) {
  const router = Router();
  router.use(requireAdminAccess);
  router.use(async (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    if (!repository || !authorization) { response.status(503).json({ error: "database_required" }); return; }
    if (!await authorization.canAccessAdmin(request.session.user!)) { response.status(403).json({ error: "insufficient_role" }); return; }
    next();
  });
  router.get("/", async (request, response) => {
    const input = z.object({
      q: z.string().trim().max(120).default(""),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(10),
      cohortYear: z.coerce.number().int().min(2000).max(2100).optional(),
      cohortCode: z.string().trim().toUpperCase().regex(/^K[0-9]{2,3}$/).optional(),
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
