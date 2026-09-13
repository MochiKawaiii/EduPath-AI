import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { AccountError, createAdminAccountsRouter, PostgresAdminAccountRepository } from "./accounts.js";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";

const id = "12345678-1234-4234-8234-123456789012";
const actor = { userId: "22345678-1234-4234-8234-123456789012", tenantId: "tenant", role: "admin" } as AuthenticatedUser;
const origin = "http://localhost:5173";
function setup(role: string | null = "admin") {
  const repository = { canAccessAdmin: vi.fn().mockResolvedValue(true), list: vi.fn().mockResolvedValue({ items: [], total: 0 }), createAdmin: vi.fn(), detail: vi.fn().mockResolvedValue({ id }), update: vi.fn().mockResolvedValue({ id }), history: vi.fn().mockResolvedValue({ items: [], total: 0 }) };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: role ? { ...actor, role } : undefined } as typeof req.session; next(); });
  app.use("/accounts", createAdminAccountsRouter(repository, origin));
  return { app, repository };
}
describe("account management authorization and validation", () => {
  it.each(["faculty_board", "department_head", "lecturer"])("allows %s to read but never grant roles, lock accounts or read history", async role => {
    const { app, repository } = setup(role);
    await request(app).get("/accounts").expect(200);
    await request(app).get(`/accounts/${id}`).expect(200);
    await request(app).post("/accounts").set("Origin", origin).send({ email: "test@example.com", confirmAdmin: true }).expect(403);
    await request(app).patch(`/accounts/${id}`).set("Origin", origin).send({ role: "admin", confirmed: true }).expect(403);
    await request(app).patch(`/accounts/${id}`).set("Origin", origin).send({ isActive: false, confirmed: true }).expect(403);
    await request(app).get("/accounts/history").expect(403);
    expect(repository.createAdmin).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.history).not.toHaveBeenCalled();
  });
  it.each(["faculty_board", "department_head", "lecturer"])("lets an admin assign %s", async role => {
    const { app, repository } = setup();
    await request(app).patch(`/accounts/${id}`).set("Origin", origin).send({ role, confirmed: true }).expect(200);
    expect(repository.update).toHaveBeenCalledWith(actor, id, { role, confirmed: true });
  });
  it.each([null, "student"])("blocks %s on all new endpoints", async (role) => {
    const { app, repository } = setup(role); const status = role ? 403 : 401;
    await request(app).get(`/accounts/${id}`).expect(status);
    await request(app).get("/accounts/history").expect(status);
    await request(app).patch(`/accounts/${id}`).set("Origin", origin).send({ role: "admin", confirmed: true }).expect(status);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("reads detail and handles an absent account", async () => {
    const { app, repository } = setup();
    await request(app).get(`/accounts/${id}`).expect(200); expect(repository.detail).toHaveBeenCalledWith(actor, id);
    repository.detail.mockRejectedValue(new AccountError("account_not_found", 404));
    await request(app).get(`/accounts/${id}`).expect(404);
    await request(app).get("/accounts/not-uuid").expect(400);
  });
  it.each([undefined, "https://elsewhere.test"])("rejects mutation Origin %s", async (value) => {
    const { app, repository } = setup(); const call = request(app).patch(`/accounts/${id}`); if (value) call.set("Origin", value);
    await call.send({ isActive: false, confirmed: true }).expect(403); expect(repository.update).not.toHaveBeenCalled();
  });
  it.each([{}, { role: "owner", confirmed: true }, { role: "admin" }, { role: "admin", confirmed: false }, { isActive: "false", confirmed: true }, { role: "admin", isActive: false, confirmed: true }, { isActive: true, confirmed: true, tenantId: "other" }])("rejects malformed change %j", async (body) => {
    const { app, repository } = setup(); await request(app).patch(`/accounts/${id}`).set("Origin", origin).send(body).expect(400); expect(repository.update).not.toHaveBeenCalled();
  });
  it.each([{ role: "student", confirmed: true }, { isActive: false, confirmed: true }, { isActive: true, confirmed: true }])("accepts confirmed change %j", async (body) => {
    const { app, repository } = setup(); await request(app).patch(`/accounts/${id}`).set("Origin", origin).send(body).expect(200); expect(repository.update).toHaveBeenCalledWith(actor, id, body);
  });
  it("passes account filters and history filters with pagination", async () => {
    const { app, repository } = setup(); await request(app).get("/accounts?role=admin&active=false&q=test").expect(200);
    expect(repository.list).toHaveBeenCalledWith(actor, { role: "admin", active: "false", q: "test", page: 1, pageSize: 10 });
    await request(app).get(`/accounts/history?userId=${id}&outcome=denied&portal=admin&page=2&q=test&from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z`).expect(200);
    expect(repository.history).toHaveBeenCalledWith(actor, expect.objectContaining({ userId: id, outcome: "denied", portal: "admin", page: 2, q: "test" }));
  });
  it.each(["page=0", "pageSize=500", "outcome=all", "portal=any", "userId=bad", "from=bad", "from=2026-09-03T00:00:00Z&to=2026-09-01T00:00:00Z", "unknown=true"])("rejects invalid history query %s", async (query) => {
    await request(setup().app).get(`/accounts/history?${query}`).expect(400);
  });
  it("denies a revoked actor before reading history", async () => {
    const { app, repository } = setup(); repository.canAccessAdmin.mockResolvedValue(false);
    await request(app).get("/accounts/history").expect(403); expect(repository.history).not.toHaveBeenCalled();
  });
});
describe("transactional role and lock changes", () => {
  function setupRepository(activeActor = true, targetFound = true) {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => ({ rows: sql.includes("FOR SHARE") ? activeActor ? [{ id: actor.userId }] : [] : sql.startsWith("UPDATE users") ? targetFound ? [{ id }] : [] : [] }));
    const release = vi.fn(); const pool = { connect: vi.fn().mockResolvedValue({ query, release }) };
    return { repository: new PostgresAdminAccountRepository(pool as unknown as DatabasePool), query, release, pool };
  }
  it("refuses self-mutation without acquiring a connection", async () => {
    const { repository, pool } = setupRepository();
    await expect(repository.update(actor, actor.userId, { isActive: false })).rejects.toMatchObject({ code: "self_change_forbidden" });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("serializes global changes, bumps version and revokes sessions atomically", async () => {
    const { repository, query, release } = setupRepository(); await repository.update(actor, id, { role: "student" });
    expect(query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(hashtext($1))", ["edupath:admin-account-management"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("auth_version = auth_version + 1"), [id, "student", null]);
    expect(query).toHaveBeenCalledWith("DELETE FROM user_sessions WHERE sess->'user'->>'userId' = $1", [id]);
    expect(query).toHaveBeenCalledWith("COMMIT"); expect(release).toHaveBeenCalled();
  });
  it.each([[false, true, "insufficient_role"], [true, false, "account_not_found"]] as const)("rolls back rejected change", async (activeActor, targetFound, code) => {
    const { repository, query, release } = setupRepository(activeActor, targetFound);
    await expect(repository.update(actor, id, { isActive: false })).rejects.toMatchObject({ code });
    expect(query).toHaveBeenCalledWith("ROLLBACK"); expect(query).not.toHaveBeenCalledWith("COMMIT"); expect(release).toHaveBeenCalled();
  });
});
