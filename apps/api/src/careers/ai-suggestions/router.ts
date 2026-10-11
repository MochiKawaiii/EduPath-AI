// Admin API for AI skill suggestions, mounted by the admin careers router at
// /requirements/ai-suggestions (before /requirements so /requirements/:id cannot capture it).
// The careers router has already checked the admin session, the role and the Origin of writes.
// Nothing is linked until the admin applies a reviewed list; the AI result itself is never edited.
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../../db/pool.js";
import { WORKER_ONLINE_SECONDS } from "../../competency-assessment/ai/queue.js";
import { CAREER_SKILL_SUGGESTION_KIND } from "../../competency-assessment/ai/worker-protocol.js";
import { lockCareers, refreshCareerSkills, skillFor } from "../requirements.js";
import { access, CareerError, fold, lockSkillCatalog } from "../shared.js";
import { createCareerSuggestionExpiry, enqueueCareerSuggestion } from "./jobs.js";
import { similarSkillNames } from "./similarity.js";
import type { StoredSuggestionItem, StoredSuggestionResult } from "./validate.js";

/** /latest only returns suggestions created within this many days. */
export const RECENT_SUGGESTION_DAYS = 7;

type Db = DatabasePool | PoolClient;
type SuggestionRow = {
  id: string;
  careerPositionId: string;
  status: string;
  errorCode: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt: Date | string | null;
  appliedAt: Date | string | null;
  model: string | null;
  promptVersion: string | null;
  result: StoredSuggestionResult | null;
};

const columns = `id,career_position_id AS "careerPositionId",status,error_code AS "errorCode",created_at AS "createdAt",
 updated_at AS "updatedAt",completed_at AS "completedAt",applied_at AS "appliedAt",ai_model AS model,
 prompt_version AS "promptVersion",result`;
/** Typed names are compared and stored with single spaces, so "Lập  trình" cannot add a near-duplicate. */
const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
const applyItem = z.object({
  skillId: z.uuid().nullable(),
  skillName: z.string().transform(collapse).pipe(z.string().max(100)),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000),
  isRequired: z.boolean(),
  sourceIndex: z.number().int().min(0).max(1000).nullable()
}).strict().refine((item) => item.skillId !== null || item.skillName.length > 0);
const applyBody = z.object({ items: z.array(applyItem).min(1).max(20) }).strict();

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());

/**
 * API shape; items carry the current catalog name, whether the skill is linked by now and, if not,
 * the first linked skill whose name looks like it (a hint for the admin, never an exclusion).
 */
async function present(db: Db, row: SuggestionRow) {
  const { result, ...rest } = row;
  const base = {
    ...rest,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    completedAt: iso(row.completedAt),
    appliedAt: iso(row.appliedAt)
  };
  const stored: StoredSuggestionItem[] = row.status === "completed" && Array.isArray(result?.items) ? result.items : [];
  if (!stored.length) return { ...base, items: [] };
  const ids = [...new Set(stored.map((item) => item.skillId).filter((id): id is string => Boolean(id)))];
  const linked = await db.query<{ id: string; name: string }>(`SELECT s.id,s.name FROM career_requirements r JOIN career_skills s ON s.id=r.skill_id
    WHERE r.career_position_id=$1 AND r.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.name,s.id`, [row.careerPositionId]);
  const current = ids.length
    ? await db.query<{ id: string; name: string }>("SELECT id,name FROM career_skills WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL", [ids])
    : { rows: [] };
  const names = new Map(current.rows.map((skill) => [skill.id, skill.name]));
  const linkedIds = new Set(linked.rows.map((skill) => skill.id));
  const linkedNames = new Set(linked.rows.map((skill) => fold(collapse(skill.name))));
  const items = stored.flatMap((item, index) => {
    // A catalog skill deleted since the suggestion was made is no longer offered.
    if (item.skillId && !names.has(item.skillId)) return [];
    const skillName = item.skillId ? names.get(item.skillId)! : item.skillName;
    const alreadyLinked = item.skillId ? linkedIds.has(item.skillId) : linkedNames.has(fold(collapse(skillName)));
    return [{
      index,
      skillId: item.skillId,
      skillName,
      isNewSkill: item.isNewSkill,
      alreadyLinked,
      similarLinkedSkill: alreadyLinked ? null : linked.rows.find((skill) => similarSkillNames(skillName, skill.name))?.name ?? null,
      isRequired: item.isRequired,
      title: item.title,
      description: item.description,
      reason: item.reason
    }];
  });
  return { ...base, items };
}

