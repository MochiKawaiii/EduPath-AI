import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { createCareersRouter } from "./router.js";

const adminId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const careerA = "33333333-3333-4333-8333-333333333333";
const careerB = "44444444-4444-4444-8444-444444444444";
const skillA = "55555555-5555-4555-8555-555555555555";
const skillB = "66666666-6666-4666-8666-666666666666";
const requirementA = "77777777-7777-4777-8777-777777777777";
const versionA = "88888888-8888-4888-8888-888888888888";
const nextVersion = "99999999-9999-4999-8999-999999999999";
const origin = "https://edupath.example";

const admin = {
  userId: adminId,
  identityKey: `${tenantId}:${adminId}`,
  tenantId,
  objectId: adminId,
  name: "Admin User",
  email: "admin@example.edu",
  username: "admin@example.edu",
  role: "admin",
  signedInAt: new Date(0).toISOString(),
} satisfies AuthenticatedUser;
const faculty = { ...admin, role: "faculty_board" } satisfies AuthenticatedUser;
const staffRoles = ["faculty_board", "department_head", "lecturer"] as const;

type Requirement = {
  id: string;
  career_position_id: string;
  skill_id: string | null;
  title: string;
  description: string;
  level: string;
  is_required: boolean;
  version: string;
  deleted_at: Date | null;
};
type Options = {
  user?: AuthenticatedUser | null;
  revokedInTransaction?: boolean;
  duplicateInsert?: boolean;
  existingRequirements?: Requirement[];
  existingSkills?: Array<{ id: string; name: string }>;
  availableCareers?: string[];
};

const careerDetails = {
  [careerA]: { code: "data-analyst", name_vi: "Chuyên viên phân tích dữ liệu", name_en: "Data Analyst", description: "Analyze data", category: "data_ai" },
  [careerB]: { code: "frontend", name_vi: "Lập trình giao diện", name_en: "Frontend Developer", description: "Build web apps", category: "software" },
};
const fields = { data_ai: "Dữ liệu và AI", software: "Phần mềm" };

function setup(options: Options = {}) {
  const user = options.user === null ? undefined : options.user ?? admin;
  const availableCareers = new Set(options.availableCareers ?? [careerA, careerB]);
  const skills = new Map((options.existingSkills ?? [{ id: skillA, name: "SQL" }]).map((skill) => [skill.id, { ...skill }]));
  const requirements = new Map((options.existingRequirements ?? []).map((item) => [item.id, { ...item }]));
  const legacySkills = new Map<string, string[]>();
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("SELECT id FROM users")) {
      const roleAllowed = user?.role === "admin" || !sql.includes("COALESCE(role_override,role)") ||
        (params?.[2] as string[] | undefined)?.includes(user?.role ?? "");
      return { rowCount: user && roleAllowed ? 1 : 0, rows: user && roleAllowed ? [{ id: adminId }] : [] };
    }
    if (sql.includes("SELECT id,name FROM career_skills")) {
      const rows = [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
      return { rowCount: rows.length, rows };
    }
    if (sql.includes("FROM career_requirements r JOIN career_positions")) {
      const rows = [...requirements.values()].filter((item) => !item.deleted_at).map((item) => toRow(item, skills));
      return { rowCount: rows.length, rows };
    }
    if (sql.includes("FROM career_requirements r JOIN career_positions c")) {
      const item = requirements.get(String(params?.[0]));
      const rows = item && !item.deleted_at ? [toRow(item, skills)] : [];
      return { rowCount: rows.length, rows };
    }
    return { rowCount: 1, rows: [] };
  });
  const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] };
    if (sql.includes("SELECT id FROM users")) {
      const allowedRoles = (params?.[2] as string[] | undefined) ?? ["admin"];
      const allowed = !!user && allowedRoles.includes(user.role) && !options.revokedInTransaction;
      return { rowCount: allowed ? 1 : 0, rows: allowed ? [{ id: adminId }] : [] };
    }
    if (sql.includes("SELECT career_position_id FROM career_requirements")) {
      const item = requirements.get(String(params?.[0]));
      const found = item && !item.deleted_at && item.version === params?.[1] ? [item] : [];
      return { rowCount: found.length, rows: found.map((row) => ({ career_position_id: row.career_position_id })) };
    }
    if (sql.includes("SELECT id FROM career_positions WHERE id=ANY")) {
      const ids = params?.[0] as string[];
      const rows = ids.filter((id) => availableCareers.has(id)).map((id) => ({ id }));
      return { rowCount: rows.length, rows };
    }
    if (sql.includes("SELECT id FROM career_skills WHERE id=$1")) {
      const skill = skills.get(String(params?.[0]));
      return { rowCount: skill ? 1 : 0, rows: skill ? [{ id: skill.id }] : [] };
    }
    if (sql.includes("INSERT INTO career_skills(name)")) {
      const name = String(params?.[0]);
      const prior = [...skills.values()].find((item) => item.name.toLowerCase() === name.toLowerCase());
      if (prior) return { rowCount: 1, rows: [{ id: prior.id }] };
      const id = name.toLowerCase() === "react" ? skillB : `skill-${skills.size}`;
      skills.set(id, { id, name });
      return { rowCount: 1, rows: [{ id }] };
    }
    if (sql.includes("INSERT INTO career_requirements")) {
      if (options.duplicateInsert) throw Object.assign(new Error("duplicate requirement"), { code: "23505" });
      const [id, career_position_id, skill_id, title, description, level, is_required] = params as [string, string, string | null, string, string, string, boolean];
      requirements.set(id, { id, career_position_id, skill_id, title, description, level, is_required, version: versionA, deleted_at: null });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("UPDATE career_requirements SET career_position_id")) {
      const [id, version, career_position_id, skill_id, title, description, level, is_required, newVersion] = params as [string, string, string, string | null, string, string, string, boolean, string];
      const item = requirements.get(id);
      if (!item || item.version !== version || item.deleted_at) return { rowCount: 0, rows: [] };
      Object.assign(item, { career_position_id, skill_id, title, description, level, is_required, version: newVersion });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("UPDATE career_requirements SET deleted_at")) {
      const [id, version, newVersion] = params as [string, string, string];
      const item = requirements.get(id);
      if (!item || item.version !== version || item.deleted_at) return { rowCount: 0, rows: [] };
      Object.assign(item, { deleted_at: new Date(), version: newVersion });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("SELECT code,name_vi,name_en,description FROM career_positions")) {
      const row = careerDetails[String(params?.[0]) as keyof typeof careerDetails];
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }
    if (sql.includes("SELECT s.name FROM career_requirements")) {
      const rows = [...requirements.values()].filter((item) => item.career_position_id === params?.[0] && !item.deleted_at && item.skill_id).map((item) => ({ name: skills.get(item.skill_id!)!.name }));
      return { rowCount: rows.length, rows };
    }
    if (sql.includes("UPDATE career_positions SET skills=$2")) {
      legacySkills.set(String(params?.[0]), params?.[1] as string[]);
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("FROM career_requirements r JOIN career_positions c")) {
      const item = requirements.get(String(params?.[0]));
      const rows = item && !item.deleted_at ? [toRow(item, skills)] : [];
      return { rowCount: rows.length, rows };
    }
    return { rowCount: 1, rows: [] };
  });
  const connect = vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user } as typeof req.session;
    next();
  });
  app.use("/careers", createCareersRouter({ query, connect } as unknown as DatabasePool, origin));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "unexpected_error" });
  });
  return { app, query, connect, clientQuery, skills, requirements, legacySkills };
}

