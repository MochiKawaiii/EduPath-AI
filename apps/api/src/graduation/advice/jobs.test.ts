import type { PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../../db/pool.js";
import {
  adviceErrorCode, adviceNeeded, autoRetryDue, claimGraduationAdvice, completeGraduationAdvice, createGraduationAdviceExpiry, currentAdvice,
  deleteGraduationAdvice, ensureGraduationAdvice, ensureGraduationAdviceAfterImport, expireGraduationAdvice, extendGraduationAdvice,
  GraduationAdviceError, pruneGraduationAdvice, retryGraduationAdvice, type GraduationAdviceRow,
} from "./jobs.js";
import { buildGraduationAdviceInput, GRADUATION_ADVICE_PROMPT_VERSION } from "./prompt.js";
import { ADVICE_TRANSCRIPT_VERSION, syntheticGraduation, unevaluatedGraduation } from "./test-fixture.js";

// Synthetic K29 data only (fixtures/synthetic-k29.json); no real student record.
const USER = "11111111-1111-4111-8111-111111111111";
const ADVICE = "44444444-4444-4444-8444-444444444444";
const LEASE = "55555555-5555-4555-8555-555555555555";
const OTHER_LEASE = "66666666-6666-4666-8666-666666666666";
const graduation = syntheticGraduation();
const FINGERPRINT = graduation.fingerprint;
const OLD = "f".repeat(64);

const row = (extra: Partial<GraduationAdviceRow> = {}): GraduationAdviceRow => ({
  id: ADVICE, fingerprint: FINGERPRINT, status: "completed", errorCode: null, createdAt: new Date("2026-10-13T08:00:00Z"),
  completedAt: new Date("2026-10-13T08:01:00Z"), model: "gemma4:e4b", standardVersion: 1, output: null, recent: false, retryDue: true, ...extra,
});

type State = { rows?: GraduationAdviceRow[]; othersPending?: number; active?: boolean };

function fakeClient(state: State = {}, log: string[] = []) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    log.push(sql);
    if (sql.startsWith("SELECT id FROM users")) return state.active === false ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ id: USER }] };
    if (sql.includes("FROM stu_grad_advice WHERE user_id=$1 ORDER BY created_at DESC,id DESC")) return { rowCount: state.rows?.length ?? 0, rows: state.rows ?? [] };
    if (sql.includes("count(*)::int AS count FROM stu_grad_advice")) return { rowCount: 1, rows: [{ count: state.othersPending ?? 0 }] };
    if (sql.startsWith("INSERT INTO stu_grad_advice")) return { rowCount: 1, rows: [{ createdAt: new Date("2026-10-13T10:00:00Z") }] };
    return { rowCount: 0, rows: [] };
  });
  const calls = () => query.mock.calls.map(([sql, params]) => [sql, params ?? []] as const);
  return { client: { query } as unknown as PoolClient, query, calls, sql: () => calls().map(([sql]) => sql), log };
}

const reader = (value = graduation as ReturnType<typeof syntheticGraduation> | ReturnType<typeof unevaluatedGraduation>, log?: string[]) =>
  vi.fn(async () => { log?.push("READ"); return value; });
const writes = (sql: string[]) => sql.filter((text) => /^(INSERT|UPDATE|DELETE)/.test(text.trim()));

afterEach(() => vi.restoreAllMocks());

describe("row helpers", () => {
  it("find the row for the current facts and decide automatic retries", () => {
    const failed = row({ status: "failed", errorCode: "ai_timeout" });
    expect(currentAdvice([row({ fingerprint: OLD, id: "a" }), failed], FINGERPRINT)).toBe(failed);
    expect(currentAdvice([failed], null)).toBeNull();
    expect(autoRetryDue([failed], FINGERPRINT)).toBe(true);
    expect(autoRetryDue([row({ status: "cancelled" })], FINGERPRINT)).toBe(true);
    expect(autoRetryDue([failed, row({ status: "failed", id: "b" })], FINGERPRINT)).toBe(false);
    expect(autoRetryDue([row({ status: "failed", retryDue: false })], FINGERPRINT)).toBe(false);
    expect(autoRetryDue([row({ status: "completed" })], FINGERPRINT)).toBe(false);
    expect(adviceNeeded([], FINGERPRINT)).toBe(true);
    expect(adviceNeeded([row({ fingerprint: OLD })], FINGERPRINT)).toBe(true);
    expect(adviceNeeded([failed], FINGERPRINT)).toBe(true);
    expect(adviceNeeded([row({ status: "queued" })], FINGERPRINT)).toBe(false);
    expect(adviceNeeded([], null)).toBe(false);
  });
});

