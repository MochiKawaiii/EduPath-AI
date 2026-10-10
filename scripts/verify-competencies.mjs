// Real-router PostgreSQL integration checks. Every write stays in a disposable LOCAL schema.
// Run after building apps/api: node scripts/verify-competencies.mjs [--workbook=path.xlsx]
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import dotenv from "dotenv";
import express from "express";
import pg from "pg";
import ExcelJS from "exceljs";
import { createCompetenciesRouter } from "../apps/api/dist/competencies/router.js";
import { createCareersRouter } from "../apps/api/dist/careers/router.js";
import { CurriculumRepository } from "../apps/api/dist/curricula/repository.js";
import { readWorkbook } from "../apps/api/dist/curricula/parser.js";

const env = dotenv.parse(await readFile("apps/api/.env", "utf8"));
assert(env.DATABASE_URL, "apps/api/.env must define DATABASE_URL");
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.DATABASE_URL).hostname), "Integration checks require a LOCAL database");
const option = process.argv.find(argument => argument.startsWith("--workbook="));
const optionIndex = process.argv.indexOf("--workbook");
const workbookPath = option?.slice("--workbook=".length) ?? (optionIndex >= 0 ? process.argv[optionIndex + 1] : undefined)
  ?? "C:/Users/THIS PC/Downloads/EduPath_course_K29.xlsx";
const sourceBytes = await readFile(workbookPath);
const sourceFilename = basename(workbookPath);
const schema = "competencies_audit_" + randomBytes(6).toString("hex");
assert(/^competencies_audit_[0-9a-f]{12}$/.test(schema));
const extraSchemas = new Set();
const coreMigrations = ["011_curricula.sql", "014_career_positions.sql", "015_career_fields.sql", "016_career_requirements.sql",
  "019_career_skill_management.sql", "020_career_field_numbers.sql", "021_career_position_codes.sql"];
const adminPool = new pg.Pool({ connectionString: env.DATABASE_URL });
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10, options: `-c search_path=${schema},public` });
const auditOrigin = "http://competencies.audit";
const tenantId = randomUUID();
const roles = ["admin", "faculty_board", "department_head", "lecturer", "student"];
const actors = Object.fromEntries(roles.map(role => [role, {
  userId: randomUUID(), tenantId, objectId: randomUUID(), identityKey: `competency-audit:${role}`, name: `Competency audit ${role}`,
  email: `${role}@competency-audit.example.test`, username: `${role}@competency-audit.example.test`, role, signedInAt: new Date(0).toISOString(),
}]));
actors.revoked = { ...actors.lecturer, userId: randomUUID(), objectId: randomUUID() };
actors.locked = { ...actors.admin, userId: randomUUID(), objectId: randomUUID() };
const checks = [];
let schemaCreated = false;
let server;
let origin;

const dataTables = ["users", "student_profiles", "career_fields", "career_positions", "career_skills", "career_requirements",
  "curricula", "curriculum_revisions", "course_catalog", "curriculum_courses", "curriculum_relations", "curriculum_events",
  "competency_groups", "competency_skills", "competency_course_links",
  "ad_comp_groups", "ad_comp_skills", "ad_comp_course_configs", "ad_comp_course_links", "ad_comp_events",
  "ad_comp_import_aliases", "ad_comp_imports"];
const legacyTables = ["competency_groups", "competency_skills", "competency_course_links", "assessment_configurations",
  "student_assessments", "student_assessment_scopes"];
const legacySkills = new Map();
const legacyGroupIds = new Map();

