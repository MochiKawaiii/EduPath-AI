import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { AccountError, createAdminAccountsRouter, PostgresAdminAccountRepository } from "./accounts.js";

const actor = { userId: "actor-id", tenantId: "tenant-id", role: "admin" } as AuthenticatedUser;
const target = { id: "target-id", name: "Test account", email: "test@example.edu", role: "student", isActive: true };
function setup(role: "admin" | "student" | null = "admin", available = true) {
  const repository = { canAccessAdmin: vi.fn().mockResolvedValue(true), list: vi.fn().mockResolvedValue({ items: [], total: 0 }), createAdmin: vi.fn().mockResolvedValue({ ...target, role: "admin" }) };
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
  it("reports preview storage as unavailable, not an empty real database", async () => {
    await request(setup("admin", false).app).get("/accounts").expect(503);
  });
  it("passes bounded pagination and search to the repository", async () => {
    const { app, repository } = setup();
    const result = await request(app).get("/accounts?q=hoa&page=2&pageSize=10").expect(200);
    expect(repository.list).toHaveBeenCalledWith(actor, { q: "hoa", page: 2, pageSize: 10 });
    expect(result.body).toEqual({ items: [], total: 0, page: 2, pageSize: 10 });
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
  function repositoryWith(matches: unknown[], validActor = true) {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FOR SHARE")) return { rows: validActor ? [{ id: actor.userId }] : [] };
      if (sql.includes("FOR UPDATE")) return { rows: matches };
      if (sql.includes("UPDATE users SET")) return { rows: [{ ...target, role: "admin" }] };
      return { rows: [] };
    });
    const release = vi.fn();
    const repository = new PostgresAdminAccountRepository({ connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as DatabasePool);
    return { repository, query, release };
  }
  it("grants the uniquely matched identity across tenants in a transaction", async () => {
    const { repository, query, release } = repositoryWith([target]);
    expect((await repository.createAdmin(actor, target.email)).role).toBe("admin");
    expect(query.mock.calls.find(([sql]) => sql.includes("FOR UPDATE"))?.[1]).toEqual([target.email]);
    expect(query.mock.calls.find(([sql]) => sql.includes("UPDATE users SET"))?.[1]).toEqual([target.id]);
    expect(query).toHaveBeenCalledWith("COMMIT"); expect(release).toHaveBeenCalled();
  });
  it.each([
    [[], "account_not_registered"], [[target, target], "ambiguous_account"],
    [[{ ...target, isActive: false }], "account_locked"], [[{ ...target, role: "admin" }], "already_admin"]
  ])("rolls back an invalid target", async (matches, code) => {
    const { repository, query, release } = repositoryWith(matches as unknown[]);
    await expect(repository.createAdmin(actor, target.email)).rejects.toMatchObject({ code });
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE users SET"))).toBe(false);
    expect(release).toHaveBeenCalled();
  });
  it("checks actor permissions again inside the transaction", async () => {
    const { repository, query } = repositoryWith([target], false);
    await expect(repository.createAdmin(actor, target.email)).rejects.toMatchObject({ code: "insufficient_role" });
    expect(query.mock.calls.some(([sql]) => sql.includes("FOR UPDATE"))).toBe(false);
  });
  it("parameterizes search across all tenants", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ items: [], total: 0 }] });
    const repository = new PostgresAdminAccountRepository({ query } as unknown as DatabasePool);
    await repository.list(actor, { q: "' OR 1=1 --", page: 2, pageSize: 10 });
    expect(query.mock.calls[0]?.[1]).toEqual(["' OR 1=1 --", 10, 10, null, null]);
    expect(query.mock.calls[0]?.[0]).not.toContain("' OR 1=1 --");
  });
});
