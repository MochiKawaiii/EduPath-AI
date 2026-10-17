// AI proposal jobs for the courses of a CTĐT revision. A row of ad_comp_ai_suggestions is queued
// inside the admin transaction and handed to the same AI worker as the other kinds
// (/api/worker/competency-assessments, kind "competency_course_suggestion"); the worker router
// calls the claim/extend/complete functions below. Rows are never deleted: they are the audit
// record of what the AI proposed and what the admin saved.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../../db/pool.js";
import type { CurriculumCourse } from "../../curricula/model.js";
import {
  AI_HOUSEKEEPING_INTERVAL_MS,
  AI_JOB_LEASE_MINUTES,
  AI_JOB_MAX_ATTEMPTS,
  type WorkerCompletion
} from "../../competency-assessment/ai/worker-protocol.js";
import { CompetencyError } from "../model.js";
import { buildCourseAiInput, type CourseAiInput, type CourseAiMode, type CourseAiSource } from "./prompt.js";
import { courseAiContextFromInput, validateCourseAiOutput, type StoredCourseAiResult } from "./validate.js";

/** At most this many queued/processing course proposals system-wide (a whole program fits). */
export const MAX_PENDING_COURSE_SUGGESTIONS = 300;
/** Serializes the pending check and the queue-size check of concurrent requests. */
export const COURSE_SUGGESTION_QUEUE_LOCK = "edupath:competency-course-ai";

type Db = Pick<DatabasePool, "query">;
const PENDING = "('queued','processing')";

/**
 * Fails stuck proposals: queued for more than 24 hours, or processing with an expired lease after
 * the last attempt (or older than 24 hours). ai_input is cleared with the failure.
 */
export async function expireCourseSuggestions(db: Db): Promise<void> {
  await db.query(`UPDATE ad_comp_ai_suggestions SET status='failed',error_code=$2,ai_input=NULL,lease_token=NULL,lease_until=NULL,
      completed_at=now(),updated_at=now()
    WHERE (status='queued' AND created_at<now()-interval '24 hours')
      OR (status='processing' AND lease_until<now() AND (attempts>=$1 OR created_at<now()-interval '24 hours'))`,
  [AI_JOB_MAX_ATTEMPTS, "worker_timeout"]);
}

/** Rate-limited expiry (at most once per interval per returned function), run from the worker and admin routers. */
export function createCourseSuggestionExpiry(intervalMs: number = AI_HOUSEKEEPING_INTERVAL_MS) {
  let last = Number.NEGATIVE_INFINITY;
  return async (db: Db): Promise<boolean> => {
    const now = Date.now();
    if (now - last < intervalMs) return false;
    last = now;
    await expireCourseSuggestions(db);
    return true;
  };
}

type RevisionRow = { cohortCode: string; name: string; version: number; courses: CurriculumCourse[] };
type SharedSource = Pick<CourseAiSource, "curriculum" | "groups" | "profiles" | "careerSkills"> & { courses: Map<string, { course: CurriculumCourse; count: number }> };

