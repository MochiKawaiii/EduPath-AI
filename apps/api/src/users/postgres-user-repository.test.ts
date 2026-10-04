import { describe, expect, it, vi } from "vitest";
import type { AppRole, MicrosoftIdentity } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { PostgresUserRepository } from "./postgres-user-repository.js";

const identity: MicrosoftIdentity = {
  tenantId: "22222222-2222-4222-8222-222222222222",
  objectId: "33333333-3333-4333-8333-333333333333",
  subject: "microsoft-subject",
  name: "Nguyễn Văn Lang",
  email: "student@vlu.edu.vn",
  username: "student@vlu.edu.vn",
  loginHint: "student-login-hint",
  roles: [],
  nonce: "nonce",
  audience: "11111111-1111-4111-8111-111111111111",
  issuer:
    "https://login.microsoftonline.com/22222222-2222-4222-8222-222222222222/v2.0",
  expiresAt: Math.floor(Date.now() / 1000) + 3_600
};

const boundUserId = "55555555-5555-4555-8555-555555555555";
const pendingUserId = "66666666-6666-4666-8666-666666666666";

function persistedUser(overrides: Partial<{
  authVersion: number;
  id: string;
  tenantId: string;
  objectId: string;
  name: string;
  email: string | null;
  username: string | null;
  role: AppRole;
  lastLoginAt: Date | string;
}> = {}) {
  return {
    id: boundUserId,
    authVersion: 8,
    tenantId: identity.tenantId,
    objectId: identity.objectId,
    name: identity.name,
    email: identity.email,
    username: identity.username,
    role: "student" as AppRole,
    lastLoginAt: new Date("2026-09-03T14:00:00.000Z"),
    ...overrides
  };
}

function transactionRepository(options: {
  existing?: Array<{ id: string; isActive: boolean; roleOverride: AppRole | null }>;
  pending?: Array<{ id: string; isActive: boolean; roleOverride: AppRole | null }>;
  result?: ReturnType<typeof persistedUser>[];
  roleLookupResults?: Array<{ roleOverride: AppRole | null; isActive: boolean }[]>;
  failOn?: string;
} = {}) {
  let roleLookupIndex = 0;
  const roleLookup = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: options.roleLookupResults?.[roleLookupIndex++] ?? [] }));
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (options.failOn && sql.includes(options.failOn)) throw new Error("database failure");
    if (sql.includes("FROM users") && sql.includes("entra_object_id = $2")) return { rows: options.existing ?? [] };
    if (sql.includes("FROM users") && sql.includes("entra_object_id IS NULL")) return { rows: options.pending ?? [] };
    if (sql.includes("UPDATE users SET entra_object_id")) return { rows: [] };
    if (sql.includes("INSERT INTO users")) return { rows: options.result ?? [persistedUser()] };
    return { rows: [] };
  });
  const release = vi.fn();
  const client = { query, release };
  const connect = vi.fn().mockResolvedValue(client);
  const pool = { query: roleLookup, connect } as unknown as DatabasePool;
  return { repository: new PostgresUserRepository(pool), query, roleLookup, connect, release };
}

