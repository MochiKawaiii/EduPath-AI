// Real-router PostgreSQL checks for the Năng lực (AD-COMP) changes of function list ver0.2 (7):
// "Xóa nhóm kỹ năng", AI links ("Tạo liên kết kỹ năng với học phần (AI)"), AI weights ("Thêm trọng số
// năng lực (AI)"), the whole-program run and "Thêm kỹ năng (AI)" of Danh mục kỹ năng
// (docs/competency-management.md).
// Every write stays in a disposable LOCAL schema that is dropped at the end. The schema is seeded by
// copying curricula, the skill catalog, careers and the competency configuration from the local public
// schema (admin data only, read-only; no users or student data are copied). The model is simulated with
// hand-written answers that the real worker client posts.
// Run after building apps/api: npm run build -w @edupath/api && node scripts/verify-competency-ai.mjs
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import express from "express";
import pg from "pg";
import { createCompetenciesRouter } from "../apps/api/dist/competencies/router.js";
import { createCompetencyWorkerRouter } from "../apps/api/dist/competency-assessment/ai/worker-router.js";
import { COURSE_AI_PROMPT_VERSIONS } from "../apps/api/dist/competencies/ai/prompt.js";
import { expireCourseSuggestions } from "../apps/api/dist/competencies/ai/jobs.js";

const env = dotenv.parse(await readFile("apps/api/.env", "utf8"));
assert(env.DATABASE_URL, "apps/api/.env must define DATABASE_URL");
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.DATABASE_URL).hostname), "Integration checks require a LOCAL database");
const schema = "comp_ai_audit_" + randomBytes(6).toString("hex");
assert(/^comp_ai_audit_[0-9a-f]{12}$/.test(schema));
const migrations = ["007_student_transcripts.sql", "010_transcript_jobs.sql", "011_curricula.sql", "012_training_plans.sql", "013_graduation_standards.sql",
  "014_career_positions.sql", "015_career_fields.sql", "016_career_requirements.sql", "027_remove_career_requirement_level.sql",
  "019_career_skill_management.sql", "020_career_field_numbers.sql", "021_career_position_codes.sql", "018_data_consents.sql",
  "026_competency_management.sql", "028_student_specialty.sql", "029_student_competency_assessments.sql", "030_competency_consent.sql",
  "031_career_ai_suggestions.sql", "032_graduation_ai_advice.sql", "033_competency_cloud_ai.sql", "034_competency_ai_suggestions.sql",
  "035_competency_ai_skills.sql"];
const adminPool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
// search_path is the audit schema ONLY, so a missing table can never fall through to public.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 8, options: `-c search_path=${schema}` });
const origin = "http://competency-ai.audit";
const workerKey = randomBytes(32).toString("hex");
const tenantId = randomUUID();
const actor = (name, role) => ({ userId: randomUUID(), tenantId, objectId: randomUUID(), identityKey: `comp-ai-audit:${name}`, name: `Audit ${name}`,
  email: `${name}@comp-ai-audit.example.test`, username: `${name}@comp-ai-audit.example.test`, role, signedInAt: new Date(0).toISOString() });
const actors = { admin: actor("admin", "admin"), student: actor("student", "student") };
const KIND = "competency_course_suggestion_v2";
const checks = [];
let schemaCreated = false;
let server;
let baseUrl;

const inSchema = (sql) => sql.replaceAll("public.", `${schema}.`).replaceAll("SET search_path=public,pg_temp", `SET search_path=${schema},pg_temp`)
  .replaceAll("nspname='public'", `nspname='${schema}'`);
const count = async (sql, params = []) => (await pool.query(`SELECT count(*)::int AS count FROM ${sql}`, params)).rows[0].count;
const publicCounts = async () => (await adminPool.query(`SELECT
  (SELECT count(*)::int FROM public.career_skills) AS skills,(SELECT count(*)::int FROM public.ad_comp_groups) AS groups,
  (SELECT count(*)::int FROM public.ad_comp_skills) AS profiles,(SELECT count(*)::int FROM public.ad_comp_course_configs) AS configs,
  (SELECT count(*)::int FROM public.ad_comp_course_links) AS links,(SELECT count(*)::int FROM public.ad_comp_events) AS events`)).rows[0];