/** The revision, its courses and the catalog shared by every course of one request. */
export async function loadSharedSource(client: Db, revisionId: string): Promise<SharedSource> {
  const revision = await client.query<RevisionRow>(`SELECT c.cohort_code AS "cohortCode",COALESCE(r.data->>'name','') AS name,r.version,
    COALESCE(r.data->'courses','[]'::jsonb) AS courses FROM curriculum_revisions r JOIN curricula c ON c.id=r.curriculum_id WHERE r.id=$1`, [revisionId]);
  const row = revision.rows[0];
  if (!row) throw new CompetencyError("curriculum_revision_not_found", 404);
  const courses = new Map<string, { course: CurriculumCourse; count: number }>();
  for (const course of Array.isArray(row.courses) ? row.courses : []) {
    const previous = courses.get(course.code);
    if (previous) previous.count += 1;
    else courses.set(course.code, { course, count: 1 });
  }
  const groups = await client.query<{ id: string; name: string }>(
    "SELECT id,name FROM ad_comp_groups WHERE deleted_at IS NULL AND is_active ORDER BY name,id");
  const profiles = await client.query<{ id: string; name: string; description: string; groupId: string }>(
    `SELECT s.id,s.name,COALESCE(NULLIF(cs.scope,''),s.description) AS description,cs.group_id AS "groupId"
      FROM ad_comp_skills cs JOIN career_skills s ON s.id=cs.skill_id JOIN ad_comp_groups g ON g.id=cs.group_id
      WHERE cs.deleted_at IS NULL AND cs.is_active AND s.deleted_at IS NULL AND g.deleted_at IS NULL AND g.is_active
      ORDER BY s.name,s.id`);
  const careerSkills = await client.query<{ id: string; name: string; description: string }>(
    `SELECT s.id,s.name,s.description FROM career_skills s
      WHERE s.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM career_requirements r JOIN career_positions p ON p.id=r.career_position_id
          WHERE r.skill_id=s.id AND r.deleted_at IS NULL AND p.deleted_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM ad_comp_skills cs WHERE cs.skill_id=s.id AND cs.deleted_at IS NULL)
      ORDER BY s.name,s.id`);
  return {
    curriculum: { cohortCode: row.cohortCode, name: row.name, version: row.version },
    groups: groups.rows,
    profiles: profiles.rows,
    careerSkills: careerSkills.rows,
    courses
  };
}

/** Current links of every configured course of the revision (any status). */
export async function loadRevisionLinks(client: Db, revisionId: string) {
  const result = await client.query<{ courseCode: string; skillId: string; name: string; groupId: string; description: string; weight: number }>(
    `SELECT c.course_code AS "courseCode",l.skill_id AS "skillId",s.name,cs.group_id AS "groupId",
      COALESCE(NULLIF(cs.scope,''),s.description) AS description,l.weight::float8 AS weight
      FROM ad_comp_course_configs c JOIN ad_comp_course_links l ON l.config_id=c.id
      JOIN ad_comp_skills cs ON cs.skill_id=l.skill_id JOIN career_skills s ON s.id=l.skill_id
      WHERE c.revision_id=$1 ORDER BY c.course_code,s.name,s.id`, [revisionId]);
  const byCourse = new Map<string, CourseAiSource["links"]>();
  for (const row of result.rows) {
    const bucket = byCourse.get(row.courseCode) ?? [];
    bucket.push({ skillId: row.skillId, name: row.name, groupId: row.groupId, description: row.description, weight: row.weight });
    byCourse.set(row.courseCode, bucket);
  }
  return byCourse;
}

const hour = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** One course of the shared source: course_not_found (404) or duplicate_curriculum_course (409). */
export function courseSource(shared: SharedSource, code: string, links: CourseAiSource["links"]): CourseAiSource {
  const occurrence = shared.courses.get(code);
  if (!occurrence) throw new CompetencyError("course_not_found", 404);
  if (occurrence.count !== 1) throw new CompetencyError("duplicate_curriculum_course", 409, [code]);
  const course = occurrence.course;
  return {
    curriculum: shared.curriculum,
    groups: shared.groups,
    profiles: shared.profiles,
    careerSkills: shared.careerSkills,
    links,
    course: {
      code: course.code,
      name: course.name,
      englishName: course.englishName ?? "",
      description: course.description ?? "",
      credits: Number(course.credits) || 0,
      type: course.type ?? "",
      block: course.block ?? "",
      specialty: course.specialty ?? "",
      studyYear: course.studyYear ?? null,
      semester: course.semester ?? null,
      hours: { lecture: hour(course.hours?.lecture), practice: hour(course.hours?.practice), project: hour(course.hours?.project), internship: hour(course.hours?.internship) }
    }
  };
}

/** Why a course cannot be sent to the model in this mode (409), checked before anything is queued. */
export function assertRunnable(input: CourseAiInput) {
  if (!input.groups.length) throw new CompetencyError("no_active_groups", 409);
  if (input.mode === "weights" && !input.linked.length) throw new CompetencyError("course_has_no_links", 409);
  if (input.mode === "full" && input.linked.length) throw new CompetencyError("course_already_linked", 409);
  if (!input.skills.length) throw new CompetencyError(input.mode === "weights" ? "course_has_no_links" : "no_candidate_skills", 409);
}