describe("ensureGraduationAdvice", () => {
  it("locks the student's row, then the queue, and only then reads the graduation page", async () => {
    const log: string[] = [];
    const { client, calls } = fakeClient({ rows: [row()] }, log);
    const expire = vi.fn(async () => { log.push("EXPIRE"); return true; });
    await ensureGraduationAdvice(client, USER, { read: reader(graduation, log), expire });
    expect(log.slice(0, 4)).toEqual([
      "SELECT id FROM users WHERE id=$1 AND is_active FOR KEY SHARE",
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      "EXPIRE",
      "READ",
    ]);
    expect(calls()[0]![1]).toEqual([USER]);
    expect(calls()[1]![1]).toEqual(["edupath:graduation-ai-advice"]);
    expect(expire).toHaveBeenCalledWith(client);
  });

  it("returns the current row unchanged while it is queued, processing or completed", async () => {
    for (const status of ["queued", "processing", "completed"] as const) {
      const current = row({ status, recent: true });
      const { client, sql } = fakeClient({ rows: [current] });
      expect(await ensureGraduationAdvice(client, USER, { read: reader() })).toEqual({ kind: "stored", row: current, created: false, graduation });
      expect(writes(sql())).toEqual([]);
    }
  });

  it("queues a job for new facts: cancels pending advice for other facts first, stores the input and prunes", async () => {
    const { client, calls, sql } = fakeClient({ rows: [row({ fingerprint: OLD, status: "queued" })] });
    const outcome = await ensureGraduationAdvice(client, USER, { read: reader() });
    expect(outcome).toMatchObject({ kind: "stored", created: true, row: { fingerprint: FINGERPRINT, status: "queued", standardVersion: 1, output: null, recent: true } });
    const [cancel, insert, prune] = writes(sql());
    expect(cancel).toContain("UPDATE stu_grad_advice SET status='cancelled',ai_input=NULL");
    expect(cancel).toContain("WHERE user_id=$1 AND status IN ('queued','processing') AND fingerprint<>$2");
    expect(insert).toContain("INSERT INTO stu_grad_advice");
    expect(prune).toContain("DELETE FROM stu_grad_advice WHERE user_id=$1 AND status NOT IN ('queued','processing')");
    expect(calls().find(([text]) => text === cancel)![1]).toEqual([USER, FINGERPRINT]);
    expect(calls().find(([text]) => text === prune)![1]).toEqual([USER, 5]);
    const params = calls().find(([text]) => text === insert)![1] as unknown[];
    expect(params[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(outcome.kind === "stored" && outcome.row.id).toBe(params[0]);
    expect(params.slice(1, 8)).toEqual([USER, ADVICE_TRANSCRIPT_VERSION, graduation.standard.id, graduation.standard.revisionId, 1,
      graduation.evaluation.calcVersion, FINGERPRINT]);
    expect(JSON.parse(params[8] as string)).toEqual(buildGraduationAdviceInput(graduation));
    expect(params[9]).toBe(GRADUATION_ADVICE_PROMPT_VERSION);
  });

  it("re-queues failed or cancelled advice by itself once, a minute after it finished", async () => {
    for (const status of ["failed", "cancelled"] as const) {
      const due = fakeClient({ rows: [row({ status })] });
      expect(await ensureGraduationAdvice(due.client, USER, { read: reader() })).toMatchObject({ kind: "stored", created: true });
      expect(due.sql().some((text) => text.startsWith("INSERT INTO stu_grad_advice"))).toBe(true);
    }
    const failed = row({ status: "failed", errorCode: "invalid_ai_output" });
    for (const rows of [[failed, row({ status: "failed", id: "b" })], [row({ status: "failed", retryDue: false })]]) {
      const { client, sql } = fakeClient({ rows });
      expect(await ensureGraduationAdvice(client, USER, { read: reader() })).toEqual({ kind: "stored", row: rows[0], created: false, graduation });
      expect(writes(sql())).toEqual([]);
    }
  });

  it("inserts at most once per student per 30 seconds", async () => {
    const recent = row({ fingerprint: OLD, status: "completed", recent: true, id: "recent" });
    const { client, sql } = fakeClient({ rows: [recent] });
    expect(await ensureGraduationAdvice(client, USER, { read: reader() })).toEqual({ kind: "stored", row: recent, created: false, graduation });
    // A failed row for the current facts is answered rather than the newer row for other facts.
    const failed = row({ status: "failed", id: "failed" });
    const both = fakeClient({ rows: [recent, failed] });
    expect(await ensureGraduationAdvice(both.client, USER, { read: reader() })).toMatchObject({ row: { id: "failed" }, created: false });
    expect([...writes(sql()), ...writes(both.sql())]).toEqual([]);
  });

  it("defers without storing anything while 20 jobs of other students are pending", async () => {
    const { client, calls, sql } = fakeClient({ rows: [row({ fingerprint: OLD, status: "queued" })], othersPending: 20 });
    expect(await ensureGraduationAdvice(client, USER, { read: reader() })).toEqual({ kind: "deferred", graduation });
    expect(writes(sql())).toEqual([]);
    expect(calls().find(([text]) => text.includes("count(*)"))![0]).toContain("user_id<>$1");
    const roomy = fakeClient({ othersPending: 19 });
    expect(await ensureGraduationAdvice(roomy.client, USER, { read: reader() })).toMatchObject({ kind: "stored", created: true });
  });

  it("has nothing to do without an evaluation, and refuses an inactive account", async () => {
    const { client, sql } = fakeClient({ rows: [row()] });
    expect(await ensureGraduationAdvice(client, USER, { read: reader(unevaluatedGraduation()) })).toMatchObject({ kind: "unavailable" });
    expect(sql().some((text) => text.includes("stu_grad_advice"))).toBe(false);
    const inactive = fakeClient({ active: false });
    const read = reader();
    await expect(ensureGraduationAdvice(inactive.client, USER, { read })).rejects.toMatchObject({ code: "account_unavailable", status: 403 });
    expect(read).not.toHaveBeenCalled();
  });
});

describe("retryGraduationAdvice", () => {
  it("queues again after a failure, even past the automatic cap", async () => {
    const rows = [row({ status: "failed" }), row({ status: "failed", id: "b" })];
    const { client, sql } = fakeClient({ rows });
    expect(await retryGraduationAdvice(client, USER, { read: reader() })).toMatchObject({ kind: "stored", created: true, row: { status: "queued" } });
    expect(sql().some((text) => text.startsWith("INSERT INTO stu_grad_advice"))).toBe(true);
  });

  it("answers 409 advice_not_retryable unless the row for the current facts failed or was cancelled", async () => {
    for (const rows of [[], [row({ status: "completed" })], [row({ status: "queued" })], [row({ status: "failed", fingerprint: OLD })]]) {
      const { client, sql } = fakeClient({ rows });
      await expect(retryGraduationAdvice(client, USER, { read: reader() })).rejects.toMatchObject({ code: "advice_not_retryable", status: 409 });
      expect(writes(sql())).toEqual([]);
    }
    const { client } = fakeClient({ rows: [row({ status: "failed" })] });
    await expect(retryGraduationAdvice(client, USER, { read: reader(unevaluatedGraduation()) })).rejects.toMatchObject({ code: "advice_not_retryable" });
  });

  it("keeps the 30 second guard and the queue cap (429)", async () => {
    const recent = fakeClient({ rows: [row({ status: "failed", recent: true })] });
    await expect(retryGraduationAdvice(recent.client, USER, { read: reader() })).rejects.toMatchObject({ code: "advice_too_frequent", status: 429 });
    const full = fakeClient({ rows: [row({ status: "cancelled" })], othersPending: 25 });
    await expect(retryGraduationAdvice(full.client, USER, { read: reader() })).rejects.toMatchObject({ code: "queue_full", status: 429 });
    expect([...writes(recent.sql()), ...writes(full.sql())]).toEqual([]);
  });
});

describe("housekeeping", () => {
  it("fails stuck advice and clears its input", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] }));
    await expireGraduationAdvice({ query } as never);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("UPDATE stu_grad_advice SET status='failed',error_code=$2,ai_input=NULL");
    expect(sql).toContain("(status='queued' AND created_at<now()-interval '24 hours')");
    expect(sql).toContain("OR (status='processing' AND lease_until<now() AND (attempts>=$1 OR created_at<now()-interval '24 hours'))");
    expect(sql).toContain("completed_at=now()");
    expect(params).toEqual([2, "worker_timeout"]);
  });

  it("runs the expiry at most once per interval", async () => {
    let now = 9_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const query = vi.fn(async () => ({ rows: [] }));
    const expire = createGraduationAdviceExpiry();
    await expect(expire({ query } as never)).resolves.toBe(true);
    now += 59_000;
    await expect(expire({ query } as never)).resolves.toBe(false);
    now += 2_000;
    await expect(expire({ query } as never)).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("deletes every row of a student and prunes beyond the newest five", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] }));
    await deleteGraduationAdvice({ query } as never, USER);
    expect(query.mock.calls[0]).toEqual(["DELETE FROM stu_grad_advice WHERE user_id=$1", [USER]]);
    await pruneGraduationAdvice({ query } as never, USER);
    expect(query.mock.calls[1]![0]).toContain("ORDER BY created_at DESC,id DESC LIMIT $2");
    expect(query.mock.calls[1]![1]).toEqual([USER, 5]);
  });
});

