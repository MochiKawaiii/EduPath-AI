// Admin API for the AI proposals of the Năng lực courses, mounted by the competencies router at
// /ai (after its admin session, role and Origin checks). Nothing is linked or weighted until an admin
// applies a proposal; the stored AI result itself is never edited.
//   POST /                       one course: links ("Tạo liên kết kỹ năng (AI)") or weights ("Thêm trọng số (AI)")
//   POST /batches                whole program: one "full" proposal per course that has no link yet
//   POST /batches/:id/apply      saves every finished proposal of a run as drafts, or applies them
import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { AuthenticatedUser } from "../../auth/types.js";
import type { DatabasePool } from "../../db/pool.js";
import { WORKER_ONLINE_SECONDS } from "../../competency-assessment/ai/queue.js";
import { COMPETENCY_COURSE_SUGGESTION_KIND } from "../../competency-assessment/ai/worker-protocol.js";
import { courseCode } from "../../curricula/course-codes.js";
import { CompetencyError } from "../model.js";
import type { CompetencyRepository } from "../repository.js";
import { createCourseSuggestionExpiry, enqueueCourseBatch, enqueueCourseSuggestion } from "./jobs.js";
import { normalizePercents, type StoredCourseAiItem, type StoredCourseAiResult } from "./validate.js";
import type { CourseAiMode } from "./prompt.js";

/** /latest only returns proposals created within this many days. */
export const RECENT_SUGGESTION_DAYS = 7;

type Db = DatabasePool | PoolClient;
type SuggestionRow = {
  id: string;
  revisionId: string;
  /** NULL only on proposals of the removed "Thêm kỹ năng (AI)" (mode 'skills', migrations 035/036). */
  courseCode: string | null;
  mode: CourseAiMode;
  batchId: string | null;
  status: string;
  errorCode: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt: Date | string | null;
  appliedAt: Date | string | null;
  model: string | null;
  promptVersion: string | null;
  result: StoredCourseAiResult | null;
};

const columns = `id,revision_id AS "revisionId",course_code AS "courseCode",mode,batch_id AS "batchId",status,error_code AS "errorCode",
 created_at AS "createdAt",updated_at AS "updatedAt",completed_at AS "completedAt",applied_at AS "appliedAt",ai_model AS model,
 prompt_version AS "promptVersion",result`;
const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());
const uuid = z.uuid();
const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
const linksBody = z.object({
  items: z.array(z.object({
    skillId: uuid.nullable(),
    skillName: z.string().transform(collapse).pipe(z.string().max(100)),
    groupId: uuid.nullable()
  }).strict().refine((item) => item.skillId !== null || item.skillName.length > 0)).min(1).max(12)
}).strict();
const weightsBody = z.object({
  weights: z.array(z.object({ skillId: uuid, percent: z.number().min(0).max(100) }).strict()).min(1).max(200),
  status: z.enum(["draft", "active"])
}).strict();
const statusBody = z.object({ status: z.enum(["draft", "active"]) }).strict();

/** Current links of a course, by skill id. */
async function linkedSkillIds(db: Db, revisionId: string, code: string) {
  const result = await db.query<{ skillId: string }>(`SELECT l.skill_id AS "skillId" FROM ad_comp_course_configs c
    JOIN ad_comp_course_links l ON l.config_id=c.id WHERE c.revision_id=$1 AND c.course_code=$2`, [revisionId, code]);
  return new Set(result.rows.map((row) => row.skillId));
}

/**
 * API shape: items carry current names and groups, whether the skill has a profile and is linked by
 * now; a weights proposal is "stale" when the course's links changed since it was made.
 */