function toRow(item: Requirement, skills: Map<string, { id: string; name: string }>) {
  const career = careerDetails[item.career_position_id as keyof typeof careerDetails];
  return {
    id: item.id,
    careerPositionId: item.career_position_id,
    skillId: item.skill_id,
    title: item.title,
    description: item.description,
    level: item.level,
    isRequired: item.is_required,
    version: item.version,
    careerName: career.name_vi,
    careerNameEn: career.name_en,
    category: career.category,
    categoryName: fields[career.category as keyof typeof fields],
    skillName: item.skill_id ? skills.get(item.skill_id)?.name ?? null : null,
  };
}

const requirementInput = {
  careerPositionId: careerA,
  title: "React fundamentals",
  description: "Build interactive interfaces",
  skillId: null,
  skillName: "React",
  level: "intermediate",
  isRequired: true,
};
const activeRequirement: Requirement = {
  id: requirementA,
  career_position_id: careerA,
  skill_id: skillA,
  title: "SQL",
  description: "Query relational data",
  level: "advanced",
  is_required: true,
  version: versionA,
  deleted_at: null,
};

describe("career requirements API", () => {
  it("lists active requirements using every structured filter and accent-insensitive text search", async () => {
    const first = { ...activeRequirement, title: "Kỹ năng số", description: "Phân tích dữ liệu" };
    const second = { ...activeRequirement, id: careerB, career_position_id: careerB, title: "React", skill_id: skillB };
    const { app, query } = setup({ existingSkills: [{ id: skillA, name: "SQL" }, { id: skillB, name: "React" }], existingRequirements: [first, second] });
    const response = await request(app)
      .get(`/careers/requirements?q=ky%20nang&careerPositionId=${careerA}&category=data_ai&skillId=${skillA}&level=advanced&kind=skill&priority=required`)
      .expect(200);
    expect(response.body.items).toEqual([toRow(first, new Map([[skillA, { id: skillA, name: "SQL" }], [skillB, { id: skillB, name: "React" }]]))]);
    const listCall = query.mock.calls.find(([sql]) => String(sql).includes("FROM career_requirements r JOIN career_positions"));
    expect(listCall?.[0]).toContain("r.deleted_at IS NULL AND c.deleted_at IS NULL AND f.deleted_at IS NULL");
    expect(listCall?.[1]).toEqual([careerA, "data_ai", skillA, "advanced", "skill", "required"]);
  });

  it("creates, moves, and deletes requirements while refreshing both legacy career skill lists", async () => {
    const { app, clientQuery, legacySkills, requirements } = setup({ existingRequirements: [activeRequirement] });
    const created = await request(app).post("/careers/requirements").set("Origin", origin).send(requirementInput).expect(201);
    expect(created.body).toMatchObject({ ...requirementInput, skillId: skillB, skillName: "React", careerName: "Chuyên viên phân tích dữ liệu" });
    expect(legacySkills.get(careerA)).toEqual(["SQL", "React"]);
    const createLock = clientQuery.mock.calls.find(([sql]) => String(sql).includes("FROM career_positions WHERE id=ANY"));
    expect(createLock?.[1]).toEqual([[careerA]]);

    const edited = await request(app)
      .patch(`/careers/requirements/${created.body.id}`)
      .set("Origin", origin)
      .set("x-version", created.body.version)
      .send({ ...requirementInput, careerPositionId: careerB, skillId: skillB, skillName: "" })
      .expect(200);
    expect(edited.body.careerPositionId).toBe(careerB);
    expect(legacySkills.get(careerA)).toEqual(["SQL"]);
    expect(legacySkills.get(careerB)).toEqual(["React"]);
    const lockCalls = clientQuery.mock.calls.filter(([sql]) => String(sql).includes("FROM career_positions WHERE id=ANY"));
    expect(lockCalls[1]?.[1]).toEqual([[careerA, careerB].sort()]);

    await request(app)
      .delete(`/careers/requirements/${created.body.id}`)
      .set("Origin", origin)
      .set("x-version", edited.body.version)
      .send({ confirmed: true })
      .expect(200, { deleted: true });
    expect(legacySkills.get(careerB)).toEqual([]);
    expect(requirements.get(created.body.id)?.deleted_at).toBeInstanceOf(Date);
  });

  it.each(staffRoles)("allows %s to add requirements after the transaction recheck", async (role) => {
    const staff = { ...admin, role } as AuthenticatedUser;
    const allowed = setup({ user: staff });
    await request(allowed.app)
      .post("/careers/requirements")
      .set("Origin", origin)
      .send(requirementInput)
      .expect(201);
    expect(allowed.clientQuery.mock.calls.find(([sql]) => String(sql).includes("SELECT id FROM users"))?.[1]?.[2])
      .toEqual(["admin", "faculty_board", "department_head", "lecturer"]);
    expect(allowed.clientQuery).toHaveBeenCalledWith("COMMIT");
  });

  it("protects requirement writes with authentication, origin, revoked-role recheck, validation, and optimistic versions", async () => {
    await request(setup({ user: null }).app).get("/careers/requirements").expect(401);
    const facultyRead = setup({ user: faculty });
    await request(facultyRead.app).get("/careers/requirements").expect(200);
    const revoked = setup({ user: faculty, revokedInTransaction: true });
    await request(revoked.app).post("/careers/requirements").set("Origin", origin).send(requirementInput).expect(403, { error: "insufficient_role" });
    expect(revoked.clientQuery).toHaveBeenCalledWith("ROLLBACK");

    const crossOrigin = setup();
    await request(crossOrigin.app).post("/careers/requirements").set("Origin", "https://evil.example").send(requirementInput).expect(403, { error: "invalid_origin" });
    expect(crossOrigin.connect).not.toHaveBeenCalled();
    const invalid = setup();
    await request(invalid.app).post("/careers/requirements").set("Origin", origin).send({ ...requirementInput, level: "expert" }).expect(400, { error: "invalid_requirement" });
    expect(invalid.connect).not.toHaveBeenCalled();
    const stale = setup();
    await request(stale.app).patch(`/careers/requirements/${requirementA}`).set("Origin", origin).set("x-version", nextVersion).send(requirementInput).expect(409, { error: "requirement_changed" });
    expect(stale.clientQuery).toHaveBeenCalledWith("ROLLBACK");
  });

  it("maps duplicate links and missing parent/skill references to stable API conflicts", async () => {
    const duplicate = setup({ duplicateInsert: true });
    await request(duplicate.app).post("/careers/requirements").set("Origin", origin).send(requirementInput).expect(409, { error: "requirement_exists" });
    expect(duplicate.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    await request(setup({ availableCareers: [] }).app).post("/careers/requirements").set("Origin", origin).send(requirementInput).expect(404, { error: "career_not_found" });
    await request(setup().app).post("/careers/requirements").set("Origin", origin).send({ ...requirementInput, skillId: careerB, skillName: "" }).expect(404, { error: "skill_not_found" });
  });
});