async function pendingCount(client: PoolClient) {
  const count = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ad_comp_ai_suggestions WHERE status IN ${PENDING}`);
  return count.rows[0]?.count ?? 0;
}

async function insertJob(client: PoolClient, data: { revisionId: string; code: string; mode: CourseAiMode; requestedBy: string; batchId: string | null; input: CourseAiInput }) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO ad_comp_ai_suggestions(id,revision_id,course_code,mode,batch_id,requested_by,status,ai_input,prompt_version)
      VALUES($1,$2,$3,$4,$5,$6,'queued',$7::jsonb,$8)`,
    [id, data.revisionId, data.code, data.mode, data.batchId, data.requestedBy, JSON.stringify(data.input), data.input.promptVersion]);
  return id;
}

/**
 * Queues a proposal for one course, or returns the one already pending in that mode (created=false).
 * Called inside the admin write transaction; ai_queue_full (429) when the global cap is reached.
 */
export async function enqueueCourseSuggestion(
  client: PoolClient,
  input: { revisionId: string; code: string; mode: "links" | "weights"; requestedBy: string }
): Promise<{ id: string; created: boolean }> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [COURSE_SUGGESTION_QUEUE_LOCK]);
  const pending = await client.query<{ id: string }>(
    `SELECT id FROM ad_comp_ai_suggestions WHERE revision_id=$1 AND course_code=$2 AND mode=$3 AND status IN ${PENDING}`,
    [input.revisionId, input.code, input.mode]);
  if (pending.rows[0]) return { id: pending.rows[0].id, created: false };
  const shared = await loadSharedSource(client, input.revisionId);
  const links = (await loadRevisionLinks(client, input.revisionId)).get(input.code) ?? [];
  const aiInput = buildCourseAiInput(courseSource(shared, input.code, links), input.mode);
  assertRunnable(aiInput);
  if (await pendingCount(client) >= MAX_PENDING_COURSE_SUGGESTIONS) throw new CompetencyError("ai_queue_full", 429);
  const id = await insertJob(client, { ...input, batchId: null, input: aiInput });
  return { id, created: true };
}

export type BatchQueued = {
  batchId: string | null;
  queued: number;
  /** Courses left out: already linked, repeated course codes, already queued in another run. */
  skipped: { linked: number; duplicate: number; pending: number };
};

/**
 * The whole-program run: one "full" proposal for every course of the revision that has no link yet,
 * no repeated code and no pending run. Nothing is queued (batchId null) when no course qualifies.
 */
export async function enqueueCourseBatch(client: PoolClient, input: { revisionId: string; requestedBy: string }): Promise<BatchQueued> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [COURSE_SUGGESTION_QUEUE_LOCK]);
  const shared = await loadSharedSource(client, input.revisionId);
  const links = await loadRevisionLinks(client, input.revisionId);
  const pending = await client.query<{ courseCode: string }>(
    `SELECT course_code AS "courseCode" FROM ad_comp_ai_suggestions WHERE revision_id=$1 AND mode='full' AND status IN ${PENDING}`, [input.revisionId]);
  const pendingCodes = new Set(pending.rows.map((row) => row.courseCode));
  const skipped = { linked: 0, duplicate: 0, pending: 0 };
  const inputs: { code: string; input: CourseAiInput }[] = [];
  for (const [code, occurrence] of [...shared.courses].sort(([a], [b]) => a.localeCompare(b))) {
    if (occurrence.count !== 1) { skipped.duplicate += 1; continue; }
    if ((links.get(code) ?? []).length) { skipped.linked += 1; continue; }
    if (pendingCodes.has(code)) { skipped.pending += 1; continue; }
    const aiInput = buildCourseAiInput(courseSource(shared, code, []), "full");
    assertRunnable(aiInput);
    inputs.push({ code, input: aiInput });
  }
  if (!inputs.length) return { batchId: null, queued: 0, skipped };
  if (await pendingCount(client) + inputs.length > MAX_PENDING_COURSE_SUGGESTIONS) throw new CompetencyError("ai_queue_full", 429);
  const batchId = randomUUID();
  for (const item of inputs) {
    await insertJob(client, { revisionId: input.revisionId, code: item.code, mode: "full", requestedBy: input.requestedBy, batchId, input: item.input });
  }
  return { batchId, queued: inputs.length, skipped };
}

