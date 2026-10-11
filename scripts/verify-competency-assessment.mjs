// Real-router PostgreSQL checks for the student competency assessment (spec §12).
// Every write stays in a disposable LOCAL schema that is dropped at the end; all data is synthetic.
// Run after building apps/api: npm run build -w @edupath/api && node scripts/verify-competency-assessment.mjs
// Add --with-ollama to also run one real AI job: the real queue + worker router in-process, one iteration of the
// real worker code (dist/ai-worker) and the LOCAL Ollama (OLLAMA_MODEL, default gemma4:e4b; OLLAMA_NUM_GPU, default 38).
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import express from "express";
import pg from "pg";
import { createCompetencyAssessmentRouter } from "../apps/api/dist/competency-assessment/router.js";
import { loadAssessmentInputs } from "../apps/api/dist/competency-assessment/inputs.js";
import { createStudentDataRouter } from "../apps/api/dist/student/router.js";
import { createTranscriptWorkerRouter } from "../apps/api/dist/student/transcript-jobs.js";
import { TRANSCRIPT_POLICY_VERSION } from "../apps/api/dist/student/consent.js";
import { createCompetencyAiQueue } from "../apps/api/dist/competency-assessment/ai/queue.js";
import { PROMPT_VERSION } from "../apps/api/dist/competency-assessment/ai/prompt.js";
import { createCompetencyWorkerRouter, expireCompetencyAiJobs } from "../apps/api/dist/competency-assessment/ai/worker-router.js";
import { createWorkerClient } from "../apps/api/dist/ai-worker/client.js";
import { getOllamaModelInfo, ollamaChat } from "../apps/api/dist/ai-worker/ollama.js";
import { processJob } from "../apps/api/dist/ai-worker/worker.js";

const withOllama = process.argv.includes("--with-ollama");

const env = dotenv.parse(await readFile("apps/api/.env", "utf8"));
assert(env.DATABASE_URL, "apps/api/.env must define DATABASE_URL");
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.DATABASE_URL).hostname), "Integration checks require a LOCAL database");
const schema = "stu_comp_audit_" + randomBytes(6).toString("hex");
assert(/^stu_comp_audit_[0-9a-f]{12}$/.test(schema));
const migrations = ["007_student_transcripts.sql", "010_transcript_jobs.sql", "011_curricula.sql", "012_training_plans.sql", "013_graduation_standards.sql",
  "014_career_positions.sql", "015_career_fields.sql", "016_career_requirements.sql", "027_remove_career_requirement_level.sql",
  "019_career_skill_management.sql", "020_career_field_numbers.sql", "021_career_position_codes.sql", "018_data_consents.sql",
  "026_competency_management.sql", "028_student_specialty.sql", "029_student_competency_assessments.sql", "030_competency_consent.sql"];
const adminPool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
// search_path is the audit schema ONLY, so a missing table can never fall through to public.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 8, options: `-c search_path=${schema}` });
const origin = "http://competency-assessment.audit";
const workerKey = randomBytes(32).toString("hex");
const tenantId = randomUUID();
const actor = (name) => ({ userId: randomUUID(), tenantId, objectId: randomUUID(), identityKey: `stu-comp-audit:${name}`, name: `Audit ${name}`,
  email: `${name}@stu-comp-audit.example.test`, username: `${name}@stu-comp-audit.example.test`, role: "student", signedInAt: new Date(0).toISOString() });
const actors = { a: actor("a"), b: actor("b"), inactive: actor("inactive") };
const checks = [];
let schemaCreated = false;
let server;
let aiServer;
let baseUrl;

const inSchema = (sql) => sql.replaceAll("public.", `${schema}.`).replaceAll("SET search_path=public,pg_temp", `SET search_path=${schema},pg_temp`)
  .replaceAll("nspname='public'", `nspname='${schema}'`);
const count = async (sql, params = []) => (await pool.query(`SELECT count(*)::int AS count FROM ${sql}`, params)).rows[0].count;