describe("PostgresUserRepository role lookup", () => {
  it.each(["admin", "student", null] as const)("reads override %s by tenant and immutable Microsoft identity", async (roleOverride) => {
    const { repository, roleLookup } = transactionRepository({
      roleLookupResults: [[{ roleOverride, isActive: true }]]
    });
    expect(await repository.getRoleOverride(identity)).toBe(roleOverride);
    expect(roleLookup).toHaveBeenCalledOnce();
    expect(roleLookup.mock.calls[0]?.[1]).toEqual([identity.tenantId, identity.objectId]);
    expect(roleLookup.mock.calls[0]?.[0]).toContain("WHERE entra_tenant_id = $1 AND entra_object_id = $2");
    expect(roleLookup.mock.calls[0]?.[0]).not.toContain("email =");
  });

  it("looks up a pending grant by canonical username only after no exact identity match", async () => {
    const { repository, roleLookup } = transactionRepository({
      roleLookupResults: [[], [{ roleOverride: "admin", isActive: true }]]
    });
    expect(await repository.getRoleOverride({ ...identity, username: "  Student@VLU.EDU.VN " })).toBe("admin");
    expect(roleLookup).toHaveBeenCalledTimes(2);
    expect(roleLookup.mock.calls[1]?.[0]).toContain("entra_tenant_id = $1 AND entra_object_id IS NULL");
    expect(roleLookup.mock.calls[1]?.[0]).toContain("entra_subject IS NULL");
    expect(roleLookup.mock.calls[1]?.[0]).toContain("lower(btrim(username)) = $2");
    expect(roleLookup.mock.calls[1]?.[0]).not.toContain("email");
    expect(roleLookup.mock.calls[1]?.[1]).toEqual([identity.tenantId, "student@vlu.edu.vn"]);
  });

  it("gives an exact bound row priority even when its override is null", async () => {
    const { repository, roleLookup } = transactionRepository({
      roleLookupResults: [[{ roleOverride: null, isActive: true }]]
    });
    expect(await repository.getRoleOverride(identity)).toBeNull();
    expect(roleLookup).toHaveBeenCalledOnce();
  });

  it("does not fall back to email when Microsoft supplies no username", async () => {
    const { repository, roleLookup } = transactionRepository({ roleLookupResults: [[]] });
    expect(await repository.getRoleOverride({ ...identity, username: null })).toBeNull();
    expect(roleLookup).toHaveBeenCalledOnce();
    expect(roleLookup.mock.calls[0]?.[0]).not.toContain("email =");
  });

  it.each([
    ["exact", [[{ roleOverride: "admin" as const, isActive: false }]]],
    ["pending", [[], [{ roleOverride: "admin" as const, isActive: false }]]]
  ])("does not grant an inactive %s account", async (_source, roleLookupResults) => {
    const { repository } = transactionRepository({ roleLookupResults });
    await expect(repository.getRoleOverride(identity)).rejects.toThrow("account is inactive");
  });

  it("rejects ambiguous pending username matches", async () => {
    const { repository } = transactionRepository({
      roleLookupResults: [[], [
        { roleOverride: "admin", isActive: true },
        { roleOverride: "lecturer", isActive: true }
      ]]
    });
    await expect(repository.getRoleOverride(identity)).rejects.toThrow("Ambiguous pending Microsoft account");
  });
});

