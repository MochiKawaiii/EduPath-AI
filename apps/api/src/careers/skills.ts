import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import { access, CareerError, fold, lockSkillCatalog } from "./shared.js";
import { refreshCareerSkills } from "./requirements.js";

const input = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000),
}).strict();
const columns = `id,name,description,version`;
const usage = `(SELECT count(DISTINCT r.career_position_id)::int FROM career_requirements r
 JOIN career_positions c ON c.id=r.career_position_id
 WHERE r.skill_id=s.id AND r.deleted_at IS NULL AND c.deleted_at IS NULL) AS "careerCount"`;

export function createCareerSkillsRouter(pool: DatabasePool) {
  const router = Router();
  router.get("/", async (req, res) => {
    const { q } = z.object({ q: z.string().trim().max(200).default("") }).strict().parse(req.query);
    const result = await pool.query(`SELECT ${columns},${usage} FROM career_skills s
 WHERE s.deleted_at IS NULL ORDER BY s.name,s.id`);
    const term = fold(q);
    res.json({ items: result.rows.filter(skill => fold(`${skill.name} ${skill.description}`).includes(term)) });
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
        if (method === "post") {
          const result = await client.query(`INSERT INTO career_skills(id,name,description)
 VALUES($1,$2,$3) RETURNING ${columns}`, [id, data!.name, data!.description]);
          await client.query("COMMIT");
          res.status(201).json({ ...result.rows[0], careerCount: 0 });
          return;
        }
        const current = await client.query<{ name: string }>(`SELECT name FROM career_skills
 WHERE id=$1 AND version=$2 AND deleted_at IS NULL FOR UPDATE`, [id, version]);
        if (!current.rowCount) throw new CareerError("skill_changed", 409);
        const linked = await client.query<{ id: string }>(`SELECT c.id FROM career_positions c
 WHERE c.deleted_at IS NULL AND EXISTS(SELECT 1 FROM career_requirements r
 WHERE r.career_position_id=c.id AND r.skill_id=$1 AND r.deleted_at IS NULL)
 ORDER BY c.id FOR UPDATE`, [id]);
        if (method === "delete") {
          if (linked.rowCount) throw new CareerError("skill_in_use", 409);
          await client.query("UPDATE career_skills SET deleted_at=now(),updated_at=now(),version=$2 WHERE id=$1", [id, randomUUID()]);
        } else {
          await client.query("UPDATE career_skills SET name=$2,description=$3,version=$4,updated_at=now() WHERE id=$1",
            [id, data!.name, data!.description, randomUUID()]);
          if (current.rows[0]!.name !== data!.name) {
            // Keep custom titles and proficiency/priority metadata; rename titles that only repeat the skill name.
            await client.query(`UPDATE career_requirements SET
 title=CASE WHEN title=$2 THEN $3 ELSE title END,version=$4,updated_at=now()
 WHERE skill_id=$1 AND deleted_at IS NULL`, [id, current.rows[0]!.name, data!.name, randomUUID()]);
            for (const career of linked.rows) await refreshCareerSkills(client, career.id);
          }
        }
        const result = data ? await client.query(`SELECT ${columns},${usage} FROM career_skills s WHERE id=$1`, [id]) : null;
        await client.query("COMMIT");
        res.json(result ? result.rows[0] : { deleted: true });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });
  }
  return router;
}
