import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { createCareersRouter } from "./router.js";

const id = "11111111-1111-4111-8111-111111111111";
const version = "22222222-2222-4222-8222-222222222222";
const origin = "https://edupath.example";
const skill = { id, name: "Phân tích dữ liệu", description: "SQL và thống kê", version, careerCount: 0, assessmentCount: 0 };
const data = { name: "SQL", description: "Query relational data" };

function setup({ role = "admin", revoked = false, duplicate = false, stale = false, linked = false, assessed = false }: {
  role?: AuthenticatedUser["role"] | null; revoked?: boolean; duplicate?: boolean; stale?: boolean; linked?: boolean; assessed?: boolean;
} = {}) {
  const user = role ? { userId: id, tenantId: id, role } as AuthenticatedUser : undefined;
  const query = vi.fn(async (sql: string) => sql.includes("FROM users")
    ? { rowCount: 1, rows: [{ id }] } : { rowCount: 1, rows: [skill] });
  const clientQuery = vi.fn(async (sql: string) => {
    if (sql.includes("FROM users")) return { rowCount: revoked ? 0 : 1, rows: revoked ? [] : [{ id }] };
    if (duplicate && (sql.startsWith("INSERT INTO career_skills") || sql.startsWith("UPDATE career_skills SET name"))) throw Object.assign(new Error("duplicate"), { code: "23505" });
    if (sql.startsWith("SELECT name,description FROM career_skills")) return { rowCount: stale ? 0 : 1, rows: stale ? [] : [{ name: data.name, description: data.description }] };
    if (sql.startsWith("SELECT c.id FROM career_positions")) return { rowCount: linked ? 1 : 0, rows: linked ? [{ id }] : [] };
    if (sql.startsWith("SELECT skill_id FROM ad_comp_skills")) return { rowCount: assessed ? 1 : 0, rows: assessed ? [{ skill_id: id }] : [] };
    if (sql.startsWith("SELECT s.id,s.name,s.description,cs.scope")) return { rowCount: assessed ? 1 : 0, rows: assessed ? [skill] : [] };
    return { rowCount: 1, rows: [skill] };
  });
  const connect = vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user } as typeof req.session; next(); });
  app.use("/careers", createCareersRouter({ query, connect } as unknown as DatabasePool, origin));
  return { app, query, connect, clientQuery };
}

describe("career skill catalog", () => {
  it("searches skill names and descriptions without Vietnamese accents", async () => {
    const { app } = setup();
    expect((await request(app).get("/careers/skills?q=phan%20tich").expect(200)).body.items).toEqual([skill]);
    expect((await request(app).get("/careers/skills?q=THONG%20KE").expect(200)).body.items).toEqual([skill]);
    expect((await request(app).get("/careers/skills?q=missing").expect(200)).body.items).toEqual([]);
  });
  it.each(["admin", "faculty_board", "department_head", "lecturer"] as const)("allows %s to manage skills", async role => {
    const { app, clientQuery } = setup({ role });
    await request(app).post("/careers/skills").set("Origin", origin).send(data).expect(201);
    await request(app).patch(`/careers/skills/${id}`).set("Origin", origin).set("x-version", version).send(data).expect(200);
    await request(app).delete(`/careers/skills/${id}`).set("Origin", origin).set("x-version", version).send({ confirmed: true }).expect(200, { deleted: true });
    expect(clientQuery).toHaveBeenCalledWith("COMMIT");
  });
  it("rejects anonymous, student, cross-origin and revoked-role writes", async () => {
    await request(setup({ role: null }).app).get("/careers/skills").expect(401);
    await request(setup({ role: "student" }).app).post("/careers/skills").set("Origin", origin).send(data).expect(403);
    const crossOrigin = setup();
    await request(crossOrigin.app).post("/careers/skills").set("Origin", "https://other.example").send(data).expect(403, { error: "invalid_origin" });
    expect(crossOrigin.connect).not.toHaveBeenCalled();
    const revoked = setup({ revoked: true });
    await request(revoked.app).post("/careers/skills").set("Origin", origin).send(data).expect(403, { error: "insufficient_role" });
    expect(revoked.clientQuery).toHaveBeenCalledWith("ROLLBACK");
  });
  it("validates input, version and deletion confirmation before opening a transaction", async () => {
    const { app, connect } = setup();
    for (const invalid of [{ ...data, name: " " }, { ...data, description: "x".repeat(2001) }, { ...data, extra: true }]) {
      await request(app).post("/careers/skills").set("Origin", origin).send(invalid).expect(400, { error: "invalid_skill" });
    }
    await request(app).patch(`/careers/skills/${id}`).set("Origin", origin).send(data).expect(400, { error: "invalid_skill" });
    await request(app).delete(`/careers/skills/${id}`).set("Origin", origin).set("x-version", version).send({ confirmed: false }).expect(400, { error: "invalid_skill" });
    expect(connect).not.toHaveBeenCalled();
  });
  it("returns stable duplicate, stale-version and in-use conflicts and rolls back", async () => {
    const duplicate = setup({ duplicate: true });
    await request(duplicate.app).post("/careers/skills").set("Origin", origin).send(data).expect(409, { error: "skill_exists" });
    const stale = setup({ stale: true });
    await request(stale.app).patch(`/careers/skills/${id}`).set("Origin", origin).set("x-version", version).send(data).expect(409, { error: "skill_changed" });
    const used = setup({ linked: true });
    await request(used.app).delete(`/careers/skills/${id}`).set("Origin", origin).set("x-version", version).send({ confirmed: true }).expect(409, { error: "skill_in_use" });
    const assessed = setup({ assessed: true });
    await request(assessed.app).delete(`/careers/skills/${id}`).set("Origin", origin).set("x-version", version).send({ confirmed: true }).expect(409, { error: "skill_in_use" });
    for (const item of [duplicate, stale, used, assessed]) expect(item.clientQuery).toHaveBeenCalledWith("ROLLBACK");
  });
  it("records assessment history when a shared skill is changed through the career catalog", async () => {
    const { app, clientQuery } = setup({ assessed: true });
    await request(app).patch(`/careers/skills/${id}`).set("Origin", origin).set("x-version", version).send({ name: "SQL cập nhật", description: "Mô tả chung" }).expect(200);
    expect(clientQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO ad_comp_events"))).toBe(true);
    expect(clientQuery).toHaveBeenCalledWith("COMMIT");
  });
});
