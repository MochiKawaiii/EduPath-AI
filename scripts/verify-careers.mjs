// Integration checks use a disposable schema on the configured LOCAL database only.
// They exercise migration 014 and the real compiled admin/student routers.
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import pg from "pg";
import dotenv from "dotenv";
import express from "express";
import { createCareersRouter } from "../apps/api/dist/careers/router.js";
import { createStudentDataRouter } from "../apps/api/dist/student/router.js";

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
  return {
    careers: careers.rows[0].present
      ? (await adminPool.query("SELECT count(*)::int AS n FROM public.career_positions")).rows[0].n
      : null,
    profiles: profiles.rows[0].present
      ? (await adminPool.query("SELECT count(*)::int AS n FROM public.student_profiles")).rows[0].n
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
      user_id UUID PRIMARY KEY REFERENCES users(id), student_code TEXT, cohort_year SMALLINT,
      class_name TEXT, current_semester SMALLINT, career_goal TEXT, interests TEXT,
      onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const migration = await readFile("apps/api/migrations/014_career_positions.sql", "utf8");
  await pool.query(migration.replaceAll("public.", `${schema}.`));
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

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    const role = req.get("x-role") ?? (req.path.startsWith("/api/student") ? "student" : "admin");
    req.session = {
      user: role === "student" ? studentActor : adminActor(role),
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
    app.get("/api/auth/me", (_req, res) =>
      res.json({ authenticated: true, user: studentActor, studentPortal: true }),
    );
    app.get("/api/admin/me", (_req, res) =>
      res.json({ authenticated: true, user: adminActor() }),
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
  const frontend = result.body.items.find((item) => item.code === "frontend");
  assert(frontend, "migration must seed the frontend position");
  checks.push("migration seeds exactly 20 bilingual IT career positions across six categories");

  result = await api("/careers", "?q=" + encodeURIComponent("Kỹ sư") + "&category=infrastructure");
  assert.equal(result.status, 200);
  assert(result.body.items.length >= 1);
  assert(result.body.items.every((item) => item.category === "infrastructure"));
  result = await api("/careers", "?q=" + encodeURIComponent("DATA ANALYST"));
  assert.equal(result.status, 200);
  assert(result.body.items.some((item) => item.code === "data-analyst"));
  assert.equal((await api("/careers", "?category=nope")).status, 400);
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
        category: "product",
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
    category: "product",
    description: "Temporary verifier position",
    skills: ["Testing", "SQL"],
  };
  result = await api("/careers", "", "POST", customInput);
  assert.equal(result.status, 201);
  const customId = result.body.id;
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
  assert.notEqual(updatedCustomVersion, customVersion);
  assert.equal(
    (await api("/careers", `/${customId}`, "PATCH", customInput, { "x-version": customVersion })).status,
    409,
  );
  checks.push("admin create/detail/update handles duplicate codes and stale optimistic versions");

  await pool.query("UPDATE users SET role='faculty_board' WHERE id=$1", [adminId]);
  assert.equal((await api("/careers", "", "GET", undefined, { "x-role": "faculty_board" })).status, 200);
  assert.equal(
    (await api("/careers", `/${customId}`, "PATCH", customInput, {
      "x-role": "faculty_board",
      "x-version": updatedCustomVersion,
    })).status,
    403,
  );
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [adminId]);
  checks.push("faculty-board can read the catalog but cannot mutate it");

  result = await api("/student-careers", "", "GET", undefined, { "x-role": "student" });
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 21);
  const frontendId = frontend.id;
  result = await api("/student", "/profile", "PATCH", {
    className: "CNTT08",
    interests: "Data and AI",
    careerGoal: "Legacy free-text goal",
    careerPositionId: frontendId,
    currentSemester: 2,
  }, { "x-role": "student" });
  assert.deepEqual(result, { status: 200, body: { saved: true } });
  let profileRow = (await pool.query("SELECT career_position_id,career_goal FROM student_profiles WHERE user_id=$1", [studentId])).rows[0];
  assert.equal(profileRow.career_position_id, frontendId);
  assert.equal(profileRow.career_goal, "Legacy free-text goal");
  checks.push("student can select an active career while retaining the previous free-text goal");

  result = await api("/careers", `/${customId}`, "DELETE", { confirmed: true }, { "x-version": updatedCustomVersion });
  assert.deepEqual(result, { status: 200, body: { deleted: true } });
  assert.equal((await api("/careers", `/${customId}`, "GET")).status, 404);
  assert.equal((await api("/student-careers", "", "GET", undefined, { "x-role": "student" })).body.items.length, 20);
  checks.push("soft-deleted careers leave the catalog and remain absent from student choices");

  const frontendDetail = await api("/careers", `/${frontendId}`, "GET");
  assert.equal(frontendDetail.status, 200);
  result = await api("/careers", `/${frontendId}`, "DELETE", { confirmed: true }, { "x-version": frontendDetail.body.version });
  assert.deepEqual(result, { status: 200, body: { deleted: true } });
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
  result = await api("/student", "/profile", "PATCH", {
    className: "CNTT08",
    interests: "Data and AI",
    careerGoal: "Legacy free-text goal",
    careerPositionId: customId,
    currentSemester: 2,
  }, { "x-role": "student" });
  assert.deepEqual(result, { status: 409, body: { error: "career_unavailable" } });
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
