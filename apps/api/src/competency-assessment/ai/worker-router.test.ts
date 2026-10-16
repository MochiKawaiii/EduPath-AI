import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../../db/pool.js";
import { buildCareerSuggestionInput, CAREER_SUGGESTION_PROMPT_VERSION } from "../../careers/ai-suggestions/prompt.js";
import { careerSource, fixtureId } from "../../careers/ai-suggestions/test-fixture.js";
import { buildGraduationAdviceInput, GRADUATION_ADVICE_PROMPT_VERSION } from "../../graduation/advice/prompt.js";
import { syntheticGraduation } from "../../graduation/advice/test-fixture.js";
import { buildCourseAiInput, COURSE_AI_PROMPT_VERSIONS } from "../../competencies/ai/prompt.js";
import { courseSource } from "../../competencies/ai/test-fixture.js";
import { buildAiInput } from "./prompt.js";
import { syntheticResult, withCompV3Improvements } from "./test-fixture.js";
import { createCompetencyAiExpiry, createCompetencyWorkerRouter, expireCompetencyAiJobs } from "./worker-router.js";

const KEY = "k".repeat(40);
const AUTH = `Bearer ${KEY}`;
const JOB = "44444444-4444-4444-8444-444444444444";
const LEASE = "55555555-5555-4555-8555-555555555555";
const OTHER_LEASE = "66666666-6666-4666-8666-666666666666";
const ASSESSMENT = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const aiInput = buildAiInput(syntheticResult());

type Row = Record<string, unknown>;
type Handler = (sql: string, params?: unknown[]) => { rows: Row[]; rowCount?: number } | undefined;

function setup(handler: Handler = () => undefined) {
  const run = vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params) ?? { rows: [], rowCount: 0 });
  const release = vi.fn();
  const pool = { query: run, connect: vi.fn(async () => ({ query: run, release })) } as unknown as DatabasePool;
  const app = express();
  app.use("/w", createCompetencyWorkerRouter(pool, KEY));
  return { app, run, release, sql: () => run.mock.calls.map(([s]) => s) };
}

const validOutput = () => ({
  summary: "Bạn có nền tảng lập trình hướng đối tượng vững với điểm 88.",
  groupInsights: [],
  strengths: [{ skillKey: "S01", comment: "Nhập môn lập trình đạt điểm 8,5." }],
  improvements: [],
  careerFit: { comment: "Bạn đạt 2/4 kỹ năng của nghề." },
  gaps: [{ skillKey: "S03", priority: "high", explanation: "Kỹ năng bắt buộc.", courses: [{ courseCode: "TST201", reason: "Học ở HK261." }], selfStudy: [] }],
  progress: "Bạn trễ 1 mục so với kế hoạch.",
  nextSteps: ["Đăng ký học phần kiểm thử.", "Làm một sản phẩm nhỏ.", "Ôn lại Toán rời rạc."]
});
const success = (output: unknown = validOutput()) => ({ leaseToken: LEASE, model: "gemma4:e4b", digest: "dc35e8d9c606", ollamaVersion: "0.40.2", metrics: { eval_count: 900, total_ms: 120000 }, output });

function jobRow(extra: Row = {}): Row {
  return { status: "processing", lease_token: LEASE, valid: true, assessment_id: ASSESSMENT, user_id: USER, ai_input: aiInput, ...extra };
}
const withJob = (row: Row | null, names: Row | null = null): Handler => (sql) => (sql.includes("FROM stu_comp_ai_jobs WHERE id=$1 FOR UPDATE") ? { rows: row ? [row] : [] }
  : names && sql.includes("computed->'skillDirectory'") ? { rows: [names] } : undefined);

afterEach(() => vi.restoreAllMocks());