async function present(db: Db, row: SuggestionRow) {
  const { result, ...rest } = row;
  const base = { ...rest, createdAt: iso(row.createdAt)!, updatedAt: iso(row.updatedAt)!, completedAt: iso(row.completedAt), appliedAt: iso(row.appliedAt) };
  const stored: StoredCourseAiItem[] = row.status === "completed" && Array.isArray(result?.items) ? result.items : [];
  if (!stored.length) return { ...base, items: [], stale: false };
  const ids = [...new Set(stored.map((item) => item.skillId).filter((id): id is string => Boolean(id)))];
  const skills = ids.length ? await db.query<{ id: string; name: string; profileGroupId: string | null }>(
    `SELECT s.id,s.name,CASE WHEN cs.deleted_at IS NULL THEN cs.group_id END AS "profileGroupId"
      FROM career_skills s LEFT JOIN ad_comp_skills cs ON cs.skill_id=s.id WHERE s.id=ANY($1::uuid[]) AND s.deleted_at IS NULL`, [ids]) : { rows: [] };
  const groups = await db.query<{ id: string; name: string }>("SELECT id,name FROM ad_comp_groups WHERE deleted_at IS NULL AND is_active");
  const current = new Map(skills.rows.map((skill) => [skill.id, skill]));
  const groupNames = new Map(groups.rows.map((group) => [group.id, group.name]));
  const linked = row.courseCode === null ? new Set<string>() : await linkedSkillIds(db, row.revisionId, row.courseCode);
  const items = stored.flatMap((item, index) => {
    // A catalog skill deleted since the proposal was made is no longer offered.
    const skill = item.skillId ? current.get(item.skillId) : undefined;
    if (item.skillId && !skill) return [];
    const groupId = skill?.profileGroupId ?? (item.groupId && groupNames.has(item.groupId) ? item.groupId : null);
    return [{
      index,
      skillId: item.skillId,
      skillName: skill?.name ?? item.skillName,
      groupId,
      groupName: groupId ? groupNames.get(groupId) ?? null : null,
      hasProfile: Boolean(skill?.profileGroupId),
      isNewSkill: item.isNewSkill,
      alreadyLinked: item.skillId ? linked.has(item.skillId) : false,
      percent: item.percent,
      reason: item.reason
    }];
  });
  const stale = row.mode === "weights" && (items.length !== linked.size || items.some((item) => !item.skillId || !linked.has(item.skillId)));
  return { ...base, items, stale };
}

async function readSuggestion(db: Db, id: string) {
  const found = await db.query<SuggestionRow>(`SELECT ${columns} FROM ad_comp_ai_suggestions WHERE id=$1`, [id]);
  const row = found.rows[0];
  if (!row) throw new CompetencyError("suggestion_not_found", 404);
  return present(db, row);
}

/** Progress of a whole-program run. */
async function readBatch(db: Db, batchId: string) {
  const rows = await db.query<{ id: string; courseCode: string | null; status: string; errorCode: string | null; appliedAt: Date | null; createdAt: Date; itemCount: number }>(
    `SELECT id,course_code AS "courseCode",status,error_code AS "errorCode",applied_at AS "appliedAt",created_at AS "createdAt",
      COALESCE(jsonb_array_length(result->'items'),0)::int AS "itemCount"
      FROM ad_comp_ai_suggestions WHERE batch_id=$1 ORDER BY course_code,id`, [batchId]);
  if (!rows.rowCount) throw new CompetencyError("batch_not_found", 404);
  const count = (status: string) => rows.rows.filter((row) => row.status === status).length;
  const first = rows.rows.reduce((min, row) => (new Date(row.createdAt) < new Date(min.createdAt) ? row : min), rows.rows[0]!);
  return {
    id: batchId,
    createdAt: iso(first.createdAt)!,
    total: rows.rowCount ?? 0,
    queued: count("queued"),
    processing: count("processing"),
    completed: count("completed"),
    failed: count("failed"),
    cancelled: count("cancelled"),
    applied: rows.rows.filter((row) => row.appliedAt).length,
    /** Finished, not yet saved, with at least one proposed skill. */
    ready: rows.rows.filter((row) => row.status === "completed" && !row.appliedAt && row.itemCount > 0).length,
    items: rows.rows.map((row) => ({ id: row.id, courseCode: row.courseCode, status: row.status, errorCode: row.errorCode, applied: Boolean(row.appliedAt), itemCount: row.itemCount }))
  };
}

