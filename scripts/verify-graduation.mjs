// Integration checks use a disposable schema on the configured LOCAL database only.
// The source workbooks are read-only audit copies; this script never writes them.
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
import dotenv from "dotenv";
import express from "express";
import { createGraduationRouter } from "../apps/api/dist/graduation/router.js";

const env = dotenv.parse(await readFile("apps/api/.env", "utf8"));
assert(env.DATABASE_URL, "apps/api/.env must define DATABASE_URL for integration checks");
const configuredUrl = new URL(env.DATABASE_URL);
assert(
  ["localhost", "127.0.0.1"].includes(configuredUrl.hostname),
  "Integration checks require a local database",
);

const schema = "graduation_audit_" + randomBytes(6).toString("hex");
assert(/^graduation_audit_[0-9a-f]{12}$/.test(schema));
const admin = new pg.Pool({ connectionString: env.DATABASE_URL });
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const checks = [];
const auditOrigin = "http://graduation.audit";
const tenantId = randomUUID();
const userId = randomUUID();
let server;
let schemaCreated = false;

const sourceDirectory = resolve("output/graduation-audit/files");
const sourceFiles = await readdir(sourceDirectory);
const sourceName = sourceFiles.find((name) => name.startsWith("3_") && /\.xlsx$/i.test(name));
assert(sourceName, "graduation audit output must contain the K28 source workbook");
const sourceFile = await readFile(resolve(sourceDirectory, sourceName));

async function publicSnapshot() {
  const exists = await admin.query(
    "SELECT to_regclass('public.graduation_standards') IS NOT NULL AS present",
  );
  if (!exists.rows[0].present) return null;
  return (await admin.query("SELECT count(*)::int AS n FROM public.graduation_standards")).rows[0].n;
}

function actor(role = "admin") {
  return {
    userId,
    identityKey: "graduation-audit",
    tenantId,
    objectId: "graduation-audit-object",
    name: "Graduation integration admin",
    email: "graduation-audit@example.test",
    username: "graduation-audit@example.test",
    role,
    signedInAt: new Date().toISOString(),
  };
}