/** Claims the oldest runnable proposal (SKIP LOCKED, 15 minute lease, at most 2 attempts). */
export async function claimCourseSuggestion(db: Db, leaseToken: string): Promise<{ id: string; leaseToken: string; aiInput: Record<string, unknown> } | null> {
  const result = await db.query<{ id: string; leaseToken: string; aiInput: Record<string, unknown> }>(`WITH candidate AS (
      SELECT id FROM ad_comp_ai_suggestions
      WHERE ai_input IS NOT NULL AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts<$2))
      ORDER BY created_at, course_code, id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE ad_comp_ai_suggestions j SET status='processing',lease_token=$1,lease_until=now()+make_interval(mins => $3),attempts=j.attempts+1,updated_at=now()
      FROM candidate c WHERE j.id=c.id RETURNING j.id,j.lease_token AS "leaseToken",j.ai_input AS "aiInput"`,
  [leaseToken, AI_JOB_MAX_ATTEMPTS, AI_JOB_LEASE_MINUTES]);
  return result.rows[0] ?? null;
}

/** Extends a live lease; null when the proposal is not processing under this lease. */
export async function extendCourseSuggestion(db: Db, id: string, leaseToken: string): Promise<Date | null> {
  const result = await db.query<{ leaseUntil: Date }>(
    `UPDATE ad_comp_ai_suggestions SET lease_until=now()+make_interval(mins => $3),updated_at=now()
      WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>now() RETURNING lease_until AS "leaseUntil"`,
    [id, leaseToken, AI_JOB_LEASE_MINUTES]);
  return result.rows[0]?.leaseUntil ?? null;
}

type LockedSuggestion = { status: string; lease_token: string | null; valid: boolean | null; ai_input: Record<string, unknown> | null };

/**
 * Stores the worker's result inside the worker router's transaction. Returns 'missing' when no
 * proposal has this id, 'expired' for another or lost lease (a cancelled proposal stays cancelled),
 * and 'ok' when stored or already stored under the same lease.
 */
export async function completeCourseSuggestion(client: PoolClient, id: string, input: WorkerCompletion): Promise<"ok" | "expired" | "missing"> {
  const locked = await client.query<LockedSuggestion>(
    "SELECT status,lease_token,lease_until>now() AS valid,ai_input FROM ad_comp_ai_suggestions WHERE id=$1 FOR UPDATE", [id]);
  const job = locked.rows[0];
  if (!job) return "missing";
  if ((job.status === "completed" || job.status === "failed") && job.lease_token === input.leaseToken) return "ok";
  if (job.status !== "processing" || job.lease_token !== input.leaseToken || job.valid !== true) return "expired";

  let errorCode: string | null = "error" in input ? input.error : null;
  let result: StoredCourseAiResult | null = null;
  if (!("error" in input)) {
    const context = courseAiContextFromInput(job.ai_input);
    const checked = context ? validateCourseAiOutput(input.output, context) : null;
    if (checked?.ok) result = checked.result;
    else errorCode = "invalid_ai_output";
  }
  const model = "error" in input ? null : input;
  const promptVersion = typeof job.ai_input?.promptVersion === "string" ? job.ai_input.promptVersion : null;
  await client.query(
    `UPDATE ad_comp_ai_suggestions SET status=$2,error_code=$3,result=$4::jsonb,metrics=$5::jsonb,ai_model=$6,ai_model_digest=$7,
      ollama_version=$8,prompt_version=COALESCE($9,prompt_version),ai_input=NULL,lease_until=NULL,completed_at=now(),updated_at=now() WHERE id=$1`,
    [id, errorCode ? "failed" : "completed", errorCode, result ? JSON.stringify(result) : null,
      model ? JSON.stringify(model.metrics) : null, model?.model ?? null, model?.digest || null, model?.ollamaVersion || null, promptVersion]);
  return "ok";
}