describe("worker side", () => {
  const aiInput = buildGraduationAdviceInput(graduation);
  const locked = (extra: Record<string, unknown> = {}) => ({ status: "processing", lease_token: LEASE, valid: true, ai_input: aiInput, ...extra });
  const output = {
    summary: "Bạn còn thiếu 2 môn ở [G1] và 6 TC ở Nhóm tự chọn TC306.",
    advice: [{ focus: "G5", text: "Hãy chọn thêm 6 tín chỉ trong Nhóm tự chọn TC306." }, { focus: "G1", text: "Xem https://example.org" }],
    nextSteps: ["Trao đổi với cố vấn học tập."],
  };
  const success = (value: unknown = output) => ({ leaseToken: LEASE, model: "gemma4:e4b", digest: "dc35e8d9c606", ollamaVersion: "0.40.2", metrics: { eval_count: 300 }, output: value });
  const completeWith = async (job: Record<string, unknown> | null, input: Parameters<typeof completeGraduationAdvice>[2]) => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => (sql.includes("FOR UPDATE") ? { rows: job ? [job] : [] } : { rows: [] }));
    const result = await completeGraduationAdvice({ query } as unknown as PoolClient, ADVICE, input);
    const update = query.mock.calls.find(([sql]) => sql.startsWith("UPDATE stu_grad_advice SET status=$2"));
    return { result, update: update && { sql: update[0], params: update[1] as unknown[] } };
  };

  it("claims the oldest runnable advice with SKIP LOCKED and a 15 minute lease", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ id: ADVICE, leaseToken: LEASE, aiInput }] }));
    expect(await claimGraduationAdvice({ query } as never, LEASE)).toEqual({ id: ADVICE, leaseToken: LEASE, aiInput });
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("ai_input IS NOT NULL AND (status='queued' OR (status='processing' AND lease_until<now() AND attempts<$2))");
    expect(sql).toContain("ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1");
    expect(sql).toContain("attempts=j.attempts+1");
    expect(params).toEqual([LEASE, 2, 15]);
    const empty = vi.fn(async () => ({ rows: [] }));
    expect(await claimGraduationAdvice({ query: empty } as never, LEASE)).toBeNull();
  });

  it("extends only a live lease", async () => {
    const until = new Date("2026-10-13T10:15:00Z");
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ leaseUntil: until }] }));
    expect(await extendGraduationAdvice({ query } as never, ADVICE, LEASE)).toBe(until);
    expect(query.mock.calls[0]![0]).toContain("WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>now()");
    expect(query.mock.calls[0]![1]).toEqual([ADVICE, LEASE, 15]);
    expect(await extendGraduationAdvice({ query: vi.fn(async () => ({ rows: [] })) } as never, ADVICE, LEASE)).toBeNull();
  });

  it("stores the validated, cleaned output with the model metadata and clears the input", async () => {
    const { result, update } = await completeWith(locked(), success());
    expect(result).toBe("ok");
    expect(update!.sql).toContain("ai_input=NULL");
    expect(update!.sql).toContain("completed_at=now()");
    expect(update!.params.slice(0, 3)).toEqual([ADVICE, "completed", null]);
    expect(JSON.parse(update!.params[3] as string)).toEqual({
      summary: "Bạn còn thiếu 2 môn ở Học phần bắt buộc và 6 TC ở Nhóm tự chọn TC306.",
      advice: [{ focus: "G5", label: "Nhóm tự chọn TC306", text: "Hãy chọn thêm 6 tín chỉ trong Nhóm tự chọn TC306." }],
      nextSteps: ["Trao đổi với cố vấn học tập."],
    });
    expect(update!.params.slice(4)).toEqual([JSON.stringify({ eval_count: 300 }), "gemma4:e4b", "dc35e8d9c606", "0.40.2", GRADUATION_ADVICE_PROMPT_VERSION]);
  });

  it("fails with invalid_ai_output when nothing usable remains, or with the worker's error code", async () => {
    const invalid = await completeWith(locked(), success({ ...output, nextSteps: ["Xem https://example.org"] }));
    expect(invalid.result).toBe("ok");
    expect(invalid.update!.params.slice(0, 4)).toEqual([ADVICE, "failed", "invalid_ai_output", null]);
    expect(invalid.update!.params[5]).toBe("gemma4:e4b");
    const malformed = await completeWith(locked({ ai_input: { user: "x" } }), success());
    expect(malformed.update!.params.slice(1, 3)).toEqual(["failed", "invalid_ai_output"]);
    const timeout = await completeWith(locked(), { leaseToken: LEASE, error: "ai_timeout" });
    expect(timeout.update!.params).toEqual([ADVICE, "failed", "ai_timeout", null, null, null, null, null, GRADUATION_ADVICE_PROMPT_VERSION]);
  });

  it("is idempotent for the same lease, expired for another lease, a lost lease or a cancelled row, and missing for an unknown id", async () => {
    for (const status of ["completed", "failed"]) {
      const same = await completeWith(locked({ status, valid: null, ai_input: null }), success());
      expect(same).toEqual({ result: "ok", update: undefined });
    }
    for (const job of [locked({ lease_token: OTHER_LEASE }), locked({ valid: false }), locked({ status: "cancelled", lease_token: null, ai_input: null }),
      locked({ status: "completed", lease_token: OTHER_LEASE })]) {
      expect(await completeWith(job, success())).toEqual({ result: "expired", update: undefined });
    }
    expect(await completeWith(null, success())).toEqual({ result: "missing", update: undefined });
  });
});

