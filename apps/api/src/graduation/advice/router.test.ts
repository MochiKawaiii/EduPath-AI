import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../auth/types.js";
import type { DatabasePool } from "../../db/pool.js";
import type { StudentGraduation } from "../student-graduation.js";
import type { GraduationAdviceRow } from "./jobs.js";
import { createGraduationAdviceRouter } from "./router.js";
import { syntheticGraduation, unevaluatedGraduation } from "./test-fixture.js";

// Synthetic K29 data only (fixtures/synthetic-k29.json); no real student record.
const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const origin = "https://edupath.example";
const ADVICE = "44444444-4444-4444-8444-444444444444";
const graduation = syntheticGraduation();
const OLD = "f".repeat(64);

const student = {
  userId: studentId, identityKey: `${tenantId}:${studentId}`, tenantId, objectId: studentId, name: "Student User",
  email: "student@example.edu", username: "student@example.edu", role: "student", signedInAt: new Date(0).toISOString(),
} satisfies AuthenticatedUser;

const output = { summary: "Tóm tắt.", advice: [{ focus: "G1", label: "Học phần bắt buộc", text: "Lời khuyên." }], nextSteps: ["Việc cần làm."] };
const row = (extra: Partial<GraduationAdviceRow> = {}): GraduationAdviceRow => ({
  id: ADVICE, fingerprint: graduation.fingerprint, status: "completed", errorCode: null, createdAt: new Date("2026-10-13T08:00:00Z"),
  completedAt: new Date("2026-10-13T08:01:00Z"), model: "gemma4:e4b", standardVersion: 1, output, recent: false, retryDue: true, ...extra,
});
const presented = (extra: Record<string, unknown> = {}) => ({
  id: ADVICE, status: "completed", errorCode: null, createdAt: "2026-10-13T08:00:00.000Z", completedAt: "2026-10-13T08:01:00.000Z",
  model: "gemma4:e4b", standardVersion: 1, output, ...extra,
});

type Setup = {
  sessionUser?: AuthenticatedUser | null;
  noPool?: boolean;
  enabled?: boolean;
  active?: boolean;
  rows?: GraduationAdviceRow[];
  othersPending?: number;
  worker?: { online: boolean; kinds: string[] | null } | null;
  loaded?: StudentGraduation;
};

function setup(options: Setup = {}) {
  const sessionUser = options.sessionUser === null ? undefined : options.sessionUser ?? student;
  const rows = options.rows ?? [];
  const worker = options.worker === undefined ? { online: true, kinds: ["competency_assessment", "career_skill_suggestion", "graduation_advice"] } : options.worker;
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    const result = (list: unknown[]) => ({ rowCount: list.length, rows: list });
    if (sql.startsWith("SELECT id FROM users")) return options.active === false ? result([]) : result([{ id: studentId }]);
    if (sql.includes("FROM stu_comp_ai_worker_status")) return result(worker ? [worker] : []);
    if (sql.includes("FROM stu_grad_advice WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1")) {
      return result(rows.slice(0, 1).map((item) => ({ id: item.id, status: item.status, errorCode: item.errorCode })));
    }
    if (sql.includes("FROM stu_grad_advice WHERE user_id=$1 ORDER BY created_at DESC,id DESC")) return result(rows);
    if (sql.includes("count(*)::int AS count FROM stu_grad_advice")) return result([{ count: options.othersPending ?? 0 }]);
    if (sql.startsWith("INSERT INTO stu_grad_advice")) return result([{ createdAt: new Date("2026-10-13T10:00:00Z") }]);
    return result([]);
  });
  const release = vi.fn();
  const pool = { query, connect: vi.fn(async () => ({ query, release })) } as unknown as DatabasePool;
  const read = vi.fn(async () => options.loaded ?? graduation);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: sessionUser } as typeof req.session; next(); });
  app.use("/advice", createGraduationAdviceRouter(options.noPool ? undefined : pool, origin, { enabled: options.enabled ?? true, read }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "unexpected_error" });
  });
  return { app, query, release, read, sql: () => query.mock.calls.map(([text]) => text) };
}

const writes = (sql: string[]) => sql.filter((text) => /^(INSERT|DELETE)/.test(text.trim()) || /^UPDATE stu_grad_advice SET status='cancelled'/.test(text.trim()));

afterEach(() => vi.restoreAllMocks());

