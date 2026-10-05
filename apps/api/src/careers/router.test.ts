import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { createCareersRouter, fold } from "./router.js";

const adminId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const careerId = "33333333-3333-4333-8333-333333333333";
const version = "44444444-4444-4444-8444-444444444444";
const nextVersion = "55555555-5555-4555-8555-555555555555";
const fieldId = "66666666-6666-4666-8666-666666666666";
const fieldVersion = "77777777-7777-4777-8777-777777777777";
const nextFieldVersion = "88888888-8888-4888-8888-888888888888";
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

const student = { ...admin, role: "student" } satisfies AuthenticatedUser;

const career = {
  id: careerId,
  code: "NN004",
  nameVi: "Chuyên viên phân tích dữ liệu",
  nameEn: "Data Analyst",
  category: "data_ai",
  description: "Phân tích dữ liệu và xây dựng báo cáo.",
  skills: ["SQL", "Thống kê"],
  version,
  deletedAt: null,
};

const input = {
  nameVi: career.nameVi,
  nameEn: career.nameEn,
  category: career.category,
  description: career.description,
  skills: career.skills,
};

const field = {
  id: fieldId,
  code: "2",
  name: "Data and AI",
  description: "Data and machine learning roles.",
  version: fieldVersion,
};

const fieldInput = {
  name: "Custom data field",
  description: "A custom career field.",
};

type SetupOptions = {
  user?: AuthenticatedUser | null;
  rows?: unknown[];
  createRow?: unknown;
  updateRows?: unknown[];
  fields?: unknown[];
  createFieldRow?: unknown;
  updateFieldRows?: unknown[];
  fieldAvailable?: boolean;
  fieldInUse?: boolean;
  deleteFieldRows?: unknown[];
  fieldInsertError?: boolean;
  studentCareerRows?: unknown[];
};

function setup(options: SetupOptions = {}) {
  const user = options.user === null ? undefined : options.user ?? admin;
  const rows = options.rows ?? [career];
  const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK")
      return { rowCount: 0, rows: [] };
    if (sql.includes("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: adminId }] };
    if (sql.includes("SELECT id FROM career_fields"))
      return {
        rowCount: options.fieldAvailable === false ? 0 : 1,
        rows: options.fieldAvailable === false ? [] : [{ id: fieldId }],
      };
    if (sql.includes("SELECT code FROM career_fields"))
      return {
        rowCount: options.deleteFieldRows === undefined ? 1 : options.deleteFieldRows.length,
        rows: options.deleteFieldRows ?? [{ code: field.code }],
      };
    if (sql.includes("SELECT id FROM career_positions WHERE category"))
      return {
        rowCount: options.fieldInUse ? 1 : 0,
        rows: options.fieldInUse ? [{ id: careerId }] : [],
      };
    if (sql.includes("INSERT INTO career_fields")) {
      if (options.fieldInsertError) throw Object.assign(new Error("duplicate field"), { code: "23505" });
      return { rowCount: 1, rows: [options.createFieldRow ?? { ...field, ...fieldInput }] };
    }
    if (sql.includes("UPDATE career_fields SET name"))
      return {
        rowCount: options.updateFieldRows === undefined ? 1 : options.updateFieldRows.length,
        rows: options.updateFieldRows ?? [{ ...field, name: "Updated field", version: nextFieldVersion }],
      };
    if (sql.includes("UPDATE career_fields SET deleted_at")) return { rowCount: 1, rows: [] };
    if (sql.includes("INSERT INTO career_positions"))
      return { rowCount: 1, rows: [options.createRow ?? career] };
    if (sql.includes("INSERT INTO career_skills(name)")) {
      const name = String(params?.[0] ?? "");
      return { rowCount: 1, rows: [{ id: `skill-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` }] };
    }
    if (sql.includes("INSERT INTO career_requirements")) return { rowCount: 1, rows: [] };
    if (sql.includes("UPDATE career_positions SET name_vi"))
      return { rowCount: options.updateRows === undefined ? 1 : options.updateRows.length, rows: options.updateRows ?? [career] };
    return { rowCount: 1, rows: [] };
  });
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: adminId }] };
    if (sql.includes("FROM career_positions c JOIN career_fields f ON f.code=c.category")) {
      const studentCareerRows = options.studentCareerRows ?? [];
      return { rowCount: studentCareerRows.length, rows: studentCareerRows };
    }
    if (sql.includes("FROM career_fields WHERE deleted_at IS NULL ORDER BY code::bigint,id"))
      return { rowCount: options.fields?.length ?? 0, rows: options.fields ?? [] };
    if (sql.includes("FROM career_positions WHERE deleted_at IS NULL")) return { rowCount: rows.length, rows };
    return { rowCount: 1, rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query: clientQuery, release });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user } as typeof req.session;
    next();
  });
  app.use("/careers", createCareersRouter({ query, connect } as unknown as DatabasePool, origin));
  app.use("/student-careers", createCareersRouter({ query, connect } as unknown as DatabasePool, origin, true));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "unexpected_error" });
  });
  return { app, query, connect, clientQuery, release };
}