describe("ensureGraduationAdviceAfterImport", () => {
  const poolWith = (query: ReturnType<typeof fakeClient>["query"]) => {
    const release = vi.fn();
    return { pool: { connect: vi.fn(async () => ({ query, release })) } as unknown as DatabasePool, release };
  };

  it("queues advice in a short transaction of its own", async () => {
    const { query, sql } = fakeClient();
    const { pool, release } = poolWith(query);
    await ensureGraduationAdviceAfterImport(pool, USER, { read: reader() });
    expect(sql()[0]).toBe("BEGIN");
    expect(sql().some((text) => text.startsWith("INSERT INTO stu_grad_advice"))).toBe(true);
    expect(sql().at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("never throws: rolls back, releases and logs only an error code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { query, sql } = fakeClient();
    const { pool, release } = poolWith(query);
    const failing = vi.fn(async () => { throw Object.assign(new Error("duplicate key value (user_id)=(11111111-1111-4111-8111-111111111111)"), { code: "23505" }); });
    await expect(ensureGraduationAdviceAfterImport(pool, USER, { read: failing })).resolves.toBeUndefined();
    expect(sql().at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("[graduation-advice] post-import ensure failed (23505)");
    const broken = { connect: vi.fn(async () => { throw new TypeError("connection refused to secret-host"); }) } as unknown as DatabasePool;
    await expect(ensureGraduationAdviceAfterImport(broken, USER)).resolves.toBeUndefined();
    expect(error).toHaveBeenLastCalledWith("[graduation-advice] post-import ensure failed (TypeError)");
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/1111|secret|duplicate/);
  });

  it("names errors by code only", () => {
    expect(adviceErrorCode(new GraduationAdviceError("queue_full", 429))).toBe("queue_full");
    expect(adviceErrorCode(Object.assign(new Error("x"), { code: "40P01" }))).toBe("40P01");
    expect(adviceErrorCode(Object.assign(new Error("x"), { code: "not a sqlstate" }))).toBe("Error");
    expect(adviceErrorCode("boom")).toBe("unknown");
  });
});
