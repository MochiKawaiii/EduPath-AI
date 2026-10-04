import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { access, CareerError, fold, lockSkillCatalog } from "./shared.js";

const levels = ["unspecified", "basic", "intermediate", "advanced"] as const;
const input = z.object({
  careerPositionId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000),
  skillId: z.uuid().nullable(),
  skillName: z.string().trim().max(100).default(""),
  level: z.enum(levels),
  isRequired: z.boolean(),
}).strict().refine(value => !(value.skillId && value.skillName));
const columns = `r.id,r.career_position_id AS "careerPositionId",r.skill_id AS "skillId",
 r.title,r.description,r.level,r.is_required AS "isRequired",r.version,
 c.name_vi AS "careerName",c.name_en AS "careerNameEn",c.category,
 f.name AS "categoryName",s.name AS "skillName"`;
const from = `FROM career_requirements r JOIN career_positions c ON c.id=r.career_position_id
 JOIN career_fields f ON f.code=c.category LEFT JOIN career_skills s ON s.id=r.skill_id`;

async function lockCareers(client: PoolClient, ids: string[]) {
  const unique = [...new Set(ids)].sort();
  const found = await client.query("SELECT id FROM career_positions WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE", [unique]);
  if (found.rowCount !== unique.length) throw new CareerError("career_not_found", 404);
}
async function skillFor(client: PoolClient, data: { skillId: string | null; skillName: string }) {
  if (data.skillId) {
    const found = await client.query("SELECT id FROM career_skills WHERE id=$1 AND deleted_at IS NULL FOR SHARE", [data.skillId]);
    if (!found.rowCount) throw new CareerError("skill_not_found", 404);
    return data.skillId;
  }
  if (!data.skillName) return null;
  const skill = await client.query<{ id: string }>(`INSERT INTO career_skills(name) VALUES($1)
    ON CONFLICT ((lower(name))) WHERE deleted_at IS NULL DO UPDATE SET name=career_skills.name RETURNING id`, [data.skillName]);
  return skill.rows[0]!.id;
}
export async function refreshCareerSkills(client: PoolClient, id: string) {
  const career = await client.query<{ code: string; name_vi: string; name_en: string; description: string }>(
    "SELECT code,name_vi,name_en,description FROM career_positions WHERE id=$1", [id]);
  const skills = await client.query<{ name: string }>(`SELECT s.name FROM career_requirements r JOIN career_skills s ON s.id=r.skill_id
    WHERE r.career_position_id=$1 AND r.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.name,s.id`, [id]);
  const row = career.rows[0]!;
  const names = skills.rows.map(skill => skill.name);
  await client.query("UPDATE career_positions SET skills=$2,search_text=$3,version=$4,updated_at=now() WHERE id=$1",
    [id, names, fold([row.code, row.name_vi, row.name_en, row.description, ...names].join(" ")), randomUUID()]);
}

/** Legacy API compatibility; the current UI manages links through requirements only. Retained links keep their metadata. */
export async function syncLegacySkillLinks(client: PoolClient, id: string, names: string[]) {
  const wanted = [...new Map(names.map(name => [name.toLowerCase(), name])).values()]
    .sort((left, right) => left.toLowerCase() < right.toLowerCase() ? -1 : 1);
  await client.query(`UPDATE career_requirements r SET deleted_at=now(),updated_at=now(),version=$3
    FROM career_skills s WHERE r.skill_id=s.id AND r.career_position_id=$1 AND r.deleted_at IS NULL
    AND NOT (lower(s.name)=ANY($2::text[]))`, [id, wanted.map(name => name.toLowerCase()), randomUUID()]);
  for (const name of wanted) {
    const skillId = await skillFor(client, { skillId: null, skillName: name });
    await client.query(`INSERT INTO career_requirements(career_position_id,skill_id,title) VALUES($1,$2,$3)
      ON CONFLICT (career_position_id,skill_id) WHERE deleted_at IS NULL AND skill_id IS NOT NULL DO NOTHING`, [id, skillId, name]);
  }
}

