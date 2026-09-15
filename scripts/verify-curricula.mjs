// Integration checks use a disposable schema on the configured LOCAL database only.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
import dotenv from "dotenv";
import express from "express";
import { createCurriculaRouter } from "../apps/api/dist/curricula/router.js";
import { seedCurricula } from "../apps/api/dist/curricula/seed.js";
const env = dotenv.parse(await readFile("apps/api/.env", "utf8"));
assert(
  ["localhost", "127.0.0.1"].includes(new URL(env.DATABASE_URL).hostname),
  "Integration checks require a local database",
);
const schema = "curricula_audit_" + randomBytes(6).toString("hex");
const admin = new pg.Pool({ connectionString: env.DATABASE_URL });
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const checks = [];
let server;
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(
    "CREATE TABLE users(id UUID PRIMARY KEY,entra_tenant_id TEXT,is_active BOOLEAN,role TEXT,role_override TEXT)",
  );
  await pool.query(
    (
      await readFile("apps/api/migrations/011_curricula.sql", "utf8")
    ).replaceAll("public.", schema + "."),
  );
  const uid = randomUUID(),
    tenant = randomUUID();
  await pool.query("INSERT INTO users VALUES($1,$2,true,'admin',null)", [
    uid,
    tenant,
  ]);
  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use((req, _res, next) => {
    req.session = {
      user: req.get("x-no-user")
        ? null
        : { userId: uid, tenantId: tenant, role: req.get("x-role") ?? "admin" },
    };
    next();
  });
  app.use("/curricula", createCurriculaRouter(pool, "http://audit.local"));
  app.use((err, _req, res, _next) => {
    console.error(err.message);
    res.status(500).json({ error: "integration_error" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const api = async (path = "", method = "GET", body, headers = {}) => {
    const res = await fetch(origin + "/curricula" + path, {
      method,
      headers: {
        Origin: "http://audit.local",
        ...(body
          ? {
              "Content-Type": Buffer.isBuffer(body)
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "application/json",
            }
          : {}),
        ...headers,
      },
      ...(body
        ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }
        : {}),
    });
    return { status: res.status, body: await res.json() };
  };
  assert.equal(
    (await api("", "GET", undefined, { "x-no-user": "1" })).status,
    401,
  );
  assert.equal(
    (await api("", "GET", undefined, { "x-role": "student" })).status,
    403,
  );
  assert.equal(
    (
      await api("/preview", "POST", Buffer.from("bad"), {
        Origin: "http://other.local",
      })
    ).status,
    403,
  );
  checks.push("session, student-role and origin enforcement");
  const workbook = await readFile("apps/api/data/curricula/K29.xlsx");
  let result = await api("/preview", "POST", workbook);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.courses.length, 88);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM curricula")).rows[0].n,
    0,
  );
  assert.equal((await api("", "POST", workbook)).status, 422);
  result = await api("", "POST", workbook, {
    "x-confirm-warnings": "true",
    "x-filename": "any-name.xlsx",
  });
  assert.equal(result.status, 201);
  const id = result.body.id;
  let detail = result.body;
  assert.equal(detail.version, 1);
  assert.equal(detail.sourceFilename, "any-name.xlsx");
  assert.equal(
    (await api("", "POST", workbook, { "x-confirm-warnings": "true" })).status,
    409,
  );
  checks.push(
    "preview is read-only; acknowledged import is atomic; duplicate identity rejected",
  );
  await seedCurricula(pool);
  await seedCurricula(pool);
  result = await api();
  assert.equal(result.body.total, 3);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM curriculum_courses"))
      .rows[0].n,
    266,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM curriculum_revisions"))
      .rows[0].n,
    3,
  );
  checks.push(
    "idempotent K29/K30/K31 seed: 3 frameworks, 266 course placements",
  );
  assert.equal((await api("?q=K30")).body.total, 1);
  assert.equal((await api("?cohort=K31")).body.items[0].courseCount, 89);
  assert.equal((await api("?q=does-not-exist")).body.total, 0);
  assert.equal((await api("?page=0")).status, 400);
  checks.push("search, cohort filtering, empty results and query validation");
  for (const role of ["faculty_board", "department_head", "lecturer"]) {
    await pool.query("UPDATE users SET role=$2 WHERE id=$1", [uid, role]);
    assert.equal(
      (await api(`/${id}`, "GET", undefined, { "x-role": role })).status,
      200,
    );
    assert.equal(
      (
        await api(
          `/${id}/status`,
          "PATCH",
          { isActive: false },
          { "x-role": role, "x-version": detail.token },
        )
      ).status,
      403,
    );
    // A stale admin session is still rejected by the current database role.
    assert.equal((await api("/preview", "POST", workbook)).status, 403);
  }
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [uid]);
  checks.push("staff read-only roles and fresh database authorization");
  const change = {
    name: detail.data.name + " updated",
    totalCredits: 126,
    notes: "Integration revision",
  };
  result = await api(`/${id}`, "PATCH", change, { "x-version": detail.token });
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 2);
  const first = detail;
  detail = result.body;
  assert.equal(
    (await api(`/${id}?revision=${first.revisionId}`)).body.data.notes,
    "",
  );
  assert.equal(
    (await api(`/${id}`, "PATCH", change, { "x-version": first.token })).status,
    409,
  );
  const downloaded = await fetch(
    `${origin}/curricula/${id}/source/${first.revisionId}`,
  );
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), workbook);
  checks.push(
    "new revision, immutable historical data/source and stale-write protection",
  );
  const { position, sourceRow, sourceSheet, sourceCells, groupId, ...course } =
    detail.data.courses[0];
  assert.equal(
    (
      await api(
        `/${id}/courses/${course.code}`,
        "PATCH",
        { ...course, semester: 4 },
        { "x-version": detail.token },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api(
        `/${id}/courses/${course.code}`,
        "PATCH",
        { ...course, code: detail.data.courses[1].code },
        { "x-version": detail.token },
      )
    ).status,
    422,
  );
  assert.equal((await api(`/${id}`)).body.version, 2);
  result = await api(
    `/${id}/courses/${course.code}`,
    "PATCH",
    { ...course, semester: 3, prerequisite: detail.data.courses[1].code },
    { "x-version": detail.token },
  );
  assert.equal(result.status, 200);
  detail = result.body;
  assert.equal(detail.data.courses[0].semester, 3);
  assert(
    detail.data.relations.some(
      (r) => r.courseCode === course.code && r.kind === "prerequisite",
    ),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT semester FROM curriculum_courses WHERE revision_id=$1 AND code=$2",
        [detail.revisionId, course.code],
      )
    ).rows[0].semester,
    3,
  );
  checks.push(
    "course edits project into relational tables; invalid and duplicate edits roll back",
  );
  const other = await readFile("apps/api/data/curricula/K31.xlsx");
  assert.equal(
    (
      await api(`/${id}/import`, "PUT", other, {
        "x-version": detail.token,
        "x-confirm-warnings": "true",
      })
    ).status,
    422,
  );
  assert.equal((await api(`/${id}`)).body.version, 3);
  result = await api(`/${id}/import`, "PUT", workbook, {
    "x-version": detail.token,
    "x-confirm-warnings": "true",
  });
  assert.equal(result.status, 200);
  detail = result.body;
  assert.equal(detail.version, 4);
  assert.equal(detail.data.courses[0].semester, first.data.courses[0].semester);
  checks.push(
    "whole-workbook replacement retains old versions and rejects wrong cohort",
  );
  const parallel = await Promise.all(
    [false, true].map((isActive) =>
      api(
        `/${id}/status`,
        "PATCH",
        { isActive },
        { "x-version": detail.token },
      ),
    ),
  );
  assert.deepEqual(parallel.map((r) => r.status).sort(), [200, 409]);
  detail = (await api(`/${id}`)).body;
  result = await api(
    `/${id}/status`,
    "PATCH",
    { isActive: false },
    { "x-version": detail.token },
  );
  assert.equal(result.status, 200);
  detail = result.body;
  assert.equal((await api("?active=false")).body.total, 1);
  await seedCurricula(pool);
  assert.equal((await api(`/${id}`)).body.isActive, false);
  assert.equal((await api(`/${id}`)).body.version, 4);
  assert.equal(
    (
      await api(
        `/${id}/status`,
        "PATCH",
        { isActive: true },
        { "x-version": detail.token },
      )
    ).status,
    200,
  );
  assert.equal((await api("?active=true")).body.total, 3);
  checks.push(
    "concurrent-write conflict; lock/open filtering; seed preserves later edits and locks",
  );
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
  if (process.argv.includes("--ui")) {
    const user = {
      userId: uid,
      tenantId: tenant,
      role: "admin",
      name: "Quản trị viên kiểm tra",
      email: "admin@example.test",
      username: "admin@example.test",
    };
    app.get(["/api/auth/me", "/api/admin/me"], (_req, res) =>
      res.json({ authenticated: true, user }),
    );
    app.use("/api/admin/curricula", createCurriculaRouter(pool, origin));
    app.use(express.static(resolve("apps/web/dist")));
    app.get(/^\/quantri(?:\/.*)?$/, (_req, res) =>
      res.sendFile(resolve("apps/web/dist/index.html")),
    );
    await mkdir("output/playwright", { recursive: true });
    await writeFile(
      "output/playwright/curriculum-url.txt",
      origin + "/quantri/chuong-trinh",
    );
    console.log("Isolated UI preview: " + origin + "/quantri/chuong-trinh");
    await new Promise((done) => {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    });
  }
} finally {
  if (server) await new Promise((r) => server.close(r));
  await pool.end();
  assert(/^curricula_audit_[0-9a-f]{12}$/.test(schema));
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
