import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../../auth/types.js";
import type { DatabasePool } from "../../db/pool.js";
import { createCareersRouter } from "../router.js";
import type { StoredSuggestionItem } from "./validate.js";

const adminId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const career = "33333333-3333-4333-8333-333333333333";
const missingCareer = "44444444-4444-4444-8444-444444444444";
const sql = "55555555-5555-4555-8555-555555555555";
const python = "66666666-6666-4666-8666-666666666666";
const viz = "77777777-7777-4777-8777-777777777777";
const deletedSkill = "88888888-8888-4888-8888-888888888888";
const suggestionId = "99999999-9999-4999-8999-999999999999";
const origin = "https://edupath.example";
const base = "/careers/requirements/ai-suggestions";

const admin = {
  userId: adminId,
  identityKey: `${tenantId}:${adminId}`,
  tenantId,
  objectId: adminId,
  name: "Admin User",
  email: "admin@example.edu",
  username: "admin@example.edu",
  role: "admin",
  signedInAt: new Date(0).toISOString()
} satisfies AuthenticatedUser;

type Suggestion = {
  id: string;
  careerPositionId: string;
  status: string;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  appliedAt: Date | null;
  model: string | null;
  promptVersion: string | null;
  result: { items: StoredSuggestionItem[]; returned: number; dropped: number } | null;
  aiInput?: unknown;
  requestedBy?: string;
  appliedBy?: string;
  appliedSummary?: unknown;
};
type Options = {
  enabled?: boolean;
  worker?: { seenAt: Date; online: boolean; kinds: string[] } | null;
  suggestions?: Suggestion[];
  linked?: string[];
  pendingElsewhere?: number;
  duplicateInsert?: boolean;
};

const stored = (skillId: string | null, skillName: string, extra: Partial<StoredSuggestionItem> = {}): StoredSuggestionItem => ({
  skillId, skillName, isNewSkill: skillId === null, isRequired: false,
  title: `Sử dụng ${skillName} trong công việc`, description: "Mô tả", reason: "Lý do", ...extra
});
const completed = (extra: Partial<Suggestion> = {}): Suggestion => ({
  id: suggestionId, careerPositionId: career, status: "completed", errorCode: null,
  createdAt: new Date("2026-10-11T05:00:00Z"), updatedAt: new Date("2026-10-11T05:01:00Z"), completedAt: new Date("2026-10-11T05:01:00Z"),
  appliedAt: null, model: "gemma4:e4b", promptVersion: "career-skill-v1",
  result: { returned: 4, dropped: 0, items: [
    stored(sql, "SQL", { isRequired: true }), stored(python, "Python"), stored(deletedSkill, "Đã xóa"), stored(null, "Power BI")
  ] },
  ...extra
});

