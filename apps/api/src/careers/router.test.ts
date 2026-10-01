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
  code: "data-analyst",
  nameVi: "Chuyên viên phân tích dữ liệu",
  nameEn: "Data Analyst",
  category: "data_ai",
  description: "Phân tích dữ liệu và xây dựng báo cáo.",
  skills: ["SQL", "Thống kê"],
  version,
  deletedAt: null,
};

const input = {
  code: "data-analyst",
  nameVi: career.nameVi,
  nameEn: career.nameEn,
  category: career.category,
  description: career.description,
  skills: career.skills,
};

const field = {
  id: fieldId,
  code: "data_ai",
  name: "Data and AI",
  description: "Data and machine learning roles.",
  version: fieldVersion,
};

const fieldInput = {
  code: "custom_data",
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
    if (sql.includes("UPDATE career_positions SET code"))
      return { rowCount: options.updateRows === undefined ? 1 : options.updateRows.length, rows: options.updateRows ?? [career] };
    return { rowCount: 1, rows: [] };
  });
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: adminId }] };
    if (sql.includes("FROM career_fields WHERE deleted_at IS NULL ORDER BY name,id"))
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
      ["phan tich", "data_ai"],
    );
  });

  it("lists active career fields with position counts and accepts unknown valid category filters", async () => {
    const fieldRows = [{ ...field, positionCount: 3 }];
    const { app, query } = setup({ fields: fieldRows, rows: [] });
    await request(app).get("/careers/fields").expect(200, { items: fieldRows });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FROM career_fields WHERE deleted_at IS NULL ORDER BY name,id"),
    );
    const fieldsQuery = query.mock.calls.find(([sql]) =>
      String(sql).includes("FROM career_fields WHERE deleted_at IS NULL ORDER BY name,id"),
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
    const created = { ...career, code: "analytics-engineer" };
    const { app, clientQuery, release } = setup({ createRow: created });
    await request(app)
      .post("/careers")
      .set("Origin", origin)
      .send({ ...input, code: created.code })
      .expect(201, created);
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO career_positions"), expect.any(Array));
    const createSql = clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(createSql.findIndex((sql) => sql.includes("career_fields") && sql.includes("FOR SHARE")))
      .toBeLessThan(createSql.findIndex((sql) => sql.includes("INSERT INTO career_positions")));
    expect(release).toHaveBeenCalled();

    const invalid = setup();
    await request(invalid.app)
      .post("/careers")
      .set("Origin", origin)
      .send({ ...input, code: "Not valid" })
      .expect(400, { error: "invalid_career" });
    expect(invalid.connect).not.toHaveBeenCalled();
  });

  it("maps an optimistic version miss to a conflict without returning a row", async () => {
    const { app, clientQuery } = setup({ updateRows: [] });
    await request(app)
      .patch(`/careers/${careerId}`)
      .set("Origin", origin)
      .set("x-version", nextVersion)
      .send(input)
      .expect(409, { error: "career_changed" });
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE career_positions SET code"), expect.any(Array));
    expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(clientQuery).toHaveBeenCalledWith(
      "SELECT id FROM career_fields WHERE code=$1 AND deleted_at IS NULL FOR SHARE",
      [career.category],
    );
  });

  it("creates, updates immutably, and soft-deletes an unused field in transactions", async () => {
    const createdField = { ...field, ...fieldInput };
    const create = setup({ createFieldRow: createdField });
    await request(create.app)
      .post("/careers/fields")
      .set("Origin", origin)
      .send(fieldInput)
      .expect(201, createdField);
    expect(create.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO career_fields(code,name,description)"),
      [fieldInput.code, fieldInput.name, fieldInput.description],
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
      expect.stringContaining("UPDATE career_positions SET code"),
      expect.any(Array),
    );
  });
});
