// Integration checks use a disposable schema on the configured LOCAL database only.
// They exercise the real training-plan parser, repository, admin routes, and seed.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
import dotenv from "dotenv";
import express from "express";
import { createCurriculaRouter } from "../apps/api/dist/curricula/router.js";
import { createPlansRouter } from "../apps/api/dist/plans/router.js";
import { seedCurricula } from "../apps/api/dist/curricula/seed.js";
import { seedPlans } from "../apps/api/dist/plans/seed.js";

const env = dotenv.parse(await readFile("apps/api/.env", "utf8"));
assert(env.DATABASE_URL, "apps/api/.env must define DATABASE_URL for integration checks");
const configuredUrl = new URL(env.DATABASE_URL);
assert(
  ["localhost", "127.0.0.1"].includes(configuredUrl.hostname),
  "Integration checks require a local database",
);

const schema = "plans_audit_" + randomBytes(6).toString("hex");
assert(/^plans_audit_[0-9a-f]{12}$/.test(schema));
const admin = new pg.Pool({ connectionString: env.DATABASE_URL });
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const checks = [];
const auditOrigin = "http://plans.audit";
let server;
let schemaCreated = false;

const users = {
  admin: {
    userId: randomUUID(),
    role: "admin",
    name: "Plans admin",
  },
  faculty: {
    userId: randomUUID(),
    role: "faculty_board",
    name: "Faculty board",
  },
  department: {
    userId: randomUUID(),
    role: "department_head",
    name: "Department head",
  },
  lecturer: {
    userId: randomUUID(),
    role: "lecturer",
    name: "Lecturer",
  },
  student: {
    userId: randomUUID(),
    role: "student",
    name: "Student",
  },
};
const tenantId = randomUUID();
const actor = (key) => {
  const user = users[key];
  if (!user) return undefined;
  return {
    userId: user.userId,
    identityKey: `${tenantId}:${user.userId}`,
    tenantId,
    objectId: randomUUID(),
    name: user.name,
    email: `${key}@example.test`,
    username: `${key}@example.test`,
    role: user.role,
    signedInAt: new Date(0).toISOString(),
  };
};

const planTables = [
  "training_plans",
  "training_plan_revisions",
  "training_plan_items",
  "training_plan_events",
];
async function snapshotPublicPlans() {
  const snapshot = {};
  for (const table of planTables) {
    const exists = await admin.query("SELECT to_regclass($1)::text AS name", [
      `public.${table}`,
    ]);
    if (exists.rows[0]?.name)
      snapshot[table] = (
        await admin.query(`SELECT count(*)::int AS n FROM public.${table}`)
      ).rows[0].n;
  }
  return snapshot;
}

