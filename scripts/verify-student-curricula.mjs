// Integration checks use a disposable schema on the configured LOCAL database only.
// They exercise the student read API alongside the real admin routes and seeded workbooks.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
import dotenv from "dotenv";
import express from "express";
import { createCurriculaRouter } from "../apps/api/dist/curricula/router.js";
import { createStudentCurriculaRouter } from "../apps/api/dist/curricula/student-router.js";
import { seedCurricula } from "../apps/api/dist/curricula/seed.js";

const env = dotenv.parse(await readFile("apps/api/.env", "utf8"));
assert(env.DATABASE_URL, "apps/api/.env must define DATABASE_URL for integration checks");
const databaseUrl = new URL(env.DATABASE_URL);
assert(
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname),
  "Integration checks require a local database",
);

const schema = "student_curricula_audit_" + randomBytes(6).toString("hex");
assert(/^student_curricula_audit_[0-9a-f]{12}$/.test(schema));
const admin = new pg.Pool({ connectionString: env.DATABASE_URL });
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const checks = [];
const auditOrigin = "http://student-curricula.audit";
let schemaCreated = false;
let server;

const adminId = randomUUID();
const studentId = randomUUID();
const tenantId = randomUUID();
const adminUser = {
  userId: adminId,
  tenantId,
  objectId: randomUUID(),
  identityKey: `${tenantId}:${adminId}`,
  name: "Curriculum verifier",
  email: "admin@example.test",
  username: "admin@example.test",
  role: "admin",
  signedInAt: new Date(0).toISOString(),
};
const studentUser = {
  userId: studentId,
  tenantId,
  objectId: randomUUID(),
  identityKey: `${tenantId}:${studentId}`,
  name: "Student verifier",
  email: "student@example.test",
  username: "student@example.test",
  role: "student",
  signedInAt: new Date(0).toISOString(),
};