type Skipped = { courseCode: string | null; reason: string };

export function createCompetencyAiRouter(pool: DatabasePool, repository: CompetencyRepository, options: { enabled: boolean }) {
  const router = Router();
  const enabled = options.enabled;
  // Stuck jobs also expire while the worker is offline; a failed expiry never breaks a read.
  const expire = createCourseSuggestionExpiry();
  const expireQuietly = () => expire(pool).catch(() => false);
  const actorOf = (user: AuthenticatedUser | undefined) => user!;

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
      supportsSuggestions: online && (row?.kinds ?? []).includes(COMPETENCY_COURSE_SUGGESTION_KIND),
      seenAt: row ? iso(row.seenAt) : null
    } });
  });

  router.get("/latest", async (req, res) => {
    const query = z.object({ revisionId: uuid, code: courseCode, mode: z.enum(["links", "weights"]) }).strict().parse(req.query);
    await expireQuietly();
    const found = await pool.query<SuggestionRow>(`SELECT ${columns} FROM ad_comp_ai_suggestions
      WHERE revision_id=$1 AND course_code=$2 AND mode=$3 AND created_at>now()-make_interval(days => $4) AND status<>'cancelled' AND applied_at IS NULL
      ORDER BY created_at DESC,id DESC LIMIT 1`, [query.revisionId, query.code, query.mode, RECENT_SUGGESTION_DAYS]);
    const row = found.rows[0];
    res.json({ suggestion: row ? await present(pool, row) : null });
  });

  router.post("/", async (req, res) => {
    const data = z.object({ revisionId: uuid, code: courseCode, mode: z.enum(["links", "weights"]) }).strict().parse(req.body);
    if (!enabled) throw new CompetencyError("ai_disabled", 503);
    const { queued, suggestion } = await repository.transaction(actorOf(req.session.user), async (client) => {
      await expire(client);
      const queued = await enqueueCourseSuggestion(client, { ...data, requestedBy: req.session.user!.userId });
      return { queued, suggestion: await readSuggestion(client, queued.id) };
    });
    res.status(queued.created ? 201 : 200).json({ suggestion });
  });

  /* ------------------------------------------------------- whole program */

  router.get("/batches/latest", async (req, res) => {
    const query = z.object({ revisionId: uuid }).strict().parse(req.query);
    await expireQuietly();
    const found = await pool.query<{ batchId: string }>(`SELECT batch_id AS "batchId" FROM ad_comp_ai_suggestions
      WHERE revision_id=$1 AND batch_id IS NOT NULL GROUP BY batch_id ORDER BY min(created_at) DESC,batch_id DESC LIMIT 1`, [query.revisionId]);
    const batchId = found.rows[0]?.batchId;
    res.json({ batch: batchId ? await readBatch(pool, batchId) : null });
  });

  router.post("/batches", async (req, res) => {
    const data = z.object({ revisionId: uuid }).strict().parse(req.body);
    if (!enabled) throw new CompetencyError("ai_disabled", 503);
    const result = await repository.transaction(actorOf(req.session.user), async (client) => {
      await expire(client);
      const queued = await enqueueCourseBatch(client, { revisionId: data.revisionId, requestedBy: req.session.user!.userId });
      return { ...queued, batch: queued.batchId ? await readBatch(client, queued.batchId) : null };
    });
    res.status(result.queued ? 201 : 200).json(result);
  });

  router.post("/batches/:batchId/cancel", async (req, res) => {
    const batchId = uuid.parse(req.params.batchId);
    z.object({}).strict().parse(req.body ?? {});
    const batch = await repository.transaction(actorOf(req.session.user), async (client) => {
      await client.query(`UPDATE ad_comp_ai_suggestions SET status='cancelled',ai_input=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
        WHERE batch_id=$1 AND status IN ('queued','processing')`, [batchId]);
      return readBatch(client, batchId);
    });
    res.json({ batch });
  });

  /**
   * Saves every finished, unsaved proposal of a run, course by course (one savepoint each), as drafts
   * or applied. A course that got links meanwhile, or that fails a check, is skipped with its reason;
   * skills that are no longer usable are dropped and the rest re-scaled to 100%.
   */
  router.post("/batches/:batchId/apply", async (req, res) => {
    const batchId = uuid.parse(req.params.batchId);
    const { status } = statusBody.parse(req.body);
    const actor = actorOf(req.session.user);
    const outcome = await repository.transaction(actor, async (client) => {
      const found = await client.query<SuggestionRow>(`SELECT ${columns} FROM ad_comp_ai_suggestions
        WHERE batch_id=$1 AND status='completed' AND applied_at IS NULL AND mode='full' ORDER BY course_code,id FOR UPDATE`, [batchId]);
      if (!found.rowCount) {
        const exists = await client.query("SELECT 1 FROM ad_comp_ai_suggestions WHERE batch_id=$1 LIMIT 1", [batchId]);
        if (!exists.rowCount) throw new CompetencyError("batch_not_found", 404);
      }
      let activated = 0, drafted = 0, empty = 0;
      const skipped: Skipped[] = [];
      for (const row of found.rows) {
        await client.query("SAVEPOINT course_ai");
        try {
          const saved = await applyFull(client, repository, row, status, actor);
          if (saved === "empty") empty += 1; else if (saved === "active") activated += 1; else drafted += 1;
          // Deferred weight checks run now, so one bad course never fails the others at commit.
          await client.query("SET CONSTRAINTS ALL IMMEDIATE");
          await client.query("SET CONSTRAINTS ALL DEFERRED");
          await client.query("RELEASE SAVEPOINT course_ai");
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT course_ai");
          skipped.push({ courseCode: row.courseCode, reason: error instanceof CompetencyError ? error.code : "invalid_competency_reference" });
        }
      }
      return { activated, drafted, empty, skipped, batch: await readBatch(client, batchId) };
    });
    res.json(outcome);
  });

  /* --------------------------------------------------------- one proposal */

  router.get("/:id", async (req, res) => {
    const id = uuid.parse(req.params.id);
    await expireQuietly();
    res.json({ suggestion: await readSuggestion(pool, id) });
  });

  router.post("/:id/cancel", async (req, res) => {
    const id = uuid.parse(req.params.id);
    z.object({}).strict().parse(req.body ?? {});
    const suggestion = await repository.transaction(actorOf(req.session.user), async (client) => {
      const cancelled = await client.query(`UPDATE ad_comp_ai_suggestions SET status='cancelled',ai_input=NULL,lease_token=NULL,lease_until=NULL,
        updated_at=now() WHERE id=$1 AND status IN ('queued','processing')`, [id]);
      if (!cancelled.rowCount) {
        const exists = await client.query("SELECT 1 FROM ad_comp_ai_suggestions WHERE id=$1", [id]);
        throw new CompetencyError(exists.rowCount ? "suggestion_not_active" : "suggestion_not_found", exists.rowCount ? 409 : 404);
      }
      return readSuggestion(client, id);
    });
    res.json({ suggestion });
  });

  router.post("/:id/apply", async (req, res) => {
    const id = uuid.parse(req.params.id);
    const actor = actorOf(req.session.user);
    const result = await repository.transaction(actor, async (client) => {
      const found = await client.query<SuggestionRow>(`SELECT ${columns} FROM ad_comp_ai_suggestions WHERE id=$1 FOR UPDATE`, [id]);
      const row = found.rows[0];
      if (!row) throw new CompetencyError("suggestion_not_found", 404);
      if (row.appliedAt) throw new CompetencyError("suggestion_already_applied", 409);
      if (row.status !== "completed") throw new CompetencyError("suggestion_not_completed", 409);
      const course = row.mode === "links" ? await applyLinks(client, repository, row, linksBody.parse(req.body), actor)
        : row.mode === "weights" ? await applyWeights(client, repository, row, weightsBody.parse(req.body), actor)
          : (() => { throw new CompetencyError("suggestion_mode_mismatch", 409); })();
      return { course, suggestion: await readSuggestion(client, id) };
    });
    res.status(201).json(result);
  });

  // Nothing under /ai falls through to the other competency routes.
  router.use((_req, res) => { res.status(404).json({ error: "not_found" }); });
  return router;
}