// Synthetic K29-style curriculum (public course codes; invented skills, weights and grades).
const courses = [
  ["71ITBS10103", "Nhập môn Công nghệ thông tin", 3, "BB", "Kiến thức cơ sở khối ngành", "", 1, 1],
  ["71ITBS10203", "Cơ sở lập trình", 3, "BB", "Kiến thức cơ sở khối ngành", "", 1, 1],
  ["71ITSE30103", "Kỹ thuật lập trình", 3, "BB", "Kiến thức cơ sở ngành", "", 2, 1],
  ["71ITIS30103", "Cơ sở dữ liệu", 3, "BB", "Kiến thức cơ sở ngành", "", 3, 1],
];
const transcriptData = (letters) => ({
  schemaVersion: 1, parserVersion: "vlu-native-1", pageCount: 1, courseCount: letters.length, warnings: [],
  sections: [{ id: "hk1", academicYear: "2023-2024", semester: "HK1", label: "Học kỳ 1 - Năm học 2023-2024", summaries: [],
    courses: letters.map(([code, letter, score10], index) => ({ ordinal: index + 1, code, name: "Tên in trên bảng điểm", credits: 3,
      score10, score4: null, letter, result: null, conditional: false, sourcePage: 1 })) }],
});

async function setupSchema() {
  await adminPool.query(`CREATE SCHEMA ${schema}`); schemaCreated = true;
  await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY,entra_tenant_id UUID NOT NULL,entra_object_id UUID NOT NULL,
 entra_subject TEXT NOT NULL,display_name TEXT NOT NULL,email TEXT,username TEXT,role TEXT NOT NULL,role_override TEXT,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,auth_version INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE student_profiles(user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,student_code TEXT,full_name TEXT,cohort_code TEXT,
 class_name TEXT,career_goal TEXT,current_semester SMALLINT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
  for (const file of migrations) await pool.query(`BEGIN; ${inSchema(await readFile("apps/api/migrations/" + file, "utf8"))} COMMIT;`);
  for (const [key, user] of Object.entries(actors)) {
    await pool.query(`INSERT INTO users(id,entra_tenant_id,entra_object_id,entra_subject,display_name,email,username,role,is_active)
 VALUES($1,$2,$3,$4,$5,$6,$7,'student',$8)`, [user.userId, tenantId, user.objectId, user.objectId, user.name, user.email, user.username, key !== "inactive"]);
    await pool.query("INSERT INTO student_profiles(user_id,cohort_code,specialty) VALUES($1,'K29',NULL)", [user.userId]);
  }
  const curriculumId = randomUUID(), revisionId = randomUUID();
  await pool.query("INSERT INTO curricula(id,identity_key,cohort_code,is_active,lock_version) VALUES($1,'cong nghe thong tin:K29','K29',TRUE,$2)", [curriculumId, randomUUID()]);
  await pool.query(`INSERT INTO curriculum_revisions(id,curriculum_id,version,data,source_filename,source_data,source_sha256,change_note)
 VALUES($1,$2,1,$3,'audit_K29.xlsx',$4,$5,'Synthetic audit curriculum')`,
  [revisionId, curriculumId, JSON.stringify({ name: "CTĐT K29 (tổng hợp)", admissionYear: 2023, courses: [] }), Buffer.from("audit"), "c".repeat(64)]);
  await pool.query("UPDATE curricula SET current_revision=$2 WHERE id=$1", [curriculumId, revisionId]);
  for (const [index, [code, name, credits, type, block, specialty, semester, year]] of courses.entries()) {
    await pool.query("INSERT INTO course_catalog(code,name) VALUES($1,$2)", [code, name]);
    await pool.query(`INSERT INTO curriculum_courses(revision_id,code,position,name,credits,course_type,block,specialty,semester,study_year,data)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [revisionId, code, index + 1, name, credits, type, block, specialty, semester, year, JSON.stringify({ code })]);
  }
  await pool.query("INSERT INTO course_catalog(code,name) VALUES('71AV010003','Anh văn đầu vào (tổng hợp)')");
  const group = (await pool.query("SELECT id FROM ad_comp_groups ORDER BY name LIMIT 1")).rows[0].id;
  const skills = [randomUUID(), randomUUID()];
  for (const [index, id] of skills.entries()) {
    await pool.query("INSERT INTO career_skills(id,name,description) VALUES($1,$2,'')", [id, `Kỹ năng kiểm thử ${index + 1}`]);
    await pool.query("INSERT INTO ad_comp_skills(skill_id,group_id,scope) VALUES($1,$2,$3)", [id, group, "Phạm vi tổng hợp"]);
  }
  for (const [code, weights] of [["71ITBS10203", [0.6, 0.4]], ["71ITSE30103", [1, 0]], ["71ITIS30103", [0, 1]]]) {
    const configId = randomUUID();
    await pool.query("INSERT INTO ad_comp_course_configs(id,revision_id,course_code,status) VALUES($1,$2,$3,'draft')", [configId, revisionId, code]);
    for (const [index, weight] of weights.entries()) if (weight) await pool.query("INSERT INTO ad_comp_course_links(config_id,skill_id,weight) VALUES($1,$2,$3)", [configId, skills[index], weight]);
    await pool.query("UPDATE ad_comp_course_configs SET status='active' WHERE id=$1", [configId]);
  }
  for (const user of [actors.a, actors.b]) await setTranscript(user, transcriptData([["71ITBS10203", "B+", 8], ["71ITSE30103", "A", 9], ["71AV010003", "MT", null]]));
  return { revisionId, skills };
}

async function setTranscript(user, data) {
  const version = randomUUID();
  await pool.query(`INSERT INTO student_transcripts(user_id,version,filename,pdf_data,file_size,sha256,parsed_data) VALUES($1,$2,'bang-diem.pdf',$3,8,$4,$5)
 ON CONFLICT(user_id) DO UPDATE SET version=EXCLUDED.version,parsed_data=EXCLUDED.parsed_data`,
  [user.userId, version, Buffer.from("%PDF-1.7"), createHash("sha256").update(version).digest("hex"), JSON.stringify(data)]);
  return version;
}

async function call(method, path, user, { body, headers = {} } = {}) {
  const response = await fetch(baseUrl + path, {
    method, headers: { "content-type": "application/json", origin, "x-audit-user": user ?? "", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
const assess = (user, headers = { "x-consent-policy-version": TRANSCRIPT_POLICY_VERSION }) => call("POST", "/api/student/competency-assessments", user, { headers });
const ageAssessments = (user) => pool.query("UPDATE stu_comp_assessments SET created_at=created_at-interval '2 minutes' WHERE user_id=$1", [user.userId]);

try {
  const { revisionId, skills } = await setupSchema();
  checks.push("migrations 028-030 apply with 007-027 in a throwaway schema");

  const app = express();
  app.use("/api/worker/transcripts", createTranscriptWorkerRouter(pool, workerKey));
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: actors[req.get("x-audit-user")] }; next(); });
  app.use("/api/student/competency-assessments", createCompetencyAssessmentRouter(pool, origin));
  app.use("/api/student", createStudentDataRouter(pool, origin, true));
  app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: "internal" }); });
  server = app.listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Access and consent.
  assert.equal((await call("GET", "/api/student/competency-assessments/latest", undefined)).status, 401);
  assert.deepEqual((await call("GET", "/api/student/competency-assessments/latest", "inactive")).body, { error: "account_unavailable" });
  assert.equal((await call("POST", "/api/student/competency-assessments", "a", { headers: { origin: "http://evil.example", "x-consent-policy-version": TRANSCRIPT_POLICY_VERSION } })).status, 403);
  assert.deepEqual((await assess("a", {})).body, { error: "consent_required" });
  assert.deepEqual((await assess("a", { "x-consent-policy-version": "2000-01-01" })).body, { error: "policy_outdated" });
  assert.equal(await count("stu_comp_assessments"), 0);
  checks.push("anonymous, inactive, foreign-origin, missing-consent and outdated-consent requests store nothing");

  // Snapshot path: real READ ONLY transaction against real tables.
  const inputs = await loadAssessmentInputs(pool, actors.a.userId);
  assert.equal(inputs.curriculum.revisionId, revisionId);
  assert.equal(inputs.weights.activeCount, 3);
  assert.equal(inputs.weights.links.length, 4);
  assert.deepEqual(inputs.catalogNames, { "71AV010003": "Anh văn đầu vào (tổng hợp)" });
  assert.equal(inputs.graduation.resolution, "not_found");
  assert.equal(inputs.plan.resolution, "not_found");
  const probe = await pool.connect();
  try {
    await probe.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await assert.rejects(probe.query("SELECT 1 FROM student_profiles FOR UPDATE"), (error) => error.code === "25006");
    await probe.query("ROLLBACK");
  } finally { probe.release(); }
  checks.push("the snapshot reader works inside REPEATABLE READ READ ONLY (row locks there fail with 25006, so it takes none)");

  // Create, consent, cooldown.
  const first = await assess("a");
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const stored = first.body.assessment;
  assert.equal(stored.ai.status, "disabled");
  assert.equal(stored.meta.transcriptVersion, inputs.transcript.version);
  assert.equal(stored.result.meta.weights.activeCount, 3);
  assert(stored.result.skills.length >= 2);
  const consent = (await pool.query("SELECT purpose,policy_version,ended_at FROM data_consents WHERE user_id=$1", [actors.a.userId])).rows;
  assert.deepEqual(consent.map(({ purpose, policy_version: version, ended_at: ended }) => [purpose, version, ended]), [["competency_assessment", TRANSCRIPT_POLICY_VERSION, null]]);
  assert.deepEqual((await assess("a")).body, { error: "assessment_too_frequent" });
  assert.equal(await count("stu_comp_assessments WHERE user_id=$1", [actors.a.userId]), 1);
  const latest = await call("GET", "/api/student/competency-assessments/latest", "a");
  assert.equal(latest.body.assessment.id, stored.id);
  assert.equal(latest.body.aiEnabled, false);
  assert.equal(latest.body.consentVersion, TRANSCRIPT_POLICY_VERSION, "GET /latest returns the student's own active consent version");
  assert.deepEqual((await call("GET", "/api/student/competency-assessments/latest/status", "a")).body, { id: stored.id, aiStatus: "disabled", aiErrorCode: null, workerOnline: false });
  checks.push("POST stores meta + computed with ai_status 'disabled', records consent 'competency_assessment', and enforces the 60 s cooldown");

  // IDOR.
  const otherLatest = (await call("GET", "/api/student/competency-assessments/latest", "b")).body;
  assert.equal(otherLatest.assessment, null);
  assert.equal(otherLatest.consentVersion, null, "consent is per student, not shared");
  assert.deepEqual((await call("DELETE", `/api/student/competency-assessments/${stored.id}/ai`, "b")).body, { error: "assessment_not_found" });
  assert.deepEqual((await call("POST", `/api/student/competency-assessments/${stored.id}/ai`, "a")).body, { error: "ai_disabled" });
  checks.push("another student cannot see or act on an assessment (404), and AI regeneration is refused while AI is disabled");

  // Cap of 20 per student, oldest removed first.
  for (let index = 0; index < 22; index++) {
    await pool.query(`INSERT INTO stu_comp_assessments(id,user_id,created_at,transcript_version,meta,computed,ai_status)
 SELECT $1,user_id,now()-make_interval(hours=>$2+1),transcript_version,meta,computed,'disabled' FROM stu_comp_assessments WHERE id=$3`, [randomUUID(), index, stored.id]);
  }
  await ageAssessments(actors.a);
  const capped = await assess("a");
  assert.equal(capped.status, 201);
  assert.equal(await count("stu_comp_assessments WHERE user_id=$1", [actors.a.userId]), 20);
  assert.equal(await count("stu_comp_assessments WHERE user_id=$1 AND id=$2", [actors.a.userId, capped.body.assessment.id]), 1);
  assert.equal(await count("stu_comp_assessments WHERE user_id=$1 AND id=$2", [actors.a.userId, stored.id]), 1, "the newest results stay");
  checks.push("at most 20 assessments are kept per student; the oldest are removed when a new one is stored");

  // Cascade: deleting B's transcript removes only B's results.
  assert.equal((await assess("b")).status, 201);
  const bVersion = (await pool.query("SELECT version FROM student_transcripts WHERE user_id=$1", [actors.b.userId])).rows[0].version;
  assert.deepEqual((await call("DELETE", "/api/student/transcript", "b", { body: { version: bVersion, confirmed: true } })).body, { deleted: true });
  assert.equal(await count("stu_comp_assessments WHERE user_id=$1", [actors.b.userId]), 0);
  assert.equal(await count("stu_comp_assessments WHERE user_id=$1", [actors.a.userId]), 20);
  checks.push("DELETE /transcript removes the student's stu_comp rows in the same transaction and leaves other students untouched");

  // Cascade: an OCR job that replaces A's transcript removes A's results.
  const aVersion = (await pool.query("SELECT version FROM student_transcripts WHERE user_id=$1", [actors.a.userId])).rows[0].version;
  const jobId = randomUUID(), lease = randomUUID();
  await pool.query(`INSERT INTO transcript_jobs(id,user_id,filename,pdf_data,expected_version,status,lease_token,lease_until,attempts)
 VALUES($1,$2,'bang-diem.pdf',$3,$4,'processing',$5,now()+interval '10 minutes',1)`, [jobId, actors.a.userId, Buffer.from("%PDF-1.7 audit"), aVersion, lease]);
  const ocr = { schema_version: "1.1", adapter: "vlu_8_columns", course_count: 1, needs_review: false, pages: [{ page: 1, method: "ppocr", warnings: [] }],
    courses: [{ ordinal: 1, course_code: "71ITBS10103", course_name: "Nhập môn Công nghệ thông tin", credits: 3, score_10: 7, score_4: 3, letter_grade: "B",
      result: "passed", source_page: 1, academic_year: "2023-2024", semester: "HK01", section: "semester", needs_review: false, issues: [] }],
    summaries: [], semesters: [], unparsed_rows: [] };
  const completed = await fetch(`${baseUrl}/api/worker/transcripts/${jobId}/complete`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${workerKey}` }, body: JSON.stringify({ leaseToken: lease, result: ocr }) });
  assert.equal(completed.status, 200);
  assert.notEqual((await pool.query("SELECT version FROM student_transcripts WHERE user_id=$1", [actors.a.userId])).rows[0].version, aVersion);
  assert.equal(await count("stu_comp_assessments WHERE user_id=$1", [actors.a.userId]), 0);
  checks.push("an OCR job that replaces the transcript removes the student's stu_comp rows");

  // Withdraw consent.
  assert.equal((await assess("a")).status, 201);

  // AI job expiry works without the worker (it also runs from the student API): a single-attempt
  // processing job whose lease expired and a queued job, both older than 24 h, fail with
  // worker_timeout and lose ai_input; their assessments are marked failed but kept.
  const aAssessment = (await pool.query("SELECT id FROM stu_comp_assessments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [actors.a.userId])).rows[0].id;
  const bAssessment = randomUUID();
  await pool.query(`INSERT INTO stu_comp_assessments(id,user_id,transcript_version,meta,computed,ai_status)
 SELECT $1,$2,transcript_version,meta,computed,'queued' FROM stu_comp_assessments WHERE id=$3`, [bAssessment, actors.b.userId, aAssessment]);
  await pool.query("UPDATE stu_comp_assessments SET ai_status='processing' WHERE id=$1", [aAssessment]);
  const staleProcessing = randomUUID(), staleQueued = randomUUID(), freshProcessing = randomUUID();
  await pool.query(`INSERT INTO stu_comp_ai_jobs(id,assessment_id,user_id,status,lease_token,lease_until,attempts,ai_input,created_at)
 VALUES($1,$2,$3,'processing',$4,now()-interval '1 hour',1,'{}',now()-interval '25 hours')`, [staleProcessing, aAssessment, actors.a.userId, randomUUID()]);
  await pool.query(`INSERT INTO stu_comp_ai_jobs(id,assessment_id,user_id,status,ai_input,created_at)
 VALUES($1,$2,$3,'queued','{}',now()-interval '25 hours')`, [staleQueued, bAssessment, actors.b.userId]);
  await expireCompetencyAiJobs(pool);
  const expiredJobs = (await pool.query("SELECT status,error_code,ai_input FROM stu_comp_ai_jobs WHERE id=ANY($1::uuid[])", [[staleProcessing, staleQueued]])).rows;
  assert.deepEqual(expiredJobs.map((row) => [row.status, row.error_code, row.ai_input]), [["failed", "worker_timeout", null], ["failed", "worker_timeout", null]]);
  const markedAssessments = (await pool.query("SELECT ai_status,ai_error_code FROM stu_comp_assessments WHERE id=ANY($1::uuid[])", [[aAssessment, bAssessment]])).rows;
  assert.deepEqual(markedAssessments.map((row) => [row.ai_status, row.ai_error_code]), [["failed", "worker_timeout"], ["failed", "worker_timeout"]]);
  // A recent single-attempt job with an expired lease is left for the worker to reclaim.
  await pool.query(`INSERT INTO stu_comp_ai_jobs(id,assessment_id,user_id,status,lease_token,lease_until,attempts,ai_input)
 VALUES($1,$2,$3,'processing',$4,now()-interval '1 minute',1,'{}')`, [freshProcessing, aAssessment, actors.a.userId, randomUUID()]);
  await expireCompetencyAiJobs(pool);
  assert.equal((await pool.query("SELECT status FROM stu_comp_ai_jobs WHERE id=$1", [freshProcessing])).rows[0].status, "processing");
  await pool.query("DELETE FROM stu_comp_ai_jobs WHERE id=$1", [freshProcessing]);
  checks.push("stale AI jobs (queued > 24 h, single-attempt processing > 24 h with an expired lease) fail with worker_timeout and lose ai_input; assessments are kept");
  await pool.query(`INSERT INTO stu_comp_ai_jobs(id,assessment_id,user_id,ai_input) SELECT $1,id,user_id,'{}' FROM stu_comp_assessments WHERE user_id=$2`, [randomUUID(), actors.a.userId]);
  assert.deepEqual((await call("DELETE", "/api/student/competency-assessments", "a", { body: {} })).body, { error: "invalid_input" });
  assert.deepEqual((await call("DELETE", "/api/student/competency-assessments", "a", { body: { confirmed: true } })).body, { deleted: true });
  assert.equal(await count("stu_comp_assessments WHERE user_id=$1", [actors.a.userId]), 0);
  assert.equal(await count("stu_comp_ai_jobs WHERE user_id=$1", [actors.a.userId]), 0);
  assert.equal(await count("data_consents WHERE user_id=$1 AND purpose='competency_assessment' AND ended_at IS NULL", [actors.a.userId]), 0);
  assert.equal(await count("data_consents WHERE user_id=$1 AND purpose='competency_assessment' AND end_reason='withdrawn'", [actors.a.userId]), 1);
  assert.equal((await call("GET", "/api/student/competency-assessments/latest", "a")).body.consentVersion, null, "a withdrawn consent is not reported as active");
  checks.push("withdrawing consent deletes every result and AI job of the student and ends the consent as 'withdrawn'");

  // Specialty on the profile.
  assert.deepEqual((await call("PATCH", "/api/student/profile", "a", { body: { specialty: "CNDL" } })).body, { saved: true });
  assert.equal((await pool.query("SELECT specialty FROM student_profiles WHERE user_id=$1", [actors.a.userId])).rows[0].specialty, "CNDL");
  await call("PATCH", "/api/student/profile", "a", { body: { interests: "Dữ liệu" } });
  assert.equal((await pool.query("SELECT specialty FROM student_profiles WHERE user_id=$1", [actors.a.userId])).rows[0].specialty, "CNDL");
  await call("PATCH", "/api/student/profile", "a", { body: { specialty: null } });
  assert.equal((await pool.query("SELECT specialty FROM student_profiles WHERE user_id=$1", [actors.a.userId])).rows[0].specialty, null);
  assert.equal((await call("PATCH", "/api/student/profile", "a", { body: { specialty: "ATTT" } })).status, 400);
  checks.push("PATCH /profile saves, keeps (absent) and clears (null) the specialty and rejects unknown codes");

  if (withOllama) await runOllamaCheck(skills);
  console.log(checks.map((check) => `PASS ${check}`).join("\n"));
} finally {
  if (server) await new Promise((done) => server.close(done));
  if (aiServer) await new Promise((done) => aiServer.close(done));
  await pool.end();
  if (schemaCreated) await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  const leftover = await adminPool.query("SELECT nspname FROM pg_namespace WHERE nspname=$1", [schema]);
  await adminPool.end();
  assert.equal(leftover.rowCount, 0, "the audit schema must be dropped");
}

// One real AI job, synthetic data only: POST with AI enabled -> worker claim -> local Ollama -> complete -> GET /latest.
async function runOllamaCheck(skills) {
  const aiKey = randomBytes(32).toString("hex");
  const user = actors.c = actor("c");
  await pool.query(`INSERT INTO users(id,entra_tenant_id,entra_object_id,entra_subject,display_name,email,username,role,is_active)
 VALUES($1,$2,$3,$4,$5,$6,$7,'student',TRUE)`, [user.userId, tenantId, user.objectId, user.objectId, user.name, user.email, user.username]);
  const position = (await pool.query("SELECT id FROM career_positions WHERE deleted_at IS NULL ORDER BY code LIMIT 1")).rows[0].id;
  await pool.query("UPDATE career_requirements SET deleted_at=now() WHERE career_position_id=$1", [position]);
  for (const [index, skill] of skills.entries()) {
    await pool.query("INSERT INTO career_requirements(career_position_id,skill_id,title,is_required) VALUES($1,$2,$3,$4)",
      [position, skill, `Kỹ năng kiểm thử ${index + 1}`, index === 0]);
  }
  await pool.query("INSERT INTO student_profiles(user_id,cohort_code,specialty,career_position_id) VALUES($1,'K29',NULL,$2)", [user.userId, position]);
  await setTranscript(user, transcriptData([["71ITBS10103", "A", 8.6], ["71ITBS10203", "B+", 7.8], ["71ITSE30103", "B", 7.0], ["71AV010003", "MT", null]]));

  const app = express();
  app.use("/api/worker/competency-assessments", createCompetencyWorkerRouter(pool, aiKey));
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: actors[req.get("x-audit-user")] }; next(); });
  app.use("/api/student/competency-assessments",
    createCompetencyAssessmentRouter(pool, origin, createCompetencyAiQueue({ enabled: true }), { promptVersion: PROMPT_VERSION }));
  app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: "internal" }); });
  aiServer = app.listen(0, "127.0.0.1");
  await new Promise((done) => aiServer.once("listening", done));
  const aiBase = `http://127.0.0.1:${aiServer.address().port}`;
  const studentCall = async (method, path) => {
    const response = await fetch(aiBase + "/api/student/competency-assessments" + path, { method,
      headers: { "content-type": "application/json", origin, "x-audit-user": "c", "x-consent-policy-version": TRANSCRIPT_POLICY_VERSION } });
    return { status: response.status, body: await response.json() };
  };

  const created = await studentCall("POST", "");
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.assessment.ai.status, "queued");
  assert.equal(created.body.assessment.meta.promptVersion, PROMPT_VERSION);
  const badKey = await fetch(aiBase + "/api/worker/competency-assessments/claim", { method: "POST", headers: { authorization: "Bearer " + "x".repeat(64) } });
  assert.equal(badKey.status, 401);

  const runtime = { ollamaUrl: "http://127.0.0.1:11434", model: process.env.OLLAMA_MODEL || "gemma4:e4b", contextLength: 16384,
    timeoutMs: 600000, numGpu: Number(process.env.OLLAMA_NUM_GPU || 38) };
  const client = createWorkerClient({ apiUrl: aiBase, workerKey: aiKey });
  const events = [];
  const deps = { client, model: runtime.model, log: (event, fields = {}) => events.push({ event, ...fields }),
    ollama: { chat: (job, signal) => ollamaChat(runtime, job, {}, signal), modelInfo: () => getOllamaModelInfo(runtime) } };
  const started = Date.now();
  await client.heartbeat();
  assert.equal((await studentCall("GET", "/latest/status")).body.workerOnline, true);
  const job = await client.claim();
  assert(job, "the queued job must be claimable");
  const processing = (await studentCall("GET", "/latest/status")).body.aiStatus;
  const outcome = await processJob(job, await deps.ollama.modelInfo(), deps, new AbortController().signal);
  const seconds = (Date.now() - started) / 1000;
  assert.equal(outcome, "completed", JSON.stringify(events));

  const latest = await studentCall("GET", "/latest");
  const ai = latest.body.assessment.ai;
  assert.equal(ai.status, "completed", JSON.stringify({ status: ai.status, errorCode: ai.errorCode }));
  assert.equal(typeof ai.output.summary, "string");
  const jobRow = (await pool.query("SELECT status,ai_input,metrics FROM stu_comp_ai_jobs WHERE id=$1", [job.id])).rows[0];
  assert.equal(jobRow.status, "completed");
  assert.equal(jobRow.ai_input, null, "ai_input is cleared after completion");
  const row = (await pool.query("SELECT ai_model,ai_model_digest,ollama_version,prompt_version FROM stu_comp_assessments WHERE id=$1",
    [latest.body.assessment.id])).rows[0];
  console.log(JSON.stringify({ ollama: { seconds, statusWhileRunning: processing, model: row.ai_model, digest: row.ai_model_digest,
    ollamaVersion: row.ollama_version, promptVersion: row.prompt_version, numGpu: runtime.numGpu, metrics: jobRow.metrics,
    events: events.map((item) => item.event), output: ai.output } }, null, 2));
  checks.push(`with AI enabled, POST queues a job; one real worker iteration on local Ollama completes it in ${seconds.toFixed(1)} s and GET /latest returns a validated output`);
}
