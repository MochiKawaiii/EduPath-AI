import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { createCompetenciesRouter } from "./router.js";

vi.mock("./workbook.js", () => ({ parseCompetencyWorkbook: vi.fn() }));
vi.mock("./import.js", () => ({ previewCompetencyImport: vi.fn(), applyCompetencyImport: vi.fn() }));

const actorId = "11111111-1111-4111-8111-111111111111";
const version = "22222222-2222-4222-8222-222222222222";
const revisionId = "33333333-3333-4333-8333-333333333333";
const skillId = "44444444-4444-4444-8444-444444444444";
const secondSkillId = "55555555-5555-4555-8555-555555555555";
const groupId = "66666666-6666-4666-8666-666666666666";
const configId = "77777777-7777-4777-8777-777777777777";
const origin = "https://edupath.example";
const coursePath = `/competencies/courses/${revisionId}/A101`;
const groupData = { name: "Chuyên môn", description: "Kỹ năng chuyên môn", isActive: true };
const activeData = { status: "active", links: [{ skillId, weight: 1 }], note: "Rà soát phân bổ" };

function setup(options: { role?: AuthenticatedUser["role"] | null; revokedAtWrite?: boolean; missingDatabase?: boolean;
  duplicateCourse?: boolean; existingConfig?: boolean; inactiveGroup?: boolean; groupUsed?: boolean; deferredFailure?: boolean } = {}) {
  const role = options.role === undefined ? "admin" : options.role;
  const user = role ? { userId: actorId, tenantId: actorId, role } as AuthenticatedUser : undefined;
  const group = { id: groupId, ...groupData, version, skillCount: 0 };
  const course = { code: "A101", name: "Lập trình", credits: 3, type: "BB", block: "Chuyên môn", specialty: "" };
  const revision = { curriculumId: actorId, revisionId, cohortCode: "K29", name: "CTĐT K29", version: 1,
    isCurrent: true, isActive: true, data: { courses: options.duplicateCourse ? [course, course] : [course] } };
  let configExists = options.existingConfig ?? false;
  let configVersion = version;
  let configStatus = "active";
  let savedLinks = [{ skillId, skillName: "Lập trình", groupId, groupName: group.name, isActive: true, weight: 1 }];
  const rows = (items: Record<string, unknown>[] = []) => ({ rows: items, rowCount: items.length });
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM users")) return rows([{ id: actorId }]);
    if (sql.includes("FROM curriculum_revisions r JOIN curricula c")) return rows([revision]);
    if (sql.includes("FROM ad_comp_groups g")) return rows([group]);
    return rows();
  });
  const clientQuery = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("FROM users")) return rows(options.revokedAtWrite ? [] : [{ id: actorId }]);
    if (sql === "COMMIT" && options.deferredFailure)
      throw Object.assign(new Error("competency_weight_total"), { code: "23514", constraint: "competency_active_total" });
    if (sql.includes("FROM curriculum_revisions r JOIN curricula c")) return rows([revision]);
    if (sql.startsWith("SELECT id,version FROM ad_comp_course_configs")) return rows(configExists ? [{ id: configId, version: configVersion }] : []);
    if (sql.startsWith("SELECT id,course_code")) return rows(configExists ? [{ id: configId, courseCode: "A101", status: configStatus, version: configVersion, note: activeData.note }] : []);
    if (sql.includes("s.id=ANY")) return rows((values?.[0] as string[]).map(id => ({ id, name: "Lập trình", isActive: true, groupActive: !options.inactiveGroup })));
    if (sql.startsWith("INSERT INTO ad_comp_course_configs")) { configExists = true; configVersion = skillId; configStatus = String(values?.[3]); return rows(); }
    if (sql.startsWith("UPDATE ad_comp_course_configs SET status='archived'")) { configStatus = "archived"; configVersion = String(values?.[1]); return rows(); }
    if (sql.startsWith("UPDATE ad_comp_course_configs SET status=")) { configStatus = String(values?.[1]); configVersion = String(values?.[3]); return rows(); }
    if (sql.startsWith("DELETE FROM ad_comp_course_links")) { savedLinks = []; return rows(); }
    if (sql.startsWith("INSERT INTO ad_comp_course_links")) {
      savedLinks.push({ skillId: String(values?.[1]), skillName: "Lập trình", groupId, groupName: group.name, isActive: true, weight: Number(values?.[2]) });
      return rows();
    }
    if (sql.includes("FROM ad_comp_course_links l JOIN ad_comp_skills cs")) return rows(savedLinks);
    if (sql.startsWith("INSERT INTO ad_comp_groups")) return rows([{ id: groupId }]);
    if (sql.startsWith("SELECT version FROM ad_comp_groups")) return rows([{ version }]);
    if (sql.startsWith("SELECT 1 FROM ad_comp_course_links")) return rows(options.groupUsed ? [{ used: true }] : []);
    if (sql.includes("FROM ad_comp_groups g")) return rows([group]);
    return rows();
  });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query: clientQuery, release });
  const pool = { query, connect } as unknown as DatabasePool;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user } as typeof req.session; next(); });
  app.use("/competencies", createCompetenciesRouter(options.missingDatabase ? undefined : pool, origin));
  return { app, query, connect, clientQuery, release };
}

