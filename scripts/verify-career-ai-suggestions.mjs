// Real-router PostgreSQL checks for AI skill suggestions of career positions
// ("Tạo liên kết kỹ năng với nghề nghiệp (AI)", docs/career-ai-suggestions.md).
// Every write stays in a disposable LOCAL schema that is dropped at the end. The schema is seeded by
// copying the career fields, careers, skill catalog and skill links from the local public schema
// (admin data only, read-only; no users or student data are copied).
// Run after building apps/api: npm run build -w @edupath/api && node scripts/verify-career-ai-suggestions.mjs
// Without flags the worker's model call is simulated with a hand-written output (the real worker code
// still parses and posts it). Add --with-ollama to run the real worker loop (dist/ai-worker) against the
// LOCAL Ollama with the non-secret settings of services/ai/.env (OLLAMA_URL, OLLAMA_MODEL, OLLAMA_NUM_GPU, …).
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import express from "express";
import pg from "pg";
import { createCareersRouter, fold } from "../apps/api/dist/careers/router.js";
import { CAREER_SUGGESTION_PROMPT_VERSION } from "../apps/api/dist/careers/ai-suggestions/prompt.js";
import { createCompetencyWorkerRouter } from "../apps/api/dist/competency-assessment/ai/worker-router.js";
import { createWorkerClient } from "../apps/api/dist/ai-worker/client.js";
import { parseAiWorkerEnvFile, DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL } from "../apps/api/dist/ai-worker/config.js";
import { getOllamaModelInfo, ollamaChat } from "../apps/api/dist/ai-worker/ollama.js";
import { processJob, runWorker } from "../apps/api/dist/ai-worker/worker.js";

const withOllama = process.argv.includes("--with-ollama");
const targetCodes = ["NN004", "NN005", "NN003"];

const env = dotenv.parse(await readFile("apps/api/.env", "utf8"));
assert(env.DATABASE_URL, "apps/api/.env must define DATABASE_URL");
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.DATABASE_URL).hostname), "Integration checks require a LOCAL database");
const schema = "career_ai_audit_" + randomBytes(6).toString("hex");
assert(/^career_ai_audit_[0-9a-f]{12}$/.test(schema));
const migrations = ["007_student_transcripts.sql", "010_transcript_jobs.sql", "011_curricula.sql", "012_training_plans.sql", "013_graduation_standards.sql",
  "014_career_positions.sql", "015_career_fields.sql", "016_career_requirements.sql", "027_remove_career_requirement_level.sql",
  "019_career_skill_management.sql", "020_career_field_numbers.sql", "021_career_position_codes.sql", "018_data_consents.sql",
  "026_competency_management.sql", "028_student_specialty.sql", "029_student_competency_assessments.sql", "030_competency_consent.sql",
  "031_career_ai_suggestions.sql"];
const copied = ["career_fields", "career_positions", "career_skills", "career_requirements"];
const adminPool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
// search_path is the audit schema ONLY, so a missing table can never fall through to public.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 8, options: `-c search_path=${schema}` });
const origin = "http://career-ai-suggestions.audit";
const workerKey = randomBytes(32).toString("hex");
const tenantId = randomUUID();
const actor = (name, role) => ({ userId: randomUUID(), tenantId, objectId: randomUUID(), identityKey: `career-ai-audit:${name}`, name: `Audit ${name}`,
  email: `${name}@career-ai-audit.example.test`, username: `${name}@career-ai-audit.example.test`, role, signedInAt: new Date(0).toISOString() });
const actors = { admin: actor("admin", "admin"), student: actor("student", "student") };
const checks = [];
let schemaCreated = false;
let server;
let baseUrl;

const inSchema = (sql) => sql.replaceAll("public.", `${schema}.`).replaceAll("SET search_path=public,pg_temp", `SET search_path=${schema},pg_temp`)
  .replaceAll("nspname='public'", `nspname='${schema}'`);
const count = async (sql, params = []) => (await pool.query(`SELECT count(*)::int AS count FROM ${sql}`, params)).rows[0].count;
const publicCounts = async () => (await adminPool.query(`SELECT
  (SELECT count(*)::int FROM public.career_fields) AS fields,(SELECT count(*)::int FROM public.career_positions) AS careers,
  (SELECT count(*)::int FROM public.career_skills) AS skills,(SELECT count(*)::int FROM public.career_requirements) AS requirements,
  (SELECT count(*)::int FROM public.career_ai_suggestions) AS suggestions`)).rows[0];

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
  // Replace the rows seeded by the migrations with a read-only copy of the local admin data.
  // The code triggers are disabled during the copy so codes (NN003…) and field numbers stay as they are.
  await pool.query(`TRUNCATE ${copied.join(",")} CASCADE`);
  await pool.query("ALTER TABLE career_fields DISABLE TRIGGER career_fields_assign_number; ALTER TABLE career_positions DISABLE TRIGGER career_positions_assign_code");
  for (const table of copied) {
    const columns = (await adminPool.query(`SELECT a.column_name FROM information_schema.columns a JOIN information_schema.columns b
      ON b.table_schema=$2 AND b.table_name=a.table_name AND b.column_name=a.column_name
      WHERE a.table_schema='public' AND a.table_name=$1 ORDER BY a.ordinal_position`, [table, schema])).rows.map((row) => `"${row.column_name}"`).join(",");
    await adminPool.query(`INSERT INTO ${schema}.${table}(${columns}) SELECT ${columns} FROM public.${table}`);
  }
  await pool.query("ALTER TABLE career_fields ENABLE TRIGGER career_fields_assign_number; ALTER TABLE career_positions ENABLE TRIGGER career_positions_assign_code");
}

