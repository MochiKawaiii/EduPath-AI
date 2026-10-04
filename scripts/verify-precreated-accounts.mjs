// Exercises pre-created Microsoft account grants against the real PostgreSQL
// repositories, using only a random disposable schema on the configured local DB.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import pg from "pg";
import { PostgresAdminAccountRepository } from "../apps/api/dist/admin/accounts.js";
import { PostgresUserRepository } from "../apps/api/dist/users/postgres-user-repository.js";

const env = dotenv.parse(await readFile("apps/api/.env", "utf8"));
assert(env.DATABASE_URL, "apps/api/.env must define DATABASE_URL for integration checks");
const configuredUrl = new URL(env.DATABASE_URL);
assert(
  ["localhost", "127.0.0.1"].includes(configuredUrl.hostname),
  "Pre-created account checks require a local database",
);

const schema = `precreated_audit_${randomBytes(6).toString("hex")}`;
assert(/^precreated_audit_[0-9a-f]{12}$/.test(schema));
const adminPool = new pg.Pool({ connectionString: env.DATABASE_URL });
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const checks = [];
let schemaCreated = false;
let cleanupComplete = false;

const actorId = randomUUID();
const tenantId = randomUUID();
const actor = {
  userId: actorId,
  identityKey: `${tenantId}:${actorId}`,
  tenantId,
  objectId: randomUUID(),
  name: "Audit admin",
  email: "audit-admin@example.test",
  username: "audit-admin@example.test",
  role: "admin",
  signedInAt: new Date(0).toISOString(),
};
const accountRepository = new PostgresAdminAccountRepository(pool);
const userRepository = new PostgresUserRepository(pool);