try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  await pool.query(
    "CREATE TABLE users(id UUID PRIMARY KEY,entra_tenant_id TEXT,is_active BOOLEAN,role TEXT,role_override TEXT)",
  );
  await pool.query("CREATE TABLE student_profiles(user_id UUID PRIMARY KEY,cohort_code TEXT)");
  await pool.query(
    (await readFile("apps/api/migrations/011_curricula.sql", "utf8")).replaceAll(
      "public.",
      `${schema}.`,
    ),
  );
  await pool.query(
    "INSERT INTO users(id,entra_tenant_id,is_active,role,role_override) VALUES($1,$2,true,'admin',null),($3,$2,true,'student',null)",
    [adminId, tenantId, studentId],
  );
  await pool.query("INSERT INTO student_profiles(user_id,cohort_code) VALUES($1,'K29')", [studentId]);
  await seedCurricula(pool);
  await seedCurricula(pool);

  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use((req, _res, next) => {
    const actor = req.get("x-test-user") === "admin" ? adminUser :
      req.get("x-test-user") === "none" ? undefined : studentUser;
    req.session = { user: actor };
    next();
  });
  app.use("/api/admin/curricula", createCurriculaRouter(pool, auditOrigin));
  app.use("/api/student/curricula", createStudentCurriculaRouter(pool));
  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: "integration_error", detail: error instanceof Error ? error.message : "unknown" });
  });

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolveServer) => server.once("listening", resolveServer));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (prefix, path = "", method = "GET", body, headers = {}) => {
    const response = await fetch(`${origin}${prefix}${path}`, {
      method,
      headers: {
        Origin: auditOrigin,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const contentType = response.headers.get("content-type") ?? "";
    return {
      status: response.status,
      headers: response.headers,
      body: contentType.includes("json") ? await response.json() : await response.text(),
    };
  };
  const studentApi = (path = "", method = "GET", body, headers = {}) =>
    call("/api/student/curricula", path, method, body, headers);
  const adminApi = (path = "", method = "GET", body, headers = {}) =>
    call("/api/admin/curricula", path, method, body, { "x-test-user": "admin", ...headers });

  let result = await studentApi();
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 3);
  assert.deepEqual(
    result.body.items.map((item) => [item.cohortCode, item.courseCount]),
    [["K31", 89], ["K30", 89], ["K29", 88]],
  );
  assert.equal(result.body.profileCohort, "K29");
  const k29 = result.body.items.find((item) => item.cohortCode === "K29");
  const k30 = result.body.items.find((item) => item.cohortCode === "K30");
  assert(k29?.id && k30?.id, "seeded K29 and K30 frameworks must be listed");
  assert.equal(result.body.suggestedId, k29.id);
  checks.push("seeded active K29/K30/K31 list with K29 cohort suggestion");

  result = await studentApi(`/${k29.id}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.cohortCode, "K29");
  assert.equal(result.body.courses.length, 88);
  assert.equal("history" in result.body, false);
  assert.equal("events" in result.body, false);
  assert.equal("token" in result.body, false);
  assert.equal("sourceFilename" in result.body, false);
  assert.equal("sourceCells" in result.body.courses[0], false);
  checks.push("student detail projection excludes administrative history, token and source data");

  const adminDetail = await adminApi(`/${k29.id}`);
  assert.equal(adminDetail.status, 200);
  const originalCourse = adminDetail.body.data.courses[0];
  const {
    position: _position,
    sourceRow: _sourceRow,
    sourceSheet: _sourceSheet,
    sourceCells: _sourceCells,
    groupId: _groupId,
    ...editableCourse
  } = originalCourse;
  const description = "Description published by the faculty board";
  editableCourse.description = description;
  result = await adminApi(
    `/${k29.id}/courses/${encodeURIComponent(originalCourse.code)}`,
    "PATCH",
    editableCourse,
    { "x-version": adminDetail.body.token },
  );
  assert.equal(result.status, 200);
  const studentAfterEdit = await studentApi(`/${k29.id}`);
  assert.equal(studentAfterEdit.status, 200);
  assert.equal(
    studentAfterEdit.body.courses.find((course) => course.code === originalCourse.code).description,
    description,
  );
  checks.push("admin course description update is immediately visible to student detail");

  const lockToken = result.body.token;
  result = await adminApi(`/${k29.id}/status`, "PATCH", { isActive: false }, { "x-version": lockToken });
  assert.equal(result.status, 200);
  result = await studentApi();
  assert.equal(result.status, 200);
  assert.equal(result.body.items.some((item) => item.id === k29.id), false);
  assert.equal(result.body.suggestedId, null);
  result = await studentApi(`/${k29.id}`);
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "curriculum_unavailable");
  checks.push("locking K29 immediately removes it from the student list and detail");

  result = await studentApi("", "POST", {});
  assert.equal(result.status, 405);
  assert.equal(result.body.error, "read_only");
  result = await studentApi(`/${k30.id}`, "PATCH", { notes: "must be rejected" });
  assert.equal(result.status, 405);
  assert.equal(result.body.error, "read_only");
  checks.push("student curriculum API has no write access");

  // A profile cohort with no open framework has no fallback suggestion.
  await pool.query("UPDATE student_profiles SET cohort_code='K32' WHERE user_id=$1", [studentId]);
  result = await studentApi();
  assert.equal(result.status, 200);
  assert.equal(result.body.profileCohort, "K32");
  assert.equal(result.body.suggestedId, null);
  checks.push("unmatched profile cohort does not silently suggest another framework");

  result = await studentApi("?revision=" + k30.id);
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "invalid_curriculum_query");
  result = await studentApi(`/${k30.id}?revision=${k30.id}`);
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "invalid_curriculum_query");
  checks.push("historical revision query parameters are rejected");

  result = await studentApi("", "GET", undefined, { "x-test-user": "none" });
  assert.equal(result.status, 401);
  await pool.query("UPDATE users SET is_active=false WHERE id=$1", [studentId]);
  result = await studentApi("", "GET", undefined, { "x-test-user": "student" });
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "account_unavailable");
  checks.push("unauthenticated and blocked student sessions are rejected");

  if (process.argv.includes("--ui")) {
    // The API checks above intentionally leave K29 locked and the student blocked;
    // restore only this disposable schema before opening the browser preview.
    await pool.query("UPDATE curricula SET is_active=true");
    await pool.query("UPDATE users SET is_active=true WHERE id=$1", [studentId]);
    await pool.query("UPDATE student_profiles SET cohort_code='K30' WHERE user_id=$1", [studentId]);
    const uiUser = { ...studentUser, name: "UI student verifier" };
    app.get("/api/auth/me", (_req, res) => res.json({ authenticated: true, user: uiUser }));
    app.get("/api/student/profile", (_req, res) => res.json({ student: {
      name: uiUser.name,
      studentCode: "UI0001",
      cohortCode: "K30",
      className: "71IT01",
      cohortYear: 2024,
      currentSemester: 1,
      email: uiUser.email,
      careerGoal: "Software engineering",
      interests: "Web development",
      profileStatus: "complete",
    } }));
    app.get("/api/student/transcript", (_req, res) => res.json({ transcript: null, job: null, workerOnline: false, ocrEnabled: false }));
    app.use(express.static(resolve("apps/web/dist")));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(resolve("apps/web/dist/index.html")));
    await mkdir("output/playwright", { recursive: true });
    await writeFile("output/playwright/student-curriculum-url.txt", `${origin}/dashboard#curriculum`);
    console.log(`Isolated student UI preview: ${origin}/dashboard#curriculum`);
    await new Promise((done) => {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    });
  }

  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  if (server) await new Promise((done) => server.close(done));
  await pool.end();
  if (schemaCreated) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