/** The course of a links, weights or full proposal. */
function courseOf(row: SuggestionRow): string {
  if (row.courseCode === null) throw new CompetencyError("suggestion_mode_mismatch", 409);
  return row.courseCode;
}

async function markApplied(client: PoolClient, id: string, actor: AuthenticatedUser, summary: Record<string, unknown>) {
  await client.query("UPDATE ad_comp_ai_suggestions SET applied_at=now(),applied_by=$2,applied_summary=$3::jsonb,updated_at=now() WHERE id=$1",
    [id, actor.userId, JSON.stringify(summary)]);
}

/** "Tạo liên kết kỹ năng (AI)": the kept skills join the course at 0%; an applied course stays applied. */
async function applyLinks(client: PoolClient, repository: CompetencyRepository, row: SuggestionRow, body: z.infer<typeof linksBody>, actor: AuthenticatedUser) {
  const state = await repository.lockCourse(client, row.revisionId, courseOf(row));
  const linked = new Set(state.links.map((link) => link.skillId));
  const added: string[] = [];
  const conflicts: string[] = [];
  let newSkills = 0, profiles = 0;
  for (const item of body.items) {
    let skillId = item.skillId;
    let name = item.skillName;
    if (!skillId) {
      const skill = await repository.catalogSkillByName(client, item.skillName);
      skillId = skill.id; name = skill.name;
      if (skill.created) newSkills += 1;
    } else {
      const skill = await client.query<{ name: string }>("SELECT name FROM career_skills WHERE id=$1 AND deleted_at IS NULL", [skillId]);
      if (!skill.rows[0]) throw new CompetencyError("skill_not_found", 404);
      name = skill.rows[0].name;
    }
    if (linked.has(skillId) || added.includes(skillId)) { conflicts.push(name); continue; }
    const hasProfile = await client.query("SELECT 1 FROM ad_comp_skills WHERE skill_id=$1 AND deleted_at IS NULL", [skillId]);
    if (!hasProfile.rowCount) {
      if (!item.groupId) throw new CompetencyError("group_required", 400, [name]);
      if (await repository.ensureProfile(client, skillId, item.groupId, actor, "Tạo cấu hình năng lực từ đề xuất AI")) profiles += 1;
    }
    added.push(skillId);
  }
  if (conflicts.length) throw new CompetencyError("skill_already_linked", 409, conflicts);
  const status = state.config?.status === "active" ? "active" : "draft";
  const links = [...state.links, ...added.map((skillId) => ({ skillId, weight: 0 }))];
  const course = await repository.writeCourse(client, row.revisionId, courseOf(row), state.config,
    { status, links, note: state.config?.note ?? "" }, actor, `Thêm ${added.length} liên kết kỹ năng từ đề xuất AI`);
  const suggested = row.result?.items.length ?? 0;
  await markApplied(client, row.id, actor, { suggested, saved: added.length, newSkills, profiles });
  return course;
}

