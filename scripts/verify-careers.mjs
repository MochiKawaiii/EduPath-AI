// Integration checks use a disposable schema on the configured LOCAL database only.
// They exercise career migrations and the real compiled admin/student routers.
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import pg from "pg";
import dotenv from "dotenv";
import express from "express";
import { createCareersRouter } from "../apps/api/dist/careers/router.js";
import { createStudentDataRouter } from "../apps/api/dist/student/router.js";
import { createAdminAccountsRouter, PostgresAdminAccountRepository } from "../apps/api/dist/admin/accounts.js";

const env = dotenv.parse(await readFile("apps/api/.env", "utf8"));
assert(env.DATABASE_URL, "apps/api/.env must define DATABASE_URL for integration checks");
const configuredUrl = new URL(env.DATABASE_URL);
assert(
  ["localhost", "127.0.0.1"].includes(configuredUrl.hostname),
  "Integration checks require a local database",
);

const schema = "careers_audit_" + randomBytes(6).toString("hex");
assert(/^careers_audit_[0-9a-f]{12}$/.test(schema));
const adminPool = new pg.Pool({ connectionString: env.DATABASE_URL });
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  options: `-c search_path=${schema},public`,
});
const auditOrigin = "http://careers.audit";
const tenantId = randomUUID();
const adminId = randomUUID();
const studentId = randomUUID();
const checks = [];
let server;
let schemaCreated = false;

const adminActor = (role = "admin") => ({
  userId: adminId,
  identityKey: `${tenantId}:${adminId}`,
  tenantId,
  objectId: adminId,
  name: "Career audit admin",
  email: "career-audit@example.test",
  username: "career-audit@example.test",
  role,
  signedInAt: new Date(0).toISOString(),
});
const studentActor = {
  userId: studentId,
  identityKey: `${tenantId}:${studentId}`,
  tenantId,
  objectId: studentId,
  name: "Career audit student",
  email: "career-student@example.test",
  username: "career-student@example.test",
  role: "student",
  signedInAt: new Date(0).toISOString(),
};

async function publicSnapshot() {
  const careers = await adminPool.query(
    "SELECT to_regclass('public.career_positions') IS NOT NULL AS present",
  );
  const profiles = await adminPool.query(
    "SELECT to_regclass('public.student_profiles') IS NOT NULL AS present",
  );
  const skills = await adminPool.query(
    "SELECT to_regclass('public.career_skills') IS NOT NULL AS present",
  );
  const requirements = await adminPool.query(
    "SELECT to_regclass('public.career_requirements') IS NOT NULL AS present",
  );
  return {
    careers: careers.rows[0].present
      ? (await adminPool.query("SELECT count(*)::int AS n FROM public.career_positions")).rows[0].n
      : null,
    profiles: profiles.rows[0].present
      ? (await adminPool.query("SELECT count(*)::int AS n FROM public.student_profiles")).rows[0].n
      : null,
    skills: skills.rows[0].present
      ? (await adminPool.query("SELECT count(*)::int AS n FROM public.career_skills")).rows[0].n
      : null,
    requirements: requirements.rows[0].present
      ? (await adminPool.query("SELECT count(*)::int AS n FROM public.career_requirements")).rows[0].n
      : null,
  };
}