describe("guards", () => {
  it("requires a session, a database, an active account and a matching Origin for writes", async () => {
    await request(setup({ sessionUser: null }).app).get("/advice").expect(401, { error: "authentication_required" });
    const noPool = await request(setup({ noPool: true }).app).get("/advice").expect(503, { error: "database_required" });
    expect(noPool.headers["cache-control"]).toBe("no-store");
    await request(setup({ active: false }).app).get("/advice").expect(403, { error: "account_unavailable" });
    const { app, read } = setup();
    await request(app).post("/advice/ensure").send({}).expect(403, { error: "invalid_origin" });
    await request(app).post("/advice/retry").set("Origin", "https://evil.example").send({}).expect(403, { error: "invalid_origin" });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects query strings and non-empty bodies with 400 invalid_input", async () => {
    const { app, read } = setup();
    await request(app).get("/advice?x=1").expect(400, { error: "invalid_input" });
    await request(app).get("/advice/status?id=1").expect(400, { error: "invalid_input" });
    await request(app).post("/advice/ensure").set("Origin", origin).send({ force: true }).expect(400, { error: "invalid_input" });
    await request(app).post("/advice/retry").set("Origin", origin).send({ id: ADVICE }).expect(400, { error: "invalid_input" });
    expect(read).not.toHaveBeenCalled();
  });

  it("answers 404 for anything else under /advice", async () => {
    const { app } = setup();
    await request(app).get("/advice/other").expect(404, { error: "not_found" });
    await request(app).delete("/advice").set("Origin", origin).expect(404, { error: "not_found" });
    await request(app).post("/advice").set("Origin", origin).send({}).expect(404, { error: "not_found" });
  });
});

describe("GET /", () => {
  it("returns the advice for the current facts with the worker status, in one read-only snapshot", async () => {
    const { app, sql, release } = setup({ rows: [row()] });
    const res = await request(app).get("/advice").expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      advice: presented(), stale: false, needsAdvice: false, aiEnabled: true,
      worker: { online: true, supportsAdvice: true }, fingerprint: graduation.fingerprint,
    });
    const statements = sql();
    expect(statements).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(statements.indexOf("COMMIT")).toBeGreaterThan(statements.findIndex((text) => text.includes("FROM stu_grad_advice WHERE user_id=$1")));
    expect(release).toHaveBeenCalledTimes(1);
    expect(statements.some((text) => text.startsWith("UPDATE stu_grad_advice SET status='failed'"))).toBe(true);
  });

  it("marks advice for other facts stale and asks for new advice", async () => {
    const old = row({ fingerprint: OLD });
    expect((await request(setup({ rows: [old] }).app).get("/advice").expect(200)).body).toMatchObject({ advice: presented(), stale: true, needsAdvice: true });
    expect((await request(setup().app).get("/advice").expect(200)).body).toMatchObject({ advice: null, stale: false, needsAdvice: true });
    // The newest row for the current facts wins over a newer row for other facts.
    const res = await request(setup({ rows: [row({ fingerprint: OLD, id: "newer" }), row()] }).app).get("/advice").expect(200);
    expect(res.body).toMatchObject({ advice: { id: ADVICE }, stale: false, needsAdvice: false });
  });

  it("asks for advice again only after an automatically retryable failure", async () => {
    const failed = row({ status: "failed", errorCode: "ai_timeout", output: null });
    const due = await request(setup({ rows: [failed] }).app).get("/advice").expect(200);
    expect(due.body).toMatchObject({ advice: presented({ status: "failed", errorCode: "ai_timeout", output: null }), stale: false, needsAdvice: true });
    const capped = await request(setup({ rows: [failed, row({ status: "failed", id: "b" })] }).app).get("/advice").expect(200);
    expect(capped.body.needsAdvice).toBe(false);
    // Output is only sent for completed advice.
    const queued = await request(setup({ rows: [row({ status: "queued", completedAt: null })] }).app).get("/advice").expect(200);
    expect(queued.body.advice).toEqual(presented({ status: "queued", completedAt: null, output: null }));
  });

  it("has no fingerprint and needs no advice without an evaluation", async () => {
    const res = await request(setup({ rows: [row()], loaded: unevaluatedGraduation() }).app).get("/advice").expect(200);
    expect(res.body).toMatchObject({ advice: presented(), stale: true, needsAdvice: false, fingerprint: null });
  });

  it("reports AI off without asking the worker table", async () => {
    const { app, sql } = setup({ enabled: false, rows: [row()] });
    const res = await request(app).get("/advice").expect(200);
    expect(res.body).toMatchObject({ aiEnabled: false, needsAdvice: false, worker: { online: false, supportsAdvice: false } });
    expect(sql().some((text) => text.includes("stu_comp_ai_worker_status"))).toBe(false);
  });

  it("supports advice only with a recent heartbeat that advertises graduation_advice", async () => {
    const old = await request(setup({ worker: { online: true, kinds: ["competency_assessment", "career_skill_suggestion"] } }).app).get("/advice").expect(200);
    expect(old.body.worker).toEqual({ online: true, supportsAdvice: false });
    const offline = await request(setup({ worker: { online: false, kinds: ["graduation_advice"] } }).app).get("/advice").expect(200);
    expect(offline.body.worker).toEqual({ online: false, supportsAdvice: false });
    const never = await request(setup({ worker: null }).app).get("/advice").expect(200);
    expect(never.body.worker).toEqual({ online: false, supportsAdvice: false });
  });
});