/** Copies the columns both schemas have, from public into the audit schema. */
async function copy(client, table, { where = "", exclude = [] } = {}) {
  const columns = (await client.query(`SELECT a.column_name FROM information_schema.columns a JOIN information_schema.columns b
    ON b.table_schema=$2 AND b.table_name=a.table_name AND b.column_name=a.column_name
    WHERE a.table_schema='public' AND a.table_name=$1 ORDER BY a.ordinal_position`, [table, schema])).rows
    .map((row) => row.column_name).filter((name) => !exclude.includes(name)).map((name) => `"${name}"`).join(",");
  await client.query(`INSERT INTO ${schema}.${table}(${columns}) SELECT ${columns} FROM public.${table} ${where}`);
}

async function setupSchema() {
  await adminPool.query(`CREATE SCHEMA ${schema}`); schemaCreated = true;
  await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY,entra_tenant_id UUID NOT NULL,entra_object_id UUID NOT NULL,
 entra_subject TEXT NOT NULL,display_name TEXT NOT NULL,email TEXT,username TEXT,role TEXT NOT NULL,role_override TEXT,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,auth_version INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE student_profiles(user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,student_code TEXT,full_name TEXT,cohort_code TEXT,
 class_name TEXT,career_goal TEXT,current_semester SMALLINT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
  for (const file of migrations) await pool.query(`BEGIN; ${inSchema(await readFile("apps/api/migrations/" + file, "utf8"))} COMMIT;`);
  for (const user of Object.values(actors)) {
    await pool.query(`INSERT INTO users(id,entra_tenant_id,entra_object_id,entra_subject,display_name,email,username,role,is_active)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE)`, [user.userId, tenantId, user.objectId, user.objectId, user.name, user.email, user.username, user.role]);
  }
  // Replace the rows seeded by the migrations with a read-only copy of the local admin data, in one
  // transaction so the deferred weight checks see each configuration with its links.
  await pool.query("TRUNCATE career_fields,career_positions,career_skills,career_requirements,ad_comp_groups CASCADE");
  await pool.query("ALTER TABLE career_fields DISABLE TRIGGER career_fields_assign_number; ALTER TABLE career_positions DISABLE TRIGGER career_positions_assign_code");
  await adminPool.query("BEGIN");
  for (const table of ["career_fields", "career_positions", "career_skills", "career_requirements", "course_catalog"]) await copy(adminPool, table);
  await copy(adminPool, "curricula", { exclude: ["current_revision"] });
  // actor_id points to public users, which are never copied.
  await copy(adminPool, "curriculum_revisions", { exclude: ["actor_id"] });
  await adminPool.query(`UPDATE ${schema}.curricula c SET current_revision=p.current_revision FROM public.curricula p WHERE p.id=c.id`);
  for (const table of ["curriculum_courses", "ad_comp_groups", "ad_comp_skills", "ad_comp_course_configs", "ad_comp_course_links"]) await copy(adminPool, table);
  await adminPool.query("COMMIT");
  await pool.query("ALTER TABLE career_fields ENABLE TRIGGER career_fields_assign_number; ALTER TABLE career_positions ENABLE TRIGGER career_positions_assign_code");
}

async function call(method, path, { user = "admin", body, headers = {}, base = "/api/admin/competencies" } = {}) {
  const response = await fetch(baseUrl + base + path, {
    method, headers: { "content-type": "application/json", origin, "x-audit-user": user ?? "", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
const ai = (method, path = "", options = {}) => call(method, "/ai" + path, options);
async function worker(path, body) {
  const response = await fetch(`${baseUrl}/api/worker/competency-assessments${path}`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${workerKey}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
const complete = (job, output) => worker(`/${job.id}/complete`, { leaseToken: job.leaseToken, model: "simulated", digest: "", ollamaVersion: "", metrics: {}, output });
const claim = async () => (await worker("/claim", { kinds: [KIND] })).body.job;

/** Candidate lines of a claimed job: key, name and group ("kỹ năng nghề, chưa có nhóm" for career skills). */
function candidates(user) {
  return [...user.matchAll(/^(S\d{3}) \| ([^|\n]+) \| ([^|\n]+)/gm)].map((match) => ({ key: match[1], name: match[2].trim(), group: match[3].trim() }));
}

try {
  const publicBefore = await publicCounts();
  await setupSchema();
  checks.push(`migrations 007-035 apply in a throwaway schema; copied ${await count("ad_comp_skills WHERE deleted_at IS NULL")} profiles, ${await count("ad_comp_course_configs")} configurations and ${await count("career_requirements WHERE deleted_at IS NULL")} career links read-only from public`);

  const app = express();
  app.use("/api/worker/competency-assessments", createCompetencyWorkerRouter(pool, workerKey));
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => { req.session = { user: actors[req.get("x-audit-user")] }; next(); });
  app.use("/api/admin/competencies", createCompetenciesRouter(pool, origin, { aiSuggestions: true }));
  app.use("/api/disabled/competencies", createCompetenciesRouter(pool, origin, { aiSuggestions: false }));
  app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: "internal" }); });
  server = app.listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Access, AI disabled, the import routes are gone.
  assert.equal((await ai("GET", "/status", { user: "student" })).status, 403);
  assert.equal((await ai("GET", "/status", { user: "" })).status, 401);
  assert.deepEqual((await call("GET", "/ai/status", { base: "/api/disabled/competencies" })).body, { enabled: false, worker: { online: false, supportsSuggestions: false, seenAt: null } });
  assert.equal((await call("POST", "/import/preview", { body: {} })).status, 404, "the Excel import is removed");
  assert.equal((await ai("GET", "/nothing/here")).status, 404);
  checks.push("students and anonymous users are refused; with AI off /ai/status says disabled; /import/preview no longer exists");

  // "Xóa nhóm kỹ năng": soft delete of an empty group, the name can be reused, a group with skills is refused.
  const created = await call("POST", "/groups", { body: { name: "Nhóm kiểm thử xóa", description: "", isActive: true } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await call("DELETE", `/groups/${created.body.id}`, { body: { confirmed: true } })).status, 400, "x-version is required");
  const deleted = await call("DELETE", `/groups/${created.body.id}`, { body: { confirmed: true }, headers: { "x-version": created.body.version } });
  assert.deepEqual(deleted.body, { deleted: true });
  assert(!(await call("GET", "/groups")).body.items.some((group) => group.id === created.body.id), "a deleted group is not listed");
  assert.equal((await call("GET", `/groups/${created.body.id}`)).status, 404);
  assert.equal((await call("POST", "/groups", { body: { name: "Nhóm kiểm thử xóa", description: "", isActive: true } })).status, 201, "the name is free again");
  const used = (await call("GET", "/groups")).body.items.find((group) => group.skillCount > 0);
  assert(used, "a group with skills exists");
  const refused = await call("DELETE", `/groups/${used.id}`, { body: { confirmed: true }, headers: { "x-version": used.version } });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "group_not_empty");
  checks.push(`an empty group is soft-deleted (hidden, 404, name reusable); deleting a group with ${used.skillCount} skills is 409 group_not_empty`);

  // Pick an unconfigured revision for the AI flows.
  const revisions = (await call("GET", "/curricula")).body.items;
  const empty = revisions.filter((item) => item.configuredCount === 0 && item.courseCount >= 5).sort((a, b) => b.courseCount - a.courseCount)[0];
  assert(empty, "an unconfigured CTĐT revision with courses exists locally");
  const courses = (await call("GET", `/courses?revisionId=${empty.revisionId}`)).body.items.filter((course) => course.occurrenceCount === 1);
  const [first, second] = courses;
  checks.push(`AI flows use ${empty.cohortCode} v${empty.version} (${empty.courseCount} courses, none configured)`);

  // Status and an up-to-date worker heartbeat.
  assert.equal((await ai("GET", "/status")).body.worker.online, false);
  await worker("/heartbeat", { kinds: [KIND] });
  assert.equal((await ai("GET", "/status")).body.worker.supportsSuggestions, true);
  assert.deepEqual((await ai("POST", "", { body: { revisionId: empty.revisionId, code: first.code, mode: "weights" } })).body.error, "course_has_no_links");
  assert.equal((await ai("POST", "", { body: { revisionId: empty.revisionId, code: "XX999", mode: "links" } })).body.error, "course_not_found");
  checks.push("a worker advertising the kind is reported as supporting it; weights for a course without links is 409 course_has_no_links");

  // Links: queue, claim (no key maps), simulated answer, review, apply.
  const queued = await ai("POST", "", { body: { revisionId: empty.revisionId, code: first.code, mode: "links" } });
  assert.equal(queued.status, 201, JSON.stringify(queued.body));
  assert.equal(queued.body.suggestion.status, "queued");
  assert.equal((await ai("POST", "", { body: { revisionId: empty.revisionId, code: first.code, mode: "links" } })).body.suggestion.id, queued.body.suggestion.id);
  const linksJob = await claim();
  assert.equal(linksJob.kind, KIND);
  assert.equal(linksJob.promptVersion, COURSE_AI_PROMPT_VERSIONS.links);
  assert.deepEqual(Object.keys(linksJob).sort(), ["id", "kind", "leaseToken", "options", "promptVersion", "schema", "system", "think", "user"], "the claim carries no key map");
  assert.equal(linksJob.think, true, "course proposals run with Gemma's thinking mode");
  assert.equal(linksJob.options.num_predict, 8192);
  assert.equal((await worker("/claim", { kinds: ["competency_course_suggestion"] })).body.job, null, "a worker released before thinking gets no course job");
  const offered = candidates(linksJob.user);
  const profiles = offered.filter((entry) => entry.group !== "kỹ năng nghề, chưa có nhóm");
  const careerOnly = offered.find((entry) => entry.group === "kỹ năng nghề, chưa có nhóm");
  assert(profiles.length >= 2, "at least two profiles are offered");
  const linksOutput = {
    links: [
      { skillKey: profiles[0].key, groupKey: "G1", reason: `Học phần rèn ${profiles[0].key} trực tiếp.` },
      { skillKey: profiles[1].key, groupKey: "G1", reason: "Dùng trong bài tập lớn." },
      { skillKey: profiles[0].key, groupKey: "G1", reason: "lặp" },
      ...(careerOnly ? [{ skillKey: careerOnly.key, groupKey: "G1", reason: "Kỹ năng nghề đang thiếu học phần đo." }] : [])
    ],
    newSkills: [{ name: "Kỹ năng kiểm chứng tự động bằng giả lập", groupKey: "G1", reason: "Học phần có phần kiểm chứng." }]
  };
  assert.deepEqual((await complete(linksJob, linksOutput)).body, { ok: true });
  const proposal = (await ai("GET", `/${linksJob.id}`)).body.suggestion;
  assert.equal(proposal.status, "completed");
  assert.equal(proposal.items.length, careerOnly ? 4 : 3);
  assert.equal(proposal.items[0].reason, `Học phần rèn ${profiles[0].name} trực tiếp.`, "keys in prose become names");
  assert.equal(proposal.items.at(-1).skillName, "Kiểm chứng tự động bằng giả lập");
  assert.equal(proposal.items.at(-1).isNewSkill, true);
  if (careerOnly) assert.equal(proposal.items[2].hasProfile, false);
  assert.equal((await ai("GET", `/latest?revisionId=${empty.revisionId}&code=${first.code}&mode=links`)).body.suggestion.id, linksJob.id);
  const skillsBefore = await count("career_skills WHERE deleted_at IS NULL");
  const profilesBefore = await count("ad_comp_skills WHERE deleted_at IS NULL");
  const keep = (item) => ({ skillId: item.skillId, skillName: item.skillId ? "" : item.skillName, groupId: item.groupId });
  const noGroup = await ai("POST", `/${linksJob.id}/apply`, { body: { items: proposal.items.map((item) => ({ ...keep(item), groupId: item.hasProfile ? item.groupId : null })) } });
  assert.equal(noGroup.body.error, "group_required", "a skill without a profile needs a group");
  const applied = await ai("POST", `/${linksJob.id}/apply`, { body: { items: proposal.items.map(keep) } });
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  assert.equal(applied.body.course.status, "draft");
  assert.equal(applied.body.course.links.length, proposal.items.length);
  assert(applied.body.course.links.every((link) => link.weight === 0), "new links start at 0%");
  assert.equal(await count("career_skills WHERE deleted_at IS NULL"), skillsBefore + 1, "the new skill joins the shared catalog");
  assert.equal(await count("ad_comp_skills WHERE deleted_at IS NULL"), profilesBefore + (careerOnly ? 2 : 1), "profiles for the career skill and the new skill");
  assert.equal((await ai("POST", `/${linksJob.id}/apply`, { body: { items: [keep(proposal.items[0])] } })).body.error, "suggestion_already_applied");
  assert.equal((await ai("GET", `/latest?revisionId=${empty.revisionId}&code=${first.code}&mode=links`)).body.suggestion, null);
  checks.push(`links: claim without key maps, ${proposal.items.length} proposed skills (repeat dropped, key in prose named), apply links them at 0% as a draft, adds the new skill to the shared catalog and creates the missing profiles; a second apply is 409`);

  // Weights: AI percents scaled to 100, applied.
  const weightsQueued = await ai("POST", "", { body: { revisionId: empty.revisionId, code: first.code, mode: "weights" } });
  assert.equal(weightsQueued.status, 201, JSON.stringify(weightsQueued.body));
  const weightsJob = await claim();
  const linkedKeys = candidates(weightsJob.user).map((entry) => entry.key);
  assert.equal(linkedKeys.length, proposal.items.length);
  await complete(weightsJob, { weights: linkedKeys.map((skillKey, index) => ({ skillKey, percent: index === 0 ? 60 : 20, reason: "Tỉ lệ theo số giờ." })) });
  const weightsProposal = (await ai("GET", `/${weightsJob.id}`)).body.suggestion;
  assert.equal(weightsProposal.items.reduce((sum, item) => sum + item.percent, 0), 100, "percents add up to 100");
  assert.equal(weightsProposal.stale, false);
  const weightsBody = { weights: weightsProposal.items.map((item) => ({ skillId: item.skillId, percent: item.percent })), status: "active" };
  assert.equal((await ai("POST", `/${weightsJob.id}/apply`, { body: { ...weightsBody, weights: weightsBody.weights.slice(1) } })).body.error, "links_changed");
  const activated = await ai("POST", `/${weightsJob.id}/apply`, { body: weightsBody });
  assert.equal(activated.status, 201, JSON.stringify(activated.body));
  assert.equal(activated.body.course.status, "active");
  assert(Math.abs(activated.body.course.links.reduce((sum, link) => sum + link.weight, 0) - 1) < 1e-9);
  checks.push(`weights: the model's ${linkedKeys.length} percents are scaled to exactly 100, a mismatched link set is 409 links_changed, and apply activates the course`);

  // Links on an applied course keep it applied; then the whole-program run.
  const more = await ai("POST", "", { body: { revisionId: empty.revisionId, code: first.code, mode: "links" } });
  const moreJob = await claim();
  const moreOffered = candidates(moreJob.user);
  await complete(moreJob, { links: [{ skillKey: moreOffered[0].key, groupKey: "G1", reason: "Bổ sung." }], newSkills: [] });
  const moreProposal = (await ai("GET", `/${more.body.suggestion.id}`)).body.suggestion;
  const kept = await ai("POST", `/${more.body.suggestion.id}/apply`, { body: { items: moreProposal.items.map(keep) } });
  assert.equal(kept.body.course.status, "active", "a 0% link keeps an applied course applied");

  const batch = await ai("POST", "/batches", { body: { revisionId: empty.revisionId } });
  assert.equal(batch.status, 201, JSON.stringify(batch.body));
  assert.equal(batch.body.skipped.linked, 1, "the configured course is skipped");
  const total = batch.body.queued;
  assert.equal(total, courses.length - 1);
  assert.equal((await ai("POST", "/batches", { body: { revisionId: empty.revisionId } })).body.queued, 0, "a second run queues nothing while the first is pending");
  let done = 0;
  for (;;) {
    const job = await claim();
    if (!job) break;
    assert.equal(job.promptVersion, COURSE_AI_PROMPT_VERSIONS.full);
    const keys = candidates(job.user);
    // Every 5th course gets an empty answer (a course with no matching skill); the rest two skills 70/30.
    const output = done % 5 === 4 ? { links: [] } : { links: [
      { skillKey: keys[0].key, groupKey: "G1", percent: 70, reason: "Trọng tâm." },
      { skillKey: keys[1].key, groupKey: "G1", percent: 30, reason: "Phụ." }] };
    assert.deepEqual((await complete(job, output)).body, { ok: true });
    done += 1;
  }
  assert.equal(done, total);
  const progress = (await ai("GET", `/batches/latest?revisionId=${empty.revisionId}`)).body.batch;
  assert.deepEqual([progress.total, progress.completed, progress.queued, progress.failed], [total, total, 0, 0]);
  const drafts = await ai("POST", `/batches/${progress.id}/apply`, { body: { status: "draft" } });
  assert.equal(drafts.status, 200, JSON.stringify(drafts.body));
  assert.equal(drafts.body.drafted + drafts.body.empty, total);
  assert.deepEqual(drafts.body.skipped, []);
  assert.equal(drafts.body.batch.applied, total);
  const configured = await count("ad_comp_course_configs WHERE revision_id=$1 AND status='draft'", [empty.revisionId]);
  assert.equal(configured, drafts.body.drafted);
  const totals = (await pool.query(`SELECT c.course_code,sum(l.weight)::float8 AS total FROM ad_comp_course_configs c JOIN ad_comp_course_links l ON l.config_id=c.id
    WHERE c.revision_id=$1 AND c.status='draft' GROUP BY c.course_code`, [empty.revisionId])).rows;
  assert(totals.every((row) => Math.abs(row.total - 1) < 1e-9), "every draft adds up to 100%");
  assert.equal((await ai("POST", `/batches/${progress.id}/apply`, { body: { status: "active" } })).body.drafted, 0, "nothing is applied twice");
  checks.push(`whole program: ${total} courses queued (the configured one skipped, a second run queues nothing), ${drafts.body.drafted} saved as drafts at 100% and ${drafts.body.empty} empty answers recorded, nothing applied twice`);

  // "Xóa liên kết của cả chương trình": every linked course becomes an empty draft, then a new run covers them all.
  const linkedBefore = (await call("GET", `/courses?revisionId=${empty.revisionId}`)).body.items.filter((course) => course.skillCount > 0).length;
  assert.equal((await call("POST", "/courses/clear", { body: { revisionId: empty.revisionId, confirm: "K00" } })).body.error, "confirmation_mismatch");
  assert.equal((await call("POST", "/courses/clear", { user: "student", body: { revisionId: empty.revisionId, confirm: empty.cohortCode } })).status, 403);
  const clearedRun = await call("POST", "/courses/clear", { body: { revisionId: empty.revisionId, confirm: empty.cohortCode.toLowerCase() } });
  assert.equal(clearedRun.status, 200, JSON.stringify(clearedRun.body));
  assert.equal(clearedRun.body.cleared, linkedBefore);
  const afterClear = (await call("GET", `/courses?revisionId=${empty.revisionId}`)).body.items;
  assert(afterClear.every((course) => course.skillCount === 0), "no course keeps a link");
  assert.equal(await count("ad_comp_course_configs WHERE revision_id=$1 AND status='active'", [empty.revisionId]), 0);
  const clearedHistory = (await call("GET", `/courses/${empty.revisionId}/${first.code}`)).body.history;
  assert.equal(clearedHistory[0].note, "Xóa liên kết và trọng số của cả chương trình");
  const rerun = await ai("POST", "/batches", { body: { revisionId: empty.revisionId } });
  assert.equal(rerun.body.queued, courses.length, "after clearing, a run covers every course again");
  await ai("POST", `/batches/${rerun.body.batchId}/cancel`, { body: {} });
  checks.push(`clearing the whole program needs the cohort code, empties ${linkedBefore} linked courses as drafts with a history entry, and a new run covers all ${courses.length} courses`);

  // "Thêm kỹ năng (AI)": one proposal per revision, career skills by key, new skills by name, saved as profiles.
  const skillsQueued = await ai("POST", "/skills", { body: { revisionId: empty.revisionId } });
  assert.equal(skillsQueued.status, 201, JSON.stringify(skillsQueued.body));
  assert.deepEqual([skillsQueued.body.suggestion.mode, skillsQueued.body.suggestion.courseCode], ["skills", null]);
  assert.equal((await ai("POST", "/skills", { body: { revisionId: empty.revisionId } })).body.suggestion.id, skillsQueued.body.suggestion.id, "one pending proposal per revision");
  const skillsJob = await claim();
  assert.equal(skillsJob.id, skillsQueued.body.suggestion.id);
  assert.equal(skillsJob.promptVersion, COURSE_AI_PROMPT_VERSIONS.skills);
  assert.equal(skillsJob.options.num_predict, 12288);
  assert.equal(skillsJob.think, true);
  assert(skillsJob.user.includes("[5. HỌC PHẦN CỦA CHƯƠNG TRÌNH]") && skillsJob.user.includes(`- ${first.name} |`), "the courses of the revision are listed");
  assert(!/MSSV|họ tên|@/i.test(skillsJob.user), "no student data");
  const careerKeys = [...skillsJob.user.matchAll(/^(S\d{3}) \| ([^|\n]+)/gm)].map((match) => ({ key: match[1], name: match[2].trim() }));
  const inCatalog = (await call("GET", "/skills")).body.items;
  assert(!careerKeys.some((entry) => inCatalog.some((skill) => skill.name === entry.name)), "skills already in the catalog are not offered by key");
  const picked = careerKeys.slice(0, 2);
  const skillsOutput = {
    links: picked.map((entry) => ({ skillKey: entry.key, groupKey: "G1", scope: `Đánh giá qua đồ án có dùng ${entry.key}.`, reason: "Học phần chuyên ngành rèn kỹ năng này." })),
    newSkills: [
      { name: "Kỹ năng thiết kế kiểm thử giả lập", groupKey: "G1", description: "Thiết kế ca kiểm thử.", scope: "Đánh giá qua bài kiểm thử.", reason: "Học phần có phần kiểm thử." },
      { name: inCatalog[0].name.toUpperCase(), groupKey: "G1", description: "", scope: "", reason: "Trùng danh mục." }
    ]
  };
  assert.deepEqual((await complete(skillsJob, skillsOutput)).body, { ok: true });
  const skillsProposal = (await ai("GET", `/${skillsJob.id}`)).body.suggestion;
  assert.equal(skillsProposal.status, "completed");
  assert.equal(skillsProposal.items.length, picked.length + 1, "a name already in the catalog is dropped");
  if (picked.length) assert.equal(skillsProposal.items[0].scope, `Đánh giá qua đồ án có dùng ${picked[0].name}.`, "keys in the scope become names");
  const newItem = skillsProposal.items.at(-1);
  assert.deepEqual([newItem.skillName, newItem.isNewSkill, newItem.description], ["Thiết kế kiểm thử giả lập", true, "Thiết kế ca kiểm thử."]);
  assert.equal((await ai("GET", `/skills/latest?revisionId=${empty.revisionId}`)).body.suggestion.id, skillsJob.id);
  const toSkill = (item) => ({ skillId: item.skillId, skillName: item.skillId ? "" : item.skillName, groupId: item.groupId, scope: item.scope, description: item.description });
  const catalogBefore = await count("career_skills WHERE deleted_at IS NULL");
  const profilesBefore2 = await count("ad_comp_skills WHERE deleted_at IS NULL");
  const savedSkills = await ai("POST", `/${skillsJob.id}/apply`, { body: { items: skillsProposal.items.map(toSkill) } });
  assert.equal(savedSkills.status, 201, JSON.stringify(savedSkills.body));
  assert.deepEqual(savedSkills.body.saved, { saved: picked.length + 1, newSkills: 1 });
  assert.equal(await count("career_skills WHERE deleted_at IS NULL"), catalogBefore + 1, "the new skill joins the shared catalog");
  assert.equal(await count("ad_comp_skills WHERE deleted_at IS NULL"), profilesBefore2 + picked.length + 1, "one profile per saved skill");
  const stored = (await pool.query(`SELECT s.name,s.description,cs.scope,cs.group_id AS "groupId" FROM ad_comp_skills cs JOIN career_skills s ON s.id=cs.skill_id
    WHERE s.name=$1`, [newItem.skillName])).rows[0];
  assert.deepEqual(stored, { name: newItem.skillName, description: "Thiết kế ca kiểm thử.", scope: "Đánh giá qua bài kiểm thử.", groupId: newItem.groupId });
  assert((await ai("GET", `/${skillsJob.id}`)).body.suggestion.items.filter((item) => item.skillId).every((item) => item.alreadyLinked), "saved career skills now show as in the catalog");
  assert.equal((await ai("POST", `/${skillsJob.id}/apply`, { body: { items: skillsProposal.items.map(toSkill) } })).body.error, "suggestion_already_applied");
  const again = await ai("POST", "/skills", { body: { revisionId: empty.revisionId } });
  const againJob = await claim();
  assert(!picked.some((entry) => againJob.user.includes(`| ${entry.name}`) && !againJob.user.includes(`: ${entry.name}`)), "saved career skills are no longer offered by key");
  await complete(againJob, { links: [], newSkills: [] });
  const emptyProposal = (await ai("GET", `/${again.body.suggestion.id}`)).body.suggestion;
  assert.deepEqual([emptyProposal.status, emptyProposal.items.length], ["completed", 0], "an empty answer is a valid empty proposal");
  const conflict = await ai("POST", `/${again.body.suggestion.id}/apply`, { body: { items: [toSkill(skillsProposal.items.at(-1))].map((item) => ({ ...item, skillName: newItem.skillName })) } });
  assert.deepEqual([conflict.status, conflict.body.error], [409, "skill_already_in_catalog"]);
  assert.equal((await ai("POST", `/${again.body.suggestion.id}/apply`, { body: { items: [] } })).status, 400);
  checks.push(`skills: one pending proposal per revision listing the courses of the revision (${Math.round((skillsJob.system.length + skillsJob.user.length) / 1000)}k prompt characters, thinking on, num_predict 12288), ${picked.length} career skills by key + 1 new skill (a catalog name dropped), saved as profiles with group and scope, the new skill in the shared catalog with its description; a skill already in the catalog is 409`);

  // Cancel a run, expiry, and the public schema.
  const second2 = revisions.find((item) => item.revisionId !== empty.revisionId && item.configuredCount === 0 && item.courseCount >= 2);
  if (second2) {
    const other = await ai("POST", "/batches", { body: { revisionId: second2.revisionId } });
    assert.equal(other.status, 201, JSON.stringify(other.body));
    const cancelled = await ai("POST", `/batches/${other.body.batchId}/cancel`, { body: {} });
    assert.equal(cancelled.body.batch.cancelled, other.body.queued);
    assert.equal(await claim(), null, "a cancelled run leaves nothing to claim");
    checks.push(`cancelling a run of ${other.body.queued} courses leaves nothing for the worker`);
  }
  const stale = randomUUID();
  await pool.query(`INSERT INTO ad_comp_ai_suggestions(id,revision_id,course_code,mode,status,ai_input,prompt_version,created_at)
    VALUES($1,$2,$3,'links','queued','{}','comp-link-v1',now()-interval '25 hours')`, [stale, empty.revisionId, second.code]);
  await expireCourseSuggestions(pool);
  assert.deepEqual((await pool.query("SELECT status,error_code,ai_input FROM ad_comp_ai_suggestions WHERE id=$1", [stale])).rows[0],
    { status: "failed", error_code: "worker_timeout", ai_input: null });
  checks.push("a proposal queued for more than 24 hours fails with worker_timeout and loses ai_input");

  assert.deepEqual(await publicCounts(), publicBefore, "the public schema is unchanged");
  checks.push("the public catalog, groups, profiles, configurations, links and events are unchanged");
  console.log(checks.map((check) => `PASS ${check}`).join("\n"));
} finally {
  if (server) await new Promise((done) => server.close(done));
  await pool.end();
  if (schemaCreated) await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  const leftover = await adminPool.query("SELECT nspname FROM pg_namespace WHERE nspname=$1", [schema]);
  await adminPool.end();
  assert.equal(leftover.rowCount, 0, "the audit schema must be dropped");
}