describe("PostgresUserRepository transactional upsert", () => {
  it("uses one transaction and persists a new identity through the tenant/object conflict key", async () => {
    const loginAt = new Date("2026-09-03T14:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(loginAt);
    try {
      const { repository, query, release, connect } = transactionRepository({ result: [persistedUser({ lastLoginAt: loginAt })] });
      const user = await repository.upsertMicrosoftUser(identity, "student");

      const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO users"));
      expect(insert?.[0]).toContain("ON CONFLICT (entra_tenant_id, entra_object_id)");
      expect(insert?.[0]).toContain("WHERE users.is_active = TRUE");
      expect(insert?.[0]).toContain("role = COALESCE(users.role_override, EXCLUDED.role)");
      expect(insert?.[1]?.[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(insert?.[1]?.slice(1, 8)).toEqual([
        identity.tenantId,
        identity.objectId,
        identity.subject,
        identity.name,
        identity.email,
        identity.username,
        "student"
      ]);
      expect(insert?.[1]?.[8]).toEqual(loginAt);
      expect(query.mock.calls.map(([sql]) => sql === "BEGIN" ? "BEGIN" : sql === "COMMIT" ? "COMMIT" : sql.includes("pg_advisory_xact_lock") ? "LOCK" : sql.includes("entra_object_id IS NULL") ? "PENDING" : sql.includes("FOR UPDATE") ? "EXACT" : sql.includes("INSERT INTO users") ? "UPSERT" : "OTHER")).toEqual(["BEGIN", "LOCK", "EXACT", "PENDING", "UPSERT", "COMMIT"]);
      expect(connect).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
      expect(user).toEqual({
        authVersion: 8,
        userId: boundUserId,
        identityKey: `${identity.tenantId}:${identity.objectId}`,
        tenantId: identity.tenantId,
        objectId: identity.objectId,
        name: identity.name,
        email: identity.email,
        username: identity.username,
        role: "student",
        signedInAt: loginAt.toISOString()
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("binds a pending grant in place and uses its stored admin override", async () => {
    const { repository, query, release } = transactionRepository({
      pending: [{ id: pendingUserId, isActive: true, roleOverride: "admin" }],
      result: [persistedUser({ id: pendingUserId, authVersion: 12, role: "admin" })]
    });
    const user = await repository.upsertMicrosoftUser(identity, "student", { requireRoleOverride: true });

    const pendingSelect = query.mock.calls.find(([sql]) => sql.includes("entra_object_id IS NULL"));
    expect(pendingSelect?.[0]).toContain("entra_subject IS NULL");
    expect(pendingSelect?.[0]).toContain("lower(btrim(username)) = $2");
    expect(pendingSelect?.[1]).toEqual([identity.tenantId, identity.username]);
    const bind = query.mock.calls.find(([sql]) => sql.includes("UPDATE users SET entra_object_id"));
    expect(bind?.[0]).toContain("first_login_at = $4, last_login_at = $4");
    expect(bind?.[1]?.slice(0, 3)).toEqual([pendingUserId, identity.objectId, identity.subject]);
    expect(bind?.[1]?.[3]).toBeInstanceOf(Date);
    const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO users"));
    expect(insert?.[1]?.[7]).toBe("admin");
    expect(user.userId).toBe(pendingUserId);
    expect(user.authVersion).toBe(12);
    expect(user.role).toBe("admin");
    expect(query).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("prefers an exact bound user's stored override over the requested role", async () => {
    const { repository, query, release } = transactionRepository({
      existing: [{ id: boundUserId, isActive: true, roleOverride: "lecturer" }],
      pending: [{ id: pendingUserId, isActive: true, roleOverride: "admin" }],
      result: [persistedUser({ role: "lecturer" })]
    });
    const user = await repository.upsertMicrosoftUser(identity, "admin");

    const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO users"));
    expect(insert?.[1]?.[7]).toBe("lecturer");
    expect(query.mock.calls.some(([sql]) => sql.includes("entra_object_id IS NULL"))).toBe(false);
    expect(user.userId).toBe(boundUserId);
    expect(user.role).toBe("lecturer");
    expect(release).toHaveBeenCalledOnce();
  });

  it("treats an exact bound row with a null override as authoritative over a same-name pending admin", async () => {
    const { repository, query, release } = transactionRepository({
      existing: [{ id: boundUserId, isActive: true, roleOverride: null }],
      pending: [{ id: pendingUserId, isActive: true, roleOverride: "admin" }],
      result: [persistedUser({ role: "student" })]
    });
    const user = await repository.upsertMicrosoftUser(identity, "student");

    expect(query.mock.calls.some(([sql]) => sql.includes("entra_object_id IS NULL"))).toBe(false);
    expect(query.mock.calls.find(([sql]) => sql.includes("INSERT INTO users"))?.[1]?.[7]).toBe("student");
    expect(user.userId).toBe(boundUserId);
    expect(user.role).toBe("student");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back a stale role grant consumed after lookup instead of creating another admin", async () => {
    const { repository, query, release, roleLookup } = transactionRepository({
      roleLookupResults: [[], [{ roleOverride: "admin", isActive: true }]],
      pending: []
    });
    const lookedUpRole = await repository.getRoleOverride(identity);
    expect(lookedUpRole).toBe("admin");

    await expect(repository.upsertMicrosoftUser(identity, lookedUpRole, { requireRoleOverride: true }))
      .rejects.toThrow("role assignment changed during sign-in");
    expect(roleLookup).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO users"))).toBe(false);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query).not.toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases when a pending row is inactive", async () => {
    const { repository, query, release } = transactionRepository({
      pending: [{ id: pendingUserId, isActive: false, roleOverride: "admin" }]
    });
    await expect(repository.upsertMicrosoftUser(identity, "student")).rejects.toThrow("account is inactive");
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE users SET entra_object_id") || sql.includes("INSERT INTO users"))).toBe(false);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back ambiguous pending rows", async () => {
    const { repository, query, release } = transactionRepository({
      pending: [
        { id: pendingUserId, isActive: true, roleOverride: "admin" },
        { id: boundUserId, isActive: true, roleOverride: "lecturer" }
      ]
    });
    await expect(repository.upsertMicrosoftUser(identity, "student")).rejects.toThrow("Ambiguous pending Microsoft account");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back database failures and releases its transaction client", async () => {
    const { repository, query, release } = transactionRepository({ failOn: "INSERT INTO users" });
    await expect(repository.upsertMicrosoftUser(identity, "student")).rejects.toThrow("database failure");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query).not.toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects an inactive exact account and rolls back", async () => {
    const { repository, query, release } = transactionRepository({
      existing: [{ id: boundUserId, isActive: false, roleOverride: "admin" }]
    });
    await expect(repository.upsertMicrosoftUser(identity, "student")).rejects.toThrow("account is inactive");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO users"))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
});