describe("GET /status", () => {
  it("returns the newest row's id, status and error code with the worker status", async () => {
    const { app, read } = setup({ rows: [row({ status: "processing", completedAt: null })] });
    await request(app).get("/advice/status").expect(200, { id: ADVICE, status: "processing", errorCode: null, worker: { online: true, supportsAdvice: true } });
    expect(read).not.toHaveBeenCalled();
    await request(setup().app).get("/advice/status").expect(200, { id: null, status: null, errorCode: null, worker: { online: true, supportsAdvice: true } });
  });
});

describe("POST /ensure", () => {
  it("does nothing with AI off or without an evaluation", async () => {
    const off = setup({ enabled: false });
    await request(off.app).post("/advice/ensure").set("Origin", origin).send({}).expect(200, { advice: null });
    expect(off.read).not.toHaveBeenCalled();
    const none = setup({ loaded: unevaluatedGraduation() });
    await request(none.app).post("/advice/ensure").set("Origin", origin).expect(200, { advice: null });
    expect(writes(none.sql())).toEqual([]);
  });

  it("queues advice for the current facts in a transaction, and returns an existing one unchanged", async () => {
    const { app, sql } = setup({ rows: [row({ fingerprint: OLD })] });
    const res = await request(app).post("/advice/ensure").set("Origin", origin).send({}).expect(200);
    expect(res.body.advice).toMatchObject({ status: "queued", errorCode: null, createdAt: "2026-10-13T10:00:00.000Z", completedAt: null, model: null, standardVersion: 1, output: null });
    expect(res.body.advice.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sql()[sql().indexOf("BEGIN") + 1]).toBe("SELECT id FROM users WHERE id=$1 AND is_active FOR KEY SHARE");
    expect(sql().at(-1)).toBe("COMMIT");
    const same = setup({ rows: [row()] });
    await request(same.app).post("/advice/ensure").set("Origin", origin).send({}).expect(200, { advice: presented() });
    expect(writes(same.sql())).toEqual([]);
  });

  it("answers a full queue with an unstored deferred advice", async () => {
    const { app, sql } = setup({ othersPending: 20 });
    await request(app).post("/advice/ensure").set("Origin", origin).send({}).expect(200, { advice: {
      id: null, status: "deferred", errorCode: null, createdAt: null, completedAt: null, model: null, standardVersion: 1, output: null,
    } });
    expect(writes(sql())).toEqual([]);
  });
});

describe("POST /retry", () => {
  it("queues again after a failure (201)", async () => {
    const { app } = setup({ rows: [row({ status: "failed", errorCode: "invalid_ai_output", output: null })] });
    const res = await request(app).post("/advice/retry").set("Origin", origin).send({}).expect(201);
    expect(res.body.advice).toMatchObject({ status: "queued", output: null });
  });

  it("refuses with AI off, without a failure, too soon or with a full queue", async () => {
    await request(setup({ enabled: false }).app).post("/advice/retry").set("Origin", origin).send({}).expect(409, { error: "ai_disabled" });
    const done = setup({ rows: [row()] });
    await request(done.app).post("/advice/retry").set("Origin", origin).send({}).expect(409, { error: "advice_not_retryable" });
    expect(done.sql().at(-1)).toBe("ROLLBACK");
    expect(done.release).toHaveBeenCalled();
    await request(setup({ rows: [row({ status: "failed", recent: true })] }).app).post("/advice/retry").set("Origin", origin).send({})
      .expect(429, { error: "advice_too_frequent" });
    await request(setup({ rows: [row({ status: "cancelled" })], othersPending: 20 }).app).post("/advice/retry").set("Origin", origin).send({})
      .expect(429, { error: "queue_full" });
  });
});