try {
  const publicBefore = await snapshotPublicPlans();
  await admin.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  await pool.query(
    "CREATE TABLE users(id UUID PRIMARY KEY,entra_tenant_id TEXT,is_active BOOLEAN,role TEXT,role_override TEXT)",
  );
  for (const migration of ["011_curricula.sql", "012_training_plans.sql"])
    await pool.query(
      (await readFile(`apps/api/migrations/${migration}`, "utf8")).replaceAll(
        "public.",
        `${schema}.`,
      ),
    );
  for (const user of Object.values(users))
    await pool.query(
      "INSERT INTO users(id,entra_tenant_id,is_active,role,role_override) VALUES($1,$2,true,$3,null)",
      [user.userId, tenantId, user.role],
    );

  await seedCurricula(pool);

  const k29 = await readFile("apps/api/data/plans/K29.xlsx");
  const k30 = await readFile("apps/api/data/plans/K30.xlsx");
  const k31 = await readFile("apps/api/data/plans/K31.xlsx");

  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use((req, _res, next) => {
    req.session = { user: actor(req.get("x-user") ?? "admin") };
    next();
  });
  app.use("/curricula", createCurriculaRouter(pool, auditOrigin));
  const plansRouter = createPlansRouter(pool, auditOrigin);
  app.use("/plans", plansRouter);
  app.use((error, _req, res, _next) => {
    console.error(error instanceof Error ? error.message : error);
    res.status(500).json({ error: "integration_error" });
  });

  server = app.listen(0, "127.0.0.1");
  await new Promise((ready) => server.once("listening", ready));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (prefix, path = "", method = "GET", body, headers = {}) => {
    const binary = Buffer.isBuffer(body);
    const response = await fetch(`${origin}${prefix}${path}`, {
      method,
      headers: {
        Origin: auditOrigin,
        ...(body === undefined
          ? {}
          : {
              "Content-Type": binary
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "application/json",
            }),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: binary ? body : JSON.stringify(body) }),
    });
    const contentType = response.headers.get("content-type") ?? "";
    return {
      status: response.status,
      headers: response.headers,
      body: contentType.includes("json")
        ? await response.json()
        : Buffer.from(await response.arrayBuffer()),
    };
  };
  const planApi = (path = "", method = "GET", body, headers = {}) =>
    call("/plans", path, method, body, headers);
  const curriculumApi = (path = "", method = "GET", body, headers = {}) =>
    call("/curricula", path, method, body, headers);

  assert.equal(
    (await planApi("", "GET", undefined, { "x-user": "student" })).status,
    403,
  );
  assert.equal(
    (await planApi("", "GET", undefined, { "x-user": "missing" })).status,
    401,
  );
  assert.equal(
    (
      await planApi("/preview", "POST", Buffer.from("bad"), {
        Origin: "http://other.local",
      })
    ).status,
    403,
  );
  checks.push("admin, student, unauthenticated, and same-origin enforcement");

  let result = await planApi("/preview", "POST", k29);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.cohortCode, "K29");
  assert.equal(result.body.data.items.length, 73);
  assert.match(result.body.previewHash, /^[0-9a-f]{64}$/);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM training_plans")).rows[0].n,
    0,
  );
  const k29PreviewHash = result.body.previewHash;
  assert.equal(
    (
      await planApi("", "POST", k29, {
        "x-preview-hash": "0".repeat(64),
        "x-confirm-warnings": "true",
      })
    ).body.error,
    "preview_changed",
  );
  result = await planApi("", "POST", k29, {
    "x-preview-hash": k29PreviewHash,
  });
  assert.equal(result.status, 422);
  assert.equal(result.body.error, "review_warnings");
  result = await planApi("", "POST", k29, {
    "x-preview-hash": k29PreviewHash,
    "x-confirm-warnings": "true",
    "x-filename": "k29-import.xlsx",
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.version, 1);
  assert.equal(result.body.sourceFilename, "k29-import.xlsx");
  const k29Id = result.body.id;
  let k29Detail = result.body;
  assert.equal(
    (
      await planApi("", "POST", k29, {
        "x-preview-hash": k29PreviewHash,
        "x-confirm-warnings": "true",
      })
    ).body.error,
    "plan_exists",
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM training_plans")).rows[0].n,
    1,
  );
  checks.push("preview hash confirmation, warning acknowledgement, atomic import, and duplicate identity rejection");

  await seedPlans(pool);
  await seedPlans(pool);
  let list = await planApi();
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 3);
  assert.deepEqual(
    list.body.items.map((item) => [item.cohortCode, item.itemCount]),
    [
      ["K31", 74],
      ["K30", 70],
      ["K29", 73],
    ],
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM training_plan_revisions")).rows[0].n,
    3,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM training_plan_items")).rows[0].n,
    217,
  );
  assert.equal((await planApi("?q=K30")).body.total, 1);
  assert.equal((await planApi("?cohort=K31")).body.items[0].itemCount, 74);
  assert.equal((await planApi("?q=does-not-exist")).body.total, 0);
  assert.equal((await planApi("?page=0")).status, 400);
  checks.push("idempotent K29/K30/K31 plan seed with 217 relational allocations and filters");

  for (const key of ["faculty", "department", "lecturer"]) {
    assert.equal(
      (await planApi(`/${k29Id}`, "GET", undefined, { "x-user": key })).status,
      200,
    );
    const readOnlyWrite = await planApi(
      `/${k29Id}`,
      "PATCH",
      { name: k29Detail.data.name, totalCredits: 126, notes: "blocked" },
      { "x-user": key, "x-version": k29Detail.token },
    );
    assert.equal(readOnlyWrite.status, 403);
    assert.equal(readOnlyWrite.body.error, "insufficient_role");
  }
  assert.equal(
    (await planApi("", "GET", undefined, { "x-user": "student" })).status,
    403,
  );
  await pool.query("UPDATE users SET is_active=false WHERE id=$1", [users.admin.userId]);
  result = await planApi("", "GET");
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "insufficient_role");
  await pool.query("UPDATE users SET is_active=true WHERE id=$1", [users.admin.userId]);
  checks.push("staff roles remain read-only, student access is denied, and inactive users are rechecked");

  const firstRevision = k29Detail.revisionId;
  const firstToken = k29Detail.token;
  result = await planApi(
    `/${k29Id}`,
    "PATCH",
    {
      name: `${k29Detail.data.name} updated`,
      totalCredits: 126,
      notes: "Metadata revision",
    },
    { "x-version": firstToken },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 2);
  assert.equal(result.body.data.notes, "Metadata revision");
  k29Detail = result.body;
  assert.equal(
    (
      await planApi(
        `/${k29Id}`,
        "PATCH",
        {
          name: `${k29Detail.data.name} stale`,
          totalCredits: 126,
          notes: "stale",
        },
        { "x-version": firstToken },
      )
    ).body.error,
    "plan_changed",
  );
  const historical = await planApi(`/${k29Id}?revision=${firstRevision}`);
  assert.equal(historical.status, 200);
  assert.equal(historical.body.data.notes, "");
  assert.equal(historical.body.version, 1);

  const originalItem = k29Detail.data.items[0];
  const {
    id: _itemId,
    position: _position,
    sourceRow: _sourceRow,
    sourceSheet: _sourceSheet,
    sourceCells: _sourceCells,
    ...editableItem
  } = originalItem;
  result = await planApi(
    `/${k29Id}/items/${originalItem.id}`,
    "PATCH",
    { ...editableItem, notes: "Edited allocation" },
    { "x-version": k29Detail.token },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 3);
  assert.equal(result.body.data.items[0].notes, "Edited allocation");
  k29Detail = result.body;
  const itemRow = await pool.query(
    "SELECT name,data->>'notes' AS notes FROM training_plan_items WHERE revision_id=$1 AND item_id=$2",
    [k29Detail.revisionId, originalItem.id],
  );
  assert.equal(itemRow.rows[0].name, originalItem.name);
  assert.equal(itemRow.rows[0].notes, "Edited allocation");
  checks.push("metadata revision, immutable historical snapshot, item revision projection, and stale token handling");

  const k29ImportPreview = await planApi("/preview", "POST", k29);
  assert.equal(k29ImportPreview.status, 200);
  assert.equal(k29ImportPreview.body.data.items.length, 73);
  result = await planApi(`/${k29Id}/import`, "PUT", k29, {
    "x-version": k29Detail.token,
    "x-preview-hash": k29ImportPreview.body.previewHash,
  });
  assert.equal(result.status, 422);
  assert.equal(result.body.error, "review_warnings");
  assert.equal((await planApi(`/${k29Id}`)).body.version, 3);
  result = await planApi(`/${k29Id}/import`, "PUT", k29, {
    "x-version": k29Detail.token,
    "x-preview-hash": k29ImportPreview.body.previewHash,
    "x-confirm-warnings": "true",
    "x-filename": "k29-reimport.xlsx",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.version, 4);
  assert.equal(result.body.sourceFilename, "k29-reimport.xlsx");
  k29Detail = result.body;
  const wrongCohortPreview = await planApi("/preview", "POST", k31);
  assert.equal(wrongCohortPreview.status, 200);
  result = await planApi(`/${k29Id}/import`, "PUT", k31, {
    "x-version": k29Detail.token,
    "x-preview-hash": wrongCohortPreview.body.previewHash,
    "x-confirm-warnings": "true",
  });
  assert.equal(result.status, 422);
  assert.equal(result.body.error, "plan_identity_mismatch");
  assert.equal((await planApi(`/${k29Id}`)).body.version, 4);
  const source = await planApi(`/${k29Id}/source/${firstRevision}`);
  assert.equal(source.status, 200);
  assert.deepEqual(source.body, k29);
  checks.push("whole-workbook import uses the preview hash, rejects wrong cohort, and round-trips the original source bytes");

  const k31Plan = list.body.items.find((item) => item.cohortCode === "K31");
  assert(k31Plan?.id, "seeded K31 plan must be listed");
  let k31Detail = (await planApi(`/${k31Plan.id}`)).body;
  assert.equal(k31Detail.data.totalCredits, 132);
  assert.equal(k31Detail.data.items.length, 74);
  assert(k31Detail.data.curriculum?.revisionId, "K31 plan should link to CTĐT");
  const pinnedCurriculumRevision = k31Detail.data.curriculum.revisionId;
  const pinnedRow = await pool.query(
    "SELECT curriculum_revision_id FROM training_plan_revisions WHERE id=$1",
    [k31Detail.revisionId],
  );
  assert.equal(pinnedRow.rows[0].curriculum_revision_id, pinnedCurriculumRevision);
  const curriculumList = await curriculumApi();
  const k31Curriculum = curriculumList.body.items.find((item) => item.cohortCode === "K31");
  assert(k31Curriculum?.id, "seeded K31 curriculum must be listed");
  const curriculumDetail = await curriculumApi(`/${k31Curriculum.id}`);
  assert.equal(curriculumDetail.body.revisionId, pinnedCurriculumRevision);
  const curriculumUpdate = await curriculumApi(
    `/${k31Curriculum.id}`,
    "PATCH",
    {
      name: `${curriculumDetail.body.data.name} revised`,
      totalCredits: 126,
      notes: "CTĐT revision after plan import",
    },
    { "x-version": curriculumDetail.body.token },
  );
  assert.equal(curriculumUpdate.status, 200);
  assert.equal(curriculumUpdate.body.revisionId === pinnedCurriculumRevision, false);
  k31Detail = (await planApi(`/${k31Plan.id}`)).body;
  assert.equal(k31Detail.data.curriculum.revisionId, pinnedCurriculumRevision);
  assert.equal(
    (
      await pool.query(
        "SELECT curriculum_revision_id FROM training_plan_revisions WHERE id=$1",
        [k31Detail.revisionId],
      )
    ).rows[0].curriculum_revision_id,
    pinnedCurriculumRevision,
  );
  checks.push("plan revision pins the CTĐT revision that was current at import time");

  const beforeConcurrent = k29Detail;
  const parallel = await Promise.all([
    planApi(
      `/${k29Id}/status`,
      "PATCH",
      { isActive: false },
      { "x-version": beforeConcurrent.token },
    ),
    planApi(
      `/${k29Id}/status`,
      "PATCH",
      { isActive: true },
      { "x-version": beforeConcurrent.token },
    ),
  ]);
  assert.deepEqual(
    parallel.map((response) => response.status).sort((a, b) => a - b),
    [200, 409],
  );
  k29Detail = (await planApi(`/${k29Id}`)).body;
  result = await planApi(
    `/${k29Id}/status`,
    "PATCH",
    { isActive: false },
    { "x-version": k29Detail.token },
  );
  assert.equal(result.status, 200);
  k29Detail = result.body;
  assert.equal(k29Detail.isActive, false);
  assert.equal(k29Detail.version, 4);
  await seedPlans(pool);
  const afterLockedSeed = (await planApi(`/${k29Id}`)).body;
  assert.equal(afterLockedSeed.isActive, false);
  assert.equal(afterLockedSeed.version, 4);
  assert.equal((await planApi("?active=false")).body.total, 1);
  result = await planApi(
    `/${k29Id}/status`,
    "PATCH",
    { isActive: true },
    { "x-version": afterLockedSeed.token },
  );
  assert.equal(result.status, 200);
  assert.equal((await planApi("?active=true")).body.total, 3);
  checks.push("concurrent optimistic status writes, lock filtering, and seed preservation of a locked plan");

  const publicAfter = await snapshotPublicPlans();
  assert.deepEqual(publicAfter, publicBefore);
  checks.push("isolated-schema writes leave public training-plan tables unchanged");

  console.log(JSON.stringify({ passed: true, schema, checks }, null, 2));

  if (process.argv.includes("--ui")) {
    const uiUser = actor("admin");
    // Browser requests carry the loopback page origin. Mount a fresh router
    // with that origin so its write-side CSRF check accepts the fixture.
    app.use("/api/admin/curricula", createCurriculaRouter(pool, origin));
    app.use("/api/admin/plans", createPlansRouter(pool, origin));
    app.get(["/api/auth/me", "/api/admin/me"], (_req, res) =>
      res.json({ authenticated: true, user: uiUser }),
    );
    app.use(express.static(resolve("apps/web/dist")));
    app.get(/^\/quantri(?:\/.*)?$/, (_req, res) =>
      res.sendFile(resolve("apps/web/dist/index.html")),
    );
    await mkdir("output/playwright", { recursive: true });
    await writeFile(
      "output/playwright/plan-url.txt",
      `${origin}/quantri/ke-hoach#${k29Id}`,
    );
    console.log(`Isolated UI preview: ${origin}/quantri/ke-hoach#${k29Id}`);
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
