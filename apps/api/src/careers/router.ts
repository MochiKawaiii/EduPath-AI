import { randomUUID } from "node:crypto";
import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import {
  requireAdminAccess,
  requireAuthentication,
} from "../middleware/authorization.js";
import { access, CareerError, fold, lockSkillCatalog } from "./shared.js";
import { createCareerRequirementsRouter, syncLegacySkillLinks } from "./requirements.js";
import { createCareerSkillsRouter } from "./skills.js";
export { fold } from "./shared.js";
const fieldCode = z.string().trim().min(1).max(60).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
const fieldDetails = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000),
}).strict();
// Accept legacy clients' code during rollout; the database assigns the actual number.
const fieldInput = fieldDetails.extend({ code: fieldCode.optional() });
const fieldColumns = `id,code,name,description,version`;
export const careerInput = z
  .object({
    // Legacy clients may send a code; it never controls the database-assigned code.
    code: z.string().trim().max(60).optional(),
    nameVi: z.string().trim().min(1).max(160),
    nameEn: z.string().trim().min(1).max(160),
    category: fieldCode,
    description: z.string().trim().max(4000),
    skills: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  })
  .strict();
const columns = `id,code,name_vi AS "nameVi",name_en AS "nameEn",category,description,skills,version,deleted_at AS "deletedAt"`;
async function requireField(client: PoolClient, code: string) {
  const field = await client.query(
    "SELECT id FROM career_fields WHERE code=$1 AND deleted_at IS NULL FOR SHARE",
    [code],
  );
  if (!field.rowCount) throw new CareerError("field_unavailable", 409);
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
  router.get("/fields", async (req, res) => {
    z.object({}).strict().parse(req.query);
    const fields = await pool!.query(`SELECT ${fieldColumns},
      (SELECT count(*)::int FROM career_positions p WHERE p.category=career_fields.code AND p.deleted_at IS NULL) AS "positionCount"
      FROM career_fields WHERE deleted_at IS NULL ORDER BY code::bigint,id`);
    res.json({ items: fields.rows });
  });
  if (!student) {
    router.post("/fields", async (req, res) => {
      const data = fieldInput.parse(req.body);
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await access(client, req.session.user!, true, false, true);
        const field = await client.query(
          `INSERT INTO career_fields(name,description) VALUES($1,$2) RETURNING ${fieldColumns}`,
          [data.name, data.description],
        );
        await client.query("COMMIT");
        res.status(201).json(field.rows[0]);
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });
    router.patch("/fields/:id", async (req, res) => {
      const id = z.uuid().parse(req.params.id);
      const version = z.uuid().parse(req.get("x-version"));
      const data = fieldDetails.parse(req.body);
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await access(client, req.session.user!, true, false, true);
        const field = await client.query(
          `UPDATE career_fields SET name=$3,description=$4,version=$5,updated_at=now()
           WHERE id=$1 AND version=$2 AND deleted_at IS NULL RETURNING ${fieldColumns}`,
          [id, version, data.name, data.description, randomUUID()],
        );
        if (!field.rowCount) throw new CareerError("field_changed", 409);
        await client.query("COMMIT");
        res.json(field.rows[0]);
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });
    router.delete("/fields/:id", async (req, res) => {
      const id = z.uuid().parse(req.params.id);
      const version = z.uuid().parse(req.get("x-version"));
      z.object({ confirmed: z.literal(true) }).strict().parse(req.body);
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await access(client, req.session.user!, true, false, true);
        const field = await client.query<{ code: string }>(
          "SELECT code FROM career_fields WHERE id=$1 AND version=$2 AND deleted_at IS NULL FOR UPDATE",
          [id, version],
        );
        if (!field.rowCount) throw new CareerError("field_changed", 409);
        const used = await client.query(
          "SELECT id FROM career_positions WHERE category=$1 AND deleted_at IS NULL LIMIT 1",
          [field.rows[0]!.code],
        );
        if (used.rowCount) throw new CareerError("field_in_use", 409);
        await client.query("UPDATE career_fields SET deleted_at=now(),updated_at=now(),version=$2 WHERE id=$1", [id, randomUUID()]);
        await client.query("COMMIT");
        res.json({ deleted: true });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });
  }
  router.get("/", async (req, res) => {
    const q = z
      .object({
        q: z.string().trim().max(200).default(""),
        category: z.union([z.literal(""), fieldCode]).default(""),
        skillLink: z.enum(["", "linked", "unlinked"]).default(""),
      })
      .strict()
      .parse(req.query);
    const rows = await pool!.query(
      `SELECT ${columns},(SELECT f.name FROM career_fields f WHERE f.code=career_positions.category) AS "categoryName"
       FROM career_positions WHERE deleted_at IS NULL AND ($1='' OR strpos(search_text,$1)>0) AND ($2='' OR category=$2)
       AND ($3='' OR EXISTS(SELECT 1 FROM career_requirements r JOIN career_skills s ON s.id=r.skill_id
         WHERE r.career_position_id=career_positions.id AND r.deleted_at IS NULL AND s.deleted_at IS NULL)=($3='linked'))
       ORDER BY name_vi,id`,
      [fold(q.q), q.category, q.skillLink],
    );
    res.json({ items: rows.rows });
  });
  if (student) {
    router.get("/:id", async (req, res) => {
      z.object({}).strict().parse(req.query);
      const result = await pool!.query(`SELECT c.id,c.code,c.name_vi AS "nameVi",c.name_en AS "nameEn",
        c.category,f.name AS "categoryName",c.description,
        COALESCE((SELECT json_agg(json_build_object('id',r.id,'title',r.title,'description',r.description,
          'skillName',s.name,'level',r.level,'isRequired',r.is_required) ORDER BY r.is_required DESC,r.title,r.id)
          FROM career_requirements r LEFT JOIN career_skills s ON s.id=r.skill_id
          WHERE r.career_position_id=c.id AND r.deleted_at IS NULL),'[]'::json) AS requirements
        FROM career_positions c JOIN career_fields f ON f.code=c.category
        WHERE c.id=$1 AND c.deleted_at IS NULL AND f.deleted_at IS NULL`, [z.uuid().parse(req.params.id)]);
      if (!result.rowCount) throw new CareerError("career_not_found", 404);
      res.json(result.rows[0]);
    });
  }
  if (!student) {
    router.use("/requirements", createCareerRequirementsRouter(pool!));
    router.use("/skills", createCareerSkillsRouter(pool!));
    router.get("/:id", async (req, res) => {
      const row = await pool!.query(
        `SELECT ${columns},(SELECT f.name FROM career_fields f WHERE f.code=c.category) AS "categoryName",
         (SELECT count(*)::int FROM student_profiles WHERE career_position_id=c.id) AS "studentCount" FROM career_positions c WHERE id=$1 AND deleted_at IS NULL`,
        [z.uuid().parse(req.params.id)],
      );
      if (!row.rowCount) throw new CareerError("career_not_found", 404);
      res.json(row.rows[0]);
    });
    router.post("/", async (req, res) => {
      const data = careerInput.parse(req.body),
        client = await pool!.connect();
      const skills = data.skills ?? [];
      try {
        await client.query("BEGIN");
        await access(client, req.session.user!, true, false, true);
        await lockSkillCatalog(client);
        await requireField(client, data.category);
        const row = await client.query(
          `INSERT INTO career_positions(name_vi,name_en,category,description,skills,search_text) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${columns}`,
          [
            data.nameVi,
            data.nameEn,
            data.category,
            data.description,
            skills,
            fold(
              [
                data.nameVi,
                data.nameEn,
                data.description,
                ...skills,
              ].join(" "),
            ),
          ],
        );
        await syncLegacySkillLinks(client, row.rows[0].id, skills);
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
        await lockSkillCatalog(client);
        await requireField(client, data.category);
        const row = await client.query(
          `UPDATE career_positions SET name_vi=$3,name_en=$4,category=$5,description=$6,skills=COALESCE($7::text[],skills),search_text=$8,version=$9,updated_at=now() WHERE id=$1 AND version=$2 AND deleted_at IS NULL RETURNING ${columns}`,
          [
            id,
            version,
            data.nameVi,
            data.nameEn,
            data.category,
            data.description,
            data.skills ?? null,
            fold(
              [
                data.nameVi,
                data.nameEn,
                data.description,
                ...(data.skills ?? []),
              ].join(" "),
            ),
            randomUUID(),
          ],
        );
        if (!row.rowCount) throw new CareerError("career_changed", 409);
        if (data.skills) await syncLegacySkillLinks(client, id, data.skills);
        await client.query("UPDATE career_positions SET search_text=$2 WHERE id=$1", [id,
          fold([row.rows[0].code, data.nameVi, data.nameEn, data.description, ...row.rows[0].skills].join(" "))]);
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
      res.status(400).json({ error: _req.path.startsWith("/skills") ? "invalid_skill" : _req.path.startsWith("/requirements") ? "invalid_requirement" : _req.path.startsWith("/fields") ? "invalid_field" : "invalid_career" });
      return;
    }
    if (e.code === "23505") {
      res.status(409).json({ error: _req.path.startsWith("/skills") ? "skill_exists" : _req.path.startsWith("/requirements") ? "requirement_exists" : _req.path.startsWith("/fields") ? "field_exists" : "career_exists" });
      return;
    }
    next(e);
  };
  router.use(errors);
  return router;
}