function setup(options: Options = {}) {
  const skills = new Map([[sql, "SQL"], [python, "Python"], [viz, "Trực quan hóa dữ liệu"]]);
  const suggestions = new Map((options.suggestions ?? []).map((row) => [row.id, { ...row }]));
  const requirements: { careerId: string; skillId: string | null; title: string; description: string; isRequired: boolean }[] =
    (options.linked ?? []).map((skillId) => ({ careerId: career, skillId, title: skills.get(skillId)!, description: "", isRequired: false }));
  const worker = options.worker === undefined ? { seenAt: new Date("2026-10-11T05:00:00Z"), online: true, kinds: ["competency_assessment", "career_skill_suggestion"] } : options.worker;
  const pick = (row: Suggestion) => {
    const { aiInput: _a, requestedBy: _r, appliedBy: _b, appliedSummary: _s, ...rest } = row;
    return rest;
  };
  const run = vi.fn(async (text: string, params: unknown[] = []) => {
    const ok = (rows: unknown[] = [], rowCount = rows.length) => ({ rows, rowCount });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text) || text.includes("pg_advisory_xact_lock")) return ok();
    if (text.includes("SELECT id FROM users")) return ok([{ id: adminId }]);
    if (text.includes("UPDATE career_ai_suggestions SET status='failed'")) return ok([], 0);
    if (text.includes("FROM stu_comp_ai_worker_status")) return ok(worker ? [worker] : []);
    if (text.includes("FOR SHARE OF c")) {
      return params[0] === career ? ok([{ code: "15", nameVi: "Chuyên viên phân tích dữ liệu", nameEn: "Data Analyst", description: "Phân tích dữ liệu",
        fieldName: "Dữ liệu", fieldDescription: "" }]) : ok();
    }
    if (text.includes("FROM career_requirements r LEFT JOIN career_skills s")) {
      return ok(requirements.filter((row) => row.careerId === params[0])
        .map((row) => ({ skillId: row.skillId, skillName: row.skillId ? skills.get(row.skillId) : null, title: row.title, isRequired: row.isRequired })));
    }
    if (text.includes("SELECT id,name,description FROM career_skills")) return ok([...skills].map(([id, name]) => ({ id, name, description: "" })));
    if (text.includes("SELECT id FROM career_ai_suggestions WHERE career_position_id=$1")) {
      return ok([...suggestions.values()].filter((row) => row.careerPositionId === params[0] && ["queued", "processing"].includes(row.status)).map((row) => ({ id: row.id })));
    }
    if (text.includes("SELECT count(*)::int AS count FROM career_ai_suggestions")) {
      return ok([{ count: (options.pendingElsewhere ?? 0) + [...suggestions.values()].filter((row) => ["queued", "processing"].includes(row.status)).length }]);
    }
    if (text.includes("INSERT INTO career_ai_suggestions")) {
      const now = new Date("2026-10-11T06:00:00Z");
      suggestions.set(String(params[0]), { id: String(params[0]), careerPositionId: String(params[1]), requestedBy: String(params[2]), status: "queued",
        errorCode: null, createdAt: now, updatedAt: now, completedAt: null, appliedAt: null, model: null, promptVersion: String(params[4]),
        result: null, aiInput: JSON.parse(String(params[3])) });
      return ok([], 1);
    }
    if (text.includes("FROM career_ai_suggestions WHERE id=$1 FOR UPDATE")) {
      const row = suggestions.get(String(params[0]));
      return ok(row ? [{ careerPositionId: row.careerPositionId, status: row.status, appliedAt: row.appliedAt, result: row.result }] : []);
    }
    if (text.includes("FROM career_ai_suggestions WHERE id=$1")) {
      const row = suggestions.get(String(params[0]));
      return ok(row ? [text.startsWith("SELECT 1") ? { "?column?": 1 } : pick(row)] : []);
    }
    if (text.includes("FROM career_ai_suggestions\n      WHERE career_position_id=$1")) {
      const rows = [...suggestions.values()].filter((row) => row.careerPositionId === params[0] && row.status !== "cancelled" && !row.appliedAt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return ok(rows.slice(0, 1).map(pick));
    }
    if (text.includes("SET status='cancelled'")) {
      const row = suggestions.get(String(params[0]));
      if (!row || !["queued", "processing"].includes(row.status)) return ok([], 0);
      Object.assign(row, { status: "cancelled", aiInput: null });
      return ok([], 1);
    }
    if (text.includes("SELECT s.id,s.name FROM career_requirements r JOIN career_skills s")) {
      return ok(requirements.filter((row) => row.careerId === params[0] && row.skillId).map((row) => ({ id: row.skillId, name: skills.get(row.skillId!) })));
    }
    if (text.includes("SELECT id,name FROM career_skills WHERE id=ANY")) {
      return ok((params[0] as string[]).filter((id) => skills.has(id)).map((id) => ({ id, name: skills.get(id) })));
    }
    if (text.includes("SELECT id,name FROM career_skills WHERE deleted_at IS NULL")) return ok([...skills].map(([id, name]) => ({ id, name })));
    if (text.includes(`SELECT skill_id AS "skillId" FROM career_requirements`)) {
      return ok(requirements.filter((row) => row.careerId === params[0] && row.skillId).map((row) => ({ skillId: row.skillId })));
    }
    if (text.includes("SELECT id FROM career_positions WHERE id=ANY")) return ok((params[0] as string[]).filter((id) => id === career).map((id) => ({ id })));
    if (text.includes("SELECT id FROM career_skills WHERE id=$1")) return ok(skills.has(String(params[0])) ? [{ id: params[0] }] : []);
    if (text.includes("INSERT INTO career_skills(name)")) {
      const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(skills.size).padStart(12, "0")}`;
      skills.set(id, String(params[0]));
      return ok([{ id }]);
    }
    if (text.includes("INSERT INTO career_requirements")) {
      if (options.duplicateInsert) throw Object.assign(new Error("duplicate"), { code: "23505" });
      requirements.push({ careerId: String(params[1]), skillId: params[2] as string, title: String(params[3]), description: String(params[4]), isRequired: params[5] as boolean });
      return ok([], 1);
    }
    if (text.includes("SELECT code,name_vi,name_en,description FROM career_positions")) return ok([{ code: "15", name_vi: "A", name_en: "B", description: "" }]);
    if (text.includes("SELECT s.name FROM career_requirements")) return ok([]);
    if (text.includes("UPDATE career_ai_suggestions SET applied_at")) {
      const row = suggestions.get(String(params[0]))!;
      Object.assign(row, { appliedAt: new Date("2026-10-11T07:00:00Z"), appliedBy: params[1], appliedSummary: JSON.parse(String(params[2])) });
      return ok([], 1);
    }
    return ok([], 1);
  });
  const connect = vi.fn(async () => ({ query: run, release: vi.fn() }));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: admin } as typeof req.session;
    next();
  });
  app.use("/careers", createCareersRouter({ query: run, connect } as unknown as DatabasePool, origin, false, { aiSuggestions: options.enabled ?? true }));
  app.use("/student", createCareersRouter({ query: run, connect } as unknown as DatabasePool, origin, true));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "unexpected_error" });
  });
  const calls = () => run.mock.calls.map(([text]) => text);
  return { app, run, connect, calls, suggestions, requirements, skills };
}

describe("GET /status", () => {
  it("reports whether the AI is enabled and whether the worker can take career jobs", async () => {
    const res = await request(setup().app).get(`${base}/status`).expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ enabled: true, worker: { online: true, supportsSuggestions: true, seenAt: "2026-10-11T05:00:00.000Z" } });
    const old = setup({ worker: { seenAt: new Date("2026-10-11T05:00:00Z"), online: true, kinds: ["competency_assessment"] } });
    expect((await request(old.app).get(`${base}/status`).expect(200)).body.worker).toMatchObject({ online: true, supportsSuggestions: false });
    const offline = setup({ worker: { seenAt: new Date("2026-10-11T04:00:00Z"), online: false, kinds: ["competency_assessment", "career_skill_suggestion"] } });
    expect((await request(offline.app).get(`${base}/status`).expect(200)).body.worker).toEqual({ online: false, supportsSuggestions: false, seenAt: "2026-10-11T04:00:00.000Z" });
    expect((await request(setup({ worker: null }).app).get(`${base}/status`).expect(200)).body.worker).toEqual({ online: false, supportsSuggestions: false, seenAt: null });
    await request(setup({ enabled: false }).app).get(`${base}/status`).expect(200, { enabled: false, worker: { online: false, supportsSuggestions: false, seenAt: null } });
  });
});

describe("POST / (request suggestions)", () => {
  it("queues a job for the career with the key map kept server-side", async () => {
    const { app, suggestions, calls } = setup({ linked: [python] });
    const res = await request(app).post(base).set("Origin", origin).send({ careerPositionId: career }).expect(201);
    expect(res.body.suggestion).toMatchObject({ careerPositionId: career, status: "queued", errorCode: null, items: [], appliedAt: null, promptVersion: "career-skill-v2" });
    const row = suggestions.get(res.body.suggestion.id)!;
    expect(row.requestedBy).toBe(adminId);
    const input = row.aiInput as { catalog: { key: string; name: string }[]; user: string };
    expect(input.catalog.map((entry) => entry.name)).toEqual(["SQL", "Trực quan hóa dữ liệu"]);
    expect(input.user).toContain("- Python | Ưu tiên");
    expect(calls()).toContain("COMMIT");
    expect(calls().some((text) => text.includes("pg_advisory_xact_lock(hashtext($1))"))).toBe(true);
  });

  it("returns the pending job instead of queueing a second one", async () => {
    const pending = completed({ status: "processing", result: null, completedAt: null });
    const { app, suggestions } = setup({ suggestions: [pending] });
    const res = await request(app).post(base).set("Origin", origin).send({ careerPositionId: career }).expect(200);
    expect(res.body.suggestion).toMatchObject({ id: suggestionId, status: "processing", items: [] });
    expect(suggestions.size).toBe(1);
  });

  it("maps disabled AI, unknown careers, a full queue, bad input and foreign origins", async () => {
    await request(setup({ enabled: false }).app).post(base).set("Origin", origin).send({ careerPositionId: career }).expect(503, { error: "ai_disabled" });
    const missing = setup();
    await request(missing.app).post(base).set("Origin", origin).send({ careerPositionId: missingCareer }).expect(404, { error: "career_not_found" });
    expect(missing.calls()).toContain("ROLLBACK");
    const full = setup({ pendingElsewhere: 10 });
    await request(full.app).post(base).set("Origin", origin).send({ careerPositionId: career }).expect(429, { error: "ai_queue_full" });
    expect(full.suggestions.size).toBe(0);
    await request(setup().app).post(base).set("Origin", origin).send({ careerPositionId: "x" }).expect(400, { error: "invalid_ai_suggestion" });
    await request(setup().app).post(base).set("Origin", origin).send({ careerPositionId: career, extra: 1 }).expect(400, { error: "invalid_ai_suggestion" });
    const foreign = setup();
    await request(foreign.app).post(base).set("Origin", "https://evil.example").send({ careerPositionId: career }).expect(403, { error: "invalid_origin" });
    expect(foreign.connect).not.toHaveBeenCalled();
  });
});

describe("reading suggestions", () => {
  it("returns the latest unapplied suggestion with current names and link state", async () => {
    const { app } = setup({ suggestions: [completed()], linked: [python] });
    const res = await request(app).get(`${base}/latest?careerPositionId=${career}`).expect(200);
    expect(res.body.suggestion).toMatchObject({ id: suggestionId, status: "completed", model: "gemma4:e4b", createdAt: "2026-10-11T05:00:00.000Z" });
    expect(res.body.suggestion).not.toHaveProperty("result");
    expect(res.body.suggestion.items).toEqual([
      { index: 0, skillId: sql, skillName: "SQL", isNewSkill: false, alreadyLinked: false, similarLinkedSkill: null, isRequired: true, title: "Sử dụng SQL trong công việc", description: "Mô tả", reason: "Lý do" },
      { index: 1, skillId: python, skillName: "Python", isNewSkill: false, alreadyLinked: true, similarLinkedSkill: null, isRequired: false, title: "Sử dụng Python trong công việc", description: "Mô tả", reason: "Lý do" },
      // index 2 refers to a catalog skill deleted since; it is no longer offered.
      { index: 3, skillId: null, skillName: "Power BI", isNewSkill: true, alreadyLinked: false, similarLinkedSkill: null, isRequired: false, title: "Sử dụng Power BI trong công việc", description: "Mô tả", reason: "Lý do" }
    ]);
    await request(setup().app).get(`${base}/latest?careerPositionId=${career}`).expect(200, { suggestion: null });
    await request(setup({ suggestions: [completed({ appliedAt: new Date() })] }).app).get(`${base}/latest?careerPositionId=${career}`).expect(200, { suggestion: null });
    await request(setup().app).get(`${base}/latest`).expect(400, { error: "invalid_ai_suggestion" });
  });

  it("names a linked skill that a suggested skill looks like, without excluding it", async () => {
    const result = { returned: 4, dropped: 0, items: [
      stored(viz, "Trực quan hóa dữ liệu"), stored(null, "Lập trình  Python"), stored(null, "Truy vấn dữ liệu bằng SQL"), stored(python, "Python")
    ] };
    const { app } = setup({ suggestions: [completed({ result })], linked: [python, sql] });
    const res = await request(app).get(`${base}/${suggestionId}`).expect(200);
    expect(res.body.suggestion.items.map((item: { skillName: string; alreadyLinked: boolean; similarLinkedSkill: string | null }) =>
      [item.skillName, item.alreadyLinked, item.similarLinkedSkill])).toEqual([
      ["Trực quan hóa dữ liệu", false, null],
      ["Lập trình  Python", false, "Python"],
      ["Truy vấn dữ liệu bằng SQL", false, "SQL"],
      ["Python", true, null]
    ]);
  });

  it("reads one suggestion by id and is never captured by /requirements/:id", async () => {
    const { app } = setup({ suggestions: [completed({ status: "failed", errorCode: "invalid_ai_output", result: null })] });
    const res = await request(app).get(`${base}/${suggestionId}`).expect(200);
    expect(res.body.suggestion).toMatchObject({ status: "failed", errorCode: "invalid_ai_output", items: [] });
    await request(setup().app).get(`${base}/${suggestionId}`).expect(404, { error: "suggestion_not_found" });
    await request(setup().app).get(base).expect(404, { error: "not_found" });
    await request(setup().app).get(`${base}/not-a-uuid`).expect(400, { error: "invalid_ai_suggestion" });
  });

  it("is not part of the student careers router", async () => {
    const { app, calls } = setup({ suggestions: [completed()] });
    const res = await request(app).get(`/student/requirements/ai-suggestions/${suggestionId}`);
    expect(res.status).toBe(404);
    expect(calls().some((text) => text.includes("career_ai_suggestions"))).toBe(false);
  });
});

describe("POST /:id/cancel", () => {
  it("cancels a pending job only", async () => {
    const { app, suggestions } = setup({ suggestions: [completed({ status: "queued", result: null, completedAt: null })] });
    const res = await request(app).post(`${base}/${suggestionId}/cancel`).set("Origin", origin).send({}).expect(200);
    expect(res.body.suggestion.status).toBe("cancelled");
    expect(suggestions.get(suggestionId)!.aiInput).toBeNull();
    await request(setup({ suggestions: [completed()] }).app).post(`${base}/${suggestionId}/cancel`).set("Origin", origin).send({}).expect(409, { error: "suggestion_not_active" });
    await request(setup().app).post(`${base}/${suggestionId}/cancel`).set("Origin", origin).send({}).expect(404, { error: "suggestion_not_found" });
  });
});

describe("POST /:id/apply", () => {
  const keep = (skillId: string | null, skillName: string, sourceIndex: number | null, extra: Record<string, unknown> = {}) => ({
    skillId, skillName, title: `Sử dụng ${skillName} trong công việc`, description: "Mô tả", isRequired: false, sourceIndex, ...extra
  });

  it("saves only the reviewed rows in one transaction and records the audit summary", async () => {
    const { app, requirements, suggestions, skills, calls } = setup({ suggestions: [completed()] });
    const res = await request(app).post(`${base}/${suggestionId}/apply`).set("Origin", origin).send({ items: [
      keep(sql, "SQL", 0, { isRequired: true }),
      keep(null, "Power BI", 3, { title: "Xây dựng dashboard bằng Power BI" }),
      keep(viz, "Trực quan hóa dữ liệu", null)
    ] }).expect(201);
    expect(res.body.created).toBe(3);
    expect(res.body.suggestion.appliedAt).toBe("2026-10-11T07:00:00.000Z");
    expect(requirements.map((row) => [skills.get(row.skillId!), row.title, row.isRequired])).toEqual([
      ["SQL", "Sử dụng SQL trong công việc", true],
      ["Power BI", "Xây dựng dashboard bằng Power BI", false],
      ["Trực quan hóa dữ liệu", "Sử dụng Trực quan hóa dữ liệu trong công việc", false]
    ]);
    const row = suggestions.get(suggestionId)!;
    expect(row.appliedBy).toBe(adminId);
    expect(row.appliedSummary).toEqual({ suggested: 4, saved: 3, edited: 2, newSkills: 1 });
    const order = calls();
    expect(order.indexOf("SELECT pg_advisory_xact_lock(1946032027)")).toBeLessThan(order.findIndex((text) => text.includes("SELECT id FROM career_positions WHERE id=ANY")));
    expect(order.some((text) => text.includes("UPDATE career_positions SET skills=$2"))).toBe(true);
    expect(order.at(-1)).toBe("COMMIT");
  });

  it("matches a new name to an existing catalog skill ignoring accents and extra spaces", async () => {
    const { app, requirements, skills } = setup({ suggestions: [completed()] });
    await request(app).post(`${base}/${suggestionId}/apply`).set("Origin", origin).send({ items: [keep(null, " truc  quan	hoa du   lieu ", null)] }).expect(201);
    expect(requirements.map((row) => row.skillId)).toEqual([viz]);
    expect(skills.size).toBe(3);
  });

  it("stores a new skill name with single spaces and counts it as the suggested one", async () => {
    const { app, skills, suggestions } = setup({ suggestions: [completed()] });
    await request(app).post(`${base}/${suggestionId}/apply`).set("Origin", origin).send({ items: [keep(null, "  Power   BI ", 3, { title: "Sử dụng Power BI trong công việc" })] }).expect(201);
    expect([...skills.values()]).toContain("Power BI");
    expect(suggestions.get(suggestionId)!.appliedSummary).toEqual({ suggested: 4, saved: 1, edited: 0, newSkills: 1 });
    const twice = setup({ suggestions: [completed()] });
    const res = await request(twice.app).post(`${base}/${suggestionId}/apply`).set("Origin", origin).send({ items: [keep(null, "Lập trình web", null), keep(null, "Lập  trình   web", null)] }).expect(409);
    expect(res.body).toEqual({ error: "requirement_exists", skills: ["Lập trình web"] });
    await request(twice.app).post(`${base}/${suggestionId}/apply`).set("Origin", origin).send({ items: [keep(null, "   ", null)] }).expect(400, { error: "invalid_ai_suggestion" });
  });

  it("refuses duplicates and saves nothing", async () => {
    const { app, requirements, calls, suggestions } = setup({ suggestions: [completed()], linked: [python] });
    const res = await request(app).post(`${base}/${suggestionId}/apply`).set("Origin", origin).send({ items: [
      keep(python, "Python", 1), keep(sql, "SQL", 0), keep(sql, "SQL", null), keep(null, "Power BI", 3), keep(null, "power bi", null)
    ] }).expect(409);
    expect(res.body).toEqual({ error: "requirement_exists", skills: ["Python", "SQL", "power bi"] });
    expect(requirements).toHaveLength(1);
    expect(calls()).toContain("ROLLBACK");
    expect(suggestions.get(suggestionId)!.appliedAt).toBeNull();
  });

  it("maps a unique-index race to requirement_exists", async () => {
    const { app } = setup({ suggestions: [completed()], duplicateInsert: true });
    await request(app).post(`${base}/${suggestionId}/apply`).set("Origin", origin).send({ items: [keep(sql, "SQL", 0)] }).expect(409, { error: "requirement_exists" });
  });

  it("only applies a completed suggestion once", async () => {
    const applied = setup({ suggestions: [completed({ appliedAt: new Date() })] });
    await request(applied.app).post(`${base}/${suggestionId}/apply`).set("Origin", origin).send({ items: [keep(sql, "SQL", 0)] }).expect(409, { error: "suggestion_already_applied" });
    for (const status of ["queued", "processing", "failed", "cancelled"]) {
      const other = setup({ suggestions: [completed({ status })] });
      await request(other.app).post(`${base}/${suggestionId}/apply`).set("Origin", origin).send({ items: [keep(sql, "SQL", 0)] }).expect(409, { error: "suggestion_not_completed" });
    }
    await request(setup().app).post(`${base}/${suggestionId}/apply`).set("Origin", origin).send({ items: [keep(sql, "SQL", 0)] }).expect(404, { error: "suggestion_not_found" });
    const gone = setup({ suggestions: [completed()] });
    await request(gone.app).post(`${base}/${suggestionId}/apply`).set("Origin", origin).send({ items: [keep(deletedSkill, "Đã xóa", 2)] }).expect(404, { error: "skill_not_found" });
  });

  it("validates the body", async () => {
    const { app, connect } = setup({ suggestions: [completed()] });
    const bodies = [
      { items: [] },
      { items: Array.from({ length: 21 }, () => keep(sql, "SQL", 0)) },
      { items: [keep(null, "", null)] },
      { items: [keep(sql, "SQL", 0, { title: " " })] },
      { items: [keep(sql, "SQL", 0, { title: "a".repeat(161) })] },
      { items: [keep(sql, "SQL", 0, { level: "advanced" })] }
    ];
    for (const body of bodies) await request(app).post(`${base}/${suggestionId}/apply`).set("Origin", origin).send(body).expect(400, { error: "invalid_ai_suggestion" });
    expect(connect).not.toHaveBeenCalled();
  });
});