async function call(method, path, user = "admin", { body, headers = {}, base = "/api/admin/careers" } = {}) {
  const response = await fetch(baseUrl + base + path, {
    method, headers: { "content-type": "application/json", origin, "x-audit-user": user ?? "", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
const ai = (method, path = "", options = {}) => call(method, "/requirements/ai-suggestions" + path, "admin", options);
async function worker(path, body) {
  const response = await fetch(`${baseUrl}/api/worker/competency-assessments${path}`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${workerKey}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
const requirementsOf = async (careerId) => (await call("GET", `/requirements?careerPositionId=${careerId}`)).body.items;
const pending = () => count("career_ai_suggestions WHERE status IN ('queued','processing')");

/** Key -> name of the catalog block and the linked skill names, read from a claimed job's user message. */
function promptData(user) {
  const keys = new Map([...user.matchAll(/^(S\d{3}) \| ([^|\n]+)/gm)].map((match) => [match[1], match[2].trim()]));
  const linked = user.split("[2. KỸ NĂNG ĐÃ LIÊN KẾT]")[1].split("[3.")[0].split("\n").filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).split(" | ")[0]);
  return { keys, linked };
}

/**
 * A hand-written model answer for the simulated worker: 6 suggestions (one with a key in prose, one
 * repeated key, one unknown key, one with a link) and 3 new skills (one really new, written with a
 * "Kỹ năng" prefix and marked required, one equal to a catalog skill written in capitals, one equal to a
 * linked skill). 5 items survive the server check; the new skill is stored without the prefix as Ưu tiên.
 */
function simulatedOutput(job) {
  const { keys, linked } = promptData(job.user);
  const [k1, k2, k3, k4, k5] = job.schema.properties.suggestions.items.properties.skillKey.enum;
  const item = (priority, title) => ({ priority, title, description: `Áp dụng kỹ năng này trong công việc hằng ngày của vị trí.`, reason: "Phù hợp với mô tả vị trí." });
  return {
    suggestions: [
      { skillKey: k1, ...item("required", `Vận dụng ${keys.get(k1)} trong công việc chính`), description: `Kết hợp với ${k2} khi xử lý yêu cầu hằng ngày.` },
      { skillKey: k2, ...item("preferred", `Sử dụng ${keys.get(k2)} khi cần`) },
      { skillKey: k1, ...item("preferred", "Mục lặp lại sẽ bị bỏ") },
      { skillKey: "S999", ...item("preferred", "Khóa không có trong danh mục") },
      { skillKey: k3, ...item("preferred", "Xem thêm tại https://example.com") },
      { skillKey: k4, ...item("preferred", `Áp dụng ${keys.get(k4)} trong dự án`) },
    ],
    newSkills: [
      { name: "Kỹ năng  kiểm chứng quy trình giả lập", ...item("required", "Kiểm chứng quy trình giả lập trước khi triển khai") },
      { name: keys.get(k5).toUpperCase(), ...item("preferred", `Thực hành ${keys.get(k5)}`) },
      { name: linked[0] ?? "Kỹ năng đã liên kết", ...item("required", "Kỹ năng đã liên kết sẽ bị bỏ") },
    ],
  };
}

try {
  const publicBefore = await publicCounts();
  await setupSchema();
  const careers = new Map((await pool.query(`SELECT id,code,name_vi FROM career_positions WHERE deleted_at IS NULL ORDER BY code`)).rows
    .map((row) => [row.code, row]));
  for (const code of targetCodes) assert(careers.has(code), `career ${code} must exist in the local data`);
  const target = targetCodes.map((code) => careers.get(code));
  const others = [...careers.values()].filter((career) => !targetCodes.includes(career.code));
  assert(others.length >= 9, "the checks need at least 12 careers");
  checks.push(`migrations 007-031 apply in a throwaway schema; copied ${careers.size} careers, ${await count("career_skills WHERE deleted_at IS NULL")} skills and ${await count("career_requirements WHERE deleted_at IS NULL")} links read-only from public`);

  const app = express();
  app.use("/api/worker/competency-assessments", createCompetencyWorkerRouter(pool, workerKey));
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: actors[req.get("x-audit-user")] }; next(); });
  app.use("/api/admin/careers", createCareersRouter(pool, origin, false, { aiSuggestions: true }));
  app.use("/api/disabled/careers", createCareersRouter(pool, origin, false, { aiSuggestions: false }));
  app.use("/api/student/careers", createCareersRouter(pool, origin, true));
  app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: "internal" }); });
  server = app.listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Access, origin, AI disabled, routing.
  const [nn004, nn005, nn003] = target;
  assert.deepEqual((await call("GET", "/requirements/ai-suggestions/status", "student")).body, { error: "insufficient_role" });
  assert.equal((await call("GET", "/requirements/ai-suggestions/status", "")).status, 401);
  assert.deepEqual((await ai("POST", "", { body: { careerPositionId: nn004.id }, headers: { origin: "http://evil.example" } })).body, { error: "invalid_origin" });
  assert.equal((await call("GET", "/requirements/ai-suggestions/status", "student", { base: "/api/student/careers" })).status, 404, "the student careers router has no AI routes");
  assert.deepEqual((await call("GET", "/requirements/ai-suggestions/status", "admin", { base: "/api/disabled/careers" })).body,
    { enabled: false, worker: { online: false, supportsSuggestions: false, seenAt: null } });
  assert.deepEqual((await call("POST", "/requirements/ai-suggestions", "admin", { base: "/api/disabled/careers", body: { careerPositionId: nn004.id } })).body,
    { error: "ai_disabled" });
  assert.deepEqual((await ai("POST", "", { body: { careerPositionId: randomUUID() } })).body, { error: "career_not_found" });
  assert.deepEqual((await ai("POST", "", { body: { careerPositionId: "x" } })).body, { error: "invalid_ai_suggestion" });
  assert.deepEqual((await ai("GET", `/${randomUUID()}`)).body, { error: "suggestion_not_found" });
  assert.deepEqual((await call("GET", `/requirements/${randomUUID()}`)).body, { error: "requirement_not_found" }, "/requirements/:id still works");
  assert.equal(await count("career_ai_suggestions"), 0);
  checks.push("students, anonymous users and foreign origins are refused; with AI_WORKER_KEY unset POST answers 503 ai_disabled; the student router has no AI routes; /requirements/:id is not captured");

  // Status before and after an old worker's heartbeat.
  const status0 = (await ai("GET", "/status")).body;
  assert.deepEqual(status0, { enabled: true, worker: { online: false, supportsSuggestions: false, seenAt: null } });
  assert.deepEqual((await worker("/heartbeat", {})).body, { ok: true });
  const oldStatus = (await ai("GET", "/status")).body.worker;
  assert.equal(oldStatus.online, true);
  assert.equal(oldStatus.supportsSuggestions, false, "an old worker does not support career suggestions");
  checks.push("GET /status: offline before any heartbeat; an old worker's heartbeat ({}) is online but does not support suggestions");

  // Queue the three careers.
  const queued = {};
  const requestedAt = {};
  for (const career of target) {
    requestedAt[career.code] = Date.now();
    const created = await ai("POST", "", { body: { careerPositionId: career.id } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.suggestion.status, "queued");
    assert.deepEqual(created.body.suggestion.items, []);
    assert.equal(created.body.suggestion.promptVersion, CAREER_SUGGESTION_PROMPT_VERSION);
    queued[career.code] = created.body.suggestion;
    const again = await ai("POST", "", { body: { careerPositionId: career.id } });
    assert.equal(again.status, 200);
    assert.equal(again.body.suggestion.id, created.body.suggestion.id);
    assert.equal((await ai("GET", `/latest?careerPositionId=${career.id}`)).body.suggestion.id, created.body.suggestion.id);
  }
  assert.equal(await pending(), 3);
  // The stored input: enum = unlinked catalog keys, linked skills listed as context only, no personal data.
  for (const career of target) {
    const row = (await pool.query("SELECT ai_input,requested_by FROM career_ai_suggestions WHERE id=$1", [queued[career.code].id])).rows[0];
    assert.equal(row.requested_by, actors.admin.userId);
    const linkedIds = (await pool.query("SELECT skill_id FROM career_requirements WHERE career_position_id=$1 AND deleted_at IS NULL AND skill_id IS NOT NULL",
      [career.id])).rows.map((link) => link.skill_id);
    const active = await count("career_skills WHERE deleted_at IS NULL");
    assert.equal(row.ai_input.catalog.length, active - new Set(linkedIds).size);
    assert(row.ai_input.catalog.every((entry) => !linkedIds.includes(entry.id)));
    assert.deepEqual(row.ai_input.schema.properties.suggestions.items.properties.skillKey.enum, row.ai_input.catalog.map((entry) => entry.key));
    assert.equal(row.ai_input.linked.length, linkedIds.length);
    assert(row.ai_input.user.includes(`Mã: ${career.code}`));
    assert(!/@|users|student/i.test(row.ai_input.user), "no personal data in the prompt");
    assert.deepEqual(row.ai_input.options, { num_ctx: 16384, num_predict: 3072, temperature: 0.3, top_p: 0.95, top_k: 64 });
  }
  checks.push("POST queues one suggestion per career (201), a repeat returns the pending one (200); ai_input holds the unlinked catalog as the key enum, linked skills as context and the agreed options");

  // Old-style claims never receive a career job.
  assert.deepEqual((await worker("/claim", {})).body, { job: null });
  assert.deepEqual((await worker("/claim", { kinds: ["competency_assessment"] })).body, { job: null });
  assert.deepEqual((await worker("/claim", { kinds: ["unknown_kind"] })).body, { job: null });
  assert.equal(await count("career_ai_suggestions WHERE status='queued' AND attempts=0"), 3);
  assert.equal((await ai("GET", "/status")).body.worker.supportsSuggestions, false);
  checks.push("claims with {} , competency-only or unknown kinds return no job while 3 career jobs are queued (none is touched)");

  // Global cap of 10 pending, then cancel.
  const extra = others.slice(0, 7);
  for (const career of extra) assert.equal((await ai("POST", "", { body: { careerPositionId: career.id } })).status, 201);
  assert.equal(await pending(), 10);
  const full = await ai("POST", "", { body: { careerPositionId: others[7].id } });
  assert.equal(full.status, 429);
  assert.deepEqual(full.body, { error: "ai_queue_full" });
  for (const career of extra) {
    const latest = (await ai("GET", `/latest?careerPositionId=${career.id}`)).body.suggestion;
    const cancelled = await ai("POST", `/${latest.id}/cancel`, { body: {} });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.suggestion.status, "cancelled");
    assert.equal((await ai("GET", `/latest?careerPositionId=${career.id}`)).body.suggestion, null);
  }
  const extraRow = (await pool.query("SELECT id,ai_input,lease_token FROM career_ai_suggestions WHERE career_position_id=$1", [extra[0].id])).rows[0];
  assert.equal(extraRow.ai_input, null);
  assert.deepEqual((await ai("POST", `/${extraRow.id}/cancel`, { body: {} })).body, { error: "suggestion_not_active" });
  assert.equal((await ai("POST", `/${extraRow.id}/cancel`, { body: { force: true } })).status, 400);
  assert.equal(await pending(), 3);
  checks.push("the 11th pending suggestion is refused with 429 ai_queue_full; cancel works on queued rows (ai_input cleared, /latest null) and a second cancel is 409 suggestion_not_active");

  // Run the worker.
  const timings = {};
  const claimed = [];
  const events = [];
  const baseClient = createWorkerClient({ apiUrl: baseUrl, workerKey });
  const client = { ...baseClient, claim: async () => { const job = await baseClient.claim(); if (job) claimed.push(job); return job; } };
  const log = (event, fields = {}) => {
    events.push({ event, at: Date.now(), ...fields });
    if (event === "job_claimed") timings[fields.job] = { claimed: Date.now() };
    if (event === "generation_finished") Object.assign(timings[fields.job], { generationMs: (timings[fields.job].generationMs ?? 0) + fields.ms, attempt: fields.attempt,
      promptTokens: fields.prompt_eval_count, outputTokens: fields.eval_count });
    if (event === "job_finished") Object.assign(timings[fields.job], { finished: Date.now(), outcome: fields.outcome });
  };
  let runtime = null;
  if (withOllama) {
    const workerEnv = parseAiWorkerEnvFile(await readFile("services/ai/.env", "utf8").catch(() => ""));
    // Non-secret settings only; the worker key and API URL of the real worker are never read here.
    runtime = { ollamaUrl: workerEnv.OLLAMA_URL || DEFAULT_OLLAMA_URL, model: workerEnv.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
      contextLength: Number(workerEnv.OLLAMA_CONTEXT || 16384), timeoutMs: Number(workerEnv.AI_TIMEOUT_MS || 600000), numGpu: Number(workerEnv.OLLAMA_NUM_GPU || 38) };
    assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(runtime.ollamaUrl).hostname));
    console.log(JSON.stringify({ ollamaSettings: runtime }));
    const controller = new AbortController();
    const deps = { client, model: runtime.model, log,
      ollama: { chat: (job, signal) => ollamaChat(runtime, job, {}, signal), modelInfo: () => getOllamaModelInfo(runtime) } };
    const loop = runWorker(deps, controller.signal);
    const deadline = Date.now() + 30 * 60_000;
    let sawSupport = false;
    while (await pending() > 0) {
      assert(Date.now() < deadline, "the worker did not finish the 3 jobs within 30 minutes");
      if (!sawSupport && claimed.length) sawSupport = (await ai("GET", "/status")).body.worker.supportsSuggestions;
      await new Promise((done) => setTimeout(done, 1000));
    }
    controller.abort();
    await loop;
    assert(sawSupport, "a new worker advertises career suggestions");
  } else {
    const deps = { client, model: "simulated-model", log,
      ollama: {
        chat: async (job) => ({ content: JSON.stringify(simulatedOutput(job)), doneReason: "stop", metrics: { prompt_eval_count: 1, eval_count: 1 } }),
        modelInfo: async () => ({ version: "0.0.0-sim", digest: "sim-digest" })
      } };
    for (;;) {
      const job = await client.claim();
      if (!job) break;
      assert.equal(job.kind, "career_skill_suggestion");
      assert.equal((await ai("GET", "/status")).body.worker.supportsSuggestions, true);
      assert.equal(await processJob(job, await deps.ollama.modelInfo(), deps, new AbortController().signal), "completed");
    }
  }
  assert.equal(claimed.length, 3, `claimed ${claimed.length} jobs`);
  for (const job of claimed) {
    assert.equal(job.kind, "career_skill_suggestion");
    assert.deepEqual(Object.keys(job).sort(), ["id", "kind", "leaseToken", "options", "promptVersion", "schema", "system", "user"]);
  }
  checks.push(`a new worker claims the 3 career jobs (kind career_skill_suggestion, no key map in the job) ${withOllama ? "with the real worker loop and local Ollama" : "with a simulated model answer"}`);

  // Results.
  const report = [];
  const results = {};
  for (const career of target) {
    const suggestion = (await ai("GET", `/latest?careerPositionId=${career.id}`)).body.suggestion;
    assert(suggestion, `${career.code} has a suggestion`);
    const row = (await pool.query("SELECT status,error_code,ai_input,result,metrics,ai_model,ai_model_digest,ollama_version,prompt_version,completed_at FROM career_ai_suggestions WHERE id=$1",
      [suggestion.id])).rows[0];
    const time = timings[suggestion.id] ?? {};
    report.push({ code: career.code, career: career.name_vi, status: suggestion.status, errorCode: suggestion.errorCode,
      secondsFromRequest: time.finished ? Math.round((time.finished - requestedAt[career.code]) / 100) / 10 : null,
      secondsProcessing: time.finished ? Math.round((time.finished - time.claimed) / 100) / 10 : null,
      generationSeconds: time.generationMs ? Math.round(time.generationMs / 100) / 10 : null, attempt: time.attempt ?? null,
      promptTokens: time.promptTokens ?? null, outputTokens: time.outputTokens ?? null,
      returned: row.result?.returned ?? null, dropped: row.result?.dropped ?? null, model: row.ai_model, ollamaVersion: row.ollama_version,
      items: suggestion.items.map((item) => ({ priority: item.isRequired ? "Bắt buộc" : "Ưu tiên", skill: item.skillName, new: item.isNewSkill,
        alreadyLinked: item.alreadyLinked, similarTo: item.similarLinkedSkill, title: item.title, description: item.description, reason: item.reason })) });
    assert.equal(suggestion.status, "completed", JSON.stringify({ code: career.code, errorCode: suggestion.errorCode }));
    assert.equal(row.ai_input, null, "ai_input is cleared when the job ends");
    assert.equal(row.prompt_version, CAREER_SUGGESTION_PROMPT_VERSION);
    assert(row.ai_model && row.completed_at && row.metrics);
    assert.equal(suggestion.items.length, row.result.items.length);
    suggestion.items.forEach((item, index) => assert.equal(item.index, index));
    for (const item of suggestion.items) {
      assert(!/\bS\d{3}\b/.test([item.title, item.description, item.reason].join(" ")), "no catalog keys left in prose");
      assert(item.title.length <= 160 && item.description.length <= 600 && item.reason.length <= 300);
      assert.equal(item.alreadyLinked, false, "nothing suggested is linked yet");
      assert(item.similarLinkedSkill === null || typeof item.similarLinkedSkill === "string");
      if (item.isNewSkill) assert.equal(item.isRequired, false, "new skills are stored as Ưu tiên");
    }
    assert(suggestion.items.filter((item) => item.isRequired).length <= 5, "at most 5 Bắt buộc");
    if (!withOllama) {
      assert.deepEqual([row.result.returned, row.result.dropped, suggestion.items.length], [9, 4, 5]);
      assert.deepEqual(suggestion.items.map((item) => item.isNewSkill), [false, false, false, true, false]);
      assert.equal(suggestion.items[3].skillName, "Kiểm chứng quy trình giả lập", "the 'Kỹ năng' prefix is dropped");
      assert.equal(suggestion.items[3].isRequired, false);
      assert.equal(suggestion.items[4].skillName, row.result.items[4].skillName, "a capitalised catalog name becomes that catalog skill");
      assert(suggestion.items[4].skillId);
      assert(!suggestion.items[0].description.includes("S0"), "a key in prose is replaced by the skill name");
    }
    results[career.code] = suggestion;
  }
  if (!withOllama) checks.push("the server keeps 5 of 9 simulated items: unknown and repeated keys, a link and a linked new name are dropped, a key in prose becomes the name, a capitalised catalog name becomes that skill");
  else checks.push("all 3 real suggestions completed, were validated and stored with model info and metrics; ai_input was cleared and no key is left in prose");

  // Worker protocol after completion.
  const done = claimed[0];
  assert.deepEqual((await worker(`/${done.id}/extend`, { leaseToken: done.leaseToken })).body, { error: "job_expired" });
  const repeat = await worker(`/${done.id}/complete`, { leaseToken: done.leaseToken, error: "ai_failed" });
  assert.deepEqual(repeat.body, { ok: true }, "a repeated complete under the same lease is idempotent");
  assert.equal((await pool.query("SELECT status FROM career_ai_suggestions WHERE id=$1", [done.id])).rows[0].status, "completed");
  assert.deepEqual((await worker(`/${done.id}/complete`, { leaseToken: randomUUID(), error: "ai_failed" })).body, { error: "job_expired" });
  assert.deepEqual((await ai("POST", `/${done.id}/cancel`, { body: {} })).body, { error: "suggestion_not_active" });
  checks.push("after completion: extend is 409 job_expired, a repeated complete under the same lease is a no-op, another lease is refused, cancel is 409");

  // Apply on NN004: duplicates first, nothing saved.
  const s4 = results.NN004;
  const before4 = await requirementsOf(nn004.id);
  const skillsBefore = await count("career_skills WHERE deleted_at IS NULL");
  const linked4 = before4.find((requirement) => requirement.skillId);
  assert(linked4, "NN004 has a linked skill");
  const catalogItems = s4.items.filter((item) => !item.isNewSkill);
  assert(catalogItems.length >= 2, "NN004 needs at least 2 catalog suggestions");
  const keep = (item, changes = {}) => ({ skillId: item.skillId, skillName: item.skillName, title: item.title, description: item.description,
    isRequired: item.isRequired, sourceIndex: item.index, ...changes });
  const catalogNames = (await pool.query("SELECT name FROM career_skills WHERE deleted_at IS NULL")).rows.map((row) => fold(row.name.trim()));
  const conflictCases = [
    [[keep(catalogItems[0]), { skillId: linked4.skillId, skillName: "", title: "Đã liên kết", description: "", isRequired: false, sourceIndex: null }], [linked4.skillName]],
    [[keep(catalogItems[0]), keep(catalogItems[0], { title: "Lặp lại" })], [catalogItems[0].skillName]],
    [[{ skillId: null, skillName: linked4.skillName.toUpperCase(), title: "Tên đã liên kết viết hoa", description: "", isRequired: false, sourceIndex: null }], [linked4.skillName]],
    // Extra spaces do not make a different name.
    [[{ skillId: null, skillName: " Quản lý  rủi ro dự án   kiểm chứng", title: "Một", description: "", isRequired: false, sourceIndex: null },
      { skillId: null, skillName: "QUAN LY RUI RO DU AN KIEM CHUNG", title: "Hai", description: "", isRequired: false, sourceIndex: null }], null],
  ];
  for (const [items, skills] of conflictCases) {
    const conflict = await ai("POST", `/${s4.id}/apply`, { body: { items } });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
    assert.equal(conflict.body.error, "requirement_exists");
    if (skills) assert.deepEqual(conflict.body.skills, skills);
    else assert.equal(conflict.body.skills.length, 1);
  }
  assert.equal((await ai("POST", `/${s4.id}/apply`, { body: { items: [] } })).body.error, "invalid_ai_suggestion");
  assert.equal((await ai("POST", `/${s4.id}/apply`, { body: { items: [{ ...keep(catalogItems[0]), title: "" }] } })).body.error, "invalid_ai_suggestion");
  assert.equal((await ai("POST", `/${s4.id}/apply`, { body: { items: [keep(catalogItems[0])] }, headers: { origin: "http://evil.example" } })).status, 403);
  assert.equal((await requirementsOf(nn004.id)).length, before4.length);
  assert.equal(await count("career_skills WHERE deleted_at IS NULL"), skillsBefore);
  checks.push("apply refuses a linked skill, the same skill twice, a new name equal to a linked skill (any case) and two equal new names (any case, extra spaces) with 409 requirement_exists + names; empty or invalid bodies are 400 and foreign origins 403; nothing is saved");

  // Apply a reviewed subset: up to 3 catalog rows (first one edited) and one new skill.
  const subset = catalogItems.slice(0, 3);
  const aiNew = s4.items.find((item) => item.isNewSkill);
  const typedName = "Kiểm chứng hành trình người dùng giả lập";
  assert(!catalogNames.includes(fold(typedName)));
  const edited = keep(subset[0], { title: `${subset[0].title.slice(0, 140)} (đã chỉnh)`, isRequired: !subset[0].isRequired });
  const newRow = aiNew ? keep(aiNew)
    : { skillId: null, skillName: typedName, title: "Mô phỏng hành trình người dùng để kiểm chứng yêu cầu", description: "Do quản trị viên tự thêm.", isRequired: false, sourceIndex: null };
  const applyItems = [edited, ...subset.slice(1).map((item) => keep(item)), newRow];
  const applied = await ai("POST", `/${s4.id}/apply`, { body: { items: applyItems } });
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  assert.equal(applied.body.created, applyItems.length);
  assert(applied.body.suggestion.appliedAt);
  const after4 = await requirementsOf(nn004.id);
  assert.equal(after4.length, before4.length + applyItems.length);
  for (const item of applyItems) {
    const saved = after4.find((requirement) => requirement.title === item.title);
    assert(saved, `requirement "${item.title}" was created`);
    assert.equal(saved.description, item.description);
    assert.equal(saved.isRequired, item.isRequired);
    assert.equal(saved.skillName, item.skillName);
    if (item.skillId) assert.equal(saved.skillId, item.skillId);
  }
  assert.equal(await count("career_skills WHERE deleted_at IS NULL"), skillsBefore + 1, "the kept new skill is created in the catalog");
  const cache = (await pool.query("SELECT skills FROM career_positions WHERE id=$1", [nn004.id])).rows[0].skills;
  assert(applyItems.every((item) => cache.includes(item.skillName)), "the career skills cache is refreshed");
  const auditRow = (await pool.query("SELECT applied_by,applied_summary,result FROM career_ai_suggestions WHERE id=$1", [s4.id])).rows[0];
  assert.equal(auditRow.applied_by, actors.admin.userId);
  assert.deepEqual(auditRow.applied_summary, { suggested: auditRow.result.items.length, saved: applyItems.length, edited: aiNew ? 1 : 2, newSkills: 1 });
  assert(applied.body.suggestion.items.filter((item) => applyItems.some((kept) => kept.sourceIndex === item.index)).every((item) => item.alreadyLinked));
  assert.deepEqual((await ai("POST", `/${s4.id}/apply`, { body: { items: [keep(catalogItems.at(-1))] } })).body, { error: "suggestion_already_applied" });
  assert.equal((await ai("GET", `/latest?careerPositionId=${nn004.id}`)).body.suggestion, null, "an applied suggestion is no longer offered");
  checks.push(`apply saves ${applyItems.length} reviewed rows (one edited, one new skill ${aiNew ? "from the AI" : "typed by the admin"}) in one transaction, creates the new skill, refreshes the skills cache and records applied_summary ${JSON.stringify(auditRow.applied_summary)}; a second apply is 409 suggestion_already_applied`);

  // alreadyLinked on NN005 after a manual link, then apply refuses it.
  const s5 = results.NN005;
  const first5 = s5.items.find((item) => item.skillId);
  const manual = await call("POST", "/requirements", "admin", { body: { careerPositionId: nn005.id, title: "Liên kết thủ công để kiểm chứng", description: "",
    skillId: first5.skillId, skillName: "", isRequired: false } });
  assert.equal(manual.status, 201, JSON.stringify(manual.body));
  const reread = (await ai("GET", `/${s5.id}`)).body.suggestion;
  assert.equal(reread.items.find((item) => item.index === first5.index).alreadyLinked, true);
  assert.equal(reread.items.filter((item) => item.alreadyLinked).length, 1);
  const linkedConflict = await ai("POST", `/${s5.id}/apply`, { body: { items: [keep(first5)] } });
  assert.deepEqual(linkedConflict.body, { error: "requirement_exists", skills: [first5.skillName] });
  checks.push("a skill linked manually after the suggestion shows alreadyLinked=true and apply refuses it with its name");

  // Failed output, a new request after a failure, cancel while processing, and suggestion_not_completed.
  const [failCareer, cancelCareer] = [others[7], others[8]];
  assert.equal((await ai("POST", "", { body: { careerPositionId: failCareer.id } })).status, 201);
  const failJob = (await worker("/claim", { kinds: ["competency_assessment", "career_skill_suggestion"] })).body.job;
  assert.equal(failJob.kind, "career_skill_suggestion");
  assert.deepEqual(Object.keys(failJob).sort(), ["id", "kind", "leaseToken", "options", "promptVersion", "schema", "system", "user"], "the raw claim has no key map");
  const badOutput = { suggestions: [{ skillKey: "S999", priority: "required", title: "Không có", description: "", reason: "" }], newSkills: [] };
  assert.deepEqual((await worker(`/${failJob.id}/complete`, { leaseToken: failJob.leaseToken, model: "sim", digest: "", ollamaVersion: "", metrics: {}, output: badOutput })).body, { ok: true });
  const failed = (await ai("GET", `/latest?careerPositionId=${failCareer.id}`)).body.suggestion;
  assert.deepEqual([failed.status, failed.errorCode, failed.items], ["failed", "invalid_ai_output", []]);
  assert.deepEqual((await ai("POST", `/${failed.id}/apply`, { body: { items: [{ skillId: null, skillName: "Bất kỳ", title: "Bất kỳ", description: "", isRequired: false, sourceIndex: null }] } })).body,
    { error: "suggestion_not_completed" });
  assert.equal((await ai("POST", "", { body: { careerPositionId: failCareer.id } })).status, 201, "a failed suggestion does not block a new request");
  const shapeJob = (await worker("/claim", { kinds: ["career_skill_suggestion"] })).body.job;
  assert.deepEqual((await worker(`/${shapeJob.id}/complete`, { leaseToken: shapeJob.leaseToken, model: "sim", digest: "", ollamaVersion: "", metrics: {}, output: { suggestions: "x" } })).body, { ok: true });
  assert.equal((await pool.query("SELECT error_code FROM career_ai_suggestions WHERE id=$1", [shapeJob.id])).rows[0].error_code, "invalid_ai_output");
  const emptyQueued = await ai("POST", "", { body: { careerPositionId: failCareer.id } });
  const emptyJob = (await worker("/claim", { kinds: ["career_skill_suggestion"] })).body.job;
  assert.equal(emptyJob.id, emptyQueued.body.suggestion.id);
  await worker(`/${emptyJob.id}/complete`, { leaseToken: emptyJob.leaseToken, model: "sim", digest: "", ollamaVersion: "", metrics: {}, output: { suggestions: [], newSkills: [] } });
  assert.deepEqual(((s) => [s.status, s.items])((await ai("GET", `/${emptyJob.id}`)).body.suggestion), ["completed", []]);
  checks.push("all items dropped -> failed invalid_ai_output, a wrong shape -> failed invalid_ai_output, an empty answer -> completed with no items; a failed suggestion cannot be applied (409 suggestion_not_completed) and does not block a new request");

  assert.equal((await ai("POST", "", { body: { careerPositionId: cancelCareer.id } })).status, 201);
  const runningJob = (await worker("/claim", { kinds: ["career_skill_suggestion"] })).body.job;
  assert.equal((await ai("GET", `/${runningJob.id}`)).body.suggestion.status, "processing");
  assert.deepEqual((await ai("POST", "", { body: { careerPositionId: cancelCareer.id } })).body.suggestion.id, runningJob.id, "a processing suggestion is returned, not duplicated");
  assert.equal((await ai("POST", `/${runningJob.id}/cancel`, { body: {} })).body.suggestion.status, "cancelled");
  assert.deepEqual((await worker(`/${runningJob.id}/extend`, { leaseToken: runningJob.leaseToken })).body, { error: "job_expired" });
  assert.deepEqual((await worker(`/${runningJob.id}/complete`, { leaseToken: runningJob.leaseToken, model: "sim", digest: "", ollamaVersion: "", metrics: {},
    output: { suggestions: [], newSkills: [] } })).body, { error: "job_expired" });
  assert.equal((await pool.query("SELECT status FROM career_ai_suggestions WHERE id=$1", [runningJob.id])).rows[0].status, "cancelled");
  checks.push("cancelling a processing suggestion stops it: the worker's extend and complete get 409 job_expired and the row stays cancelled");

  // Expiry: queued > 24 h and processing with an expired lease after the last attempt fail with worker_timeout.
  const stale = [randomUUID(), randomUUID()];
  await pool.query(`INSERT INTO career_ai_suggestions(id,career_position_id,status,ai_input,created_at) VALUES($1,$2,'queued','{}',now()-interval '25 hours')`, [stale[0], others[9].id]);
  await pool.query(`INSERT INTO career_ai_suggestions(id,career_position_id,status,ai_input,lease_token,lease_until,attempts)
    VALUES($1,$2,'processing','{}',$3,now()-interval '1 minute',2)`, [stale[1], others[10]?.id ?? others[0].id, randomUUID()]);
  const { expireCareerSuggestions } = await import("../apps/api/dist/careers/ai-suggestions/jobs.js");
  await expireCareerSuggestions(pool);
  const expired = (await pool.query("SELECT status,error_code,ai_input FROM career_ai_suggestions WHERE id=ANY($1::uuid[])", [stale])).rows;
  assert.deepEqual(expired.map((row) => [row.status, row.error_code, row.ai_input]), [["failed", "worker_timeout", null], ["failed", "worker_timeout", null]]);
  checks.push("stuck suggestions (queued > 24 h, processing with an expired lease after 2 attempts) fail with worker_timeout and lose ai_input");

  assert.deepEqual(await publicCounts(), publicBefore, "the public schema is unchanged");
  checks.push("the public schema's career tables and career_ai_suggestions are unchanged");

  console.log(JSON.stringify({ mode: withOllama ? "ollama" : "simulated", report }, null, 2));
  console.log(checks.map((check) => `PASS ${check}`).join("\n"));
} finally {
  if (server) await new Promise((done) => server.close(done));
  await pool.end();
  if (schemaCreated) await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  const leftover = await adminPool.query("SELECT nspname FROM pg_namespace WHERE nspname=$1", [schema]);
  await adminPool.end();
  assert.equal(leftover.rowCount, 0, "the audit schema must be dropped");
}