try {
  const publicBefore = await publicSnapshot();
  await admin.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  await pool.query(
    "CREATE TABLE users(id UUID PRIMARY KEY,entra_tenant_id TEXT,is_active BOOLEAN,role TEXT,role_override TEXT)",
  );
  const migration = await readFile(
    "apps/api/migrations/013_graduation_standards.sql",
    "utf8",
  );
  await pool.query(migration.replaceAll("public.", `${schema}.`));
  await pool.query(
    "INSERT INTO users(id,entra_tenant_id,is_active,role,role_override) VALUES($1,$2,true,'admin',null)",
    [userId, tenantId],
  );

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    req.session = {
      user: req.get("x-no-user") ? null : actor(req.get("x-role") ?? "admin"),
    };
    next();
  });
  app.use("/graduation", createGraduationRouter(pool, auditOrigin));
  if (process.argv.includes("--ui")) {
    app.get(["/api/auth/me", "/api/admin/me"], (_req, res) =>
      res.json({ authenticated: true, user: actor() }),
    );
    app.use("/api/admin/graduation", createGraduationRouter(pool, auditOrigin));
    app.use(express.static(resolve("apps/web/dist")));
    app.get(/^\/quantri(?:\/.*)?$/, (_req, res) =>
      res.sendFile(resolve("apps/web/dist/index.html")),
    );
  }
  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "integration_error" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const api = async (path = "", method = "GET", body, headers = {}) => {
    const response = await fetch(origin + "/graduation" + path, {
      method,
      headers: {
        Origin: auditOrigin,
        ...(body !== undefined
          ? {
              "Content-Type": Buffer.isBuffer(body)
                ? "application/octet-stream"
                : "application/json",
            }
          : {}),
        ...headers,
      },
      ...(body !== undefined
        ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }
        : {}),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed, headers: response.headers };
  };

  const apiBytes = async (path, headers = {}) => {
    const response = await fetch(origin + "/graduation" + path, {
      headers: { Origin: auditOrigin, ...headers },
    });
    return {
      status: response.status,
      bytes: Buffer.from(await response.arrayBuffer()),
      headers: response.headers,
    };
  };

  assert.equal((await api("", "GET", undefined, { "x-no-user": "1" })).status, 401);
  assert.equal((await api("", "GET", undefined, { "x-role": "student" })).status, 403);
  assert.equal(
    (
      await api("/preview", "POST", sourceFile, {
        Origin: "http://other.local",
        "x-filename": encodeURIComponent(sourceName),
      })
    ).status,
    403,
  );
  checks.push("authentication, student-role, and write-origin enforcement");

  let result = await api("/preview", "POST", sourceFile, {
    "x-filename": encodeURIComponent(sourceName),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 1);
  assert.equal(result.body.items[0].data.cohortCode, "K28");
  assert.equal(result.body.items[0].data.courses.length, 88);
  assert.equal(result.body.items[0].existingId, null);
  assert.match(result.body.fingerprint, /^[0-9a-f]{64}$/);
  const fingerprint = result.body.fingerprint;
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM graduation_standards")).rows[0].n,
    0,
  );
  checks.push("read-only preview returns one K28 item and leaves the schema empty");

  assert.equal(
    (
      await api("/import", "POST", sourceFile, {
        "x-filename": encodeURIComponent(sourceName),
        "x-selection": "[0]",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api("/import", "POST", sourceFile, {
        "x-filename": encodeURIComponent(sourceName),
        "x-preview": fingerprint,
        "x-selection": "[0,0]",
      })
    ).body.error,
    "invalid_selection",
  );
  result = await api("/import", "POST", sourceFile, {
    "x-filename": encodeURIComponent(sourceName),
    "x-preview": fingerprint,
    "x-selection": "[0]",
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.ids.length, 1);
  const id = result.body.ids[0];
  checks.push("preview fingerprint is required; duplicate selection is rejected; import is atomic");

  result = await api("/preview", "POST", sourceFile, {
    "x-filename": encodeURIComponent(sourceName),
  });
  assert.equal(result.body.items[0].existingId, id);
  assert.equal(
    (
      await api("/import", "POST", sourceFile, {
        "x-filename": encodeURIComponent(sourceName),
        "x-preview": result.body.fingerprint,
        "x-selection": "[0]",
      })
    ).status,
    409,
  );
  checks.push("preview identifies an existing identity and duplicate import is rejected");

  assert.equal((await api("?cohort=K28")).body.items.length, 1);
  assert.equal((await api("?q=does-not-exist")).body.items.length, 0);
  assert.equal((await api("?active=bad")).status, 400);
  result = await api(`/${id}?revision=bad`);
  assert.equal(result.status, 400);
  result = await api(`/${id}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(result.body.data.courses.length, 88);
  assert.equal(result.body.history.length, 1);
  const originalToken = result.body.token;
  const originalRevision = result.body.revisionId;
  const originalSourceWorkbook = result.body.data.sourceWorkbook;
  const originalSourceSheet = result.body.data.sourceSheet;
  const originalSourceNotes = result.body.data.sourceNotes;
  const downloaded = await apiBytes(`/` + id + `/source/` + originalRevision);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.bytes, sourceFile);
  checks.push("list filters, strict query validation, detail/history, and source round-trip work");

  const changed = structuredClone(result.body.data);
  changed.notes = "Integration revision";
  changed.groups[0].minimumCredits = (changed.groups[0].minimumCredits ?? 0) + 1;
  changed.courses[0].credits = 1;
  result = await api(`/${id}`, "PATCH", changed, { "x-version": originalToken });
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 2);
  assert.equal(result.body.data.notes, "Integration revision");
  assert.equal(result.body.data.groups[0].minimumCredits, changed.groups[0].minimumCredits);
  assert.equal(result.body.data.courses[0].credits, 1);
  assert.equal(result.body.data.sourceWorkbook, originalSourceWorkbook);
  assert.equal(result.body.data.sourceSheet, originalSourceSheet);
  assert.deepEqual(result.body.data.sourceNotes, originalSourceNotes);
  assert.equal(result.body.history.length, 2);
  const currentToken = result.body.token;
  const currentRevision = result.body.revisionId;
  assert.equal(
    (await api(`/${id}`, "PATCH", changed, { "x-version": originalToken })).status,
    409,
  );
  const historical = await api(`/${id}?revision=${originalRevision}`);
  assert.equal(historical.status, 200);
  assert.equal(historical.body.version, 1);
  assert.notEqual(
    historical.body.data.groups[0].minimumCredits,
    result.body.data.groups[0].minimumCredits,
  );
  const editedSource = await apiBytes(`/${id}/source/${currentRevision}`);
  assert.deepEqual(editedSource.bytes, sourceFile);
  checks.push("group/course threshold edits create a revision, preserve source metadata/bytes, keep history readable, and reject stale writes");

  result = await api(`/${id}/replace`, "POST", sourceFile, {
    "x-filename": encodeURIComponent(sourceName),
    "x-preview": fingerprint,
    "x-sheet": "0",
    "x-version": currentToken,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 3);
  assert.equal(result.body.sourceFilename, sourceName);
  assert.equal(result.body.history.length, 3);
  const replacementToken = result.body.token;
  const replacementSource = await apiBytes(`/${id}/source/${result.body.revisionId}`);
  assert.deepEqual(replacementSource.bytes, sourceFile);
  checks.push("previewed workbook replacement creates a revision and stores the source bytes");

  result = await api(`/${id}/status`, "PATCH", { isActive: false }, { "x-version": replacementToken });
  assert.equal(result.status, 200);
  assert.equal(result.body.isActive, false);
  assert.equal((await api("?active=false")).body.items.length, 1);
  const lockedToken = result.body.token;
  assert.equal(
    (await api(`/${id}/status`, "PATCH", { isActive: true }, { "x-version": currentToken })).status,
    409,
  );
  result = await api(`/${id}/status`, "PATCH", { isActive: true }, { "x-version": lockedToken });
  assert.equal(result.status, 200);
  assert.equal(result.body.isActive, true);
  assert.equal(result.body.history.length, 3);
  checks.push("status changes use optimistic tokens and do not create duplicate data revisions");

  await pool.query("UPDATE users SET role='faculty_board' WHERE id=$1", [userId]);
  assert.equal((await api(`/${id}`, "GET", undefined, { "x-role": "faculty_board" })).status, 200);
  assert.equal(
    (
      await api(`/${id}/status`, "PATCH", { isActive: false }, {
        "x-role": "faculty_board",
        "x-version": result.body.token,
      })
    ).status,
    403,
  );
  await pool.query("UPDATE users SET role='student' WHERE id=$1", [userId]);
  assert.equal((await api(`/${id}`, "GET", undefined, { "x-role": "student" })).status, 403);
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [userId]);
  checks.push("faculty-board is read-only and student access is denied");

  const publicAfter = await publicSnapshot();
  assert.deepEqual(publicAfter, publicBefore);
  checks.push("all writes remain inside the disposable graduation schema");

  console.log(JSON.stringify({ passed: true, schema, checks }, null, 2));
  if (process.argv.includes("--ui")) {
    console.log(`Graduation UI fixture: ${origin}/quantri/tieu-chuan-tot-nghiep`);
    await new Promise((done) => {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    });
  }
} finally {
  if (server) await new Promise((done) => server.close(done));
  await pool.end();
  if (schemaCreated) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