describe("worker auth", () => {
  it("returns 503 when no key or no database is configured", async () => {
    const app = express();
    app.use("/a", createCompetencyWorkerRouter({} as DatabasePool, undefined));
    app.use("/b", createCompetencyWorkerRouter(undefined, KEY));
    await request(app).post("/a/heartbeat").set("Authorization", AUTH).expect(503, { error: "worker_disabled" });
    await request(app).post("/b/heartbeat").set("Authorization", AUTH).expect(503, { error: "worker_disabled" });
  });

  it("rejects a wrong key before reading the body", async () => {
    const { app, run } = setup();
    const res = await request(app).post("/w/claim").set("Authorization", "Bearer wrong").set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
    expect(res.headers["cache-control"]).toBe("no-store");
    await request(app).post("/w/claim").send({}).expect(401);
    await request(app).post("/w/claim").set("Authorization", KEY).expect(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("parses JSON only after auth and limits it to 512 kB", async () => {
    const { app } = setup();
    await request(app).post(`/w/${JOB}/extend`).set("Authorization", AUTH).set("Content-Type", "application/json").send("{not json").expect(400, { error: "invalid_json" });
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send({ leaseToken: LEASE, error: "ai_failed", pad: "x".repeat(600 * 1024) }).expect(413, { error: "payload_too_large" });
  });
});

describe("heartbeat and claim", () => {
  it("records the heartbeat", async () => {
    const { app, sql } = setup();
    await request(app).post("/w/heartbeat").set("Authorization", AUTH).expect(200, { ok: true });
    expect(sql()[0]).toContain("INSERT INTO stu_comp_ai_worker_status");
  });

  it("claims the oldest job with SKIP LOCKED, a 15 minute lease and returns the stored input", async () => {
    const { app, run, sql } = setup((s) => (s.includes("FOR UPDATE SKIP LOCKED") ? { rows: [{ id: JOB, leaseToken: LEASE, aiInput }] } : undefined));
    const res = await request(app).post("/w/claim").set("Authorization", AUTH).expect(200);
    expect(res.body.job).toEqual({ kind: "competency_assessment", id: JOB, leaseToken: LEASE, promptVersion: "comp-v5", system: aiInput.system, user: aiInput.user, schema: aiInput.schema, options: aiInput.options });
    const claim = run.mock.calls.find(([s]) => s.includes("SKIP LOCKED"))!;
    expect(claim[0]).toContain("ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1");
    expect(claim[0]).toContain("status='processing' AND lease_until<now() AND attempts<$2");
    expect(claim[0]).toContain("attempts=j.attempts+1");
    expect(claim[0]).toContain("ai_status='processing'");
    expect((claim[1] as unknown[]).slice(1)).toEqual([2, 15]);
    expect(sql()[0]).toContain("stu_comp_ai_worker_status");
  });

  it("returns null when nothing is queued", async () => {
    const { app } = setup();
    await request(app).post("/w/claim").set("Authorization", AUTH).expect(200, { job: null });
  });

  it("runs expiry housekeeping at most once per 60 seconds", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { app, sql } = setup();
    const housekeepingCount = () => sql().filter((s) => s.includes("error_code='worker_timeout'")).length;
    await request(app).post("/w/claim").set("Authorization", AUTH).expect(200);
    now += 30_000;
    await request(app).post("/w/claim").set("Authorization", AUTH).expect(200);
    expect(housekeepingCount()).toBe(1);
    now += 31_000;
    await request(app).post("/w/claim").set("Authorization", AUTH).expect(200);
    expect(housekeepingCount()).toBe(2);
  });
});

describe("expireCompetencyAiJobs", () => {
  it("fails stuck jobs with their assessments and deletes only old terminal jobs", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await expireCompetencyAiJobs({ query } as never);
    const [fail, cleanup] = query.mock.calls.map((call) => (call as unknown as [string])[0]);
    // Queued > 24 h, and processing with an expired lease after the last attempt or > 24 h old (single attempt too).
    expect(fail).toContain("(status='queued' AND created_at<now()-interval '24 hours')");
    expect(fail).toContain("OR (status='processing' AND lease_until<now() AND (attempts>=$1 OR created_at<now()-interval '24 hours'))");
    expect(query.mock.calls[0]).toEqual([expect.any(String), [2]]);
    expect(fail).toContain("UPDATE stu_comp_assessments a SET ai_status='failed',ai_error_code='worker_timeout'");
    expect(fail).toContain("ai_input=NULL");
    expect(cleanup).toBe("DELETE FROM stu_comp_ai_jobs WHERE status IN ('completed','failed','cancelled') AND updated_at<now()-interval '7 days'");
    for (const call of query.mock.calls) expect((call as unknown as [string])[0]).not.toMatch(/DELETE FROM stu_comp_assessments/);
  });
});

describe("createCompetencyAiExpiry", () => {
  it("runs the expiry at most once per interval", async () => {
    let now = 5_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const query = vi.fn(async () => ({ rows: [] }));
    const expire = createCompetencyAiExpiry();
    await expect(expire({ query } as never)).resolves.toBe(true);
    now += 59_000;
    await expect(expire({ query } as never)).resolves.toBe(false);
    now += 2_000;
    await expect(expire({ query } as never)).resolves.toBe(true);
    expect(query.mock.calls.filter((call) => String((call as unknown as [string])[0]).includes("worker_timeout"))).toHaveLength(2);
  });
});

describe("extend", () => {
  it("extends a live lease", async () => {
    const until = new Date("2026-10-11T10:00:00Z");
    const { app, run } = setup((s) => (s.includes("lease_until>now() RETURNING") ? { rows: [{ leaseUntil: until }] } : undefined));
    await request(app).post(`/w/${JOB}/extend`).set("Authorization", AUTH).send({ leaseToken: LEASE }).expect(200, { leaseUntil: until.toISOString() });
    expect(run.mock.calls[0]![1]).toEqual([JOB, LEASE, 15]);
  });

  it("returns 409 job_expired for a lost lease and 400 for bad input", async () => {
    const { app } = setup();
    await request(app).post(`/w/${JOB}/extend`).set("Authorization", AUTH).send({ leaseToken: LEASE }).expect(409, { error: "job_expired" });
    await request(app).post("/w/not-a-uuid/extend").set("Authorization", AUTH).send({ leaseToken: LEASE }).expect(400, { error: "invalid_input" });
    await request(app).post(`/w/${JOB}/extend`).set("Authorization", AUTH).send({ leaseToken: LEASE, extra: 1 }).expect(400);
  });
});

describe("complete", () => {
  it("stores a valid output and clears the job input", async () => {
    const { app, run, release } = setup(withJob(jobRow()));
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success()).expect(200, { ok: true });
    const calls = run.mock.calls.map(([s, p]) => [s, p] as const);
    const assessment = calls.find(([s]) => s.includes("SET ai_status='completed'"))!;
    expect(assessment[1]).toEqual([ASSESSMENT, USER, JSON.stringify(validOutput()), "gemma4:e4b", "dc35e8d9c606", "0.40.2", "comp-v5"]);
    const job = calls.find(([s]) => s.startsWith("UPDATE stu_comp_ai_jobs SET status=$2"))!;
    expect(job[0]).toContain("ai_input=NULL");
    expect(job[1]).toEqual([JOB, "completed", null, JSON.stringify({ eval_count: 900, total_ms: 120000 })]);
    expect(calls.at(-1)![0]).toBe("COMMIT");
    expect(release).toHaveBeenCalled();
  });

  it("replaces skill and group keys in prose with names before storing", async () => {
    const result = syntheticResult();
    const { app, run } = setup(withJob(jobRow(), { skills: result.skillDirectory, groups: result.groups }));
    const output = {
      ...validOutput(),
      summary: "Lập trình hướng đối tượng (S01) là thế mạnh của nhóm G1.",
      strengths: [{ skillKey: "S01", comment: "Bạn vững (Lập trình hướng đối tượng - S01)." }],
      nextSteps: ["Ôn S03 - Kiểm thử phần mềm.", "Làm một sản phẩm nhỏ.", "Ôn lại Toán rời rạc."]
    };
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(output)).expect(200, { ok: true });
    const lookup = run.mock.calls.find(([s]) => s.includes("computed->'skillDirectory'"))!;
    expect(lookup[1]).toEqual([ASSESSMENT, USER]);
    const stored = JSON.parse((run.mock.calls.find(([s]) => s.includes("SET ai_status='completed'"))![1] as unknown[])[2] as string);
    expect(stored.summary).toBe("Lập trình hướng đối tượng là thế mạnh của nhóm Kỹ thuật phần mềm.");
    expect(stored.strengths).toEqual([{ skillKey: "S01", comment: "Bạn vững (Lập trình hướng đối tượng)." }]);
    expect(stored.nextSteps[0]).toBe("Ôn Kiểm thử phần mềm.");
    expect(stored.gaps[0].skillKey).toBe("S03");
    expect(JSON.stringify([stored.summary, stored.strengths[0].comment, stored.nextSteps])).not.toMatch(/\b[SG]\d/);
  });

  it("stores improvement courses picked from the skill's own list, with keys cleaned from their reasons (comp-v4)", async () => {
    const result = syntheticResult();
    const { app, run } = setup(withJob(jobRow(), { skills: result.skillDirectory, groups: result.groups }));
    const improvement = { skillKey: "S02", priority: "high", courses: [{ courseCode: "TST130", reason: "Đã đạt 6,8 (C+), học cải thiện để nâng S02." }], comment: "Học cải thiện Nhập môn cơ sở dữ liệu." };
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success({ ...validOutput(), improvements: [improvement] })).expect(200, { ok: true });
    const stored = JSON.parse((run.mock.calls.find(([s]) => s.includes("SET ai_status='completed'"))![1] as unknown[])[2] as string);
    expect(stored.improvements).toEqual([{ ...improvement, courses: [{ courseCode: "TST130", reason: "Đã đạt 6,8 (C+), học cải thiện để nâng Cơ sở dữ liệu." }] }]);

    // A course of another skill (TST201 belongs to S03) fails the job.
    const foreign = setup(withJob(jobRow()));
    const wrong = { ...improvement, courses: [{ courseCode: "TST201", reason: "Học mới." }] };
    await request(foreign.app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success({ ...validOutput(), improvements: [wrong] })).expect(200, { ok: true });
    expect(foreign.run.mock.calls.find(([s]) => s.includes("SET ai_status='failed'"))![1]).toEqual([ASSESSMENT, USER, "invalid_ai_output"]);

    // With a career, a weak skill outside it (Mạng máy tính) is no improvement at all (comp-v5).
    const outside = setup(withJob(jobRow()));
    await request(outside.app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success({ ...validOutput(), improvements: [{ ...improvement, skillKey: "S06", courses: [] }] })).expect(200, { ok: true });
    expect(outside.run.mock.calls.find(([s]) => s.includes("SET ai_status='failed'"))![1]).toEqual([ASSESSMENT, USER, "invalid_ai_output"]);
  });

  it("still completes a job queued before comp-v4 with its own schema and prompt version", async () => {
    const legacyInput = { ...aiInput, schema: withCompV3Improvements(aiInput.schema, ["S03"]), promptVersion: "comp-v3" };
    const { app, run } = setup(withJob(jobRow({ ai_input: legacyInput })));
    const output = { ...validOutput(), improvements: [{ skillKey: "S03", priority: "high", comment: "Kiểm thử phần mềm cần thêm sản phẩm." }] };
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(output)).expect(200, { ok: true });
    const params = run.mock.calls.find(([s]) => s.includes("SET ai_status='completed'"))![1] as unknown[];
    expect(JSON.parse(params[2] as string).improvements).toEqual([{ ...output.improvements[0], courses: [] }]);
    expect(params[6]).toBe("comp-v3");
  });

  it("fails the assessment with invalid_ai_output when the output does not validate", async () => {
    const { app, run } = setup(withJob(jobRow()));
    const output = { ...validOutput(), summary: "Điểm của bạn là 91 trên https://example.org" };
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(output)).expect(200, { ok: true });
    const failed = run.mock.calls.find(([s]) => s.includes("SET ai_status='failed'"))!;
    expect(failed[1]).toEqual([ASSESSMENT, USER, "invalid_ai_output"]);
    const job = run.mock.calls.find(([s]) => s.startsWith("UPDATE stu_comp_ai_jobs SET status=$2"))!;
    expect((job[1] as unknown[]).slice(0, 3)).toEqual([JOB, "failed", "invalid_ai_output"]);
    expect(run.mock.calls.some(([s]) => s.includes("SET ai_status='completed'"))).toBe(false);
  });

  it("records a worker error code", async () => {
    const { app, run } = setup(withJob(jobRow()));
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send({ leaseToken: LEASE, error: "ai_output_truncated" }).expect(200);
    expect(run.mock.calls.find(([s]) => s.includes("SET ai_status='failed'"))![1]).toEqual([ASSESSMENT, USER, "ai_output_truncated"]);
    expect(run.mock.calls.find(([s]) => s.startsWith("UPDATE stu_comp_ai_jobs SET status=$2"))![1]).toEqual([JOB, "failed", "ai_output_truncated", null]);
  });

  it("is idempotent for the same lease after completion", async () => {
    for (const status of ["completed", "failed"]) {
      const { app, sql } = setup(withJob(jobRow({ status, valid: null, ai_input: null })));
      await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success()).expect(200, { ok: true });
      expect(sql().filter((s) => s.startsWith("UPDATE"))).toEqual([]);
    }
  });

  it("returns 409 job_expired for another lease, an expired lease, a cancelled or missing job", async () => {
    const cases: (Row | null)[] = [
      jobRow({ lease_token: OTHER_LEASE }),
      jobRow({ valid: false }),
      jobRow({ status: "cancelled", lease_token: null }),
      jobRow({ status: "completed", lease_token: OTHER_LEASE }),
      null
    ];
    for (const row of cases) {
      const { app, sql, release } = setup(withJob(row));
      await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success()).expect(409, { error: "job_expired" });
      expect(sql()).toContain("ROLLBACK");
      expect(sql().filter((s) => s.startsWith("UPDATE"))).toEqual([]);
      expect(release).toHaveBeenCalled();
    }
  });

  it("rejects malformed bodies and unknown error codes", async () => {
    const { app, run } = setup(withJob(jobRow()));
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send({ leaseToken: LEASE, error: "worker_timeout" }).expect(400, { error: "invalid_input" });
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send({ leaseToken: LEASE, error: "ai_failed", output: {} }).expect(400);
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send({ leaseToken: "nope", error: "ai_failed" }).expect(400);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("career skill suggestion jobs", () => {
  const BOTH = ["competency_assessment", "career_skill_suggestion"];
  const careerInput = buildCareerSuggestionInput(careerSource());
  const careerClaim = (s: string) => s.includes("UPDATE career_ai_suggestions j SET status='processing'");
  const competencyClaim = (s: string) => s.includes("UPDATE stu_comp_ai_jobs j SET status='processing'");
  const claimRows: Handler = (s) => (careerClaim(s) ? { rows: [{ id: JOB, leaseToken: LEASE, aiInput: careerInput }] }
    : competencyClaim(s) ? { rows: [{ id: OTHER_LEASE, leaseToken: LEASE, aiInput }] } : undefined);
  const careerRow = (extra: Row = {}): Row => ({ status: "processing", lease_token: LEASE, valid: true, ai_input: careerInput, ...extra });
  const withCareer = (row: Row | null): Handler => (s) => (s.includes("FROM career_ai_suggestions WHERE id=$1 FOR UPDATE") ? { rows: row ? [row] : [] } : undefined);
  const careerUpdate = (run: ReturnType<typeof setup>["run"]) => run.mock.calls.find(([s]) => s.startsWith("UPDATE career_ai_suggestions SET status=$2"));
  const careerOutput = (suggestions: unknown[], newSkills: unknown[] = []) => ({ suggestions, newSkills });
  const suggestion = (skillKey: string) => ({ skillKey, priority: "required", title: "Viết truy vấn SQL (S002)", description: "Dùng hằng ngày.", reason: "Vị trí làm việc với dữ liệu." });

  it("stores the advertised kinds on heartbeat and drops unknown ones", async () => {
    const cases: [object | undefined, string[]][] = [
      [{ kinds: BOTH }, BOTH],
      [{ kinds: ["career_skill_suggestion", "something_new", "career_skill_suggestion"] }, ["career_skill_suggestion"]],
      [{ kinds: ["something_new"] }, ["competency_assessment"]],
      [{}, ["competency_assessment"]],
      [undefined, ["competency_assessment"]]
    ];
    for (const [body, kinds] of cases) {
      const { app, run } = setup();
      const req = request(app).post("/w/heartbeat").set("Authorization", AUTH);
      await (body === undefined ? req : req.send(body)).expect(200, { ok: true });
      expect(run.mock.calls[0]![0]).toContain("kinds=EXCLUDED.kinds");
      expect(run.mock.calls[0]![1]).toEqual([kinds]);
    }
    const { app } = setup();
    await request(app).post("/w/heartbeat").set("Authorization", AUTH).send({ kinds: "career_skill_suggestion" }).expect(400, { error: "invalid_input" });
  });

  it("never gives a career job to an old worker that sends no kinds", async () => {
    for (const body of [undefined, {}]) {
      const { app, sql } = setup(claimRows);
      const req = request(app).post("/w/claim").set("Authorization", AUTH);
      const res = await (body === undefined ? req : req.send(body)).expect(200);
      expect(res.body.job.kind).toBe("competency_assessment");
      expect(sql().some(careerClaim)).toBe(false);
    }
  });

  it("gives a new worker the career job first, without the key map", async () => {
    const { app, run, sql } = setup(claimRows);
    const res = await request(app).post("/w/claim").set("Authorization", AUTH).send({ kinds: BOTH }).expect(200);
    expect(res.body.job).toEqual({ kind: "career_skill_suggestion", id: JOB, leaseToken: LEASE, promptVersion: CAREER_SUGGESTION_PROMPT_VERSION,
      system: careerInput.system, user: careerInput.user, schema: careerInput.schema, options: careerInput.options });
    expect(JSON.stringify(res.body)).not.toContain(fixtureId(2));
    expect(sql().some(competencyClaim)).toBe(false);
    const claim = run.mock.calls.find(([s]) => careerClaim(s))!;
    expect(claim[0]).toContain("ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1");
    expect((claim[1] as unknown[]).slice(1)).toEqual([2, 15]);
    // Career expiry runs with the competency housekeeping.
    const expiry = run.mock.calls.find(([s]) => s.startsWith("UPDATE career_ai_suggestions SET status='failed'"))!;
    expect(expiry[0]).toContain("(status='queued' AND created_at<now()-interval '24 hours')");
    expect(expiry[0]).toContain("ai_input=NULL");
    expect(expiry[1]).toEqual([2, "worker_timeout"]);
  });

  it("falls back to a competency job when no career job is queued, and honours a career-only worker", async () => {
    const competencyOnly: Handler = (s) => (competencyClaim(s) ? { rows: [{ id: JOB, leaseToken: LEASE, aiInput }] } : undefined);
    const both = setup(competencyOnly);
    expect((await request(both.app).post("/w/claim").set("Authorization", AUTH).send({ kinds: BOTH }).expect(200)).body.job.kind).toBe("competency_assessment");
    const careerOnly = setup(competencyOnly);
    await request(careerOnly.app).post("/w/claim").set("Authorization", AUTH).send({ kinds: ["career_skill_suggestion"] }).expect(200, { job: null });
    expect(careerOnly.sql().some(competencyClaim)).toBe(false);
  });

  it("extends the lease of a career job", async () => {
    const until = new Date("2026-10-11T10:00:00Z");
    const { app, run } = setup((s) => (s.startsWith("UPDATE career_ai_suggestions SET lease_until") ? { rows: [{ leaseUntil: until }] } : undefined));
    await request(app).post(`/w/${JOB}/extend`).set("Authorization", AUTH).send({ leaseToken: LEASE }).expect(200, { leaseUntil: until.toISOString() });
    expect(run.mock.calls[1]![1]).toEqual([JOB, LEASE, 15]);
  });

  it("stores a validated career result with model info and clears the input", async () => {
    const { app, run } = setup(withCareer(careerRow()));
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(careerOutput([suggestion("S002"), suggestion("S404")]))).expect(200, { ok: true });
    const update = careerUpdate(run)!;
    expect(update[0]).toContain("ai_input=NULL");
    expect(update[0]).toContain("completed_at=now()");
    const params = update[1] as unknown[];
    expect(params.slice(0, 3)).toEqual([JOB, "completed", null]);
    expect(JSON.parse(params[3] as string)).toEqual({ returned: 2, dropped: 1, items: [
      { skillId: fixtureId(2), skillName: "SQL", isNewSkill: false, isRequired: true, title: "Viết truy vấn SQL", description: "Dùng hằng ngày.", reason: "Vị trí làm việc với dữ liệu." }
    ] });
    expect(params.slice(4)).toEqual([JSON.stringify({ eval_count: 900, total_ms: 120000 }), "gemma4:e4b", "dc35e8d9c606", "0.40.2", CAREER_SUGGESTION_PROMPT_VERSION]);
    expect(run.mock.calls.at(-1)![0]).toBe("COMMIT");
    expect(run.mock.calls.some(([s]) => s.includes("stu_comp_assessments"))).toBe(false);
  });

  it("fails a career job with invalid_ai_output or the error code the worker reported", async () => {
    const invalid = setup(withCareer(careerRow()));
    await request(invalid.app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(careerOutput([suggestion("S404")]))).expect(200);
    expect((careerUpdate(invalid.run)![1] as unknown[]).slice(0, 4)).toEqual([JOB, "failed", "invalid_ai_output", null]);
    const shape = setup(withCareer(careerRow()));
    await request(shape.app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(validOutput())).expect(200);
    expect((careerUpdate(shape.run)![1] as unknown[]).slice(1, 3)).toEqual(["failed", "invalid_ai_output"]);
    const timeout = setup(withCareer(careerRow()));
    await request(timeout.app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send({ leaseToken: LEASE, error: "ai_timeout" }).expect(200);
    expect(careerUpdate(timeout.run)![1]).toEqual([JOB, "failed", "ai_timeout", null, null, null, null, null, CAREER_SUGGESTION_PROMPT_VERSION]);
  });

  it("does not resurrect a cancelled career job and is idempotent for the same lease", async () => {
    for (const row of [careerRow({ status: "cancelled", lease_token: null, ai_input: null }), careerRow({ lease_token: OTHER_LEASE }), careerRow({ valid: false })]) {
      const { app, run, sql } = setup(withCareer(row));
      await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(careerOutput([suggestion("S002")]))).expect(409, { error: "job_expired" });
      expect(careerUpdate(run)).toBeUndefined();
      expect(sql()).toContain("ROLLBACK");
    }
    const done = setup(withCareer(careerRow({ status: "completed", valid: null, ai_input: null })));
    await request(done.app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(careerOutput([suggestion("S002")]))).expect(200, { ok: true });
    expect(careerUpdate(done.run)).toBeUndefined();
  });
});

describe("graduation advice jobs", () => {
  const ALL = ["competency_assessment", "career_skill_suggestion", "graduation_advice"];
  const adviceInput = buildGraduationAdviceInput(syntheticGraduation());
  const careerInput = buildCareerSuggestionInput(careerSource());
  const adviceClaim = (s: string) => s.includes("UPDATE stu_grad_advice j SET status='processing'");
  const careerClaim = (s: string) => s.includes("UPDATE career_ai_suggestions j SET status='processing'");
  const competencyClaim = (s: string) => s.includes("UPDATE stu_comp_ai_jobs j SET status='processing'");
  const queued = (which: { career?: boolean; advice?: boolean; competency?: boolean }): Handler => (s) =>
    careerClaim(s) && which.career ? { rows: [{ id: JOB, leaseToken: LEASE, aiInput: careerInput }] }
      : adviceClaim(s) && which.advice ? { rows: [{ id: JOB, leaseToken: LEASE, aiInput: adviceInput }] }
        : competencyClaim(s) && which.competency ? { rows: [{ id: JOB, leaseToken: LEASE, aiInput }] } : undefined;
  const claim = (app: express.Express, body?: object) => {
    const req = request(app).post("/w/claim").set("Authorization", AUTH);
    return (body === undefined ? req : req.send(body)).expect(200);
  };
  const adviceOutput = {
    summary: "Bạn còn thiếu 2 môn ở Học phần bắt buộc.",
    advice: [{ focus: "G1", text: "Hãy đăng ký Đồ án thực tập (71ITIN40304)." }],
    nextSteps: ["Trao đổi với cố vấn học tập."]
  };
  const adviceRow = (extra: Row = {}): Row => ({ status: "processing", lease_token: LEASE, valid: true, ai_input: adviceInput, ...extra });
  /** The id is in neither the competency nor the career table. */
  const withAdvice = (row: Row | null, career: Row | null = null): Handler => (s) =>
    s.includes("FROM stu_grad_advice WHERE id=$1 FOR UPDATE") ? { rows: row ? [row] : [] }
      : s.includes("FROM career_ai_suggestions WHERE id=$1 FOR UPDATE") ? { rows: career ? [career] : [] } : undefined;
  const adviceUpdate = (run: ReturnType<typeof setup>["run"]) => run.mock.calls.find(([s]) => s.startsWith("UPDATE stu_grad_advice SET status=$2"));

  it("never gives a graduation job to a worker that does not advertise the kind", async () => {
    for (const body of [undefined, {}, { kinds: ["competency_assessment"] }, { kinds: ["competency_assessment", "career_skill_suggestion"] }]) {
      const { app, sql } = setup(queued({ advice: true, competency: true }));
      expect((await claim(app, body)).body.job.kind).toBe("competency_assessment");
      expect(sql().some(adviceClaim)).toBe(false);
    }
    const careerOnly = setup(queued({ advice: true }));
    expect((await claim(careerOnly.app, { kinds: ["career_skill_suggestion"] })).body).toEqual({ job: null });
    expect(careerOnly.sql().some(adviceClaim)).toBe(false);
  });

  it("gives a new worker career jobs first, then graduation advice without its key map, then competency jobs", async () => {
    const all = setup(queued({ career: true, advice: true, competency: true }));
    expect((await claim(all.app, { kinds: ALL })).body.job.kind).toBe("career_skill_suggestion");
    expect(all.sql().some(adviceClaim)).toBe(false);

    const advice = setup(queued({ advice: true, competency: true }));
    const res = await claim(advice.app, { kinds: ALL });
    expect(res.body.job).toEqual({ kind: "graduation_advice", id: JOB, leaseToken: LEASE, promptVersion: GRADUATION_ADVICE_PROMPT_VERSION,
      system: adviceInput.system, user: adviceInput.user, schema: adviceInput.schema, options: adviceInput.options });
    expect(JSON.stringify(res.body)).not.toMatch(/"keys"|row-10|row-92/);
    expect(advice.sql().some(competencyClaim)).toBe(false);
    const claimCall = advice.run.mock.calls.find(([s]) => adviceClaim(s))!;
    expect(claimCall[0]).toContain("ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1");
    expect((claimCall[1] as unknown[]).slice(1)).toEqual([2, 15]);

    const competency = setup(queued({ competency: true }));
    expect((await claim(competency.app, { kinds: ALL })).body.job.kind).toBe("competency_assessment");
    const adviceOnly = setup(queued({ competency: true }));
    expect((await claim(adviceOnly.app, { kinds: ["graduation_advice"] })).body).toEqual({ job: null });
    expect(adviceOnly.sql().some(competencyClaim)).toBe(false);
  });

  it("expires stuck graduation advice in the claim housekeeping", async () => {
    const { app, run } = setup();
    await claim(app, {});
    const expiry = run.mock.calls.find(([s]) => s.startsWith("UPDATE stu_grad_advice SET status='failed'"))!;
    expect(expiry[0]).toContain("(status='queued' AND created_at<now()-interval '24 hours')");
    expect(expiry[0]).toContain("ai_input=NULL");
    expect(expiry[1]).toEqual([2, "worker_timeout"]);
  });

  it("extends a graduation job after the competency and career tables miss it", async () => {
    const until = new Date("2026-10-13T10:00:00Z");
    const { app, run } = setup((s) => (s.startsWith("UPDATE stu_grad_advice SET lease_until") ? { rows: [{ leaseUntil: until }] } : undefined));
    await request(app).post(`/w/${JOB}/extend`).set("Authorization", AUTH).send({ leaseToken: LEASE }).expect(200, { leaseUntil: until.toISOString() });
    const order = run.mock.calls.map(([s]) => s.split(" ").slice(0, 2).join(" "));
    expect(order).toEqual(["UPDATE stu_comp_ai_jobs", "UPDATE career_ai_suggestions", "UPDATE stu_grad_advice"]);
    expect(run.mock.calls[2]![1]).toEqual([JOB, LEASE, 15]);
    await request(setup().app).post(`/w/${JOB}/extend`).set("Authorization", AUTH).send({ leaseToken: LEASE }).expect(409, { error: "job_expired" });
  });

  it("completes a graduation job after the competency and career tables miss it", async () => {
    const { app, run, sql } = setup(withAdvice(adviceRow()));
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(adviceOutput)).expect(200, { ok: true });
    const update = adviceUpdate(run)!;
    expect(update[0]).toContain("ai_input=NULL");
    expect((update[1] as unknown[]).slice(0, 3)).toEqual([JOB, "completed", null]);
    expect(JSON.parse((update[1] as unknown[])[3] as string)).toEqual({
      summary: adviceOutput.summary, advice: [{ focus: "G1", label: "Học phần bắt buộc", text: adviceOutput.advice[0]!.text }], nextSteps: adviceOutput.nextSteps
    });
    expect(sql().at(-1)).toBe("COMMIT");
    expect(sql().some((s) => s.includes("stu_comp_assessments"))).toBe(false);
    const errored = setup(withAdvice(adviceRow()));
    await request(errored.app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send({ leaseToken: LEASE, error: "ai_output_truncated" }).expect(200);
    expect((adviceUpdate(errored.run)![1] as unknown[]).slice(0, 3)).toEqual([JOB, "failed", "ai_output_truncated"]);
  });

  it("returns 409 job_expired for a lost graduation lease, an unknown id, or an id the career table rejects", async () => {
    for (const handler of [withAdvice(adviceRow({ lease_token: OTHER_LEASE })), withAdvice(adviceRow({ status: "cancelled", lease_token: null })), withAdvice(null),
      withAdvice(adviceRow(), { status: "cancelled", lease_token: null, valid: null, ai_input: null })]) {
      const { app, run, sql } = setup(handler);
      await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(adviceOutput)).expect(409, { error: "job_expired" });
      expect(adviceUpdate(run)).toBeUndefined();
      expect(sql()).toContain("ROLLBACK");
    }
    // An id the career table knows is never looked up in the advice table.
    const career = setup(withAdvice(adviceRow(), { status: "cancelled", lease_token: null, valid: null, ai_input: null }));
    await request(career.app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(adviceOutput)).expect(409);
    expect(career.sql().some((s) => s.includes("FROM stu_grad_advice WHERE id=$1"))).toBe(false);
    // Same lease after completion: idempotent.
    const done = setup(withAdvice(adviceRow({ status: "completed", valid: null, ai_input: null })));
    await request(done.app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(adviceOutput)).expect(200, { ok: true });
    expect(adviceUpdate(done.run)).toBeUndefined();
  });
});