async function readSuggestion(db: Db, id: string) {
  const found = await db.query<SuggestionRow>(`SELECT ${columns} FROM career_ai_suggestions WHERE id=$1`, [id]);
  const row = found.rows[0];
  if (!row) throw new CareerError("suggestion_not_found", 404);
  return present(db, row);
}

export function createCareerAiSuggestionsRouter(pool: DatabasePool, options: { enabled: boolean }) {
  const router = Router();
  const enabled = options.enabled;
  // Stuck jobs also expire while the worker is offline; a failed expiry never breaks a read.
  const expire = createCareerSuggestionExpiry();
  const expireQuietly = () => expire(pool).catch(() => false);

  router.get("/status", async (req, res) => {
    z.object({}).strict().parse(req.query);
    if (!enabled) {
      res.json({ enabled: false, worker: { online: false, supportsSuggestions: false, seenAt: null } });
      return;
    }
    const status = await pool.query<{ seenAt: Date | string; online: boolean; kinds: string[] | null }>(
      `SELECT seen_at AS "seenAt",seen_at>now()-make_interval(secs => $1) AS online,kinds FROM stu_comp_ai_worker_status WHERE id=1`,
      [WORKER_ONLINE_SECONDS]);
    await expireQuietly();
    const row = status.rows[0];
    const online = row?.online === true;
    res.json({ enabled: true, worker: {
      online,
      supportsSuggestions: online && (row?.kinds ?? []).includes(CAREER_SKILL_SUGGESTION_KIND),
      seenAt: row ? iso(row.seenAt) : null
    } });
  });

  router.get("/latest", async (req, res) => {
    const query = z.object({ careerPositionId: z.uuid() }).strict().parse(req.query);
    await expireQuietly();
    const found = await pool.query<SuggestionRow>(`SELECT ${columns} FROM career_ai_suggestions
      WHERE career_position_id=$1 AND created_at>now()-make_interval(days => $2) AND status<>'cancelled' AND applied_at IS NULL
      ORDER BY created_at DESC,id DESC LIMIT 1`, [query.careerPositionId, RECENT_SUGGESTION_DAYS]);
    const row = found.rows[0];
    res.json({ suggestion: row ? await present(pool, row) : null });
  });

  router.post("/", async (req, res) => {
    const data = z.object({ careerPositionId: z.uuid() }).strict().parse(req.body);
    if (!enabled) throw new CareerError("ai_disabled", 503);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await access(client, req.session.user!, true, false, true);
      await expire(client);
      const queued = await enqueueCareerSuggestion(client, { careerPositionId: data.careerPositionId, requestedBy: req.session.user!.userId });
      const suggestion = await readSuggestion(client, queued.id);
      await client.query("COMMIT");
      res.status(queued.created ? 201 : 200).json({ suggestion });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  router.get("/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    await expireQuietly();
    res.json({ suggestion: await readSuggestion(pool, id) });
  });

  router.post("/:id/cancel", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    z.object({}).strict().parse(req.body ?? {});
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await access(client, req.session.user!, true, false, true);
      const cancelled = await client.query(`UPDATE career_ai_suggestions SET status='cancelled',ai_input=NULL,lease_token=NULL,lease_until=NULL,
        updated_at=now() WHERE id=$1 AND status IN ('queued','processing')`, [id]);
      if (!cancelled.rowCount) {
        const exists = await client.query("SELECT 1 FROM career_ai_suggestions WHERE id=$1", [id]);
        throw new CareerError(exists.rowCount ? "suggestion_not_active" : "suggestion_not_found", exists.rowCount ? 409 : 404);
      }
      const suggestion = await readSuggestion(client, id);
      await client.query("COMMIT");
      res.json({ suggestion });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  router.post("/:id/apply", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { items } = applyBody.parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await access(client, req.session.user!, true, false, true);
      // Same locks and order as a manual requirement write.
      await lockSkillCatalog(client);
      const found = await client.query<{ careerPositionId: string; status: string; appliedAt: Date | null; result: StoredSuggestionResult | null }>(
        `SELECT career_position_id AS "careerPositionId",status,applied_at AS "appliedAt",result FROM career_ai_suggestions WHERE id=$1 FOR UPDATE`, [id]);
      const suggestion = found.rows[0];
      if (!suggestion) throw new CareerError("suggestion_not_found", 404);
      if (suggestion.appliedAt) throw new CareerError("suggestion_already_applied", 409);
      if (suggestion.status !== "completed") throw new CareerError("suggestion_not_completed", 409);
      const careerId = suggestion.careerPositionId;
      await lockCareers(client, [careerId]);

      const catalog = await client.query<{ id: string; name: string }>("SELECT id,name FROM career_skills WHERE deleted_at IS NULL");
      const byId = new Map(catalog.rows.map((skill) => [skill.id, skill]));
      const byName = new Map(catalog.rows.map((skill) => [fold(collapse(skill.name)), skill]));
      const linked = await client.query<{ skillId: string }>(
        `SELECT skill_id AS "skillId" FROM career_requirements WHERE career_position_id=$1 AND deleted_at IS NULL AND skill_id IS NOT NULL`, [careerId]);
      const linkedIds = new Set(linked.rows.map((row) => row.skillId));
      // A new name (whitespace already collapsed) that exists in the catalog, ignoring case and accents, uses that skill.
      const rows = items.map((item) => {
        if (item.skillId) {
          const skill = byId.get(item.skillId);
          if (!skill) throw new CareerError("skill_not_found", 404);
          return { item, skill, name: skill.name };
        }
        const skill = byName.get(fold(item.skillName)) ?? null;
        return { item, skill, name: skill?.name ?? item.skillName };
      });
      const conflicts = new Set<string>();
      const seen = new Set<string>();
      for (const row of rows) {
        const key = row.skill ? row.skill.id : `new:${fold(row.name)}`;
        if ((row.skill && linkedIds.has(row.skill.id)) || seen.has(key)) conflicts.add(row.name);
        seen.add(key);
      }
      if (conflicts.size) throw new CareerError("requirement_exists", 409, { skills: [...conflicts] });

      const stored = suggestion.result?.items ?? [];
      let newSkills = 0;
      let edited = 0;
      for (const { item, skill, name } of rows) {
        const skillId = await skillFor(client, skill ? { skillId: skill.id, skillName: "" } : { skillId: null, skillName: name });
        if (!skill) newSkills += 1;
        await client.query(`INSERT INTO career_requirements(id,career_position_id,skill_id,title,description,is_required)
          VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(), careerId, skillId, item.title, item.description, item.isRequired]);
        const source = item.sourceIndex === null ? undefined : stored[item.sourceIndex];
        const sameSkill = source && (source.skillId ? source.skillId === skillId : fold(collapse(source.skillName)) === fold(collapse(name)));
        if (!source || !sameSkill || source.title.trim() !== item.title || source.description.trim() !== item.description
          || source.isRequired !== item.isRequired) edited += 1;
      }
      await refreshCareerSkills(client, careerId);
      const summary = { suggested: stored.length, saved: items.length, edited, newSkills };
      await client.query("UPDATE career_ai_suggestions SET applied_at=now(),applied_by=$2,applied_summary=$3::jsonb,updated_at=now() WHERE id=$1",
        [id, req.session.user!.userId, JSON.stringify(summary)]);
      const result = await readSuggestion(client, id);
      await client.query("COMMIT");
      res.status(201).json({ created: items.length, suggestion: result });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  // Nothing under /requirements/ai-suggestions falls through to /requirements/:id.
  router.use((_req, res) => { res.status(404).json({ error: "not_found" }); });
  return router;
}