/** "Thêm trọng số (AI)": the reviewed percentages replace the weights of exactly the linked skills. */
async function applyWeights(client: PoolClient, repository: CompetencyRepository, row: SuggestionRow, body: z.infer<typeof weightsBody>, actor: AuthenticatedUser) {
  const state = await repository.lockCourse(client, row.revisionId, courseOf(row));
  const current = new Set(state.links.map((link) => link.skillId));
  const given = new Set(body.weights.map((item) => item.skillId));
  if (given.size !== body.weights.length) throw new CompetencyError("duplicate_skill_link", 409);
  if (current.size !== given.size || [...given].some((skillId) => !current.has(skillId))) throw new CompetencyError("links_changed", 409);
  const links = body.weights.map((item) => ({ skillId: item.skillId, weight: item.percent / 100 }));
  const course = await repository.writeCourse(client, row.revisionId, courseOf(row), state.config,
    { status: body.status, links, note: state.config?.note ?? "" }, actor,
    body.status === "active" ? "Áp dụng trọng số từ đề xuất AI" : "Lưu bản nháp trọng số từ đề xuất AI");
  const proposed = new Map((row.result?.items ?? []).map((item) => [item.skillId, item.percent]));
  const edited = body.weights.filter((item) => proposed.get(item.skillId) !== item.percent).length;
  await markApplied(client, row.id, actor, { suggested: proposed.size, saved: body.weights.length, edited, status: body.status });
  return course;
}

