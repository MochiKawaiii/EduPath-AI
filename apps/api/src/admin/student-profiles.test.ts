import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { AccountError } from "./accounts.js";
import { createStudentProfilesRouter, PostgresStudentProfileRepository } from "./student-profiles.js";
import type { AuthenticatedUser, AppRole } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";

const id = "12345678-1234-4234-8234-123456789012";
const actor = { userId: "admin", tenantId: "tenant", role: "admin" } as AuthenticatedUser;
function setup(role: AppRole | null = "admin", available = true) {
  const repository = { list: vi.fn().mockResolvedValue({ items: [], total: 0, cohortYears: [2023], cohortCodes: ["K29"] }), detail: vi.fn().mockResolvedValue({ id, profileStatus: "missing" }) };
  const authorization = { canAccessAdmin: vi.fn().mockResolvedValue(true) };
  const app = express();
  app.use((req, _res, next) => { req.session = { user: role ? { ...actor, role } : undefined } as typeof req.session; next(); });
  app.use("/students", createStudentProfilesRouter(available ? repository : undefined, authorization));
  return { app, repository, authorization };
}
describe("student profile read API", () => {
  it.each([[null, 401], ["student", 403]] as const)("blocks role %s", async (role, status) => {
    const { app, repository } = setup(role);
    await request(app).get("/students").expect(status); await request(app).get(`/students/${id}`).expect(status);
    expect(repository.list).not.toHaveBeenCalled(); expect(repository.detail).not.toHaveBeenCalled();
  });
  it.each(["faculty_board", "department_head", "lecturer"] as const)("allows %s to read student lists and details", async role => {
    const { app } = setup(role);
    await request(app).get("/students").expect(200);
    await request(app).get(`/students/${id}`).expect(200);
  });
  it("rejects stale Admin sessions using current database authorization", async () => {
    const { app, authorization, repository } = setup(); authorization.canAccessAdmin.mockResolvedValue(false);
    await request(app).get("/students").expect(403); await request(app).get(`/students/${id}`).expect(403);
    expect(repository.list).not.toHaveBeenCalled();
  });
  it("returns 503 in preview mode without pretending data was loaded", async () => {
    await request(setup("admin", false).app).get("/students").expect(503);
  });
  it("returns a no-store paginated response", async () => {
    const { app, repository } = setup(); const result = await request(app).get("/students").expect(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body).toEqual({ items: [], total: 0, cohortYears: [2023], cohortCodes: ["K29"], page: 1, pageSize: 10 });
    expect(repository.list).toHaveBeenCalledWith(actor, { q: "", page: 1, pageSize: 10 });
  });
  it("combines bounded search and all supported filters", async () => {
    const { app, repository } = setup();
    await request(app).get("/students").query({ q: "  23748  ", page: 2, pageSize: 20, cohortYear: 2023, cohortCode: "K29", active: "false", profileStatus: "incomplete" }).expect(200);
    expect(repository.list).toHaveBeenCalledWith(actor, { q: "23748", page: 2, pageSize: 20, cohortYear: 2023, cohortCode: "K29", active: "false", profileStatus: "incomplete" });
  });
  it.each(["page=0", "pageSize=51", "page=1&page=2", "cohortYear=1999", "cohortYear=2101", "cohortYear=2023.5", "cohortYear=abc", "cohortCode=29", "cohortCode=bad", "cohortCode=K29&cohortCode=K30", "semester=0", "semester=4", "semester=20", "semester=21", "semester=1.5", "active=yes", "profileStatus=all", "tenantId=other", "role=admin"])("rejects invalid filters %s", async (query) => {
    const { app, repository } = setup(); await request(app).get(`/students?${query}`).expect(400); expect(repository.list).not.toHaveBeenCalled();
  });
  it("rejects oversized keywords and malformed ids", async () => {
    const { app } = setup(); await request(app).get("/students").query({ q: "x".repeat(121) }).expect(400);
    await request(app).get("/students/not-uuid").expect(400);
  });
  it("allows a missing profile detail and returns 404 for inaccessible students", async () => {
    const { app, repository } = setup(); const response = await request(app).get(`/students/${id}`).expect(200);
    expect(response.body.student.profileStatus).toBe("missing"); expect(repository.detail).toHaveBeenCalledWith(actor, id);
    repository.detail.mockRejectedValue(new AccountError("student_not_found", 404));
    expect((await request(app).get(`/students/${id}`).expect(404)).body.error).toBe("student_not_found");
  });
  it.each(["post", "patch", "delete"] as const)("exposes no %s write endpoint", async (method) => {
    await request(setup().app)[method](`/students/${id}`).expect(404);
  });
});
describe("student profile SQL safety", () => {
  it("uses a left join and effective Student role across tenants with parameterized filters", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ items: [], total: 0, cohortYears: [], cohortCodes: [] }] });
    const repo = new PostgresStudentProfileRepository({ query } as unknown as DatabasePool);
    await repo.list(actor, { q: "' OR 1=1 --", page: 2, pageSize: 10, cohortYear: 2023, cohortCode: "K29", active: "false", profileStatus: "incomplete" });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("LEFT JOIN student_profiles"); expect(sql).not.toContain("u.entra_tenant_id =");
    expect(sql).toContain("COALESCE(u.role_override, u.role) = 'student'");
    expect(sql).not.toContain("' OR 1=1 --"); expect(sql).not.toContain("SELECT * FROM users");
    expect(values).toEqual(["' OR 1=1 --", 2023, "K29", "false", "incomplete", 10, 10]);
  });
  it("does not return absent or non-student details", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] }); const repo = new PostgresStudentProfileRepository({ query } as unknown as DatabasePool);
    await expect(repo.detail(actor, id)).rejects.toMatchObject({ code: "student_not_found", status: 404 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("COALESCE(u.role_override, u.role) = 'student'"), [id, null]);
  });
});