async function fingerprint(db, targetSchema, omitLegacyBridge = false) {
  assert(targetSchema === "public" || targetSchema === schema || extraSchemas.has(targetSchema));
  const present = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=$1
 AND (table_name=ANY($2::text[]) OR table_name LIKE 'competency_%' OR table_name LIKE '%assessment%') ORDER BY table_name`, [targetSchema, dataTables])).rows;
  const result = {};
  for (const { table_name: table } of present) {
    assert((dataTables.includes(table) || /^competency_[a-z_]+$/.test(table) || /^[a-z_]*assessment[a-z_]*$/.test(table)) && /^[a-z_]+$/.test(table));
    const row = omitLegacyBridge && table === "ad_comp_skills" ? "(to_jsonb(t)-'legacy_skill_id')" : "to_jsonb(t)";
    result[table] = (await db.query(`SELECT count(*)::int AS count,
 md5(COALESCE(string_agg(md5(${row}::text),'' ORDER BY ${row}::text),'')) AS digest FROM ${targetSchema}.${table} t`)).rows[0];
  }
  return result;
}

function inSchema(sql, targetSchema) {
  assert(targetSchema === schema || extraSchemas.has(targetSchema));
  return sql.replaceAll("public.", `${targetSchema}.`).replaceAll("SET search_path=public,pg_temp", `SET search_path=${targetSchema},pg_temp`)
    .replaceAll("nspname='public'", `nspname='${targetSchema}'`);
}

async function verifyBootstrap(mode) {
  const targetSchema = `${schema}_${mode}`;
  assert(/^competencies_audit_[0-9a-f]{12}_(fresh|adopted)$/.test(targetSchema));
  extraSchemas.add(targetSchema);
  const db = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1, options: `-c search_path=${targetSchema},public` });
  let created = false;
  try {
    await adminPool.query(`CREATE SCHEMA ${targetSchema}`); created = true;
    await db.query(`CREATE TABLE users(id UUID PRIMARY KEY,entra_tenant_id UUID NOT NULL,entra_object_id UUID NOT NULL,
 entra_subject TEXT NOT NULL,display_name TEXT NOT NULL,email TEXT,username TEXT,role TEXT NOT NULL,role_override TEXT,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,auth_version INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE student_profiles(user_id UUID PRIMARY KEY REFERENCES users(id),student_code TEXT,full_name TEXT,cohort_code TEXT,class_name TEXT,career_goal TEXT);`);
    for (const filename of coreMigrations) await db.query(`BEGIN; ${inSchema(await readFile("apps/api/migrations/" + filename, "utf8"), targetSchema)} COMMIT;`);
    const migration = await readFile("apps/api/migrations/026_competency_management.sql", "utf8");
    let before;
    let oldHelpers;
    let profileId;
    if (mode === "adopted") {
      // Equivalent observed025 objects, not a reconstruction of its missing source/checksum.
      const tables = migration.split("-- BEGIN AD-COMP TABLES")[1].split("-- END AD-COMP TABLES")[0];
      const helpers = migration.split("-- BEGIN AD-COMP HELPERS")[1].split("-- END AD-COMP HELPERS")[0]
        .replace(/\bad_comp_(lock_catalog_trigger|assert_active_config|check_config_trigger|lock_link_parent|pin_scope|check_group_trigger|check_skill_trigger|protect_shared_skill|shared_skill_version|catalog_lock|config_valid|links_valid|links_parent_lock|scope_immutable|group_valid|skill_valid|shared_skill_protected|shared_skill_changed)\b/g, "competency_$1");
      await db.query(`BEGIN; ${inSchema(tables + helpers, targetSchema)} COMMIT;`);
      const curriculumId = randomUUID(), revisionId = randomUUID(); profileId = randomUUID();
      await db.query("BEGIN");
      await db.query("INSERT INTO curricula(id,identity_key,cohort_code,lock_version) VALUES($1,$2,'K29',$3)", [curriculumId, randomUUID(), randomUUID()]);
      await db.query(`INSERT INTO curriculum_revisions(id,curriculum_id,version,data,source_filename,source_data,source_sha256,change_note)
 VALUES($1,$2,1,$3,'recovery_K29.xlsx',$4,$5,'Synthetic already-applied025 fixture')`,
      [revisionId, curriculumId, JSON.stringify({ name: "Recovery K29", courses: [{ code: "RECOVERY101", name: "Recovery course" }] }), Buffer.from("recovery"), "a".repeat(64)]);
      await db.query("INSERT INTO course_catalog(code,name) VALUES('RECOVERY101','Recovery course')");
      await db.query(`INSERT INTO curriculum_courses(revision_id,code,position,name,credits,course_type,block,specialty,data)
 VALUES($1,'RECOVERY101',1,'Recovery course',3,'BB','Recovery fixture','',$2)`, [revisionId, JSON.stringify({ code: "RECOVERY101" })]);
      await db.query("INSERT INTO career_skills(id,name,description) VALUES($1,'Recovery shared skill','Preserve existing025 description')", [profileId]);
      await db.query("INSERT INTO ad_comp_skills(skill_id,group_id,scope) SELECT $1,id,'Preserve existing025 scope' FROM ad_comp_groups ORDER BY id LIMIT 1", [profileId]);
      const configId = randomUUID();
      await db.query("INSERT INTO ad_comp_course_configs(id,revision_id,course_code,status,note) VALUES($1,$2,'RECOVERY101','draft','Preserve025 note')", [configId, revisionId]);
      await db.query("INSERT INTO ad_comp_course_links(config_id,skill_id,weight) VALUES($1,$2,1)", [configId, profileId]);
      await db.query("UPDATE ad_comp_course_configs SET status='active' WHERE id=$1", [configId]);
      await db.query("INSERT INTO ad_comp_events(kind,entity_key,snapshot) VALUES('skill',$1,$2)", [profileId, JSON.stringify({ id: profileId, name: "Recovery shared skill", fixture: "existing025 history" })]);
      await db.query("INSERT INTO ad_comp_import_aliases(cohort_code,source_name,skill_id) VALUES('K29','Recovery shared skill',$1)", [profileId]);
      await db.query("INSERT INTO ad_comp_imports(revision_id,filename,sha256,summary) VALUES($1,'recovery_K29.xlsx',$2,$3)", [revisionId, "b".repeat(64), JSON.stringify({ fixture: "existing025 import" })]);
      await db.query("COMMIT");
      await db.query(`CREATE TABLE assessment_version_updates(id BIGSERIAL PRIMARY KEY,skill_id UUID NOT NULL);
 CREATE FUNCTION ${targetSchema}.audit_version_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
 BEGIN INSERT INTO ${targetSchema}.assessment_version_updates(skill_id) VALUES(NEW.skill_id); RETURN NEW; END $$;
 CREATE TRIGGER audit_version_update AFTER UPDATE ON ad_comp_skills FOR EACH ROW EXECUTE FUNCTION ${targetSchema}.audit_version_update();
 CREATE FUNCTION ${targetSchema}.legacy_career_probe() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
 CREATE TRIGGER legacy_career_probe BEFORE UPDATE ON career_skills FOR EACH ROW EXECUTE FUNCTION ${targetSchema}.legacy_career_probe();`);
      oldHelpers = (await db.query(`SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=$1 AND (p.proname LIKE 'competency_%' OR p.proname='legacy_career_probe') ORDER BY p.proname`, [targetSchema])).rows;
      assert.equal(oldHelpers.length, 10);
      before = await fingerprint(db, targetSchema, true);
    }
    await db.query(`BEGIN; ${inSchema(migration, targetSchema)} COMMIT;`);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM ad_comp_groups")).rows[0].count, 3);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=$1 AND t.tgname LIKE 'ad_comp_%' AND NOT t.tgisinternal`, [targetSchema])).rows[0].count, 13);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=$1 AND t.tgname LIKE 'competency_%' AND c.relname IN ('ad_comp_groups','ad_comp_skills','ad_comp_course_configs','ad_comp_course_links','career_skills')`, [targetSchema])).rows[0].count, 0);
    if (before) {
      assert.deepEqual(await fingerprint(db, targetSchema, true), before, "Adoption keeps every existing025 ID, scope, version, allocation, alias, event and import");
      assert.deepEqual((await db.query(`SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=$1 AND (p.proname LIKE 'competency_%' OR p.proname='legacy_career_probe') ORDER BY p.proname`, [targetSchema])).rows, oldHelpers);
      assert.equal((await db.query("SELECT legacy_skill_id FROM ad_comp_skills WHERE skill_id=$1", [profileId])).rows[0].legacy_skill_id, null);
      assert.equal((await db.query(`SELECT count(*)::int AS count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=$1 AND t.tgname='legacy_career_probe'`, [targetSchema])).rows[0].count, 1);
      await db.query("UPDATE career_skills SET name='Recovery renamed shared skill' WHERE id=$1", [profileId]);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM assessment_version_updates")).rows[0].count, 1, "One canonical edit rotates the profile token once");
    }
    const once = await fingerprint(db, targetSchema);
    await db.query(`BEGIN; ${inSchema(migration, targetSchema)} COMMIT;`);
    assert.deepEqual(await fingerprint(db, targetSchema), once, "Idempotent rerun preserves all module rows and versions");
    await db.query("ALTER TABLE ad_comp_groups ADD COLUMN unrelated_shape TEXT");
    const beforeBadShape = await fingerprint(db, targetSchema);
    await assert.rejects(db.query(`BEGIN; ${inSchema(migration, targetSchema)} COMMIT;`), error => error.message.includes("table shape mismatch"));
    await db.query("ROLLBACK");
    assert.deepEqual(await fingerprint(db, targetSchema), beforeBadShape);
    await db.query("ALTER TABLE ad_comp_groups DROP COLUMN unrelated_shape");
    for (const [alter, restore, reason] of [
      ["ALTER TABLE ad_comp_course_links DROP CONSTRAINT ad_comp_course_links_weight_check", "ALTER TABLE ad_comp_course_links ADD CHECK(weight BETWEEN 0 AND 1)", "check shape mismatch"],
      ["ALTER TABLE ad_comp_course_configs DROP CONSTRAINT ad_comp_course_configs_status_check", "ALTER TABLE ad_comp_course_configs ADD CHECK(status IN ('draft','active','archived'))", "check shape mismatch"],
      ["ALTER TABLE ad_comp_course_configs DROP CONSTRAINT ad_comp_course_configs_revision_id_course_code_key", "ALTER TABLE ad_comp_course_configs ADD UNIQUE(revision_id,course_code)", "key shape mismatch"],
      ["ALTER TABLE ad_comp_course_links DROP CONSTRAINT ad_comp_course_links_config_id_fkey; ALTER TABLE ad_comp_course_links ADD FOREIGN KEY(config_id) REFERENCES ad_comp_course_configs(id) ON DELETE CASCADE",
        "ALTER TABLE ad_comp_course_links DROP CONSTRAINT ad_comp_course_links_config_id_fkey; ALTER TABLE ad_comp_course_links ADD FOREIGN KEY(config_id) REFERENCES ad_comp_course_configs(id)", "reference shape mismatch"],
    ]) {
      await db.query(alter);
      const beforeReject = await fingerprint(db, targetSchema);
      await assert.rejects(db.query(`BEGIN; ${inSchema(migration, targetSchema)} COMMIT;`), error => error.message.includes(reason));
      await db.query("ROLLBACK");
      assert.deepEqual(await fingerprint(db, targetSchema), beforeReject, "Shape rejection must roll back every attempted migration change");
      await db.query(restore);
    }
    await db.query("DROP TABLE ad_comp_imports");
    const beforePartial = await fingerprint(db, targetSchema);
    await assert.rejects(db.query(`BEGIN; ${inSchema(migration, targetSchema)} COMMIT;`), error => error.message.includes("incomplete existing module"));
    await db.query("ROLLBACK");
    assert.deepEqual(await fingerprint(db, targetSchema), beforePartial);
    checks.push(mode === "fresh" ? "migration026 creates a fresh module without legacy tables, reruns without row/version changes, and rejects unrelated table shapes"
      : "migration026 adopts populated025 objects without changing their IDs/data or old helper bodies, preserves unrelated career triggers, and replaces duplicate token triggers exactly once");
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    await db.end();
    if (created) await adminPool.query(`DROP SCHEMA IF EXISTS ${targetSchema} CASCADE`);
    extraSchemas.delete(targetSchema);
  }
}

async function legacyFingerprint() {
  const snapshot = await fingerprint(pool, schema);
  return Object.fromEntries(legacyTables.map(table => [table, snapshot[table]]));
}

// Mirror the relevant catalog/result columns observed in the read-only legacy audit.
// These are synthetic records, never copies of student results from public.
async function createLegacyFixture() {
  await pool.query(`CREATE TABLE competency_groups (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),code TEXT NOT NULL UNIQUE CHECK(code IN ('technical','soft','foundation')),
 name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',is_active BOOLEAN NOT NULL DEFAULT TRUE,
 version UUID NOT NULL DEFAULT gen_random_uuid(),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE competency_skills (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),code TEXT NOT NULL UNIQUE CHECK(code ~ '^KN[0-9]{3,}$'),
 group_id UUID NOT NULL REFERENCES competency_groups(id),name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',
 is_active BOOLEAN NOT NULL DEFAULT TRUE,source_file TEXT NOT NULL DEFAULT '',source_type TEXT NOT NULL DEFAULT '',
 version UUID NOT NULL DEFAULT gen_random_uuid(),deleted_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE competency_course_links (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),skill_id UUID NOT NULL REFERENCES competency_skills(id),
 course_code TEXT NOT NULL REFERENCES course_catalog(code),contribution_weight NUMERIC(5,4) NOT NULL CHECK(contribution_weight>0 AND contribution_weight<=1),
 description TEXT NOT NULL DEFAULT '',is_active BOOLEAN NOT NULL DEFAULT TRUE,source_file TEXT NOT NULL DEFAULT '',
 version UUID NOT NULL DEFAULT gen_random_uuid(),deleted_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 curriculum_id UUID REFERENCES curricula(id),specialty TEXT NOT NULL DEFAULT '');
 CREATE TABLE assessment_configurations (
 id UUID PRIMARY KEY,draft_id UUID NOT NULL,curriculum_id UUID NOT NULL REFERENCES curricula(id),specialty TEXT NOT NULL,
 version INTEGER NOT NULL,curriculum_revision_id UUID NOT NULL REFERENCES curriculum_revisions(id),snapshot JSONB NOT NULL,
 fingerprint TEXT NOT NULL,applied_by UUID REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE student_assessments (
 id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id),curriculum_id UUID NOT NULL REFERENCES curricula(id),
 config_id UUID NOT NULL REFERENCES assessment_configurations(id),transcript_version UUID NOT NULL,source_fingerprint TEXT NOT NULL,
 idempotency_key UUID NOT NULL,snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'),result JSONB NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE student_assessment_scopes (
 user_id UUID PRIMARY KEY REFERENCES users(id),curriculum_id UUID REFERENCES curricula(id),specialty TEXT NOT NULL DEFAULT '',
 plan_id UUID,standard_id UUID,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE FUNCTION ${schema}.competency_assert_active_config(UUID) RETURNS VOID LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Legacy validation helper must not execute for new allocations'; END $$;`);
  for (const [code, name] of [["foundation", "Kiến thức nền tảng"], ["soft", "Kỹ năng mềm"], ["technical", "Kỹ năng chuyên môn"]]) {
    const id = randomUUID();
    legacyGroupIds.set(code, id);
    await pool.query("INSERT INTO competency_groups(id,code,name,description) VALUES($1,$2,$3,$4)", [id, code, name, `Preserved legacy ${code} description`]);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(sourceBytes);
  const sheet = workbook.getWorksheet("skills");
  assert(sheet, "The actual source workbook must contain the skills sheet");
  for (let row = 2; row <= sheet.rowCount; row++) {
    const rawName = sheet.getRow(row).getCell(1).value;
    if (rawName === null || rawName === "") continue;
    assert.equal(typeof rawName, "string");
    const name = rawName.normalize("NFC").trim();
    const sourceGroup = sheet.getRow(row).getCell(2).value;
    assert.equal(typeof sourceGroup, "string");
    const code = sourceGroup === "Kiến thức nền tảng" ? "foundation" : sourceGroup === "Kỹ năng mềm" ? "soft" : "technical";
    assert(!legacySkills.has(name), "Legacy fixture source names must be unique");
    const id = randomUUID();
    const number = legacySkills.size + 1;
    legacySkills.set(name, id);
    await pool.query(`INSERT INTO competency_skills(id,code,group_id,name,description,is_active,source_file,source_type)
 VALUES($1,$2,$3,$4,$5,$6,'legacy_K29_bootstrap.xlsx','legacy_fixture')`,
    [id, `KN${String(number).padStart(3, "0")}`, legacyGroupIds.get(code), name, `Preserved legacy skill description ${number}`, number !== 1]);
  }
  assert.equal(legacySkills.size, 67);
}

async function api(path, method = "GET", body, headers = {}) {
  const binary = Buffer.isBuffer(body);
  const response = await fetch(origin + path, { method, headers: { Origin: auditOrigin,
    ...(body !== undefined ? { "Content-Type": binary ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: binary ? body : JSON.stringify(body) } : {}) });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed };
}
const competency = (path = "", method = "GET", body, headers = {}) => api("/api/admin/competencies" + path, method, body, headers);
const career = (path = "", method = "GET", body, headers = {}) => api("/api/admin/careers" + path, method, body, headers);
const token = version => ({ "x-version": version });
const coursePath = (revisionId, code) => `/courses/${revisionId}/${encodeURIComponent(code)}`;
async function expectResponse(promise, status, code) {
  const result = await promise;
  assert.equal(result.status, status, `Expected HTTP ${status}, received ${result.status}: ${JSON.stringify(result.body)}`);
  if (code) assert.equal(result.body.error, code);
  return result.body;
}
const getSkill = id => expectResponse(competency(`/skills/${id}`), 200);
const getCourse = (revisionId, code) => expectResponse(competency(coursePath(revisionId, code)), 200);
async function createSkill(groupId, name, extra = {}) {
  return expectResponse(competency("/skills", "POST", { name, description: "Integration fixture description", scope: "Integration fixture scope", groupId, isActive: true, ...extra }), 201);
}
function skillInput(skill, changes = {}) {
  return { name: skill.name, description: skill.description, scope: skill.scope, groupId: skill.groupId, isActive: skill.isActive, ...changes };
}
function groupInput(group, changes = {}) {
  return { name: group.name, description: group.description, isActive: group.isActive, ...changes };
}
async function saveCourse(revisionId, code, currentVersion, links, status = "active", note = "Integration fixture allocation") {
  return competency(coursePath(revisionId, code), "PUT", { links, status, note }, token(currentVersion));
}
async function importPreview(revisionId, bytes = sourceBytes, headers = {}) {
  return competency("/import/preview", "POST", bytes, { "x-revision-id": revisionId, "x-source-cohort": "K29", "x-filename": encodeURIComponent(sourceFilename), ...headers });
}
async function importConfirm(revisionId, preview, bytes = sourceBytes, headers = {}) {
  return competency("/import", "POST", bytes, { "x-revision-id": revisionId, "x-source-cohort": "K29", "x-filename": encodeURIComponent(sourceFilename),
    "x-preview-token": preview.token, "x-confirm-warnings": "true", ...headers });
}
async function deferredReject(sql, values, constraint) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql, values);
    await assert.rejects(client.query("COMMIT"), error => error.code === "23514" && error.constraint === constraint);
  } finally { await client.query("ROLLBACK"); client.release(); }
}

