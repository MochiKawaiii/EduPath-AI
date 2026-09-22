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

type SetupOptions = {
  user?: AuthenticatedUser | null;
  rows?: unknown[];
  createRow?: unknown;
  updateRows?: unknown[];
};

function setup(options: SetupOptions = {}) {
  const user = options.user === null ? undefined : options.user ?? admin;
  const rows = options.rows ?? [career];
  const clientQuery = vi.fn(async (sql: string) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK")
      return { rowCount: 0, rows: [] };
    if (sql.includes("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: adminId }] };
    if (sql.includes("INSERT INTO career_positions"))
      return { rowCount: 1, rows: [options.createRow ?? career] };
    if (sql.includes("UPDATE career_positions SET code"))
      return { rowCount: options.updateRows === undefined ? 1 : options.updateRows.length, rows: options.updateRows ?? [career] };
    return { rowCount: 1, rows: [] };
  });
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: adminId }] };
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
    await request(setup().app).get("/careers?category=unknown").expect(400);
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
  });
});