describe("competency course suggestion jobs", () => {
  const ALL = ["competency_assessment", "career_skill_suggestion", "graduation_advice", "competency_course_suggestion"];
  const courseInput = buildCourseAiInput(courseSource(), "links");
  const courseClaim = (s: string) => s.includes("UPDATE ad_comp_ai_suggestions j SET status='processing'");
  const competencyClaim = (s: string) => s.includes("UPDATE stu_comp_ai_jobs j SET status='processing'");
  const queued = (which: { course?: boolean; competency?: boolean }): Handler => (s) =>
    courseClaim(s) && which.course ? { rows: [{ id: JOB, leaseToken: LEASE, aiInput: courseInput }] }
      : competencyClaim(s) && which.competency ? { rows: [{ id: JOB, leaseToken: LEASE, aiInput }] } : undefined;
  const claim = (app: express.Express, body?: object) => {
    const req = request(app).post("/w/claim").set("Authorization", AUTH);
    return (body === undefined ? req : req.send(body)).expect(200);
  };
  const courseRow = (extra: Row = {}): Row => ({ status: "processing", lease_token: LEASE, valid: true, ai_input: courseInput, ...extra });
  /** The id is in none of the competency, career and graduation tables. */
  const withCourse = (row: Row | null): Handler => (s) => (s.includes("FROM ad_comp_ai_suggestions WHERE id=$1 FOR UPDATE") ? { rows: row ? [row] : [] } : undefined);
  const courseUpdate = (run: ReturnType<typeof setup>["run"]) => run.mock.calls.find(([s]) => s.startsWith("UPDATE ad_comp_ai_suggestions SET status=$2"));

  it("never gives a course job to a worker that does not advertise the kind", async () => {
    for (const body of [undefined, {}, { kinds: ALL.slice(0, 3) }]) {
      const { app, sql } = setup(queued({ course: true }));
      expect((await claim(app, body)).body).toEqual({ job: null });
      expect(sql().some(courseClaim)).toBe(false);
    }
  });

  it("gives course jobs after competency jobs, without the key maps", async () => {
    const both = setup(queued({ course: true, competency: true }));
    expect((await claim(both.app, { kinds: ALL })).body.job.kind).toBe("competency_assessment");
    expect(both.sql().some(courseClaim)).toBe(false);

    const course = setup(queued({ course: true }));
    const res = await claim(course.app, { kinds: ALL });
    expect(res.body.job).toEqual({ kind: "competency_course_suggestion", id: JOB, leaseToken: LEASE, promptVersion: COURSE_AI_PROMPT_VERSIONS.links,
      system: courseInput.system, user: courseInput.user, schema: courseInput.schema, options: courseInput.options });
    expect(JSON.stringify(res.body)).not.toMatch(/"skills"|"groups"|"linked"/);
    const claimCall = course.run.mock.calls.find(([s]) => courseClaim(s))!;
    expect(claimCall[0]).toContain("FOR UPDATE SKIP LOCKED LIMIT 1");
    expect((claimCall[1] as unknown[]).slice(1)).toEqual([2, 15]);
    // A worker that only runs course proposals never touches the student queue.
    const courseOnly = setup(queued({ course: true, competency: true }));
    expect((await claim(courseOnly.app, { kinds: ["competency_course_suggestion"] })).body.job.kind).toBe("competency_course_suggestion");
    expect(courseOnly.sql().some(competencyClaim)).toBe(false);
  });

  it("extends a course job after the other tables miss it", async () => {
    const until = new Date("2026-10-16T10:00:00Z");
    const { app, run } = setup((s) => (s.startsWith("UPDATE ad_comp_ai_suggestions SET lease_until") ? { rows: [{ leaseUntil: until }] } : undefined));
    await request(app).post(`/w/${JOB}/extend`).set("Authorization", AUTH).send({ leaseToken: LEASE }).expect(200, { leaseUntil: until.toISOString() });
    const order = run.mock.calls.map(([s]) => s.split(" ").slice(0, 2).join(" "));
    expect(order).toEqual(["UPDATE stu_comp_ai_jobs", "UPDATE career_ai_suggestions", "UPDATE stu_grad_advice", "UPDATE ad_comp_ai_suggestions"]);
  });

  it("completes a course job after the other tables miss it and fails an invalid output", async () => {
    const { app, run, sql } = setup(withCourse(courseRow()));
    const output = { links: [{ skillKey: "S001", groupKey: "G1", reason: "Học phần xây dựng ứng dụng web." }], newSkills: [] };
    await request(app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(output)).expect(200, { ok: true });
    const update = courseUpdate(run)!;
    expect(update[0]).toContain("ai_input=NULL");
    expect((update[1] as unknown[]).slice(0, 3)).toEqual([JOB, "completed", null]);
    expect(JSON.parse((update[1] as unknown[])[3] as string)).toMatchObject({ mode: "links", items: [{ skillName: "Lập trình web", hasProfile: true }] });
    expect(sql().at(-1)).toBe("COMMIT");

    const invalid = setup(withCourse(courseRow()));
    await request(invalid.app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success({ links: "nope" })).expect(200);
    expect((courseUpdate(invalid.run)![1] as unknown[]).slice(0, 3)).toEqual([JOB, "failed", "invalid_ai_output"]);

    const cancelled = setup(withCourse(courseRow({ status: "cancelled", lease_token: null })));
    await request(cancelled.app).post(`/w/${JOB}/complete`).set("Authorization", AUTH).send(success(output)).expect(409, { error: "job_expired" });
    expect(courseUpdate(cancelled.run)).toBeUndefined();
  });
});
