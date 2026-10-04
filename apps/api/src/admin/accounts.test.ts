import express from "express";
import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { AccountError, createAdminAccountsRouter, PostgresAdminAccountRepository } from "./accounts.js";

const actor = { userId: "actor-id", tenantId: "tenant-id", role: "admin" } as AuthenticatedUser;
const target = { id: "target-id", name: "Test account", email: "test@example.edu", role: "student" as const, isActive: true };
const seedBatch = "edupath-demo-2026-10-02";
const seedId = (index: number) => createHash("md5").update(`${seedBatch}:${index}`).digest("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.*)$/, "$1-$2-$3-$4-$5");
const seedAccountIds = Array.from({ length: 50 }, (_, index) => seedId(index + 1));
function setup(role: "admin" | "student" | "faculty_board" | "department_head" | "lecturer" | null = "admin", available = true) {
  const repository = {
    canAccessAdmin: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    detail: vi.fn().mockResolvedValue({ ...target, id: seedAccountIds[0], createdAt: "", firstLoginAt: "", updatedAt: "" }),
    history: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    createAdmin: vi.fn().mockResolvedValue({ ...target, role: "admin" }),
    update: vi.fn().mockResolvedValue({ ...target, id: seedAccountIds[0] }),
  };
  const app = express();
  app.use(express.json());
  // Test-only sessions; production uses the Microsoft session middleware.
  app.use((req, _res, next) => { req.session = { user: role ? { ...actor, role } : undefined } as typeof req.session; next(); });
  app.use("/accounts", createAdminAccountsRouter(available ? repository : undefined, "http://localhost:5173"));
  return { app, repository };
}

describe("admin accounts API", () => {
  it.each([[null, 401], ["student", 403]] as const)("rejects %s on reads and grants", async (role, status) => {
    const { app, repository } = setup(role);
    await request(app).get("/accounts").expect(status);
    await request(app).post("/accounts").send({ email: target.email, confirmAdmin: true }).expect(status);
    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.createAdmin).not.toHaveBeenCalled();
  });
  it("rejects a revoked Admin even with an old Admin session", async () => {
    const { app, repository } = setup(); repository.canAccessAdmin.mockResolvedValue(false);
    await request(app).get("/accounts").expect(403);
    await request(app).post("/accounts").expect(403);
    expect(repository.createAdmin).not.toHaveBeenCalled();
  });
  it.each(["faculty_board", "department_head", "lecturer"] as const)("lets %s manage accounts but reserves admin grants for admins", async (role) => {
    const { app, repository } = setup(role);
    await request(app).get("/accounts").expect(200);
    await request(app).post("/accounts").set("Origin", "http://localhost:5173").send({ email: target.email, confirmAdmin: true }).expect(403);
    expect(repository.createAdmin).not.toHaveBeenCalled();
  });
  it("reports preview storage as unavailable, not an empty real database", async () => {
    await request(setup("admin", false).app).get("/accounts").expect(503);
  });
  it("passes bounded pagination and search to the repository", async () => {
    const { app, repository } = setup();
    const result = await request(app).get("/accounts?q=hoa&page=2&pageSize=10").expect(200);
    expect(repository.list).toHaveBeenCalledWith(actor, { q: "hoa", page: 2, pageSize: 10 });
    expect(result.body).toEqual({ items: [], total: 0, page: 2, pageSize: 10 });
  });
  it("accepts every deterministic MD5 seed GUID on account detail and routes a seed GUID to history and lock handlers", async () => {
    const { app, repository } = setup();
    for (const seedAccountId of seedAccountIds) await request(app).get(`/accounts/${seedAccountId}`).expect(200);
    expect(repository.detail.mock.calls.map(([, requestedId]) => requestedId)).toEqual(seedAccountIds);

    const selectedId = seedAccountIds[45]!;
    await request(app).get(`/accounts/history?userId=${selectedId}`).expect(200);
    expect(repository.history).toHaveBeenCalledWith(actor, expect.objectContaining({ userId: selectedId }));
    const lockId = seedAccountIds[46]!;
    await request(app).patch(`/accounts/${lockId}`).set("Origin", "http://localhost:5173").send({ isActive: false, confirmed: true }).expect(200);
    expect(repository.update).toHaveBeenCalledWith(actor, lockId, { isActive: false, confirmed: true });
  });
  it("returns specific errors for malformed account ids without invoking repositories", async () => {
    const { app, repository } = setup();
    const detail = await request(app).get("/accounts/not-guid").expect(400);
    expect(detail.body).toEqual({ error: "invalid_account_id" });
    const change = await request(app).patch("/accounts/not-guid").set("Origin", "http://localhost:5173").send({ isActive: false, confirmed: true }).expect(400);
    expect(change.body).toEqual({ error: "invalid_account_id" });
    const history = await request(app).get("/accounts/history?userId=not-guid").expect(400);
    expect(history.body).toEqual({ error: "invalid_query" });
    expect(repository.detail).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.history).not.toHaveBeenCalled();
  });
  it.each(["page=0", "page=-2", "page=NaN", "pageSize=100000", "role=owner", "page=1&page=2"])("rejects invalid query %s", async (query) => {
    await request(setup().app).get(`/accounts?${query}`).expect(400);
  });
  it.each([undefined, "https://evil.example"])("requires same Origin, received %s", async (origin) => {
    const { app, repository } = setup();
    const call = request(app).post("/accounts");
    if (origin) call.set("Origin", origin);
    await call.send({ email: target.email, confirmAdmin: true }).expect(403);
    expect(repository.createAdmin).not.toHaveBeenCalled();
  });
  it.each([{ email: "invalid", confirmAdmin: true }, { email: target.email, confirmAdmin: false }, { email: target.email, confirmAdmin: true, role: "admin" }, {}])("validates email, confirmation and unknown fields", async (body) => {
    const { app, repository } = setup();
    await request(app).post("/accounts").set("Origin", "http://localhost:5173").send(body).expect(400);
    expect(repository.createAdmin).not.toHaveBeenCalled();
  });
  it("creates an admin with a normalized email and explicit confirmation", async () => {
    const { app, repository } = setup();
    await request(app).post("/accounts").set("Origin", "http://localhost:5173").send({ email: "TEST@EXAMPLE.EDU", confirmAdmin: true }).expect(201);
    expect(repository.createAdmin).toHaveBeenCalledWith(actor, target.email);
  });
  it.each(["already_admin", "account_locked", "ambiguous_account"])("reports conflict %s", async (code) => {
    const { app, repository } = setup(); repository.createAdmin.mockRejectedValue(new AccountError(code, 409));
    expect((await request(app).post("/accounts").set("Origin", "http://localhost:5173").send({ email: target.email, confirmAdmin: true }).expect(409)).body.error).toBe(code);
  });
});