try {
  const publicBefore = await publicSnapshot();
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  await pool.query(`
    CREATE TABLE users(
      id UUID PRIMARY KEY, entra_tenant_id UUID NOT NULL, entra_object_id UUID NOT NULL,
      entra_subject TEXT NOT NULL, display_name TEXT NOT NULL, email TEXT, username TEXT,
      role TEXT NOT NULL, role_override TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE,
      first_login_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE student_profiles(
      user_id UUID PRIMARY KEY REFERENCES users(id), student_code TEXT, full_name TEXT, cohort_year SMALLINT,
      class_name TEXT, current_semester SMALLINT, career_goal TEXT, interests TEXT,
      onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const careersMigration = await readFile("apps/api/migrations/014_career_positions.sql", "utf8");
  await pool.query(careersMigration.replaceAll("public.", `${schema}.`));
  const fieldsMigration = await readFile("apps/api/migrations/015_career_fields.sql", "utf8");
  await pool.query(fieldsMigration.replaceAll("public.", `${schema}.`));
  const requirementsMigration = await readFile("apps/api/migrations/016_career_requirements.sql", "utf8");
  await pool.query(requirementsMigration.replaceAll("public.", `${schema}.`));
  const skillsMigration = await readFile("apps/api/migrations/019_career_skill_management.sql", "utf8");
  await pool.query(skillsMigration.replaceAll("public.", `${schema}.`));
  // Include an archived numeric code that collides with the new numbering scheme.
  await pool.query("INSERT INTO career_fields(code,name,deleted_at) VALUES('1','Archived numeric field',now())");
  await pool.query(`INSERT INTO career_positions(code,name_vi,name_en,category,description,skills,search_text,deleted_at)
    VALUES('NN001','Archived number audit','Archived number audit','1','','{}','',now())`);
  const originalFields = (await pool.query("SELECT id,code,name,description,deleted_at,version FROM career_fields ORDER BY id")).rows;
  const originalLinks = (await pool.query(`SELECT p.id,f.id AS field_id FROM career_positions p
    JOIN career_fields f ON f.code=p.category ORDER BY p.id`)).rows;
  const numbersMigration = await readFile("apps/api/migrations/020_career_field_numbers.sql", "utf8");
  await pool.query(`BEGIN; ${numbersMigration.replaceAll("public.", `${schema}.`)} COMMIT;`);
  const numberedFields = (await pool.query("SELECT id,code,name,description,deleted_at,version FROM career_fields ORDER BY id")).rows;
  assert.equal(numberedFields.length, originalFields.length);
  for (let i = 0; i < numberedFields.length; i++) {
    assert.deepEqual({ ...numberedFields[i], code: originalFields[i].code, version: originalFields[i].version }, originalFields[i]);
    assert.match(numberedFields[i].code, /^[1-9][0-9]*$/);
    assert.notEqual(numberedFields[i].version, originalFields[i].version);
  }
  assert.deepEqual((await pool.query(`SELECT p.id,f.id AS field_id FROM career_positions p
    JOIN career_fields f ON f.code=p.category ORDER BY p.id`)).rows, originalLinks);
  assert.deepEqual(numberedFields.map(f => Number(f.code)).sort((a,b) => a-b), [1,2,3,4,5,6,7]);
  checks.push("field number migration preserves active/archived fields and career associations, resolves existing numeric-code collisions and invalidates old versions");
  await pool.query(
    "INSERT INTO users(id,entra_tenant_id,entra_object_id,entra_subject,display_name,email,username,role) VALUES($1,$2,$3,$4,$5,$6,$7,'admin'),($8,$2,$9,$10,$11,$12,$13,'student')",
    [
      adminId,
      tenantId,
      randomUUID(),
      "career-admin-subject",
      "Career audit admin",
      "career-audit@example.test",
      "career-audit@example.test",
      studentId,
      randomUUID(),
      "career-student-subject",
      "Career audit student",
      "career-student@example.test",
      "career-student@example.test",
    ],
  );
  await pool.query(
    "INSERT INTO student_profiles(user_id,career_goal,interests,class_name,current_semester) VALUES($1,$2,$3,$4,$5)",
    [studentId, "Legacy free-text goal", "Data and AI", "CNTT08", 2],
  );

  const originalCareers = (await pool.query("SELECT id,code,name_vi,name_en,category,description,skills,deleted_at,version FROM career_positions ORDER BY id")).rows;
  const originalRequirements = (await pool.query("SELECT id,career_position_id,skill_id FROM career_requirements ORDER BY id")).rows;
  await pool.query("UPDATE student_profiles SET career_position_id=$2 WHERE user_id=$1", [studentId, originalCareers[0].id]);
  const positionCodesMigration = await readFile("apps/api/migrations/021_career_position_codes.sql", "utf8");
  await pool.query(`BEGIN; ${positionCodesMigration.replaceAll("public.", `${schema}.`)} COMMIT;`);
  const numberedCareers = (await pool.query("SELECT id,code,name_vi,name_en,category,description,skills,deleted_at,version FROM career_positions ORDER BY id")).rows;
  assert.equal(numberedCareers.length, originalCareers.length);
  for (let i = 0; i < numberedCareers.length; i++) {
    assert.deepEqual({ ...numberedCareers[i], code: originalCareers[i].code, version: originalCareers[i].version }, originalCareers[i]);
    assert.match(numberedCareers[i].code, /^NN[0-9]{3,}$/);
    assert.notEqual(numberedCareers[i].version, originalCareers[i].version);
  }
  assert.deepEqual(numberedCareers.map(c => Number(c.code.slice(2))).sort((a,b) => a-b), Array.from({ length: 21 }, (_, i) => i+1));
  assert.deepEqual((await pool.query("SELECT id,career_position_id,skill_id FROM career_requirements ORDER BY id")).rows, originalRequirements);
  assert.equal((await pool.query("SELECT career_position_id FROM student_profiles WHERE user_id=$1", [studentId])).rows[0].career_position_id, originalCareers[0].id);
  await pool.query("UPDATE student_profiles SET career_position_id=NULL WHERE user_id=$1", [studentId]);
  checks.push("position code migration renumbers active/archived rows and existing NN001 collisions while preserving all UUIDs, metadata, student selections and skill links");

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    const role = req.get("x-role") ?? (req.path.startsWith("/api/student") ? "student" : "admin");
    req.session = {
      user: role === "anonymous" ? undefined : role === "student" ? studentActor : adminActor(role),
    };
    next();
  });
  app.use("/careers", createCareersRouter(pool, auditOrigin));
  app.use("/student-careers", createCareersRouter(pool, auditOrigin, true));
  app.use("/student", createStudentDataRouter(pool, auditOrigin));
  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "integration_error" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (process.argv.includes("--ui")) {
    const uiRole = process.argv.find((argument) => argument.startsWith("--ui-role="))?.slice("--ui-role=".length) ?? "admin";
    assert(["admin", "faculty_board", "department_head", "lecturer"].includes(uiRole), "unsupported UI fixture role");
    await pool.query("UPDATE users SET role=$2 WHERE id=$1", [adminId, uiRole]);
    app.get("/api/auth/me", (_req, res) =>
      res.json({ authenticated: true, user: studentActor, studentPortal: true }),
    );
    app.get("/api/admin/me", (_req, res) =>
      res.json({ authenticated: true, user: adminActor(uiRole) }),
    );
    app.get("/api/student/profile", async (_req, res) => {
      const row = (await pool.query(
        `SELECT p.class_name AS "className",p.interests,p.career_goal AS "careerGoal",
          p.career_position_id AS "careerPositionId",
          (SELECT json_build_object('id',c.id,'nameVi',c.name_vi,'nameEn',c.name_en,'category',c.category,'description',c.description,'deletedAt',c.deleted_at)
             FROM career_positions c WHERE c.id=p.career_position_id) AS "careerPosition"
         FROM student_profiles p WHERE p.user_id=$1`,
        [studentId],
      )).rows[0] ?? {};
      res.json({
        student: {
          id: studentId,
          name: studentActor.name,
          email: studentActor.email,
          studentCode: "AUDIT001",
          cohortCode: "K29",
          cohortYear: 2023,
          ...row,
        },
      });
    });
    app.get("/api/student/transcript", (_req, res) =>
      res.json({ transcript: null, job: null, workerOnline: false, ocrEnabled: false }),
    );
    app.use("/api/admin/careers", createCareersRouter(pool, origin));
    app.use("/api/admin/accounts", createAdminAccountsRouter(new PostgresAdminAccountRepository(pool), origin));
    app.use("/api/student/careers", createCareersRouter(pool, origin, true));
    app.use("/api/student", createStudentDataRouter(pool, origin));
    app.use(express.static(resolve("apps/web/dist")));
    app.get(/^\/(?:quantri|dashboard)(?:\/.*)?$/, (_req, res) =>
      res.sendFile(resolve("apps/web/dist/index.html")),
    );
  }

  const api = async (base, path = "", method = "GET", body, headers = {}) => {
    const response = await fetch(origin + base + path, {
      method,
      headers: {
        Origin: auditOrigin,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed };
  };

  let result = await api("/careers");
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 20);
  assert.equal(new Set(result.body.items.map((item) => item.category)).size, 6);
  const frontend = result.body.items.find((item) => item.nameEn === "Frontend Developer");
  assert(frontend, "migration must seed the frontend position");
  checks.push("migration seeds exactly 20 bilingual IT career positions across six categories");

  const seededSkillInfo = await pool.query(`
    SELECT (SELECT count(*)::int FROM career_skills) AS skills,
      (SELECT count(DISTINCT lower(trim(skill)))::int FROM career_positions p CROSS JOIN LATERAL unnest(p.skills) skill) AS legacy_skills,
      (SELECT count(*)::int FROM career_positions p CROSS JOIN LATERAL unnest(p.skills) skill) AS legacy_occurrences,
      (SELECT count(*)::int FROM career_requirements WHERE skill_id IS NOT NULL AND deleted_at IS NULL) AS links,
      (SELECT count(*)::int FROM (
        SELECT DISTINCT p.id,lower(trim(skill)) AS name
        FROM career_positions p CROSS JOIN LATERAL unnest(p.skills) skill
      ) expected) AS expected_links,
      (SELECT count(*)::int FROM (
        SELECT DISTINCT p.id,lower(trim(skill)) AS name
        FROM career_positions p CROSS JOIN LATERAL unnest(p.skills) skill
      ) expected
      LEFT JOIN career_skills s ON lower(s.name)=expected.name
      LEFT JOIN career_requirements r ON r.career_position_id=expected.id AND r.skill_id=s.id AND r.deleted_at IS NULL
      WHERE s.id IS NULL OR r.id IS NULL) AS missing_links`);
  assert.equal(seededSkillInfo.rows[0].skills, seededSkillInfo.rows[0].legacy_skills,
    "migration 016 must preserve each distinct legacy skill name");
  assert.equal(seededSkillInfo.rows[0].links, seededSkillInfo.rows[0].expected_links,
    "every distinct legacy career-skill pair must have an active requirement link");
  assert.equal(seededSkillInfo.rows[0].links, 80,
    "migration 016 must preserve all 80 legacy career-skill links");
  assert.equal(seededSkillInfo.rows[0].missing_links, 0);
  result = await api("/careers", "/requirements/skills");
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, seededSkillInfo.rows[0].legacy_skills);
  checks.push(`migration 016 seeds every distinct legacy career skill and active career-skill link (${seededSkillInfo.rows[0].legacy_skills} names, 80 links)`);

  result = await api("/careers", "/fields");
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 6);
  assert(result.body.items.every((field) => Number.isInteger(field.positionCount)));
  const productCode = result.body.items.find(field => field.name === "Nghiệp vụ & Thiết kế").code;
  const infrastructureCode = result.body.items.find(field => field.name === "Hạ tầng & Điện toán đám mây").code;
  const initialProductPositionCount = result.body.items.find(field => field.code === productCode).positionCount;
  assert.deepEqual(result.body.items.map(field => Number(field.code)), [1,2,3,4,5,6]);
  checks.push("migration 015 seeds six active career fields and reports position counts");

  result = await api("/careers", "?q=" + encodeURIComponent("Kỹ sư") + "&category=" + infrastructureCode);
  assert.equal(result.status, 200);
  assert(result.body.items.length >= 1);
  assert(result.body.items.every((item) => item.category === infrastructureCode));
  result = await api("/careers", "?q=" + encodeURIComponent("DATA ANALYST"));
  assert.equal(result.status, 200);
  assert(result.body.items.some((item) => item.nameEn === "Data Analyst"));
  assert((await api("/careers", "?q=" + frontend.code)).body.items.some(item => item.id === frontend.id));
  result = await api("/careers", "?category=valid-but-unknown");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { items: [] });
  assert.equal((await api("/careers", "?category=%21invalid")).status, 400);
  checks.push("accent-insensitive Vietnamese/English search and category filtering work");

  assert.equal(
    (await api("/careers", "", "GET", undefined, { "x-role": "student" })).status,
    403,
  );
  assert.equal(
    (
      await api("/careers", "", "POST", {
        code: "wrong-origin",
        nameVi: "Sai origin",
        nameEn: "Wrong origin",
        category: productCode,
        description: "",
        skills: [],
      }, { Origin: "http://evil.local" })
    ).status,
    403,
  );
  checks.push("admin role and CSRF origin checks reject unauthorized catalog writes");

  const customInput = {
    code: "integration-career",
    nameVi: "Vị trí kiểm thử tích hợp",
    nameEn: "Integration Career",
    category: productCode,
    description: "Temporary verifier position",
    skills: ["Testing", "SQL"],
  };
  result = await api("/careers", "", "POST", customInput);
  assert.equal(result.status, 201);
  const customId = result.body.id;
  const customCode = result.body.code;
  assert.match(customCode, /^NN[0-9]{3,}$/);
  assert.notEqual(customCode, customInput.code);
  const customVersion = result.body.version;
  assert.equal(
    (await api("/careers", "", "POST", customInput)).body.error,
    "career_exists",
  );
  result = await api("/careers", `/${customId}`, "GET");
  assert.equal(result.status, 200);
  assert.equal(result.body.studentCount, 0);
  result = await api("/careers", `/${customId}`, "PATCH", {
    ...customInput,
    nameVi: "Vị trí kiểm thử tích hợp cập nhật",
  }, { "x-version": customVersion });
  assert.equal(result.status, 200);
  const updatedCustomVersion = result.body.version;
  assert.equal(result.body.code, customCode);
  assert((await api("/careers", "?q=" + customCode)).body.items.some(item => item.id === customId));
  assert.notEqual(updatedCustomVersion, customVersion);
  assert.equal(
    (await api("/careers", `/${customId}`, "PATCH", customInput, { "x-version": customVersion })).status,
    409,
  );
  result = await api("/careers", `/${customId}`, "PATCH", {
    code: customInput.code,
    nameVi: "Vị trí kiểm thử tích hợp cập nhật",
    nameEn: customInput.nameEn,
    category: customInput.category,
    description: customInput.description,
  }, { "x-version": updatedCustomVersion });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.skills.sort(), ["SQL", "Testing"]);
  const customNoSkillsVersion = result.body.version;
  checks.push("admin career PATCH may omit legacy skills while preserving linked skill names");

  result = await api("/careers", `/requirements?careerPositionId=${customId}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items.map((item) => item.skillName).sort(), ["SQL", "Testing"]);
  const sqlRequirement = result.body.items.find((item) => item.skillName === "SQL");
  const testingRequirement = result.body.items.find((item) => item.skillName === "Testing");
  assert(sqlRequirement && testingRequirement);
  assert.equal(sqlRequirement.level, "unspecified");
  assert.equal(sqlRequirement.isRequired, false);
  result = await api("/careers", `/requirements/${sqlRequirement.id}`, "PATCH", {
    careerPositionId: customId,
    title: "SQL data querying",
    description: "Query relational data sources.",
    skillId: sqlRequirement.skillId,
    skillName: "",
    level: "advanced",
    isRequired: true,
  }, { "x-version": sqlRequirement.version });
  assert.equal(result.status, 200);
  assert.equal(result.body.level, "advanced");
  const structuredSqlVersion = result.body.version;
  const careerAfterStructuredEdit = await api("/careers", `/${customId}`);
  assert.equal(careerAfterStructuredEdit.status, 200);

  result = await api("/careers", `/${customId}`, "PATCH", {
    code: customInput.code,
    nameVi: "Vị trí kiểm thử tích hợp cập nhật",
    nameEn: customInput.nameEn,
    category: customInput.category,
    description: customInput.description,
    skills: ["SQL", "Statistics"],
  }, { "x-version": careerAfterStructuredEdit.body.version });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.skills.sort(), ["SQL", "Statistics"]);
  const syncedCareerVersion = result.body.version;
  result = await api("/careers", `/requirements?careerPositionId=${customId}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items.map((item) => item.skillName).sort(), ["SQL", "Statistics"]);
  const synchronizedSql = result.body.items.find((item) => item.skillName === "SQL");
  const statisticsRequirement = result.body.items.find((item) => item.skillName === "Statistics");
  assert.equal(synchronizedSql.level, "advanced", "legacy skill sync must retain existing requirement metadata");
  assert.equal(synchronizedSql.isRequired, true);
  assert.equal(statisticsRequirement.level, "unspecified");
  assert.equal(statisticsRequirement.isRequired, false);
  assert.equal((await api("/careers", `/requirements/${testingRequirement.id}`)).status, 404);
  checks.push("career POST/PATCH legacy skills synchronize structured links, preserve metadata, and retain skills when PATCH omits them");

  let requirementResult = await api("/careers", "/requirements", "POST", {
    careerPositionId: customId,
    title: "React fundamentals",
    description: "Build responsive interfaces.",
    skillId: null,
    skillName: "Career Audit React",
    level: "intermediate",
    isRequired: true,
  });
  assert.equal(requirementResult.status, 201);
  const reactRequirement = requirementResult.body;
  const reactSkillId = reactRequirement.skillId;
  result = await api("/careers", `/requirements?careerPositionId=${customId}&category=${productCode}&skillId=${reactSkillId}&level=intermediate&kind=skill&priority=required&q=react`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items.map((item) => item.id), [reactRequirement.id]);
  assert((await api("/careers", `/${customId}`)).body.skills.includes("Career Audit React"));
  result = await api("/student-careers", "", "GET", undefined, { "x-role": "student" });
  assert(result.body.items.find((item) => item.id === customId).skills.includes("Career Audit React"));

  const optionalRequirement = await api("/careers", "/requirements", "POST", {
    careerPositionId: customId,
    title: "Kỹ năng phối hợp",
    description: "Làm việc cùng nhóm.",
    skillId: null,
    skillName: "",
    level: "unspecified",
    isRequired: false,
  });
  assert.equal(optionalRequirement.status, 201);
  result = await api("/careers", "/requirements?careerPositionId=" + customId + "&kind=other&priority=preferred&q=ky%20nang");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items.map((item) => item.id), [optionalRequirement.body.id]);
  assert.equal((await api("/careers", "/requirements?careerPositionId=" + customId + "&kind=other&priority=required")).body.items.length, 0);

  const studentCareerDetail = await api("/student-careers", `/${customId}`, "GET", undefined, { "x-role": "student" });
  assert.equal(studentCareerDetail.status, 200);
  assert.deepEqual(Object.keys(studentCareerDetail.body).sort(), [
    "category", "categoryName", "code", "description", "id", "nameEn", "nameVi", "requirements",
  ].sort());
  assert.equal(studentCareerDetail.body.requirements.length, 4);
  const canonicalReact = studentCareerDetail.body.requirements.find((item) => item.title === "React fundamentals");
  assert.deepEqual({
    title: canonicalReact.title,
    description: canonicalReact.description,
    skillName: canonicalReact.skillName,
    level: canonicalReact.level,
    isRequired: canonicalReact.isRequired,
  }, {
    title: "React fundamentals",
    description: "Build responsive interfaces.",
    skillName: "Career Audit React",
    level: "intermediate",
    isRequired: true,
  });
  const canonicalPlain = studentCareerDetail.body.requirements.find((item) => item.title === "Kỹ năng phối hợp");
  assert.deepEqual({
    title: canonicalPlain.title,
    description: canonicalPlain.description,
    skillName: canonicalPlain.skillName,
    level: canonicalPlain.level,
    isRequired: canonicalPlain.isRequired,
  }, {
    title: "Kỹ năng phối hợp",
    description: "Làm việc cùng nhóm.",
    skillName: null,
    level: "unspecified",
    isRequired: false,
  });
  assert(studentCareerDetail.body.requirements.every((item) => !("version" in item) && !("skillId" in item)));
  assert.deepEqual(await api("/student-careers", `/${customId}`, "GET", undefined, { "x-role": "anonymous" }), {
    status: 401,
    body: { error: "authentication_required" },
  });
  checks.push("student career detail exposes canonical linked/plain active requirements without admin metadata and requires authentication");

  assert.deepEqual(
    await api("/careers", "/requirements", "POST", {
      careerPositionId: customId,
      title: "React requirement duplicate",
      description: "Duplicate active skill link.",
      skillId: reactSkillId,
      skillName: "",
      level: "basic",
      isRequired: false,
    }),
    { status: 409, body: { error: "requirement_exists" } },
  );
  const linkedBeforeDuplicate = (await api("/careers", `/requirements?careerPositionId=${customId}&kind=skill`)).body.items;
  assert(linkedBeforeDuplicate.some(item => item.skillId === reactSkillId && item.skillName === "Career Audit React"));
  assert.deepEqual(await api("/careers", "/requirements", "POST", {
    careerPositionId: customId, title: "React alias duplicate", description: "",
    skillId: null, skillName: "  career audit react  ", level: "basic", isRequired: false,
  }), { status: 409, body: { error: "requirement_exists" } });
  assert.deepEqual(await api("/careers", `/requirements/${sqlRequirement.id}`, "PATCH", {
    careerPositionId: customId, title: "Replace SQL with existing React", description: "",
    skillId: reactSkillId, skillName: "", level: "basic", isRequired: false,
  }, { "x-version": structuredSqlVersion }), { status: 409, body: { error: "requirement_exists" } });
  assert.deepEqual((await api("/careers", `/requirements?careerPositionId=${customId}&kind=skill`)).body.items, linkedBeforeDuplicate);
  const staleRequirement = await api("/careers", `/requirements/${reactRequirement.id}`, "PATCH", {
    careerPositionId: customId,
    title: "Stale edit",
    description: "Old version.",
    skillId: reactSkillId,
    skillName: "",
    level: "basic",
    isRequired: false,
  }, { "x-version": sqlRequirement.version });
  assert.deepEqual(staleRequirement, { status: 409, body: { error: "requirement_changed" } });
  assert.equal((await api("/careers", "/requirements", "POST", {
    careerPositionId: randomUUID(),
    title: "Missing parent",
    description: "The career does not exist.",
    skillId: null,
    skillName: "",
    level: "unspecified",
    isRequired: false,
  })).status, 404);
  checks.push("structured requirement search and filters cover career, category, skill, level, kind, priority, duplicate links, and Vietnamese text");

  result = await api("/careers", `/requirements/${reactRequirement.id}`, "PATCH", {
    careerPositionId: frontend.id,
    title: "React fundamentals",
    description: "Build responsive interfaces.",
    skillId: reactSkillId,
    skillName: "",
    level: "intermediate",
    isRequired: true,
  }, { "x-version": reactRequirement.version });
  assert.equal(result.status, 200);
  const movedReactRequirement = result.body;
  assert(!(await api("/careers", `/${customId}`)).body.skills.includes("Career Audit React"));
  assert((await api("/careers", `/${frontend.id}`)).body.skills.includes("Career Audit React"));
  const customStudentAfterMove = await api("/student-careers", `/${customId}`, "GET", undefined, { "x-role": "student" });
  assert.equal(customStudentAfterMove.status, 200);
  assert(!customStudentAfterMove.body.requirements.some((item) => item.title === "React fundamentals"));
  const frontendStudentAfterMove = await api("/student-careers", `/${frontend.id}`, "GET", undefined, { "x-role": "student" });
  assert.equal(frontendStudentAfterMove.status, 200);
  const movedCanonicalReact = frontendStudentAfterMove.body.requirements.find((item) => item.title === "React fundamentals");
  assert.deepEqual({ skillName: movedCanonicalReact.skillName, isRequired: movedCanonicalReact.isRequired }, {
    skillName: "Career Audit React",
    isRequired: true,
  });
  result = await api("/student-careers", "", "GET", undefined, { "x-role": "student" });
  assert(!(result.body.items.find((item) => item.id === customId).skills ?? []).includes("Career Audit React"));
  assert(result.body.items.find((item) => item.id === frontend.id).skills.includes("Career Audit React"));
  assert.deepEqual(await api("/careers", `/requirements/${movedReactRequirement.id}`, "DELETE", { confirmed: true }, { "x-version": movedReactRequirement.version }), { status: 200, body: { deleted: true } });
  assert(!(await api("/careers", `/${frontend.id}`)).body.skills.includes("Career Audit React"));
  const frontendStudentAfterRequirementDelete = await api("/student-careers", `/${frontend.id}`, "GET", undefined, { "x-role": "student" });
  assert.equal(frontendStudentAfterRequirementDelete.status, 200);
  assert(!frontendStudentAfterRequirementDelete.body.requirements.some((item) => item.title === "React fundamentals"));
  assert.deepEqual(await api("/careers", `/requirements/${optionalRequirement.body.id}`, "DELETE", { confirmed: true }, { "x-version": optionalRequirement.body.version }), { status: 200, body: { deleted: true } });
  const customStudentAfterPlainDelete = await api("/student-careers", `/${customId}`, "GET", undefined, { "x-role": "student" });
  assert.equal(customStudentAfterPlainDelete.status, 200);
  assert(!customStudentAfterPlainDelete.body.requirements.some((item) => item.title === "Kỹ năng phối hợp"));
  assert.equal((await api("/careers", `/requirements?careerPositionId=${customId}&kind=other`)).body.items.length, 0);
  assert.equal((await api("/careers", `/requirements/${testingRequirement.id}`)).status, 404);
  checks.push("moving and deleting linked and standalone requirements refreshes source/destination legacy and student skill lists");

  assert.deepEqual(await api("/careers", "/requirements", "POST", {
    careerPositionId: customId,
    title: "Field origin guard",
    description: "",
    skillId: null,
    skillName: "",
    level: "unspecified",
    isRequired: false,
  }, { Origin: "http://evil.local" }), { status: 403, body: { error: "invalid_origin" } });
  for (const role of ["faculty_board", "department_head", "lecturer"]) {
    await pool.query("UPDATE users SET role=$2 WHERE id=$1", [adminId, role]);
    assert.equal((await api("/careers", "/requirements", "GET", undefined, { "x-role": role })).status, 200);
    const staffRequirement = await api("/careers", "/requirements", "POST", {
      careerPositionId: customId,
      title: `${role} write permission check`,
      description: "Temporary requirement removed by the verifier.",
      skillId: null,
      skillName: "",
      level: "unspecified",
      isRequired: false,
    }, { "x-role": role });
    assert.equal(staffRequirement.status, 201);
    assert.equal((await api("/careers", `/requirements/${staffRequirement.body.id}`, "DELETE", { confirmed: true }, {
      "x-role": role,
      "x-version": staffRequirement.body.version,
    })).status, 200);
  }
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [adminId]);
  checks.push("all staff roles can create and delete requirements; origin and revoked-role checks remain enforced");

  // Keep these references in scope for the legacy-sync invariants above.
  assert(structuredSqlVersion);
  assert(syncedCareerVersion);
  checks.push("admin create/detail/update handles duplicate codes and stale optimistic versions");

  const customFieldInput = {
    name: "Integration Robotics",
    description: "Temporary field created only in the disposable verifier schema.",
  };
  result = await api("/careers", "/fields", "POST", customFieldInput);
  assert.equal(result.status, 201);
  const customFieldCode = result.body.code;
  assert.match(customFieldCode, /^[1-9][0-9]*$/);
  assert(Number(customFieldCode) > 7);
  const customFieldId = result.body.id;
  const customFieldVersion = result.body.version;
  assert.deepEqual(
    await api("/careers", "/fields", "POST", customFieldInput),
    { status: 409, body: { error: "field_exists" } },
  );
  const customFieldCareerInput = {
    code: "integration-robotics-role",
    nameVi: "Vị trí kiểm thử Robotics",
    nameEn: "Robotics Test Role",
    category: customFieldCode,
    description: "Temporary position under a custom career field.",
    skills: ["Testing"],
  };
  result = await api("/careers", "", "POST", customFieldCareerInput);
  assert.equal(result.status, 201);
  const customFieldCareerId = result.body.id;
  let customFieldCareerVersion = result.body.version;

  result = await api("/careers", `?category=${customFieldCode}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 1);
  assert.equal(result.body.items[0].categoryName, "Integration Robotics");
  let customFieldCareerDetail = await api("/careers", `/${customFieldCareerId}`, "GET");
  assert.equal(customFieldCareerDetail.status, 200);
  assert.equal(customFieldCareerDetail.body.categoryName, "Integration Robotics");
  result = await api("/student-careers", "/fields", "GET", undefined, { "x-role": "student" });
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 7);
  assert(result.body.items.some((item) => item.code === customFieldCode && item.name === "Integration Robotics"));
  result = await api("/student-careers", "", "GET", undefined, { "x-role": "student" });
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 22);
  let studentCustomCareer = result.body.items.find((item) => item.id === customFieldCareerId);
  assert.equal(studentCustomCareer.category, customFieldCode);
  assert.equal(studentCustomCareer.categoryName, "Integration Robotics");

  const fieldUsage = (await api("/careers", "/fields")).body.items;
  assert.equal(fieldUsage.find((item) => item.code === customFieldCode).positionCount, 1);
  result = await api("/careers", `/fields/${customFieldId}`, "DELETE", { confirmed: true }, { "x-version": customFieldVersion });
  assert.deepEqual(result, { status: 409, body: { error: "field_in_use" } });

  result = await api("/careers", `/fields/${customFieldId}`, "PATCH", {
    name: "Integration Robotics Updated",
    description: "Updated verifier field description.",
  }, { "x-version": customFieldVersion });
  assert.equal(result.status, 200);
  assert.equal(result.body.code, customFieldCode);
  assert.notEqual(result.body.version, customFieldVersion);
  let updatedFieldVersion = result.body.version;
  assert.deepEqual(
    await api("/careers", `/fields/${customFieldId}`, "PATCH", {
      name: customFieldInput.name,
      description: customFieldInput.description,
    }, { "x-version": customFieldVersion }),
    { status: 409, body: { error: "field_changed" } },
  );
  assert.deepEqual(
    await api("/careers", `/fields/${customFieldId}`, "PATCH", {
      code: "renamed_robotics",
      name: customFieldInput.name,
      description: customFieldInput.description,
    }, { "x-version": updatedFieldVersion }),
    { status: 400, body: { error: "invalid_field" } },
  );
  result = await api("/careers", `?category=${customFieldCode}`);
  assert.equal(result.body.items[0].categoryName, "Integration Robotics Updated");
  customFieldCareerDetail = await api("/careers", `/${customFieldCareerId}`, "GET");
  assert.equal(customFieldCareerDetail.body.categoryName, "Integration Robotics Updated");
  result = await api("/student-careers", "/fields", "GET", undefined, { "x-role": "student" });
  assert(result.body.items.some((item) => item.code === customFieldCode && item.name === "Integration Robotics Updated"));
  result = await api("/student-careers", "", "GET", undefined, { "x-role": "student" });
  studentCustomCareer = result.body.items.find((item) => item.id === customFieldCareerId);
  assert.equal(studentCustomCareer.categoryName, "Integration Robotics Updated");
  assert.equal((await api("/careers", "/fields")).body.items.find((item) => item.code === customFieldCode).positionCount, 1);
  checks.push("renaming a career field after career creation updates admin list/detail and student category names without changing its code or position count");

  assert.deepEqual(
    await api("/careers", "/fields", "POST", { ...customFieldInput, code: "wrong-origin-field" }, { Origin: "http://evil.local" }),
    { status: 403, body: { error: "invalid_origin" } },
  );
  assert.equal(
    (await api("/careers", "/fields", "POST", { ...customFieldInput, code: "student-field" }, { "x-role": "student" })).status,
    403,
  );
  for (const role of ["faculty_board", "department_head", "lecturer"]) {
    await pool.query("UPDATE users SET role=$2 WHERE id=$1", [adminId, role]);
    const staffField = await api("/careers", "/fields", "POST", {
      code: `${role}_permission_check`,
      name: `${role} permission check`,
      description: "Temporary field created and deleted by the verifier.",
    }, { "x-role": role });
    assert.equal(staffField.status, 201);
    assert.equal((await api("/careers", `/fields/${staffField.body.id}`, "DELETE", { confirmed: true }, {
      "x-role": role,
      "x-version": staffField.body.version,
    })).status, 200);
    result = await api("/careers", `/fields/${customFieldId}`, "PATCH", {
      name: "Integration Robotics Updated",
      description: `Updated by ${role} in the disposable verifier.`,
    }, { "x-role": role, "x-version": updatedFieldVersion });
    assert.equal(result.status, 200);
    updatedFieldVersion = result.body.version;
  }
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [adminId]);
  checks.push("faculty board, department head and lecturer can edit active career fields; students cannot");
  const productField = (await api("/careers", "/fields")).body.items.find((item) => item.code === productCode);
  result = await api("/careers", `/${customFieldCareerId}`, "PATCH", {
    ...customFieldCareerInput,
    category: productCode,
  }, { "x-version": customFieldCareerVersion });
  assert.equal(result.status, 200);
  customFieldCareerVersion = result.body.version;
  assert.equal(result.body.category, productCode);
  let updatedFields = (await api("/careers", "/fields")).body.items;
  assert.equal(updatedFields.find((item) => item.code === customFieldCode).positionCount, 0);
  assert.equal(updatedFields.find((item) => item.code === productCode).positionCount, initialProductPositionCount + 2);
  assert.deepEqual((await api("/careers", `?category=${customFieldCode}`)).body, { items: [] });
  result = await api("/careers", `?category=${productCode}`);
  const reassignedCareer = result.body.items.find((item) => item.id === customFieldCareerId);
  assert.equal(reassignedCareer.categoryName, productField.name);
  customFieldCareerDetail = await api("/careers", `/${customFieldCareerId}`, "GET");
  assert.equal(customFieldCareerDetail.body.categoryName, productField.name);
  result = await api("/student-careers", "", "GET", undefined, { "x-role": "student" });
  studentCustomCareer = result.body.items.find((item) => item.id === customFieldCareerId);
  assert.equal(studentCustomCareer.category, productCode);
  assert.equal(studentCustomCareer.categoryName, productField.name);
  result = await api("/careers", `/fields/${customFieldId}`, "DELETE", { confirmed: true }, { "x-version": updatedFieldVersion });
  assert.deepEqual(result, { status: 200, body: { deleted: true } });
  result = await api("/careers", `/fields/${productField.id}`, "DELETE", { confirmed: true }, { "x-version": productField.version });
  assert.deepEqual(result, { status: 409, body: { error: "field_in_use" } });
  result = await api("/careers", `/${customFieldCareerId}`, "DELETE", { confirmed: true }, { "x-version": customFieldCareerVersion });
  assert.deepEqual(result, { status: 200, body: { deleted: true } });
  updatedFields = (await api("/careers", "/fields")).body.items;
  assert.equal(updatedFields.find((item) => item.code === productCode).positionCount, initialProductPositionCount + 1);
  assert(!updatedFields.some((item) => item.code === customFieldCode));
  result = await api("/student-careers", "/fields", "GET", undefined, { "x-role": "student" });
  assert.equal(result.body.items.length, 6);
  assert(!result.body.items.some((item) => item.code === customFieldCode));
  assert.equal((await api("/student-careers", "", "GET", undefined, { "x-role": "student" })).body.items.length, 21);
  checks.push("career reassignment updates category filters and field counts; deletion is blocked for the occupied destination and succeeds for the unused source");

  let finalCustomVersion = (await api("/careers", `/${customId}`, "GET")).body.version;
  for (const role of ["faculty_board", "department_head", "lecturer"]) {
    await pool.query("UPDATE users SET role=$2 WHERE id=$1", [adminId, role]);
    assert.equal((await api("/careers", "", "GET", undefined, { "x-role": role })).status, 200);
    const staffCareer = await api("/careers", "", "POST", {
      code: `${role.replaceAll("_", "-")}-permission-check`,
      nameVi: `${role} permission check`,
      nameEn: `${role} permission check`,
      category: productCode,
      description: "Temporary career created and deleted by the verifier.",
      skills: [],
    }, { "x-role": role });
    assert.equal(staffCareer.status, 201);
    assert.equal((await api("/careers", `/${staffCareer.body.id}`, "DELETE", { confirmed: true }, {
      "x-role": role,
      "x-version": staffCareer.body.version,
    })).status, 200);
    result = await api("/careers", `/${customId}`, "PATCH", customInput, {
      "x-role": role,
      "x-version": finalCustomVersion,
    });
    assert.equal(result.status, 200);
    finalCustomVersion = result.body.version;
  }
  await pool.query("UPDATE users SET role='student' WHERE id=$1", [adminId]);
  assert.equal((await api("/careers", `/${customId}`, "PATCH", customInput, {
    "x-role": "student",
    "x-version": finalCustomVersion,
  })).status, 403);
  const revokedRequirement = await api("/careers", "/requirements", "POST", {
    careerPositionId: customId,
    title: "Revoked role transaction check",
    description: "This must not persist after access is revoked.",
    skillId: null,
    skillName: "",
    level: "unspecified",
    isRequired: false,
  }, { "x-role": "lecturer" });
  assert.equal(revokedRequirement.status, 403);
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [adminId]);
  checks.push("all staff roles can update careers; students and a revoked staff actor cannot write");

  result = await api("/student-careers", "", "GET", undefined, { "x-role": "student" });
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 21);
  const frontendId = frontend.id;
  result = await api("/student", "/profile", "PATCH", { careerPositionId: frontendId }, { "x-role": "student" });
  assert.deepEqual(result, { status: 200, body: { saved: true } });
  let profileRow = (await pool.query("SELECT career_position_id,career_goal,interests FROM student_profiles WHERE user_id=$1", [studentId])).rows[0];
  assert.equal(profileRow.career_position_id, frontendId);
  assert.equal(profileRow.career_goal, "Legacy free-text goal");
  assert.equal(profileRow.interests, "Data and AI");
  result = await api("/student", "/profile", "PATCH", { careerPositionId: randomUUID() }, { "x-role": "student" });
  assert.deepEqual(result, { status: 409, body: { error: "career_unavailable" } });
  profileRow = (await pool.query("SELECT career_position_id,career_goal,interests FROM student_profiles WHERE user_id=$1", [studentId])).rows[0];
  assert.equal(profileRow.career_position_id, frontendId);
  assert.equal(profileRow.career_goal, "Legacy free-text goal");
  assert.equal(profileRow.interests, "Data and AI");
  checks.push("career-only student profile PATCH saves immediately, preserves interests/free text, and rolls back unavailable selections");

  const customCareerBeforeDelete = await api("/careers", `/${customId}`);
  assert.equal(customCareerBeforeDelete.status, 200);
  result = await api("/careers", `/${customId}`, "DELETE", { confirmed: true }, { "x-version": customCareerBeforeDelete.body.version });
  assert.deepEqual(result, { status: 200, body: { deleted: true } });
  assert.equal((await api("/careers", `/${customId}`, "GET")).status, 404);
  assert.deepEqual(await api("/student-careers", `/${customId}`, "GET", undefined, { "x-role": "student" }), {
    status: 404,
    body: { error: "career_not_found" },
  });
  assert.equal((await api("/careers", `/requirements?careerPositionId=${customId}`)).body.items.length, 0);
  assert.equal((await api("/student-careers", "", "GET", undefined, { "x-role": "student" })).body.items.length, 20);
  checks.push("soft-deleted careers leave the catalog and remain absent from student choices");

  const frontendDetail = await api("/careers", `/${frontendId}`, "GET");
  assert.equal(frontendDetail.status, 200);
  result = await api("/careers", `/${frontendId}`, "DELETE", { confirmed: true }, { "x-version": frontendDetail.body.version });
  assert.deepEqual(result, { status: 200, body: { deleted: true } });
  assert.deepEqual(await api("/student-careers", `/${frontendId}`, "GET", undefined, { "x-role": "student" }), {
    status: 404,
    body: { error: "career_not_found" },
  });
  profileRow = (await pool.query("SELECT career_position_id,career_goal FROM student_profiles WHERE user_id=$1", [studentId])).rows[0];
  assert.equal(profileRow.career_position_id, frontendId);
  assert.equal(profileRow.career_goal, "Legacy free-text goal");
  result = await api("/student", "/profile", "PATCH", {
    className: "CNTT08",
    interests: "Data and AI",
    careerGoal: "Legacy free-text goal",
    careerPositionId: frontendId,
    currentSemester: 2,
  }, { "x-role": "student" });
  assert.equal(result.status, 200);
  result = await api("/student", "/profile", "PATCH", { careerPositionId: customId }, { "x-role": "student" });
  assert.deepEqual(result, { status: 409, body: { error: "career_unavailable" } });
  profileRow = (await pool.query("SELECT career_position_id,career_goal,interests FROM student_profiles WHERE user_id=$1", [studentId])).rows[0];
  assert.equal(profileRow.career_position_id, frontendId);
  assert.equal(profileRow.career_goal, "Legacy free-text goal");
  assert.equal(profileRow.interests, "Data and AI");
  result = await api("/student", "/profile", "PATCH", {
    className: "CNTT08",
    interests: "Data and AI",
    careerGoal: "Legacy free-text goal",
    careerPositionId: null,
    currentSemester: 2,
  }, { "x-role": "student" });
  assert.deepEqual(result, { status: 200, body: { saved: true } });
  profileRow = (await pool.query("SELECT career_position_id,career_goal FROM student_profiles WHERE user_id=$1", [studentId])).rows[0];
  assert.equal(profileRow.career_position_id, null);
  assert.equal(profileRow.career_goal, "Legacy free-text goal");
  checks.push("student may retain a previously selected deleted career, rejects a newly deleted one, and can clear it without losing free text");

  // Skill catalog CRUD, shared-name synchronization, and safe deletion on real PostgreSQL.
  result = await api("/careers", "/skills", "POST", { name: "Audit kỹ năng", description: "Kỹ năng quản lý riêng." });
  assert.equal(result.status, 201);
  let managedSkill = result.body;
  assert.equal(managedSkill.careerCount, 0);
  assert.equal((await api("/careers", "/skills?q=audit%20ky%20nang")).body.items[0].id, managedSkill.id);
  assert.equal((await api("/careers", "/skills", "POST", { name: "AUDIT KỸ NĂNG", description: "" })).body.error, "skill_exists");
  const skillCareer = (await api("/careers")).body.items[0];
  const linkedInput = { careerPositionId: skillCareer.id, title: managedSkill.name, description: "Keep link metadata", skillId: managedSkill.id, skillName: "", level: "advanced", isRequired: true };
  const managedLink = await api("/careers", "/requirements", "POST", linkedInput);
  assert.equal(managedLink.status, 201);
  assert.equal((await api("/careers", `/skills/${managedSkill.id}`, "DELETE", { confirmed: true }, { "x-version": managedSkill.version })).body.error, "skill_in_use");
  const oldVersion = managedSkill.version;
  result = await api("/careers", `/skills/${managedSkill.id}`, "PATCH", { name: "Audit kỹ năng mới", description: "Đã cập nhật" }, { "x-version": oldVersion });
  assert.equal(result.status, 200);
  managedSkill = result.body;
  assert.equal(managedSkill.careerCount, 1);
  assert.notEqual(managedSkill.version, oldVersion);
  assert.equal((await api("/careers", `/skills/${managedSkill.id}`, "PATCH", { name: "Stale", description: "" }, { "x-version": oldVersion })).body.error, "skill_changed");
  result = await api("/careers", `/requirements/${managedLink.body.id}`);
  assert.equal(result.body.skillName, managedSkill.name);
  assert.equal(result.body.title, managedSkill.name);
  assert.equal(result.body.level, "advanced");
  assert.equal(result.body.isRequired, true);
  assert.equal(result.body.description, "Keep link metadata");
  assert.notEqual(result.body.version, managedLink.body.version);
  const latestLink = result.body;
  assert((await api("/careers", `/${skillCareer.id}`)).body.skills.includes(managedSkill.name));
  assert((await api("/careers", "?q=" + encodeURIComponent(managedSkill.name))).body.items.some(c => c.id === skillCareer.id));
  assert((await api("/student-careers", `/${skillCareer.id}`, "GET", undefined, { "x-role": "student" })).body.requirements.some(r => r.skillName === managedSkill.name));
  assert((await api("/careers", "/requirements/skills")).body.items.some(s => s.id === managedSkill.id && s.name === managedSkill.name));
  result = await api("/careers", `/requirements/${latestLink.id}`, "PATCH", { ...linkedInput, title: "Custom requirement title" }, { "x-version": latestLink.version });
  assert.equal(result.status, 200);
  result = await api("/careers", `/skills/${managedSkill.id}`, "PATCH", { name: "Audit renamed again", description: "" }, { "x-version": managedSkill.version });
  assert.equal(result.status, 200);
  managedSkill = result.body;
  const customLink = (await api("/careers", `/requirements/${latestLink.id}`)).body;
  assert.equal(customLink.title, "Custom requirement title", "rename preserves custom requirement titles");
  assert.equal(customLink.skillName, managedSkill.name);
  assert.equal((await api("/careers", `/requirements/${customLink.id}`, "DELETE", { confirmed: true }, { "x-version": customLink.version })).status, 200);
  assert.equal((await api("/careers", `/skills/${managedSkill.id}`, "DELETE", { confirmed: true }, { "x-version": managedSkill.version })).status, 200);
  assert(!(await api("/careers", "/requirements/skills")).body.items.some(s => s.id === managedSkill.id));
  assert(!(await api("/careers", "/skills")).body.items.some(s => s.id === managedSkill.id));
  assert((await pool.query("SELECT deleted_at FROM career_skills WHERE id=$1", [managedSkill.id])).rows[0].deleted_at);
  assert.equal((await api("/careers", "/requirements", "POST", linkedInput)).body.error, "skill_not_found");
  assert.equal((await api("/careers", "/skills", "POST", { name: managedSkill.name, description: "New active skill" })).status, 201);
  checks.push("skill catalog CRUD preserves existing seeds, rejects duplicates and stale writes, synchronizes names/search/cache/student requirements, preserves custom titles and levels, blocks occupied deletion and retains history");

  const raceSkill = (await api("/careers", "/skills", "POST", { name: "Audit concurrent skill", description: "" })).body;
  const raceInput = { ...linkedInput, skillId: raceSkill.id, title: "Concurrent link" };
  const [raceLink, raceDelete] = await Promise.all([
    api("/careers", "/requirements", "POST", raceInput),
    api("/careers", `/skills/${raceSkill.id}`, "DELETE", { confirmed: true }, { "x-version": raceSkill.version }),
  ]);
  assert((raceLink.status === 201 && raceDelete.status === 409) || (raceLink.status === 404 && raceDelete.status === 200), "concurrent delete/link must never leave an active link to a deleted skill");
  const renameSkill = (await api("/careers", "/skills", "POST", { name: "Audit concurrent rename", description: "" })).body;
  const [raceRename, renameLink] = await Promise.all([
    api("/careers", `/skills/${renameSkill.id}`, "PATCH", { name: "Audit concurrent renamed", description: "" }, { "x-version": renameSkill.version }),
    api("/careers", "/requirements", "POST", { ...linkedInput, skillId: renameSkill.id, title: "Concurrent rename link" }),
  ]);
  assert.equal(raceRename.status, 200);
  assert.equal(renameLink.status, 201);
  assert((await api("/careers", `/${skillCareer.id}`)).body.skills.includes("Audit concurrent renamed"));
  assert(!(await api("/careers", `/${skillCareer.id}`)).body.skills.includes("Audit concurrent rename"));
  checks.push("concurrent skill deletion/linking and renaming/linking preserve references and career cache consistency");

  const largestFieldNumber = Number((await pool.query("SELECT max(code::bigint) AS n FROM career_fields")).rows[0].n);
  const parallelFields = await Promise.all(["A", "B", "C"].map(suffix => api("/careers", "/fields", "POST", {
    name: `Concurrent numbered field ${suffix}`, description: "",
  })));
  assert(parallelFields.every(result => result.status === 201));
  const parallelNumbers = parallelFields.map(result => Number(result.body.code));
  assert.equal(new Set(parallelNumbers).size, 3);
  assert(parallelNumbers.every(number => number > largestFieldNumber));
  const removedField = parallelFields[0].body;
  assert.equal((await api("/careers", `/fields/${removedField.id}`, "DELETE", { confirmed: true }, { "x-version": removedField.version })).status, 200);
  const legacyCreatedField = await api("/careers", "/fields", "POST", { name: "Legacy numbered field", description: "", code: "manual_legacy_code" });
  assert.equal(legacyCreatedField.status, 201);
  assert(Number(legacyCreatedField.body.code) > Math.max(...parallelNumbers));
  const rawLegacyField = (await pool.query("INSERT INTO career_fields(code,name) VALUES('supplied_code','Old backend field') RETURNING id,code")).rows[0];
  assert(Number(rawLegacyField.code) > Number(legacyCreatedField.body.code));
  assert.equal((await pool.query("UPDATE career_fields SET code='999999' WHERE id=$1 RETURNING code", [rawLegacyField.id])).rows[0].code, rawLegacyField.code);
  checks.push("database assigns distinct increasing field numbers under concurrent creation, never reuses deleted numbers, ignores legacy input codes and keeps assigned numbers immutable");

  const largestPositionNumber = Number((await pool.query("SELECT max(substr(code,3)::bigint) AS n FROM career_positions")).rows[0].n);
  const parallelCareers = await Promise.all(["A", "B", "C"].map(suffix => api("/careers", "", "POST", {
    nameVi: `Concurrent career ${suffix}`, nameEn: `Concurrent career ${suffix}`, category: productCode, description: "",
  })));
  assert(parallelCareers.every(result => result.status === 201));
  const parallelCodes = parallelCareers.map(result => Number(result.body.code.slice(2)));
  assert.equal(new Set(parallelCodes).size, 3);
  assert(parallelCodes.every(number => number > largestPositionNumber));
  const removedCareer = parallelCareers[0].body;
  assert.equal((await api("/careers", `/${removedCareer.id}`, "DELETE", { confirmed: true }, { "x-version": removedCareer.version })).status, 200);
  const rawCareer = (await pool.query("INSERT INTO career_positions(code,name_vi,name_en,category,search_text) VALUES('NN001','Old backend career','Old backend career',$1,'old backend career') RETURNING id,code", [productCode])).rows[0];
  assert(Number(rawCareer.code.slice(2)) > Math.max(...parallelCodes));
  assert.equal((await pool.query("UPDATE career_positions SET code='NN999999' WHERE id=$1 RETURNING code", [rawCareer.id])).rows[0].code, rawCareer.code);
  assert((await api("/careers", "?q=" + rawCareer.code)).body.items.some(item => item.id === rawCareer.id));
  await pool.query(`SELECT setval('${schema}.career_position_code_seq'::regclass,999,true)`);
  const thousandthCareer = await api("/careers", "", "POST", { nameVi: "Thousandth career", nameEn: "Thousandth career", category: productCode, description: "" });
  assert.equal(thousandthCareer.status, 201);
  assert.equal(thousandthCareer.body.code, "NN1000");
  checks.push("position codes are generated without input, distinct under concurrent creation, immutable, never reused after deletion, searchable and retain all digits beyond NN999");

  // Filter all results before client pagination, using active skill links rather than plain requirements.
  const filterCareerId = thousandthCareer.body.id;
  const filterQuery = `?q=Thousandth&category=${productCode}&skillLink=`;
  const filterIds = async status => (await api("/careers", filterQuery + status)).body.items.map(item => item.id);
  assert.deepEqual(await filterIds("unlinked"), [filterCareerId]);
  assert.deepEqual(await filterIds("linked"), []);
  assert.deepEqual(await filterIds(""), [filterCareerId]);
  assert.equal((await api("/careers", "?skillLink=unknown")).status, 400);
  const plainFilterRequirement = await api("/careers", "/requirements", "POST", {
    careerPositionId: filterCareerId, title: "Portfolio requirement", description: "", skillId: null,
    skillName: "", level: "unspecified", isRequired: false,
  });
  assert.equal(plainFilterRequirement.status, 201);
  assert.deepEqual(await filterIds("unlinked"), [filterCareerId]);
  const filterLink = await api("/careers", "/requirements", "POST", {
    careerPositionId: filterCareerId, title: "Filter audit skill", description: "", skillId: null,
    skillName: "Filter audit skill", level: "basic", isRequired: false,
  });
  assert.equal(filterLink.status, 201);
  assert.deepEqual(await filterIds("linked"), [filterCareerId]);
  assert.deepEqual(await filterIds("unlinked"), []);
  assert.deepEqual((await api("/careers", `?q=Thousandth&category=${infrastructureCode}&skillLink=linked`)).body.items, []);
  const allActiveCareers = (await api("/careers")).body.items;
  const linkedCareers = (await api("/careers", "?skillLink=linked")).body.items;
  const unlinkedCareers = (await api("/careers", "?skillLink=unlinked")).body.items;
  assert.deepEqual([...linkedCareers, ...unlinkedCareers].map(item => item.id).sort(), allActiveCareers.map(item => item.id).sort());
  assert(linkedCareers.every(item => item.skills.length > 0));
  assert(unlinkedCareers.every(item => item.skills.length === 0));
  assert(!linkedCareers.some(item => item.id === removedCareer.id));
  assert(!unlinkedCareers.some(item => item.id === removedCareer.id));
  assert.equal((await api("/careers", `/requirements/${filterLink.body.id}`, "DELETE", { confirmed: true }, { "x-version": filterLink.body.version })).status, 200);
  assert.deepEqual(await filterIds("linked"), []);
  assert.deepEqual(await filterIds("unlinked"), [filterCareerId]);
  checks.push("skill-link filter combines search/category before pagination, partitions all active careers, ignores plain/deleted requirements and reflects link creation/removal immediately");

  const publicAfter = await publicSnapshot();
  assert.deepEqual(publicAfter, publicBefore);
  checks.push("all career/profile writes stay inside the disposable schema");
  console.log(JSON.stringify({ passed: true, schema, checks }, null, 2));
  if (process.argv.includes("--ui")) {
    console.log(`Career UI fixture: ${origin}/quantri/vi-tri-nghe-nghiep`);
    await new Promise((done) => {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    });
  }
} finally {
  if (server) await new Promise((done) => server.close(done));
  await pool.end();
  if (schemaCreated) await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.end();
}