async function waitForCatalogWaiter() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const pending = await adminPool.query(`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=1946032027
 AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) LIMIT 1`);
    if (pending.rowCount) return;
    await new Promise(done => setTimeout(done, 20));
  }
  assert.fail("A competing allocation must wait for the catalog transaction lock");
}

async function concurrentDeactivation(sql, values, revisionId, code, linkedSkillId, expectedError) {
  const owner = await pool.connect();
  let pending;
  try {
    await owner.query("BEGIN");
    await owner.query(sql, values);
    pending = saveCourse(revisionId, code, "new", [{ skillId: linkedSkillId, weight: 1 }]);
    await waitForCatalogWaiter();
    await owner.query("COMMIT");
    await expectResponse(pending, 409, expectedError);
    assert.equal((await getCourse(revisionId, code)).status, "missing");
  } finally {
    await owner.query("ROLLBACK"); owner.release();
    if (pending) await pending.catch(() => {});
  }
}

try {
  const publicBefore = await fingerprint(adminPool, "public");
  await verifyBootstrap("fresh");
  await verifyBootstrap("adopted");
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY,entra_tenant_id UUID NOT NULL,entra_object_id UUID NOT NULL,
 entra_subject TEXT NOT NULL,display_name TEXT NOT NULL,email TEXT,username TEXT,role TEXT NOT NULL,role_override TEXT,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,auth_version INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE student_profiles(user_id UUID PRIMARY KEY REFERENCES users(id),student_code TEXT,full_name TEXT,cohort_code TEXT,class_name TEXT,career_goal TEXT);`);
  for (const migration of [...coreMigrations, "026_competency_management.sql"]) {
    let beforeLegacyMigration;
    let oldHelper;
    if (migration === "026_competency_management.sql") {
      await createLegacyFixture();
      beforeLegacyMigration = await legacyFingerprint();
      oldHelper = (await pool.query("SELECT pg_get_functiondef($1::regprocedure) AS definition", [`${schema}.competency_assert_active_config(uuid)`])).rows[0].definition;
    }
    const sql = inSchema(await readFile("apps/api/migrations/" + migration, "utf8"), schema);
    await pool.query(`BEGIN; ${sql} COMMIT;`);
    if (beforeLegacyMigration) {
      assert.deepEqual(await legacyFingerprint(), beforeLegacyMigration, "Migration026 must preserve legacy catalog and result tables");
      assert.equal((await pool.query("SELECT pg_get_functiondef($1::regprocedure) AS definition", [`${schema}.competency_assert_active_config(uuid)`])).rows[0].definition, oldHelper);
    }
  }
  for (const [key, actor] of Object.entries(actors)) {
    await pool.query(`INSERT INTO users(id,entra_tenant_id,entra_object_id,entra_subject,display_name,email,username,role,is_active)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [actor.userId, actor.tenantId, actor.objectId, key, actor.name, actor.email, actor.username,
      key === "revoked" ? "student" : actor.role, key !== "locked"]);
  }

  let k29Source;
  if (publicBefore.curricula && publicBefore.curriculum_revisions) {
    k29Source = (await adminPool.query(`SELECT r.data,r.source_data,r.source_filename FROM public.curricula c
 JOIN public.curriculum_revisions r ON r.curriculum_id=c.id WHERE c.cohort_code='K29'
 ORDER BY (r.version=1) DESC,r.version,c.id LIMIT 1`)).rows[0];
  }
  if (!k29Source) {
    const file = await readFile("apps/api/data/curricula/K29.xlsx");
    k29Source = { data: await readWorkbook(file), source_data: file, source_filename: "K29.xlsx" };
  }
  const curricula = new CurriculumRepository(pool);
  const realCurriculumId = await curricula.create(k29Source.data, k29Source.source_data, k29Source.source_filename);
  const realCurriculum = await curricula.detail(realCurriculumId);
  const realRevisionId = realCurriculum.revisionId;
  const templateCourse = k29Source.data.courses[0];
  assert(templateCourse, "K29 source must contain courses");
  const synthetic = cohortCode => ({ schemaVersion: 1, name: `Integration fixture ${cohortCode}`, major: "Integration fixture major", cohortCode,
    admissionYear: cohortCode === "K29" ? 2023 : 2024, totalCredits: 15, notes: "Disposable integration fixture",
    courses: ["A101", "B102", "C103", "D104", "E105"].map((code, index) => ({ ...structuredClone(templateCourse), code, name: `Audit course ${code}`,
      position: index + 1, credits: 3, type: "BB", block: "Integration fixture", specialty: "", groupId: "audit-group",
      prerequisite: "", prior: "", sourceSheet: "Integration fixture", sourceRow: index + 2, sourceCells: {} })),
    groups: [{ id: "audit-group", label: "A. Integration fixture", credits: 15, sourceRow: 1 }], electives: [], relations: [], warnings: [], sourceWarnings: [] });
  const manualCurriculumId = await curricula.create(synthetic("K29"), Buffer.from("fixture K29"), "audit_K29.xlsx");
  const manualCurriculum = await curricula.detail(manualCurriculumId);
  const manualRevisionId = manualCurriculum.revisionId;
  const k30CurriculumId = await curricula.create(synthetic("K30"), Buffer.from("fixture K30"), "audit_K30.xlsx");
  const k30RevisionId = (await curricula.detail(k30CurriculumId)).revisionId;

  const oldIds = [...legacySkills.values()];
  for (let index = 0; index < 3; index++) {
    await pool.query(`INSERT INTO competency_course_links(skill_id,course_code,contribution_weight,description,curriculum_id,specialty,source_file)
 VALUES($1,$2,0.7,'Preserve legacy non-unit allocation',$3,'Legacy specialty','legacy_K29_bootstrap.xlsx')`, [oldIds[index], templateCourse.code, realCurriculumId]);
  }
  await pool.query(`INSERT INTO competency_course_links(skill_id,course_code,contribution_weight,description,curriculum_id,specialty)
 VALUES($1,'A101',0.4,'Preserve legacy K30 scope',$2,'Legacy K30 specialty'),
 ($3,$4,0.9,'Preserve legacy global scope',NULL,'')`, [oldIds[3], k30CurriculumId, oldIds[4], templateCourse.code]);
  const legacyConfigId = randomUUID();
  const legacySnapshot = { legacySkillIds: oldIds.slice(0, 3), curriculumId: realCurriculumId, specialty: "Legacy specialty", weights: [0.7, 0.7, 0.7] };
  await pool.query(`INSERT INTO assessment_configurations(id,draft_id,curriculum_id,specialty,version,curriculum_revision_id,snapshot,fingerprint,applied_by)
 VALUES($1,$2,$3,'Legacy specialty',1,$4,$5,$6,$7)`,
  [legacyConfigId, randomUUID(), realCurriculumId, realRevisionId, JSON.stringify(legacySnapshot), "f".repeat(64), actors.admin.userId]);
  await pool.query(`INSERT INTO student_assessments(id,user_id,curriculum_id,config_id,transcript_version,source_fingerprint,idempotency_key,snapshot,result)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), actors.student.userId, realCurriculumId, legacyConfigId, randomUUID(), "e".repeat(64), randomUUID(),
    JSON.stringify(legacySnapshot), JSON.stringify({ skills: oldIds.slice(0, 3).map(skillId => ({ skillId, score: 7.25 })), fixture: "Synthetic legacy result" })]);
  await pool.query("INSERT INTO student_assessment_scopes(user_id,curriculum_id,specialty) VALUES($1,$2,'Legacy specialty')", [actors.student.userId, realCurriculumId]);
  const legacyBaseline = await legacyFingerprint();

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    const key = req.get("x-actor") ?? "admin";
    req.session = { user: key === "anonymous" ? undefined : actors[key] };
    next();
  });
  app.use("/api/admin/competencies", createCompetenciesRouter(pool, auditOrigin));
  app.use("/api/admin/careers", createCareersRouter(pool, auditOrigin));
  app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: "integration_error" }); });
  server = app.listen(0, "127.0.0.1");
  await new Promise(done => server.once("listening", done));
  origin = `http://127.0.0.1:${server.address().port}`;

  for (const actor of ["anonymous", "student", "revoked", "locked"]) {
    await expectResponse(competency("/groups", "GET", undefined, { "x-actor": actor }), actor === "anonymous" ? 401 : 403);
    await expectResponse(competency("/groups", "POST", { name: "Denied fixture", description: "", isActive: true }, { "x-actor": actor }), actor === "anonymous" ? 401 : 403);
  }
  const noOriginBefore = await fingerprint(pool, schema);
  await expectResponse(competency("/groups", "POST", { name: "Denied origin", description: "", isActive: true }, { Origin: "http://evil.audit" }), 403, "invalid_origin");
  assert.deepEqual(await fingerprint(pool, schema), noOriginBefore);
  assert.equal((await expectResponse(competency("/groups"), 200)).items.length, 3);
  for (const role of roles.filter(role => role !== "student")) {
    const group = await expectResponse(competency("/groups", "POST", { name: `Audit staff ${role}`, description: "", isActive: true }, { "x-actor": role }), 201);
    await expectResponse(competency(`/groups/${group.id}`, "PATCH", groupInput(group, { isActive: false }), { ...token(group.version), "x-actor": role }), 200);
  }
  checks.push("anonymous/student/revoked/locked sessions and bad origins are denied; all four staff roles manage groups");

  let group = await expectResponse(competency("/groups", "POST", { name: "Audit nhóm ánh xạ", description: "Audit mapping group", isActive: true }), 201);
  await expectResponse(competency("/groups", "POST", { name: group.name.toLowerCase(), description: "", isActive: true }), 409, "group_exists");
  const oldGroupVersion = group.version;
  group = await expectResponse(competency(`/groups/${group.id}`, "PATCH", groupInput(group, { description: "Updated audit description" }), token(group.version)), 200);
  await expectResponse(competency(`/groups/${group.id}`, "PATCH", groupInput(group), token(oldGroupVersion)), 409, "group_changed");
  const groupDetail = await expectResponse(competency(`/groups/${group.id}`), 200);
  assert(groupDetail.history.length >= 2);
  assert.equal(groupDetail.history[0].snapshot.name, group.name);
  checks.push("group creation/detail/history, case-insensitive duplicate rejection and optimistic versions work");

  const canonical = await expectResponse(career("/skills", "POST", { name: "Audit shared canonical", description: "Canonical career description" }), 201);
  await expectResponse(competency("/skills", "POST", { name: canonical.name, description: canonical.description, scope: "Audit scope", groupId: group.id, isActive: true }), 409, "skill_exists");
  await expectResponse(competency("/skills", "POST", { existingSkillId: canonical.id, name: canonical.name, description: "Unexpected canonical change", scope: "Audit scope", groupId: group.id, isActive: true }), 409, "canonical_skill_mismatch");
  let shared = await createSkill(group.id, canonical.name, { existingSkillId: canonical.id, description: canonical.description });
  assert.equal(shared.id, canonical.id);
  await expectResponse(competency("/skills", "POST", { ...skillInput(shared), existingSkillId: shared.id }), 409, "skill_profile_exists");
  const fields = (await expectResponse(career("/fields"), 200)).items;
  const position = await expectResponse(career("", "POST", { nameVi: "Audit nghề dùng chung", nameEn: "Audit shared career", category: fields[0].code, description: "", skills: [shared.name] }), 201);
  const oldSharedVersion = shared.version;
  shared = await expectResponse(competency(`/skills/${shared.id}`, "PATCH", skillInput(shared, { name: "Audit kỹ năng đổi tên", description: "Shared updated description" }), token(shared.version)), 200);
  assert.equal(shared.id, canonical.id);
  assert.deepEqual((await expectResponse(career(`/${position.id}`), 200)).skills, [shared.name]);
  const requirements = (await expectResponse(career(`/requirements?careerPositionId=${position.id}`), 200)).items;
  assert.equal(requirements[0].skillId, shared.id);
  assert.equal(requirements[0].title, shared.name);
  await expectResponse(competency(`/skills/${shared.id}`, "PATCH", skillInput(shared), token(oldSharedVersion)), 409, "skill_changed");
  const canonicalNow = (await expectResponse(career("/skills?q=Audit"), 200)).items.find(skill => skill.id === shared.id);
  assert.equal(canonicalNow.assessmentCount, 1);
  await expectResponse(career(`/skills/${shared.id}`, "DELETE", { confirmed: true }, token(canonicalNow.version)), 409, "skill_in_use");
  await expectResponse(career(`/skills/${shared.id}`, "PATCH", { name: "Audit career rename", description: shared.description }, token(canonicalNow.version)), 200);
  await expectResponse(competency(`/skills/${shared.id}`, "PATCH", skillInput(shared), token(shared.version)), 409, "skill_changed");
  shared = await getSkill(shared.id);
  assert.equal(shared.name, "Audit career rename");
  assert(shared.history.some(event => event.note.includes("nghề nghiệp")));
  assert(shared.history.some(event => event.snapshot.name === canonical.name));
  checks.push("explicit canonical reuse preserves UUID; both rename routes update career titles/cache, invalidate profile tokens and preserve audit snapshots");

  let skillA = await createSkill(group.id, "Audit năng lực A");
  let skillB = await createSkill(group.id, "Audit năng lực B");
  let zeroSkill = await createSkill(group.id, "Audit năng lực 0%");
  await expectResponse(competency("/skills", "POST", skillInput(skillA, { name: skillA.name.toUpperCase() })), 409, "skill_exists");
  assert((await expectResponse(competency("/skills?q=nang%20luc&active=true"), 200)).items.some(skill => skill.id === skillA.id));
  assert((await expectResponse(competency(`/skills?groupId=${group.id}`), 200)).items.length >= 4);
  await expectResponse(competency(`/skills/${skillB.id}`, "DELETE", { confirmed: false }, token(skillB.version)), 400, "invalid_competency_input");
  const missing = await getCourse(manualRevisionId, "A101");
  assert.equal(missing.status, "missing"); assert.equal(missing.version, null); assert.deepEqual(missing.links, []);
  await expectResponse(saveCourse(manualRevisionId, "A101", "new", [{ skillId: skillA.id, weight: 0.4 }]), 422, "weight_total_invalid");
  await expectResponse(saveCourse(manualRevisionId, "A101", "new", [{ skillId: skillA.id, weight: 0.6 }, { skillId: skillB.id, weight: 0.6 }]), 422, "weight_total_invalid");
  await expectResponse(saveCourse(manualRevisionId, "A101", "new", [{ skillId: skillA.id, weight: 0.5 }, { skillId: skillA.id, weight: 0.5 }]), 409, "duplicate_skill_link");
  await expectResponse(saveCourse(manualRevisionId, "A101", "new", [{ skillId: skillA.id, weight: 1.1 }]), 400, "invalid_competency_input");
  let allocation = await expectResponse(saveCourse(manualRevisionId, "A101", "new", [{ skillId: skillA.id, weight: 0.4 }], "draft"), 200);
  allocation = await expectResponse(saveCourse(manualRevisionId, "A101", allocation.version, [{ skillId: skillA.id, weight: 0.9 }, { skillId: skillB.id, weight: 0.9 }], "draft"), 200);
  const draftSummary = await expectResponse(competency(`/summary?revisionId=${manualRevisionId}`), 200);
  assert.equal(draftSummary.draftCount, 1);
  assert(draftSummary.warnings.some(warning => warning.code === "incomplete_draft"));
  const draftVersion = allocation.version;
  allocation = await expectResponse(saveCourse(manualRevisionId, "A101", allocation.version, [{ skillId: skillA.id, weight: 0.4 }, { skillId: skillB.id, weight: 0.6 }]), 200);
  await expectResponse(saveCourse(manualRevisionId, "A101", draftVersion, [{ skillId: skillA.id, weight: 1 }]), 409, "configuration_changed");
  await expectResponse(saveCourse(manualRevisionId, "A101", "new", [{ skillId: skillA.id, weight: 1 }]), 409, "configuration_changed");
  assert.equal((await getCourse(k30RevisionId, "A101")).status, "missing");
  assert.equal((await expectResponse(competency(`/summary?revisionId=${k30RevisionId}`), 200)).activeCount, 0);
  await expectResponse(competency(`/summary?revisionId=${randomUUID()}`), 404, "curriculum_revision_not_found");
  checks.push("drafts permit incomplete totals; active under/over totals, duplicate/out-of-range weights and stale/new tokens are rejected; K30 remains isolated");

  await expectResponse(competency(`/skills/${skillA.id}`, "DELETE", { confirmed: true }, token(skillA.version)), 409, "skill_in_use");
  await expectResponse(competency(`/skills/${skillA.id}`, "PATCH", skillInput(skillA, { isActive: false }), token(skillA.version)), 409, "skill_in_use");
  await expectResponse(competency(`/groups/${group.id}`, "PATCH", groupInput(group, { isActive: false }), token(group.version)), 409, "group_in_use");
  const zeroAllocation = await expectResponse(saveCourse(manualRevisionId, "C103", "new", [{ skillId: skillA.id, weight: 1 }, { skillId: zeroSkill.id, weight: 0 }]), 200);
  assert.equal(zeroAllocation.links.find(link => link.skillId === zeroSkill.id).weight, 0);
  zeroSkill = await getSkill(zeroSkill.id);
  assert.equal(zeroSkill.courseCount, 0);
  assert(zeroSkill.contributions.some(link => link.courseCode === "C103" && link.weight === 0));
  await expectResponse(competency(`/skills/${zeroSkill.id}`, "DELETE", { confirmed: true }, token(zeroSkill.version)), 409, "skill_in_use");
  assert((await expectResponse(competency(`/summary?revisionId=${manualRevisionId}`), 200)).warnings.some(warning => warning.code === "zero_contribution"));
  await expectResponse(competency(coursePath(manualRevisionId, "C103"), "DELETE", { confirmed: true }, token(zeroAllocation.version)), 200);
  assert.equal((await getCourse(manualRevisionId, "C103")).links.length, 2);
  await expectResponse(competency(`/skills/${zeroSkill.id}`, "DELETE", { confirmed: true }, token(zeroSkill.version)), 200);
  assert.equal((await pool.query("SELECT deleted_at FROM career_skills WHERE id=$1", [zeroSkill.id])).rows[0].deleted_at, null);
  zeroSkill = await createSkill(group.id, zeroSkill.name, { existingSkillId: zeroSkill.id, description: zeroSkill.description });
  assert(zeroSkill.contributions.some(link => link.courseCode === "C103" && link.status === "archived"));
  zeroSkill = await expectResponse(competency(`/skills/${zeroSkill.id}`, "PATCH", skillInput(zeroSkill, { isActive: false }), token(zeroSkill.version)), 200);
  assert((await expectResponse(competency("/skills?active=false"), 200)).items.some(skill => skill.id === zeroSkill.id));
  assert(!(await expectResponse(competency("/skills?active=true"), 200)).items.some(skill => skill.id === zeroSkill.id));
  const zeroCanonical = (await expectResponse(competency("/catalog"), 200)).items.find(skill => skill.id === zeroSkill.id);
  await expectResponse(career(`/skills/${zeroSkill.id}`, "DELETE", { confirmed: true }, token(zeroCanonical.version)), 409, "skill_in_use");
  zeroSkill = await expectResponse(competency(`/skills/${zeroSkill.id}`, "PATCH", skillInput(zeroSkill, { isActive: true }), token(zeroSkill.version)), 200);
  checks.push("active references block skill/group deactivation and deletion even at 0%; archive preserves links and assessment restore keeps the canonical ID");

  const beforeDeferred = await fingerprint(pool, schema);
  await deferredReject("UPDATE ad_comp_groups SET is_active=false WHERE id=$1", [group.id], "competency_active_skills");
  await deferredReject("UPDATE ad_comp_skills SET is_active=false WHERE skill_id=$1", [skillA.id], "competency_active_skills");
  await deferredReject("UPDATE ad_comp_course_links SET weight=0.2 WHERE config_id=$1 AND skill_id=$2", [allocation.configId, skillA.id], "competency_active_total");
  assert.deepEqual(await fingerprint(pool, schema), beforeDeferred);
  const beforeAtomic = await getCourse(manualRevisionId, "A101");
  await pool.query(`CREATE FUNCTION ${schema}.audit_reject_allocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.weight=0.1234567890 THEN RAISE EXCEPTION 'audit allocation failure' USING ERRCODE='23514',CONSTRAINT='competency_active_total'; END IF;
 RETURN NEW; END $$;
 CREATE TRIGGER audit_reject_allocation BEFORE INSERT ON ${schema}.ad_comp_course_links FOR EACH ROW EXECUTE FUNCTION ${schema}.audit_reject_allocation();`);
  await expectResponse(saveCourse(manualRevisionId, "A101", beforeAtomic.version, [{ skillId: skillA.id, weight: 0.123456789 }, { skillId: skillB.id, weight: 0.876543211 }]), 422, "weight_total_invalid");
  assert.deepEqual(await getCourse(manualRevisionId, "A101"), beforeAtomic);
  await pool.query(`DROP TRIGGER audit_reject_allocation ON ${schema}.ad_comp_course_links; DROP FUNCTION ${schema}.audit_reject_allocation();`);
  checks.push("deferred database guards reject invalid committed states; an injected mid-replacement failure restores the old token, allocations and history atomically");

  const concurrencyGroup = await expectResponse(competency("/groups", "POST", { name: "Audit concurrency group", description: "", isActive: true }), 201);
  const concurrencySkill = await createSkill(concurrencyGroup.id, "Audit concurrency profile");
  await concurrentDeactivation("UPDATE ad_comp_skills SET is_active=false WHERE skill_id=$1", [concurrencySkill.id], manualRevisionId, "E105", concurrencySkill.id, "skill_unavailable");
  await pool.query("UPDATE ad_comp_skills SET is_active=true WHERE skill_id=$1", [concurrencySkill.id]);
  await concurrentDeactivation("UPDATE ad_comp_groups SET is_active=false WHERE id=$1", [concurrencyGroup.id], manualRevisionId, "E105", concurrencySkill.id, "group_unavailable");
  checks.push("concurrent profile/group deactivation serializes with a new active allocation and cannot commit a dangling active configuration");

  const nextData = { ...structuredClone(manualCurriculum.data), notes: "New immutable fixture revision" };
  let latestManual = await curricula.update(manualCurriculumId, manualCurriculum.token, actors.admin, () => nextData, "Audit revision isolation");
  assert.notEqual(latestManual.revisionId, manualRevisionId);
  assert.equal((await getCourse(latestManual.revisionId, "A101")).status, "missing");
  assert.equal((await getCourse(manualRevisionId, "A101")).status, "active");
  const duplicateData = structuredClone(latestManual.data);
  duplicateData.courses.push({ ...structuredClone(duplicateData.courses[0]), position: 6, sourceRow: 100 });
  latestManual = await curricula.update(manualCurriculumId, latestManual.token, actors.admin, () => duplicateData, "Audit duplicate source rows");
  const duplicated = (await expectResponse(competency(`/courses?revisionId=${latestManual.revisionId}&q=A101`), 200)).items[0];
  assert.equal(duplicated.occurrenceCount, 2);
  for (const status of ["draft", "active"]) await expectResponse(saveCourse(latestManual.revisionId, "A101", "new", [{ skillId: skillA.id, weight: 1 }], status), 409, "duplicate_curriculum_course");
  const listedRevisions = (await expectResponse(competency("/curricula"), 200)).items;
  assert(listedRevisions.some(revision => revision.revisionId === manualRevisionId && !revision.isCurrent));
  assert(listedRevisions.some(revision => revision.revisionId === latestManual.revisionId && revision.isCurrent));
  checks.push("new CTĐT revisions inherit no allocations; histories remain pinned and repeated source codes block draft/active saves");

  const beforePreview = await fingerprint(pool, schema);
  let preview = await expectResponse(importPreview(realRevisionId), 200);
  assert.equal(preview.canImport, true, JSON.stringify(preview.errors));
  assert.equal(preview.counts.skillRows, 67); assert.equal(preview.counts.linkRows, 258); assert.equal(preview.counts.courses, 85);
  assert.equal(preview.counts.legacySkillsMapped, 67);
  for (const plan of preview.skills) assert.equal(plan.legacySkillId, legacySkills.get(plan.name));
  assert(preview.warnings.some(issue => issue.code === "legacy_data_preserved"));
  assert.equal(preview.errors.length, 0); assert.equal(preview.requiresOverwrite, false);
  assert.deepEqual(await fingerprint(pool, schema), beforePreview);
  const duplicateLegacyId = randomUUID();
  await pool.query(`INSERT INTO competency_skills(id,code,group_id,name,description)
 VALUES($1,'KN999',$2,$3,'Synthetic ambiguity probe')`, [duplicateLegacyId, legacyGroupIds.get("technical"), preview.skills[0].name]);
  const beforeAmbiguousLegacy = await fingerprint(pool, schema);
  const ambiguousLegacyPreview = await expectResponse(importPreview(realRevisionId), 200);
  assert.equal(ambiguousLegacyPreview.canImport, false);
  assert(ambiguousLegacyPreview.errors.some(issue => issue.code === "ambiguous_legacy_skill"));
  await expectResponse(importConfirm(realRevisionId, ambiguousLegacyPreview), 422, "import_has_errors");
  assert.deepEqual(await fingerprint(pool, schema), beforeAmbiguousLegacy);
  await pool.query("DELETE FROM competency_skills WHERE id=$1", [duplicateLegacyId]);
  assert.deepEqual(await legacyFingerprint(), legacyBaseline);
  await expectResponse(importPreview(realRevisionId, sourceBytes, { "x-source-cohort": "K30" }), 422, "cohort_mismatch");
  await expectResponse(importPreview(realRevisionId, sourceBytes, { "x-filename": "audit_K30.xlsx" }), 422, "cohort_mismatch");
  await expectResponse(importPreview(realRevisionId, sourceBytes, { "x-filename": encodeURIComponent("../K29.xlsx") }), 400, "invalid_filename");
  const sourceCanonical = (await expectResponse(competency("/catalog"), 200)).items.find(skill => skill.name === "Trực quan hóa dữ liệu");
  assert(sourceCanonical, "Career migration must expose the actual shared source skill");
  const stalePreview = preview;
  group = await expectResponse(competency(`/groups/${group.id}`, "PATCH", groupInput(group, { description: "Changed after preview" }), token(group.version)), 200);
  const afterPreviewChange = await fingerprint(pool, schema);
  await expectResponse(importConfirm(realRevisionId, stalePreview), 409, "import_preview_changed");
  assert.deepEqual(await fingerprint(pool, schema), afterPreviewChange);
  preview = await expectResponse(importPreview(realRevisionId), 200);
  assert(preview.warnings.length > 0, "Shared-description and source omissions must require review");
  await expectResponse(importConfirm(realRevisionId, preview, sourceBytes, { "x-confirm-warnings": "false" }), 422, "review_warnings");
  const imported = await expectResponse(importConfirm(realRevisionId, preview), 200);
  assert.equal(imported.imported, true); assert.equal(imported.unchanged, false); assert(imported.importId);
  const sharedImported = (await expectResponse(competency("/skills?q=Tr%E1%BB%B1c%20quan%20h%C3%B3a%20d%E1%BB%AF%20li%E1%BB%87u"), 200)).items.find(skill => skill.id === sourceCanonical.id);
  assert(sharedImported); assert.equal(sharedImported.description, sourceCanonical.description);
  assert.equal(sharedImported.legacySkillId, legacySkills.get(sharedImported.name));
  assert.notEqual(sharedImported.id, sharedImported.legacySkillId, "An existing canonical career identity is preserved and bridged to its legacy assessment identity");
  const adopted = (await pool.query("SELECT s.skill_id,s.legacy_skill_id,k.name FROM ad_comp_skills s JOIN career_skills k ON k.id=s.skill_id WHERE s.legacy_skill_id IS NOT NULL")).rows;
  assert.equal(adopted.length, 67);
  for (const profile of adopted) {
    assert.equal(profile.legacy_skill_id, legacySkills.get(profile.name));
    const plan = preview.skills.find(skill => skill.name === profile.name);
    assert(plan);
    assert.equal(profile.skill_id, plan.action === "create" ? profile.legacy_skill_id : plan.skillId,
      "New canonical skills preserve unoccupied legacy UUIDs; existing canonical skills preserve their shared UUIDs");
  }
  const adoptedSnapshot = await fingerprint(pool, schema);
  await assert.rejects(pool.query("UPDATE ad_comp_skills SET legacy_skill_id=$2 WHERE skill_id=$1", [sharedImported.id, randomUUID()]),
    error => error.code === "23503" && error.constraint === "ad_comp_legacy_skill_fk");
  await assert.rejects(pool.query("UPDATE ad_comp_skills SET legacy_skill_id=$2 WHERE skill_id=$1", [skillA.id, sharedImported.legacySkillId]),
    error => error.code === "23505");
  assert.deepEqual(await fingerprint(pool, schema), adoptedSnapshot);
  assert.deepEqual(await legacyFingerprint(), legacyBaseline);
  const summary = await expectResponse(competency(`/summary?revisionId=${realRevisionId}`), 200);
  assert.equal(summary.activeCount, 85); assert.equal(summary.missingCount, summary.courseCount - 85);
  const firstImportSnapshot = await fingerprint(pool, schema);
  const secondPreview = await expectResponse(importPreview(realRevisionId), 200);
  assert.equal(secondPreview.requiresOverwrite, false); assert.equal(secondPreview.counts.coursesUnchanged, 85);
  const secondImport = await expectResponse(importConfirm(realRevisionId, secondPreview), 200);
  assert.equal(secondImport.unchanged, true); assert.equal(secondImport.importId, null);
  assert.deepEqual(await fingerprint(pool, schema), firstImportSnapshot);
  checks.push("the actual K29 workbook imports 67 skills/258 links/85 courses; preview is read-only, cohort/header/review/stale-token checks hold, shared descriptions persist, and identical reimport changes nothing");
  checks.push("migration026 preserves legacy helpers, groups, 67 UUIDs, scoped non-unit weights and synthetic student results; exact adoption maps every skill, rejects ambiguous names and enforces unique foreign keys");

  const editedWorkbook = new ExcelJS.Workbook();
  await editedWorkbook.xlsx.load(sourceBytes);
  const sourceLinks = editedWorkbook.getWorksheet("course_skills");
  assert(sourceLinks);
  const originalCode = String(sourceLinks.getCell(2, 1).value).trim().toUpperCase();
  for (let row = 2; row <= sourceLinks.rowCount; row++) if (String(sourceLinks.getCell(row, 1).value).trim().toUpperCase() === originalCode)
    sourceLinks.getCell(row, 1).value = "UNKNOWN_AUDIT_CODE";
  const unknownBytes = Buffer.from(await editedWorkbook.xlsx.writeBuffer());
  const beforeBadImport = await fingerprint(pool, schema);
  const badPreview = await expectResponse(importPreview(realRevisionId, unknownBytes), 200);
  assert.equal(badPreview.canImport, false);
  assert(badPreview.errors.some(issue => issue.code === "course_not_found"));
  await expectResponse(importConfirm(realRevisionId, badPreview, unknownBytes), 422, "import_has_errors");
  assert.deepEqual(await fingerprint(pool, schema), beforeBadImport);
  const duplicateSourceData = structuredClone(realCurriculum.data);
  duplicateSourceData.major = "Integration duplicate source major";
  duplicateSourceData.name = "Integration duplicate source K29";
  const repeatedSourceCourse = duplicateSourceData.courses.find(course => course.code === originalCode);
  assert(repeatedSourceCourse, "The actual workbook's first course must exist in the K29 reference");
  duplicateSourceData.courses.push({ ...structuredClone(repeatedSourceCourse), position: duplicateSourceData.courses.length + 1, sourceRow: 1999 });
  const duplicateSourceId = await curricula.create(duplicateSourceData, k29Source.source_data, "audit_duplicate_K29.xlsx");
  const duplicateSourceRevision = (await curricula.detail(duplicateSourceId)).revisionId;
  const beforeDuplicateImport = await fingerprint(pool, schema);
  const duplicatedSource = await expectResponse(importPreview(duplicateSourceRevision), 200);
  assert.equal(duplicatedSource.canImport, false);
  assert(duplicatedSource.errors.some(issue => issue.code === "ambiguous_course"));
  await expectResponse(importConfirm(duplicateSourceRevision, duplicatedSource), 422, "import_has_errors");
  assert.deepEqual(await fingerprint(pool, schema), beforeDuplicateImport);
  checks.push("unknown courses and repeated CTĐT codes block the entire Excel import without partial writes or invented course catalog entries");

  const sourceSkillPlan = preview.skills.find(skill => skill.action === "create");
  assert(sourceSkillPlan);
  let importedSkill = (await expectResponse(competency("/skills"), 200)).items.find(skill => skill.name === sourceSkillPlan.name);
  assert(importedSkill);
  const importedSkillId = importedSkill.id;
  importedSkill = await expectResponse(competency(`/skills/${importedSkill.id}`, "PATCH", skillInput(importedSkill, { name: "Audit renamed imported competency" }), token(importedSkill.version)), 200);
  const alias = (await pool.query("SELECT skill_id FROM ad_comp_import_aliases WHERE cohort_code='K29' AND source_name=$1", [sourceSkillPlan.name])).rows[0];
  assert.equal(alias.skill_id, importedSkillId);
  const aliasPreview = await expectResponse(importPreview(realRevisionId), 200);
  assert.equal(aliasPreview.skills.find(skill => skill.name === sourceSkillPlan.name).skillId, importedSkillId);
  assert.equal(aliasPreview.requiresOverwrite, false);
  const beforeAliasImport = await fingerprint(pool, schema);
  assert.equal((await expectResponse(importConfirm(realRevisionId, aliasPreview), 200)).unchanged, true);
  assert.deepEqual(await fingerprint(pool, schema), beforeAliasImport);
  importedSkill = await getSkill(importedSkillId);
  assert.equal(importedSkill.name, "Audit renamed imported competency");
  const linkedCourse = importedSkill.contributions.find(link => link.revisionId === realRevisionId);
  assert(linkedCourse);
  let importedCourse = await getCourse(realRevisionId, linkedCourse.courseCode);
  assert(importedCourse.links.some(link => link.skillId === importedSkillId && link.skillName === importedSkill.name));
  assert(importedCourse.history.some(event => event.snapshot.links?.some(link => link.skillId === importedSkillId && link.skillName === sourceSkillPlan.name)));
  importedCourse = await expectResponse(saveCourse(realRevisionId, importedCourse.courseCode, importedCourse.version,
    importedCourse.links.map(link => ({ skillId: link.skillId, weight: link.weight })), "draft", "Manual audit edit"), 200);
  importedSkill = await expectResponse(competency(`/skills/${importedSkill.id}`, "PATCH", skillInput(importedSkill, { scope: "Manual audit scope" }), token(importedSkill.version)), 200);
  const overwritePreview = await expectResponse(importPreview(realRevisionId), 200);
  assert.equal(overwritePreview.requiresOverwrite, true);
  assert(overwritePreview.counts.skillsToUpdate > 0 && overwritePreview.counts.coursesToUpdate > 0);
  const beforeOverwrite = await fingerprint(pool, schema);
  await expectResponse(importConfirm(realRevisionId, overwritePreview), 409, "confirm_overwrite");
  assert.deepEqual(await fingerprint(pool, schema), beforeOverwrite);
  await expectResponse(importConfirm(realRevisionId, overwritePreview, sourceBytes, { "x-confirm-overwrite": "true" }), 200);
  importedSkill = await getSkill(importedSkillId);
  assert.equal(importedSkill.scope, sourceSkillPlan.scope);
  assert.equal(importedSkill.name, "Audit renamed imported competency");
  assert.equal((await getCourse(realRevisionId, importedCourse.courseCode)).status, "active");
  assert.equal(importedSkill.legacySkillId, legacySkills.get(sourceSkillPlan.name));
  assert.deepEqual(await legacyFingerprint(), legacyBaseline, "All new API/import/reimport/rename/overwrite operations must preserve legacy data and results");
  checks.push("cohort source aliases retain the same UUID after rename; snapshots retain old names and manual profile/config changes require explicit overwrite");

  assert.deepEqual(await fingerprint(adminPool, "public"), publicBefore);
  checks.push("public table counts and full-row digests are unchanged: all fixture, migration, API and import writes stayed in the disposable schema");
  console.log(JSON.stringify({ passed: true, schema, workbook: sourceFilename, checks }, null, 2));
} finally {
  if (server) await new Promise(done => server.close(done));
  await pool.end();
  if (schemaCreated) {
    assert(/^competencies_audit_[0-9a-f]{12}$/.test(schema));
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  await adminPool.end();
}