/**
 * One course of a whole-program run. Profiles are created for career skills in the group the model
 * chose; items that cannot be used any more are dropped and the rest re-scaled to 100%.
 */
async function applyFull(client: PoolClient, repository: CompetencyRepository, row: SuggestionRow, status: "draft" | "active", actor: AuthenticatedUser): Promise<"empty" | "active" | "draft"> {
  const state = await repository.lockCourse(client, row.revisionId, courseOf(row));
  if (state.links.length) throw new CompetencyError("course_already_linked", 409);
  const kept: { skillId: string; percent: number }[] = [];
  let profiles = 0;
  for (const item of row.result?.items ?? []) {
    if (!item.skillId || kept.some((entry) => entry.skillId === item.skillId)) continue;
    const skill = await client.query("SELECT 1 FROM career_skills WHERE id=$1 AND deleted_at IS NULL", [item.skillId]);
    if (!skill.rowCount) continue;
    const profile = await client.query<{ active: boolean }>(`SELECT (cs.is_active AND g.is_active AND g.deleted_at IS NULL) AS active
      FROM ad_comp_skills cs JOIN ad_comp_groups g ON g.id=cs.group_id WHERE cs.skill_id=$1 AND cs.deleted_at IS NULL`, [item.skillId]);
    if (profile.rows[0]) {
      if (!profile.rows[0].active) continue;
    } else {
      if (!item.groupId) continue;
      const group = await client.query("SELECT 1 FROM ad_comp_groups WHERE id=$1 AND deleted_at IS NULL AND is_active", [item.groupId]);
      if (!group.rowCount) continue;
      if (await repository.ensureProfile(client, item.skillId, item.groupId, actor, "Tạo cấu hình năng lực từ đề xuất AI cho cả chương trình")) profiles += 1;
    }
    kept.push({ skillId: item.skillId, percent: item.percent ?? 0 });
  }
  if (!kept.length) {
    await markApplied(client, row.id, actor, { suggested: row.result?.items.length ?? 0, saved: 0, status: "empty" });
    return "empty";
  }
  const percents = normalizePercents(kept.map((item) => item.percent));
  const links = kept.map((item, index) => ({ skillId: item.skillId, weight: percents[index]! / 100 }));
  await repository.writeCourse(client, row.revisionId, courseOf(row), state.config, { status, links, note: state.config?.note ?? "" }, actor,
    status === "active" ? "Áp dụng liên kết và trọng số từ AI cho cả chương trình" : "Lưu bản nháp liên kết và trọng số từ AI cho cả chương trình");
  await markApplied(client, row.id, actor, { suggested: row.result?.items.length ?? 0, saved: kept.length, profiles, status });
  return status;
}
