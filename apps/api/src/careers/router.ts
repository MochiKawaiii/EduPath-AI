import { randomUUID } from "node:crypto";
import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import {
  requireAdminAccess,
  requireAuthentication,
} from "../middleware/authorization.js";
import type { AuthenticatedUser } from "../auth/types.js";
export const categories = [
  "software",
  "data_ai",
  "security",
  "infrastructure",
  "quality",
  "product",
] as const;
export const careerInput = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    nameVi: z.string().trim().min(1).max(160),
    nameEn: z.string().trim().min(1).max(160),
    category: z.enum(categories),
    description: z.string().trim().max(4000),
    skills: z.array(z.string().trim().min(1).max(100)).max(30),
  })
  .strict();
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
const columns = `id,code,name_vi AS "nameVi",name_en AS "nameEn",category,description,skills,version,deleted_at AS "deletedAt"`;
class CareerError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
async function access(
  client: DatabasePool | PoolClient,
  actor: AuthenticatedUser,
  write: boolean,
  student = false,
  lock = false,
) {
  const row = await client.query(
    `SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active
 ${student ? "" : "AND COALESCE(role_override,role)=ANY($3::text[])"}${lock ? " FOR SHARE" : ""}`,
    student
      ? [actor.userId, actor.tenantId]
      : [
          actor.userId,
          actor.tenantId,
          write
            ? ["admin"]
            : ["admin", "faculty_board", "department_head", "lecturer"],
        ],
  );
  if (!row.rowCount) throw new CareerError("insufficient_role", 403);
}
export function createCareersRouter(
  pool: DatabasePool | undefined,
  origin: string,
  student = false,
) {
  const router = Router();
  router.use(student ? requireAuthentication : requireAdminAccess);
  router.use(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!pool) {
      res.status(503).json({ error: "database_required" });
      return;
    }
    const write = !["GET", "HEAD"].includes(req.method);
    if (write && (student || req.get("origin") !== origin)) {
      res.status(403).json({ error: "invalid_origin" });
      return;
    }
    await access(pool, req.session.user!, write, student);
    next();
  });
  router.get("/", async (req, res) => {
    const q = z
      .object({
        q: z.string().trim().max(200).default(""),
        category: z.enum(["", ...categories]).default(""),
      })
      .strict()
      .parse(req.query);
    const rows = await pool!.query(
      `SELECT ${columns} FROM career_positions WHERE deleted_at IS NULL AND ($1='' OR strpos(search_text,$1)>0) AND ($2='' OR category=$2) ORDER BY name_vi,id`,
      [fold(q.q), q.category],
    );
    res.json({ items: rows.rows });
  });
  if (!student) {
    router.get("/:id", async (req, res) => {
      const row = await pool!.query(
        `SELECT ${columns},(SELECT count(*)::int FROM student_profiles WHERE career_position_id=c.id) AS "studentCount" FROM career_positions c WHERE id=$1 AND deleted_at IS NULL`,
        [z.uuid().parse(req.params.id)],
      );
      if (!row.rowCount) throw new CareerError("career_not_found", 404);
      res.json(row.rows[0]);
    });
    router.post("/", async (req, res) => {
      const data = careerInput.parse(req.body),
        client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await access(client, req.session.user!, true, false, true);
        const row = await client.query(
          `INSERT INTO career_positions(code,name_vi,name_en,category,description,skills,search_text) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${columns}`,
          [
            data.code,
            data.nameVi,
            data.nameEn,
            data.category,
            data.description,
            data.skills,
            fold(
              [
                data.code,
                data.nameVi,
                data.nameEn,
                data.description,
                ...data.skills,
              ].join(" "),
            ),
          ],
        );
        await client.query("COMMIT");
        res.status(201).json(row.rows[0]);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    });
    router.patch("/:id", async (req, res) => {
      const id = z.uuid().parse(req.params.id),
        version = z.uuid().parse(req.get("x-version")),
        data = careerInput.parse(req.body),
        client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await access(client, req.session.user!, true, false, true);
        const row = await client.query(
          `UPDATE career_positions SET code=$3,name_vi=$4,name_en=$5,category=$6,description=$7,skills=$8,search_text=$9,version=$10,updated_at=now() WHERE id=$1 AND version=$2 AND deleted_at IS NULL RETURNING ${columns}`,
          [
            id,
            version,
            data.code,
            data.nameVi,
            data.nameEn,
            data.category,
            data.description,
            data.skills,
            fold(
              [
                data.code,
                data.nameVi,
                data.nameEn,
                data.description,
                ...data.skills,
              ].join(" "),
            ),
            randomUUID(),
          ],
        );
        if (!row.rowCount) throw new CareerError("career_changed", 409);
        await client.query("COMMIT");
        res.json(row.rows[0]);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    });
    router.delete("/:id", async (req, res) => {
      const id = z.uuid().parse(req.params.id),
        version = z.uuid().parse(req.get("x-version"));
      z.object({ confirmed: z.literal(true) })
        .strict()
        .parse(req.body);
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await access(client, req.session.user!, true, false, true);
        const row = await client.query(
          "UPDATE career_positions SET deleted_at=now(),updated_at=now(),version=$3 WHERE id=$1 AND version=$2 AND deleted_at IS NULL",
          [id, version, randomUUID()],
        );
        if (!row.rowCount) throw new CareerError("career_changed", 409);
        await client.query("COMMIT");
        res.json({ deleted: true });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    });
  }
  const errors: ErrorRequestHandler = (e, _req, res, next) => {
    if (e instanceof CareerError) {
      res.status(e.status).json({ error: e.code });
      return;
    }
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "invalid_career" });
      return;
    }
    if (e.code === "23505") {
      res.status(409).json({ error: "career_exists" });
      return;
    }
    next(e);
  };
  router.use(errors);
  return router;
}