describe("career catalog API", () => {
  it("folds Vietnamese search terms and passes category filters to the database", async () => {
    const { app, query } = setup();
    expect(fold("Kỹ sư Điện toán đám mây")).toBe("ky su dien toan dam may");
    const response = await request(app)
      .get("/careers?q=phân%20tích&category=data_ai")
      .expect(200);
    expect(response.body).toEqual({ items: [career] });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("career_positions WHERE deleted_at IS NULL"),
      ["phan tich", "data_ai", ""],
    );
  });

  it("combines skill-link status with search/category and rejects unknown statuses", async () => {
    const { app, query } = setup();
    for (const status of ["linked", "unlinked"]) {
      await request(app).get(`/careers?q=SQL&category=data_ai&skillLink=${status}`).expect(200);
      expect(query).toHaveBeenCalledWith(expect.stringContaining("r.deleted_at IS NULL AND s.deleted_at IS NULL"),
        ["sql", "data_ai", status]);
    }
    await request(app).get("/careers?skillLink=unknown").expect(400, { error: "invalid_career" });
    expect(query.mock.calls.filter(([sql]) => sql.includes("FROM career_positions WHERE deleted_at IS NULL"))).toHaveLength(2);
  });

  it("lists active career fields with position counts and accepts unknown valid category filters", async () => {
    const fieldRows = [{ ...field, positionCount: 3 }];
    const { app, query } = setup({ fields: fieldRows, rows: [] });
    await request(app).get("/careers/fields").expect(200, { items: fieldRows });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FROM career_fields WHERE deleted_at IS NULL ORDER BY code::bigint,id"),
    );
    const fieldsQuery = query.mock.calls.find(([sql]) =>
      String(sql).includes("FROM career_fields WHERE deleted_at IS NULL ORDER BY code::bigint,id"),
    );
    expect(fieldsQuery?.[0]).toContain("AS \"positionCount\"");
    await request(app).get("/careers?category=valid-but-unknown").expect(200, { items: [] });
  });

  it("exposes dynamic fields to students without granting field mutations", async () => {
    const fieldRows = [{ ...field, positionCount: 0 }];
    const { app, connect } = setup({ user: student, fields: fieldRows });
    await request(app).get("/student-careers/fields").expect(200, { items: fieldRows });
    await request(app)
      .post("/student-careers/fields")
      .set("Origin", origin)
      .send(fieldInput)
      .expect(403, { error: "invalid_origin" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("lists active fields and careers to authenticated students with dynamic category names", async () => {
    const fieldRows = [{ ...field, positionCount: 1 }];
    const studentCareer = { ...career, categoryName: field.name };
    const { app, query } = setup({ user: student, fields: fieldRows, rows: [studentCareer] });

    await request(app).get("/student-careers/fields").expect(200, { items: fieldRows });
    await request(app)
      .get("/student-careers?q=K%C3%BD%20s%C6%B0&category=data_ai")
      .expect(200, { items: [studentCareer] });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FROM career_positions WHERE deleted_at IS NULL"),
      ["ky su", "data_ai", ""],
    );
  });

  it("returns canonical linked and plain requirements without admin-only career fields", async () => {
    const studentCareer = {
      id: careerId,
      code: career.code,
      nameVi: career.nameVi,
      nameEn: career.nameEn,
      category: career.category,
      categoryName: field.name,
      description: career.description,
      requirements: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "SQL query design",
          description: "Query relational sources.",
          skillName: "SQL",
          level: "advanced",
          isRequired: true,
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          title: "Portfolio project",
          description: "Build a small data project.",
          skillName: null,
          level: "unspecified",
          isRequired: false,
        },
      ],
    };
    const { app, query } = setup({ user: student, studentCareerRows: [studentCareer] });

    await request(app).get(`/student-careers/${careerId}`).expect(200, studentCareer);

    const detailCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("FROM career_positions c JOIN career_fields f ON f.code=c.category"),
    );
    const detailSql = String(detailCall?.[0]);
    expect(detailCall?.[1]).toEqual([careerId]);
    expect(detailSql).toContain("r.deleted_at IS NULL");
    expect(detailSql).toContain("LEFT JOIN career_skills s ON s.id=r.skill_id");
    expect(detailSql).toContain("'skillName',s.name");
    expect(detailSql).toContain("c.deleted_at IS NULL AND f.deleted_at IS NULL");
    expect(detailSql).not.toMatch(/studentCount|version|count\s*\(/i);
    expect(studentCareer.requirements[0]).toMatchObject({ title: "SQL query design", skillName: "SQL", isRequired: true });
    expect(studentCareer.requirements[1]).toMatchObject({ title: "Portfolio project", skillName: null, isRequired: false });
  });

  it("requires authentication and returns safe not-found/validation responses for student detail", async () => {
    await request(setup({ user: null }).app)
      .get(`/student-careers/${careerId}`)
      .expect(401, { error: "authentication_required" });

    const missing = setup({ user: student });
    await request(missing.app)
      .get(`/student-careers/${careerId}`)
      .expect(404, { error: "career_not_found" });
    const detailSql = String(missing.query.mock.calls.find(([sql]) =>
      String(sql).includes("FROM career_positions c JOIN career_fields f ON f.code=c.category"),
    )?.[0]);
    expect(detailSql).toContain("c.deleted_at IS NULL AND f.deleted_at IS NULL");

    const invalid = setup({ user: student });
    await request(invalid.app)
      .get("/student-careers/not-a-uuid")
      .expect(400, { error: "invalid_career" });
    await request(invalid.app)
      .get(`/student-careers/${careerId}?unexpected=1`)
      .expect(400, { error: "invalid_career" });
    expect(invalid.query.mock.calls.some(([sql]) =>
      String(sql).includes("FROM career_positions c JOIN career_fields f ON f.code=c.category"),
    )).toBe(false);
  });

  it("denies student career writes even for a valid same-origin request", async () => {
    const { app, connect } = setup({ user: student });
    await request(app)
      .post("/student-careers")
      .set("Origin", origin)
      .send(input)
      .expect(403, { error: "invalid_origin" });
    await request(app)
      .patch(`/student-careers/${careerId}`)
      .set("Origin", origin)
      .set("x-version", version)
      .send(input)
      .expect(403, { error: "invalid_origin" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated/student admin access, cross-origin writes, and malformed filters", async () => {
    await request(setup({ user: null }).app).get("/careers").expect(401);
    await request(setup({ user: student }).app).get("/careers").expect(403);
    const crossOrigin = setup();
    await request(crossOrigin.app)
      .post("/careers")
      .set("Origin", "https://evil.example")
      .send(input)
      .expect(403);
    expect(crossOrigin.connect).not.toHaveBeenCalled();
    await request(setup({ rows: [] }).app).get("/careers?category=unknown").expect(200, { items: [] });
    await request(setup().app).get("/careers?category=%21invalid").expect(400);
    await request(setup().app).get("/careers?extra=1").expect(400);
  });

  it("creates a validated catalog entry and maps duplicate-style input errors before writing", async () => {
    const created = { ...career, code: "NN021" };
    const { app, clientQuery, release } = setup({ createRow: created });
    await request(app)
      .post("/careers")
      .set("Origin", origin)
      .send(input)
      .expect(201, created);
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO career_positions(name_vi,name_en"),
      [input.nameVi, input.nameEn, input.category, input.description, input.skills, expect.any(String)]);
    const createSql = clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(createSql.findIndex((sql) => sql.includes("career_fields") && sql.includes("FOR SHARE")))
      .toBeLessThan(createSql.findIndex((sql) => sql.includes("INSERT INTO career_positions")));
    expect(release).toHaveBeenCalled();

    const invalid = setup();
    await request(invalid.app)
      .post("/careers")
      .set("Origin", origin)
      .send({ ...input, nameVi: " " })
      .expect(400, { error: "invalid_career" });
    expect(invalid.connect).not.toHaveBeenCalled();
  });

  it("ignores legacy career codes on create/edit and searches with the assigned code", async () => {
    const create = setup();
    await request(create.app).post("/careers").set("Origin", origin)
      .send({ ...input, code: "manual-code" }).expect(201, career);
    const insert = create.clientQuery.mock.calls.find(([sql]) => sql.includes("INSERT INTO career_positions"));
    expect(insert?.[0]).not.toContain("(code,");
    expect(insert?.[1]).not.toContain("manual-code");
    const update = setup();
    await request(update.app).patch(`/careers/${careerId}`).set("Origin", origin).set("x-version", version)
      .send({ ...input, code: "NN999" }).expect(200, career);
    const changed = update.clientQuery.mock.calls.find(([sql]) => sql.includes("UPDATE career_positions SET name_vi"));
    expect(changed?.[0]).not.toContain("code=");
    expect(changed?.[1]).not.toContain("NN999");
    expect(update.clientQuery).toHaveBeenCalledWith("UPDATE career_positions SET search_text=$2 WHERE id=$1",
      [careerId, fold([career.code, input.nameVi, input.nameEn, input.description, ...career.skills].join(" "))]);
    await request(update.app).get("/careers?q=NN004").expect(200);
    expect(update.query).toHaveBeenCalledWith(expect.stringContaining("strpos(search_text,$1)"), ["nn004", "", ""]);
  });

  it("maps an optimistic version miss to a conflict without returning a row", async () => {
    const { app, clientQuery } = setup({ updateRows: [] });
    await request(app)
      .patch(`/careers/${careerId}`)
      .set("Origin", origin)
      .set("x-version", nextVersion)
      .send(input)
      .expect(409, { error: "career_changed" });
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE career_positions SET name_vi"), expect.any(Array));
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(clientQuery).toHaveBeenCalledWith(
      "SELECT id FROM career_fields WHERE code=$1 AND deleted_at IS NULL FOR SHARE",
      [career.category],
    );
  });

  it("creates, updates immutably, and soft-deletes an unused field in transactions", async () => {
    const createdField = { ...field, ...fieldInput, code: "7" };
    const create = setup({ createFieldRow: createdField });
    await request(create.app)
      .post("/careers/fields")
      .set("Origin", origin)
      .send(fieldInput)
      .expect(201, createdField);
    expect(create.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO career_fields(name,description)"),
      [fieldInput.name, fieldInput.description],
    );
    expect(create.clientQuery).toHaveBeenCalledWith("COMMIT");
    expect(create.release).toHaveBeenCalled();

    const updatedField = { ...createdField, name: "Updated field", version: nextFieldVersion };
    const update = setup({ updateFieldRows: [updatedField] });
    await request(update.app)
      .patch(`/careers/fields/${fieldId}`)
      .set("Origin", origin)
      .set("x-version", fieldVersion)
      .send({ name: updatedField.name, description: updatedField.description })
      .expect(200, updatedField);
    const updateCall = update.clientQuery.mock.calls.find(([sql]) => String(sql).includes("UPDATE career_fields SET name"));
    expect(updateCall?.[0]).not.toContain("code=");
    expect(updateCall?.[1]).toEqual([fieldId, fieldVersion, updatedField.name, updatedField.description, expect.any(String)]);

    const remove = setup();
    await request(remove.app)
      .delete(`/careers/fields/${fieldId}`)
      .set("Origin", origin)
      .set("x-version", fieldVersion)
      .send({ confirmed: true })
      .expect(200, { deleted: true });
    const deleteSql = remove.clientQuery.mock.calls.map(([sql]) => String(sql));
    const lockIndex = deleteSql.findIndex((sql) => sql.includes("SELECT code FROM career_fields") && sql.includes("FOR UPDATE"));
    const usageIndex = deleteSql.findIndex((sql) => sql.includes("SELECT id FROM career_positions WHERE category"));
    const softDeleteIndex = deleteSql.findIndex((sql) => sql.includes("UPDATE career_fields SET deleted_at"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(usageIndex).toBeGreaterThan(lockIndex);
    expect(softDeleteIndex).toBeGreaterThan(usageIndex);
    expect(remove.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE career_fields SET deleted_at"),
      [fieldId, expect.any(String)],
    );
  });

  it("discards legacy manually supplied codes and returns the database-assigned field number", async () => {
    const createdField = { ...field, ...fieldInput, code: "7" };
    const create = setup({ createFieldRow: createdField });
    await request(create.app).post("/careers/fields").set("Origin", origin)
      .send({ ...fieldInput, code: "legacy_field" }).expect(201, createdField);
    expect(create.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO career_fields(name,description)"),
      [fieldInput.name, fieldInput.description],
    );
  });

  it("protects field writes with admin, origin, validation, duplicate and optimistic-version checks", async () => {
    const unauthenticated = setup({ user: null });
    await request(unauthenticated.app).get("/careers/fields").expect(401);
    await request(setup({ user: student }).app).get("/careers/fields").expect(403);

    const crossOrigin = setup();
    await request(crossOrigin.app)
      .post("/careers/fields")
      .set("Origin", "https://evil.example")
      .send(fieldInput)
      .expect(403, { error: "invalid_origin" });
    expect(crossOrigin.connect).not.toHaveBeenCalled();

    const invalid = setup();
    await request(invalid.app)
      .post("/careers/fields")
      .set("Origin", origin)
      .send({ ...fieldInput, code: "Invalid Code" })
      .expect(400, { error: "invalid_field" });
    expect(invalid.connect).not.toHaveBeenCalled();

    const duplicate = setup({ fieldInsertError: true });
    await request(duplicate.app)
      .post("/careers/fields")
      .set("Origin", origin)
      .send(fieldInput)
      .expect(409, { error: "field_exists" });
    expect(duplicate.clientQuery).toHaveBeenCalledWith("ROLLBACK");

    const stale = setup({ updateFieldRows: [] });
    await request(stale.app)
      .patch(`/careers/fields/${fieldId}`)
      .set("Origin", origin)
      .set("x-version", fieldVersion)
      .send({ name: field.name, description: field.description })
      .expect(409, { error: "field_changed" });
    expect(stale.clientQuery).toHaveBeenCalledWith("ROLLBACK");

    const immutableCode = setup();
    await request(immutableCode.app)
      .patch(`/careers/fields/${fieldId}`)
      .set("Origin", origin)
      .set("x-version", fieldVersion)
      .send({ code: "renamed", name: field.name, description: field.description })
      .expect(400, { error: "invalid_field" });
    expect(immutableCode.connect).not.toHaveBeenCalled();
  });

  it("rejects field deletion while active positions use it and refuses unavailable fields for career writes", async () => {
    const used = setup({ fieldInUse: true });
    await request(used.app)
      .delete(`/careers/fields/${fieldId}`)
      .set("Origin", origin)
      .set("x-version", fieldVersion)
      .send({ confirmed: true })
      .expect(409, { error: "field_in_use" });
    expect(used.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(used.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE career_fields SET deleted_at"),
      expect.any(Array),
    );

    const unavailableCreate = setup({ fieldAvailable: false });
    await request(unavailableCreate.app)
      .post("/careers")
      .set("Origin", origin)
      .send(input)
      .expect(409, { error: "field_unavailable" });
    expect(unavailableCreate.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO career_positions"),
      expect.any(Array),
    );

    const unavailableUpdate = setup({ fieldAvailable: false });
    await request(unavailableUpdate.app)
      .patch(`/careers/${careerId}`)
      .set("Origin", origin)
      .set("x-version", version)
      .send(input)
      .expect(409, { error: "field_unavailable" });
    expect(unavailableUpdate.clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE career_positions SET name_vi"),
      expect.any(Array),
    );
  });
});