export function createCareerRequirementsRouter(pool: DatabasePool) {
  const router = Router();
  router.get("/skills", async (req, res) => {
    z.object({}).strict().parse(req.query);
    const skills = await pool.query("SELECT id,name FROM career_skills WHERE deleted_at IS NULL ORDER BY name,id");
    res.json({ items: skills.rows });
  });
  router.get("/", async (req, res) => {
    const query = z.object({
      q: z.string().trim().max(200).default(""),
      careerPositionId: z.union([z.literal(""), z.uuid()]).default(""),
      category: z.string().trim().max(60).regex(/^$|^[a-z0-9]+(?:[-_][a-z0-9]+)*$/).default(""),
      skillId: z.union([z.literal(""), z.uuid()]).default(""),
      level: z.union([z.literal(""), z.enum(levels)]).default(""),
      kind: z.enum(["", "skill", "other"]).default(""),
      priority: z.enum(["", "required", "preferred"]).default(""),
    }).strict().parse(req.query);
    const result = await pool.query(`SELECT ${columns} ${from}
      WHERE r.deleted_at IS NULL AND c.deleted_at IS NULL AND f.deleted_at IS NULL
      AND ($1='' OR r.career_position_id=NULLIF($1,'')::uuid) AND ($2='' OR c.category=$2)
      AND ($3='' OR r.skill_id=NULLIF($3,'')::uuid) AND ($4='' OR r.level=$4)
      AND ($5='' OR ($5='skill' AND r.skill_id IS NOT NULL) OR ($5='other' AND r.skill_id IS NULL))
      AND ($6='' OR r.is_required=($6='required')) ORDER BY c.name_vi,r.title,r.id`,
      [query.careerPositionId, query.category, query.skillId, query.level, query.kind, query.priority]);
    const term = fold(query.q);
    res.json({ items: result.rows.filter(row => fold([row.title, row.description, row.skillName ?? "", row.careerName, row.careerNameEn, row.categoryName].join(" ")).includes(term)) });
  });
  router.get("/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const result = await pool.query(`SELECT ${columns} ${from} WHERE r.id=$1 AND r.deleted_at IS NULL AND c.deleted_at IS NULL`, [id]);
    if (!result.rowCount) throw new CareerError("requirement_not_found", 404);
    res.json(result.rows[0]);
  });
  for (const method of ["post", "patch", "delete"] as const) {
    router[method](method === "post" ? "/" : "/:id", async (req, res) => {
      const id = method === "post" ? randomUUID() : z.object({ id: z.uuid() }).parse(req.params).id;
      const version = method === "post" ? null : z.uuid().parse(req.get("x-version"));
      const data = method === "delete" ? null : input.parse(req.body);
      if (method === "delete") z.object({ confirmed: z.literal(true) }).strict().parse(req.body);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await access(client, req.session.user!, true, false, true);
        await lockSkillCatalog(client);
        const existing = method === "post" ? null : (await client.query<{ career_position_id: string }>(
          "SELECT career_position_id FROM career_requirements WHERE id=$1 AND version=$2 AND deleted_at IS NULL", [id, version])).rows[0];
        if (method !== "post" && !existing) throw new CareerError("requirement_changed", 409);
        const careers = [...new Set([existing?.career_position_id, data?.careerPositionId].filter((value): value is string => Boolean(value)))];
        await lockCareers(client, careers);
        if (data) {
          const skillId = await skillFor(client, data);
          if (method === "post") {
            await client.query(`INSERT INTO career_requirements(id,career_position_id,skill_id,title,description,level,is_required)
              VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, data.careerPositionId, skillId, data.title, data.description, data.level, data.isRequired]);
          } else {
            const changed = await client.query(`UPDATE career_requirements SET career_position_id=$3,skill_id=$4,title=$5,description=$6,
              level=$7,is_required=$8,version=$9,updated_at=now() WHERE id=$1 AND version=$2 AND deleted_at IS NULL`,
              [id, version, data.careerPositionId, skillId, data.title, data.description, data.level, data.isRequired, randomUUID()]);
            if (!changed.rowCount) throw new CareerError("requirement_changed", 409);
          }
        } else {
          const changed = await client.query("UPDATE career_requirements SET deleted_at=now(),version=$3,updated_at=now() WHERE id=$1 AND version=$2 AND deleted_at IS NULL", [id, version, randomUUID()]);
          if (!changed.rowCount) throw new CareerError("requirement_changed", 409);
        }
        for (const careerId of careers) await refreshCareerSkills(client, careerId);
        const result = data ? await client.query(`SELECT ${columns} ${from} WHERE r.id=$1`, [id]) : null;
        await client.query("COMMIT");
        res.status(method === "post" ? 201 : 200).json(result ? result.rows[0] : { deleted: true });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });
  }
  return router;
}