describe("competency administration API", () => {
  it("requires an admin portal session, a database, and same-origin writes", async () => {
    await request(setup({ role: null }).app).get("/competencies/groups").expect(401);
    await request(setup({ role: "student" }).app).get("/competencies/groups").expect(403);
    await request(setup({ missingDatabase: true }).app).get("/competencies/groups").expect(503, { error: "database_required" });
    const denied = setup();
    await request(denied.app).post("/competencies/groups").set("Origin", "https://other.example").send(groupData).expect(403, { error: "invalid_origin" });
    expect(denied.query).not.toHaveBeenCalled();
    expect(denied.connect).not.toHaveBeenCalled();
  });

  it.each(["admin", "faculty_board", "department_head", "lecturer"] as const)("allows %s to edit academic groups and records an audit snapshot", async role => {
    const { app, clientQuery, release } = setup({ role });
    await request(app).post("/competencies/groups").set("Origin", origin).send(groupData).expect(201);
    expect(clientQuery.mock.calls.some(([sql]) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    const event = clientQuery.mock.calls.find(([sql]) => sql.includes("INSERT INTO ad_comp_events"));
    expect(JSON.parse(String(event?.[1]?.[3]))).toMatchObject({ id: groupId, name: groupData.name });
    expect(clientQuery).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rechecks the database role inside the transaction and rolls back a revoked actor", async () => {
    const { app, clientQuery } = setup({ revokedAtWrite: true });
    await request(app).post("/competencies/groups").set("Origin", origin).send(groupData).expect(403, { error: "insufficient_role" });
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(clientQuery.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO ad_comp_groups"))).toBe(false);
  });

  it("validates versions, confirmation and strict allocation input before a transaction", async () => {
    const { app, connect } = setup();
    await request(app).put(coursePath).set("Origin", origin).send(activeData).expect(400);
    await request(app).put(coursePath).set("Origin", origin).set("x-version", "new").send({ ...activeData, extra: true }).expect(400);
    await request(app).put(coursePath).set("Origin", origin).set("x-version", "new").send({ ...activeData, links: [{ skillId, weight: 1.1 }] }).expect(400);
    await request(app).delete(coursePath).set("Origin", origin).set("x-version", version).send({ confirmed: false }).expect(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects duplicate links and active totals below 100% before a transaction", async () => {
    const { app, connect } = setup();
    const duplicate = await request(app).put(coursePath).set("Origin", origin).set("x-version", "new")
      .send({ status: "active", links: [{ skillId, weight: 0.5 }, { skillId, weight: 0.5 }] }).expect(409);
    expect(duplicate.body.error).toBe("duplicate_skill_link");
    const incomplete = await request(app).put(coursePath).set("Origin", origin).set("x-version", "new")
      .send({ status: "active", links: [{ skillId, weight: 0.5 }] }).expect(422);
    expect(incomplete.body.error).toBe("weight_total_invalid");
    expect(connect).not.toHaveBeenCalled();
  });

  it("does not replace allocations when an existing configuration token is stale", async () => {
    const { app, clientQuery } = setup({ existingConfig: true });
    const result = await request(app).put(coursePath).set("Origin", origin).set("x-version", skillId).send(activeData).expect(409);
    expect(result.body.error).toBe("configuration_changed");
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(clientQuery.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM ad_comp_course_links"))).toBe(false);
  });

  it("blocks draft and active saves for repeated curriculum course rows", async () => {
    const { app, clientQuery } = setup({ duplicateCourse: true });
    for (const status of ["draft", "active"]) {
      const result = await request(app).put(coursePath).set("Origin", origin).set("x-version", "new").send({ ...activeData, status }).expect(409);
      expect(result.body.error).toBe("duplicate_curriculum_course");
    }
    expect(clientQuery.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO ad_comp_course_configs"))).toBe(false);
  });

  it("prevents active allocations from using inactive groups and blocks group deactivation while in use", async () => {
    const disabled = setup({ inactiveGroup: true });
    const allocation = await request(disabled.app).put(coursePath).set("Origin", origin).set("x-version", "new").send(activeData).expect(409);
    expect(allocation.body.error).toBe("group_unavailable");
    const occupied = setup({ groupUsed: true });
    const group = await request(occupied.app).patch(`/competencies/groups/${groupId}`).set("Origin", origin).set("x-version", version)
      .send({ ...groupData, isActive: false }).expect(409);
    expect(group.body.error).toBe("group_in_use");
    for (const instance of [disabled, occupied]) expect(instance.clientQuery).toHaveBeenCalledWith("ROLLBACK");
  });

  it("keeps explicit zero-weight links in the saved snapshot", async () => {
    const { app, clientQuery } = setup({ existingConfig: true });
    const result = await request(app).put(coursePath).set("Origin", origin).set("x-version", version)
      .send({ status: "active", links: [{ skillId, weight: 1 }, { skillId: secondSkillId, weight: 0 }] }).expect(200);
    expect(result.body.links).toHaveLength(2);
    expect(result.body.links.find((link: { skillId: string }) => link.skillId === secondSkillId).weight).toBe(0);
    expect(clientQuery.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO ad_comp_course_links"))).toHaveLength(2);
  });

  it("maps deferred database validation errors and rolls the whole save back", async () => {
    const { app, clientQuery, release } = setup({ existingConfig: true, deferredFailure: true });
    await request(app).put(coursePath).set("Origin", origin).set("x-version", version).send(activeData)
      .expect(422, { error: "weight_total_invalid" });
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("archives a configuration without deleting its allocations", async () => {
    const { app, clientQuery } = setup({ existingConfig: true });
    const result = await request(app).delete(coursePath).set("Origin", origin).set("x-version", version).send({ confirmed: true }).expect(200);
    expect(result.body.status).toBe("archived");
    expect(result.body.links).toHaveLength(1);
    expect(clientQuery.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM ad_comp_course_links"))).toBe(false);
    expect(clientQuery.mock.calls.some(([sql]) => sql.includes("INSERT INTO ad_comp_events"))).toBe(true);
  });
});