describe("Postgres admin account repository", () => {
  function repositoryWith(options: {
    matches?: unknown[];
    validActor?: boolean;
    insertResult?: unknown;
    updateResult?: unknown;
    failOn?: string;
  } = {}) {
    const matches = options.matches ?? [];
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (options.failOn && sql.includes(options.failOn)) throw new Error("database failure");
      if (sql.includes("FOR SHARE")) return { rows: options.validActor === false ? [] : [{ id: actor.userId }] };
      if (sql.includes("FOR UPDATE")) return { rows: matches };
      if (sql.includes("INSERT INTO users")) return { rows: options.insertResult ? [options.insertResult] : [{ ...target, role: "admin" }] };
      if (sql.includes("UPDATE users SET")) return { rows: options.updateResult ? [options.updateResult] : [{ ...target, role: "admin" }] };
      return { rows: [] };
    });
    const release = vi.fn();
    const client = { query, release };
    const connect = vi.fn().mockResolvedValue(client);
    const repository = new PostgresAdminAccountRepository({ connect } as unknown as DatabasePool);
    return { repository, query, release, connect };
  }

  it("creates a tenant-scoped pending admin when the email is not registered yet", async () => {
    const pendingAdmin = { ...target, id: "pending-id", email: "future.admin@example.edu", role: "admin" as const };
    const { repository, query, release } = repositoryWith({ insertResult: pendingAdmin });
    const created = await repository.createAdmin(actor, " FUTURE.ADMIN@example.edu ");

    expect(created).toEqual(pendingAdmin);
    const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO users"));
    expect(insert?.[0]).toContain("entra_tenant_id, entra_object_id, entra_subject");
    expect(insert?.[0]).toContain("VALUES ($1, $2, NULL, NULL");
    expect(insert?.[0]).toContain("FALSE, NULL, NULL)");
    expect(insert?.[1]).toEqual([expect.any(String), actor.tenantId, "future.admin@example.edu", "future.admin@example.edu"]);
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE users SET"))).toBe(false);
    expect(query).toHaveBeenCalledWith("COMMIT");
    expect(query).not.toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("promotes the uniquely matched existing account and revokes its sessions", async () => {
    const { repository, query, release } = repositoryWith({ matches: [target] });
    expect((await repository.createAdmin(actor, target.email)).role).toBe("admin");
    expect(query.mock.calls.find(([sql]) => sql.includes("FOR UPDATE"))?.[1]).toEqual([target.email]);
    expect(query.mock.calls.find(([sql]) => sql.includes("UPDATE users SET"))?.[1]).toEqual([target.id]);
    expect(query.mock.calls.find(([sql]) => sql.includes("UPDATE users SET"))?.[0]).toContain("auth_version = auth_version + 1");
    expect(query.mock.calls.some(([sql, values]) => sql.includes("DELETE FROM user_sessions") && values?.[0] === target.id)).toBe(true);
    expect(query).toHaveBeenCalledWith("COMMIT");
    expect(query).not.toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    [[target, target], "ambiguous_account"],
    [[{ ...target, isActive: false }], "account_locked"], [[{ ...target, role: "admin" }], "already_admin"]
  ])("rolls back an invalid target", async (matches, code) => {
    const { repository, query, release } = repositoryWith({ matches: matches as unknown[] });
    await expect(repository.createAdmin(actor, target.email)).rejects.toMatchObject({ code });
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE users SET") || sql.includes("INSERT INTO users"))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("checks actor permissions again inside the transaction", async () => {
    const { repository, query, release } = repositoryWith({ matches: [target], validActor: false });
    await expect(repository.createAdmin(actor, target.email)).rejects.toMatchObject({ code: "insufficient_role" });
    expect(query.mock.calls.some(([sql]) => sql.includes("FOR UPDATE"))).toBe(false);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back database failures and always releases its client", async () => {
    const { repository, query, release } = repositoryWith({ matches: [target], failOn: "UPDATE users SET" });
    await expect(repository.createAdmin(actor, target.email)).rejects.toThrow("database failure");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query).not.toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("parameterizes search across all tenants", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ items: [], total: 0 }] });
    const repository = new PostgresAdminAccountRepository({ query } as unknown as DatabasePool);
    await repository.list(actor, { q: "' OR 1=1 --", page: 2, pageSize: 10 });
    expect(query.mock.calls[0]?.[1]).toEqual(["' OR 1=1 --", 10, 10, null, null]);
    expect(query.mock.calls[0]?.[0]).not.toContain("' OR 1=1 --");
  });
});