function identity({
  username = "",
  email = username,
  tenant = tenantId,
  object = randomUUID(),
  subject = `subject-${randomUUID()}`,
  name = "Audit Microsoft user",
} = {}) {
  return {
    tenantId: tenant,
    objectId: object,
    subject,
    name,
    email: email || null,
    username: username || null,
    loginHint: username || undefined,
    roles: [],
    nonce: "audit-nonce",
    audience: randomUUID(),
    issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

async function createGrant(email) {
  return accountRepository.createAdmin(actor, email);
}

async function fetchUser(id) {
  const result = await pool.query(
    `SELECT id, entra_tenant_id AS "tenantId", entra_object_id AS "objectId",
       entra_subject AS subject, display_name AS name, email, username, role,
       role_override AS "roleOverride", is_active AS "isActive", is_student AS "isStudent",
       auth_version AS "authVersion", first_login_at AS "firstLoginAt", last_login_at AS "lastLoginAt"
     FROM users WHERE id=$1`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function insertPending({ email, tenant = tenantId, role = "admin", roleOverride = role, active = true }) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users(id,entra_tenant_id,entra_object_id,entra_subject,display_name,email,username,
       role,role_override,is_active,is_student,first_login_at,last_login_at)
     VALUES($1,$2,NULL,NULL,$3,$4,$4,$5,$6,$7,FALSE,NULL,NULL)`,
    [id, tenant, email, email, role, roleOverride, active],
  );
  return id;
}

async function insertBound({ email, tenant = tenantId, object = randomUUID(), role = "student", roleOverride = null, active = true, isStudent = false }) {
  const id = randomUUID();
  const now = new Date("2026-01-02T03:04:05.000Z");
  await pool.query(
    `INSERT INTO users(id,entra_tenant_id,entra_object_id,entra_subject,display_name,email,username,
       role,role_override,is_active,is_student,first_login_at,last_login_at)
     VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$11)`,
    [id, tenant, object, `sub-${object}`, "Existing audit user", email, role, roleOverride, active, isStudent, now],
  );
  return id;
}

try {
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;

  for (const migrationName of [
    "001_initial_auth.sql",
    "003_user_role_override.sql",
    "004_account_activity.sql",
    "009_faculty_roles.sql",
  ]) {
    const sql = await readFile(`apps/api/migrations/${migrationName}`, "utf8");
    await pool.query(sql.replaceAll("public.", `${schema}.`));
  }
  await pool.query("ALTER TABLE student_profiles ADD COLUMN full_name TEXT");
  const pendingAccountsMigration = await readFile("apps/api/migrations/017_precreated_accounts.sql", "utf8");
  await pool.query(pendingAccountsMigration.replaceAll("public.", `${schema}.`));

  await pool.query(
    `INSERT INTO users(id,entra_tenant_id,entra_object_id,entra_subject,display_name,email,username,
       role,role_override,first_login_at,last_login_at)
     VALUES($1,$2,$3,$4,$5,$6,$6,'admin','admin',$7,$7)`,
    [actorId, tenantId, actor.objectId, "audit-admin-subject", actor.name, actor.email, new Date()],
  );

  const normalizedGrant = await createGrant("  PRECREATED@example.test  ");
  assert.equal(normalizedGrant.email, "precreated@example.test");
  assert.equal(normalizedGrant.username, "precreated@example.test");
  assert.equal(normalizedGrant.role, "admin");
  const initialPending = await fetchUser(normalizedGrant.id);
  assert(initialPending);
  assert.equal(initialPending.tenantId, tenantId);
  assert.equal(initialPending.objectId, null);
  assert.equal(initialPending.subject, null);
  assert.equal(initialPending.roleOverride, "admin");
  assert.equal(initialPending.authVersion, 0);
  assert.equal(initialPending.firstLoginAt, null);
  assert.equal(initialPending.lastLoginAt, null);
  assert.equal(initialPending.isActive, true);
  const listed = await accountRepository.list(actor, { q: "precreated@example.test", page: 1, pageSize: 10 });
  const listedGrant = listed.items.find((item) => item.id === normalizedGrant.id);
  assert(listedGrant, "new pending grant should appear in the account list");
  assert.equal(listedGrant.lastLoginAt, null);
  checks.push("missing email creates a normalized, visible pending admin with null identity and login dates");

  const firstLogin = identity({ username: "  PRECREATED@EXAMPLE.TEST  ", email: "precreated@example.test" });
  assert.equal(await userRepository.getRoleOverride(firstLogin), "admin");
  const boundLogin = await userRepository.upsertMicrosoftUser(firstLogin, "student", { requireRoleOverride: true });
  assert.equal(boundLogin.userId, normalizedGrant.id);
  assert.equal(boundLogin.role, "admin");
  const boundRow = await fetchUser(normalizedGrant.id);
  assert(boundRow);
  assert.equal(boundRow.objectId, firstLogin.objectId);
  assert.equal(boundRow.subject, firstLogin.subject);
  assert.equal(boundRow.roleOverride, "admin");
  assert.equal(boundRow.authVersion, 0);
  assert(boundRow.firstLoginAt instanceof Date);
  assert(boundRow.lastLoginAt instanceof Date);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS count FROM users WHERE entra_tenant_id=$1 AND email=$2", [tenantId, "precreated@example.test"])).rows[0].count,
    1,
  );
  checks.push("first Microsoft login binds the pending row in place and preserves its admin grant and auth version");

  await assert.rejects(createGrant("precreated@example.test"), { code: "already_admin" });
  assert.equal(
    (await pool.query("SELECT count(*)::int AS count FROM users WHERE entra_tenant_id=$1 AND lower(email)=lower($2)", [tenantId, "precreated@example.test"])).rows[0].count,
    1,
  );
  checks.push("repeated admin grant rejects an already-admin account without inserting a duplicate");

  const revokedActorId = randomUUID();
  await pool.query("UPDATE users SET role='student',role_override='student' WHERE id=$1", [actorId]);
  await assert.rejects(accountRepository.createAdmin({ ...actor, userId: revokedActorId }, "must-not-exist@example.test"), { code: "insufficient_role" });
  await assert.rejects(accountRepository.createAdmin(actor, "must-not-exist@example.test"), { code: "insufficient_role" });
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM users WHERE lower(email)=$1", ["must-not-exist@example.test"])).rows[0].count, 0);
  await pool.query("UPDATE users SET role='admin',role_override='admin' WHERE id=$1", [actorId]);
  checks.push("transaction rechecks current admin permission and rolls back without creating a pending account");

  const promotedId = await insertBound({ email: "promote@example.test", role: "student", isStudent: true });
  const priorPromoted = await fetchUser(promotedId);
  await pool.query(
    "INSERT INTO user_sessions(sid,sess,expire) VALUES($1,$2::json,$3)",
    ["promote-session", JSON.stringify({ user: { userId: promotedId } }), new Date(Date.now() + 60_000)],
  );
  const promoted = await createGrant("PROMOTE@example.test");
  assert.equal(promoted.id, promotedId);
  assert.equal(promoted.role, "admin");
  const promotedRow = await fetchUser(promotedId);
  assert(promotedRow && priorPromoted);
  assert.equal(promotedRow.roleOverride, "admin");
  assert.equal(promotedRow.authVersion, priorPromoted.authVersion + 1);
  assert.equal(promotedRow.isStudent, true);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM user_sessions WHERE sid='promote-session'")).rows[0].count, 0);
  await assert.rejects(createGrant("promote@example.test"), { code: "already_admin" });
  checks.push("existing student promotion retains identity, increments auth version, and revokes active sessions");

  const inactiveEmail = "inactive-pending@example.test";
  const inactiveId = await insertPending({ email: inactiveEmail, active: false });
  const inactiveIdentity = identity({ username: inactiveEmail });
  await assert.rejects(userRepository.getRoleOverride(inactiveIdentity), /account is inactive/);
  await assert.rejects(userRepository.upsertMicrosoftUser(inactiveIdentity, "student"), /account is inactive/);
  const inactiveRow = await fetchUser(inactiveId);
  assert(inactiveRow);
  assert.equal(inactiveRow.objectId, null);
  checks.push("inactive pending accounts cannot expose an override or bind on sign-in");

  const tenantEmail = "tenant-isolation@example.test";
  const tenantGrant = await createGrant(tenantEmail);
  const wrongTenantIdentity = identity({ username: tenantEmail, tenant: randomUUID() });
  assert.equal(await userRepository.getRoleOverride(wrongTenantIdentity), null);
  const wrongTenantUser = await userRepository.upsertMicrosoftUser(wrongTenantIdentity, "student");
  assert.notEqual(wrongTenantUser.userId, tenantGrant.id);
  assert.equal((await fetchUser(tenantGrant.id)).objectId, null);
  assert.equal((await fetchUser(wrongTenantUser.userId)).tenantId, wrongTenantIdentity.tenantId);
  checks.push("pending username matching is tenant-scoped and cannot claim another tenant's grant");

  const emailOnly = "email-only@example.test";
  const emailOnlyGrant = await createGrant(emailOnly);
  const emailOnlyIdentity = identity({ username: null, email: emailOnly });
  assert.equal(await userRepository.getRoleOverride(emailOnlyIdentity), null);
  const emailOnlyLogin = await userRepository.upsertMicrosoftUser(emailOnlyIdentity, "student");
  assert.notEqual(emailOnlyLogin.userId, emailOnlyGrant.id);
  assert.equal((await fetchUser(emailOnlyGrant.id)).objectId, null);
  checks.push("email alone cannot claim a pending grant when verified username is absent");

  const exactUsername = "bound-priority@example.test";
  const pendingAdminId = await insertPending({ email: exactUsername, role: "admin", roleOverride: "admin" });
  const boundIdentity = identity({ username: exactUsername, email: exactUsername });
  const boundStudentId = await insertBound({ email: exactUsername, object: boundIdentity.objectId, role: "student", roleOverride: null });
  assert.equal(await userRepository.getRoleOverride(boundIdentity), null);
  const boundStudentLogin = await userRepository.upsertMicrosoftUser(boundIdentity, "student");
  assert.equal(boundStudentLogin.userId, boundStudentId);
  assert.equal((await fetchUser(pendingAdminId)).objectId, null);
  checks.push("exact bound identity with null override wins over a same-name pending admin grant");

  const consumedEmail = "consumed-grant@example.test";
  const consumed = await createGrant(consumedEmail);
  const identityA = identity({ username: consumedEmail, object: randomUUID() });
  const identityB = identity({ username: consumedEmail, object: randomUUID() });
  assert.equal(await userRepository.getRoleOverride(identityA), "admin");
  assert.equal(await userRepository.getRoleOverride(identityB), "admin");
  const claimed = await userRepository.upsertMicrosoftUser(identityA, "admin", { requireRoleOverride: true });
  assert.equal(claimed.userId, consumed.id);
  await assert.rejects(
    userRepository.upsertMicrosoftUser(identityB, "admin", { requireRoleOverride: true }),
    /role assignment changed/,
  );
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM users WHERE entra_tenant_id=$1 AND email=$2", [tenantId, consumedEmail])).rows[0].count, 1);
  checks.push("a pending role looked up by two identities can be consumed once; the stale second grant fails closed");

  const concurrentLoginEmail = "concurrent-login@example.test";
  const concurrentLoginGrant = await createGrant(concurrentLoginEmail);
  const concurrentIdentity = identity({ username: concurrentLoginEmail });
  const simultaneousLogins = await Promise.all([
    userRepository.upsertMicrosoftUser(concurrentIdentity, "admin", { requireRoleOverride: true }),
    userRepository.upsertMicrosoftUser(concurrentIdentity, "admin", { requireRoleOverride: true }),
  ]);
  assert.deepEqual(simultaneousLogins.map((item) => item.userId), [concurrentLoginGrant.id, concurrentLoginGrant.id]);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM users WHERE entra_tenant_id=$1 AND entra_object_id=$2", [tenantId, concurrentIdentity.objectId])).rows[0].count, 1);
  checks.push("concurrent first logins for one Microsoft object bind and return the same user row");

  const concurrentCreateEmail = "concurrent-create-login@example.test";
  const concurrentCreateIdentity = identity({ username: concurrentCreateEmail });
  const concurrentOperations = await Promise.all([
    createGrant(concurrentCreateEmail),
    userRepository.upsertMicrosoftUser(concurrentCreateIdentity, "student"),
  ]);
  const createdGrant = concurrentOperations[0];
  const createdLogin = concurrentOperations[1];
  assert.equal(createdGrant.id, createdLogin.userId);
  const concurrentFinal = await fetchUser(createdGrant.id);
  assert(concurrentFinal);
  assert.equal(concurrentFinal.objectId, concurrentCreateIdentity.objectId);
  assert.equal(concurrentFinal.roleOverride, "admin");
  assert.equal(concurrentFinal.role, "admin");
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM users WHERE entra_tenant_id=$1 AND (email=$2 OR entra_object_id=$3)", [tenantId, concurrentCreateEmail, concurrentCreateIdentity.objectId])).rows[0].count, 1);
  checks.push("concurrent admin creation and first login converge on one bound admin account");

  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await pool.end();
  if (schemaCreated) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    cleanupComplete = true;
  }
  await adminPool.end();
  if (!cleanupComplete) {
    throw new Error("Disposable pre-created account schema was not cleaned up");
  }
}
