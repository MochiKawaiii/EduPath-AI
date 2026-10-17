import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { COMPETENCY_AI_QUEUE_LOCK_KEY, MAX_PENDING_AI_JOBS, createCompetencyAiQueue } from "./queue.js";
import { syntheticResult } from "./test-fixture.js";

const USER = "11111111-1111-4111-8111-111111111111";
const ASSESSMENT = "22222222-2222-4222-8222-222222222222";
const OLD_ASSESSMENT = "33333333-3333-4333-8333-333333333333";

function mockClient(options: { pending?: number; cancelled?: string[] } = {}) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.startsWith("UPDATE stu_comp_ai_jobs SET status='cancelled'")) {
      const rows = (options.cancelled ?? []).map((assessment_id) => ({ assessment_id }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("count(*)")) return { rows: [{ count: options.pending ?? 0 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  return { client: { query } as unknown as PoolClient, query };
}
const sqlOf = (query: ReturnType<typeof mockClient>["query"]) => query.mock.calls.map(([sql]) => sql);
const input = () => ({ assessmentId: ASSESSMENT, userId: USER, result: syntheticResult() });

describe("createCompetencyAiQueue", () => {
  it("uses a new advisory lock key", () => {
    expect(COMPETENCY_AI_QUEUE_LOCK_KEY).not.toBe(1946032027);
    expect(MAX_PENDING_AI_JOBS).toBe(25);
  });

  it("enqueue cancels the previous pending job, inserts the job and marks the assessment queued", async () => {
    const { client, query } = mockClient({ cancelled: [OLD_ASSESSMENT] });
    await expect(createCompetencyAiQueue({ enabled: true }).enqueue(client, input())).resolves.toBe("queued");
    const sql = sqlOf(query);
    expect(query.mock.calls[0]).toEqual(["SELECT pg_advisory_xact_lock($1)", [COMPETENCY_AI_QUEUE_LOCK_KEY]]);
    expect(sql[1]).toContain("SET status='cancelled',ai_input=NULL");
    expect(query.mock.calls[1]![1]).toEqual([USER]);
    expect(sql[2]).toContain("SET ai_status='cancelled'");
    expect(query.mock.calls[2]![1]).toEqual([USER, [OLD_ASSESSMENT]]);
    const insert = query.mock.calls.find(([s]) => s.startsWith("INSERT INTO stu_comp_ai_jobs"))!;
    const params = insert[1] as unknown[];
    expect(params.slice(1, 3)).toEqual([ASSESSMENT, USER]);
    const aiInput = JSON.parse(params[3] as string);
    expect(Object.keys(aiInput).sort()).toEqual(["options", "promptVersion", "schema", "system", "user"]);
    expect(aiInput.promptVersion).toBe("comp-v6");
    const last = query.mock.calls.at(-1)!;
    expect(last[0]).toContain("SET ai_status='queued'");
    expect(last[1]).toEqual([ASSESSMENT, USER]);
  });

  it("enqueue defers without a job when 25 jobs are pending", async () => {
    const { client, query } = mockClient({ pending: 25 });
    await expect(createCompetencyAiQueue({ enabled: true }).enqueue(client, input())).resolves.toBe("deferred");
    expect(sqlOf(query).some((s) => s.startsWith("INSERT"))).toBe(false);
    expect(query.mock.calls.at(-1)).toEqual([expect.stringContaining("SET ai_status='deferred'"), [ASSESSMENT, USER]]);
  });

  it("regenerate changes nothing when the queue is full", async () => {
    const { client, query } = mockClient({ pending: 30 });
    await expect(createCompetencyAiQueue({ enabled: true }).regenerate(client, input())).resolves.toBe("deferred");
    expect(sqlOf(query).filter((s) => s.startsWith("UPDATE") || s.startsWith("INSERT"))).toEqual([]);
  });

  it("regenerate queues a new job", async () => {
    const { client, query } = mockClient({ pending: 3 });
    await expect(createCompetencyAiQueue({ enabled: true }).regenerate(client, input())).resolves.toBe("queued");
    expect(sqlOf(query).some((s) => s.startsWith("INSERT INTO stu_comp_ai_jobs"))).toBe(true);
  });

  it("cancel is scoped by user and assessment and reports whether a job was cancelled", async () => {
    const hit = mockClient({ cancelled: [ASSESSMENT] });
    await expect(createCompetencyAiQueue({ enabled: true }).cancel(hit.client, { assessmentId: ASSESSMENT, userId: USER })).resolves.toBe(true);
    expect(hit.query.mock.calls[1]![0]).toContain("AND assessment_id=$2");
    expect(hit.query.mock.calls[1]![1]).toEqual([USER, ASSESSMENT]);
    const miss = mockClient();
    await expect(createCompetencyAiQueue({ enabled: true }).cancel(miss.client, { assessmentId: ASSESSMENT, userId: USER })).resolves.toBe(false);
    expect(sqlOf(miss.query).some((s) => s.includes("stu_comp_assessments"))).toBe(false);
  });

  it("reports the worker online from a recent heartbeat", async () => {
    const queue = createCompetencyAiQueue({ enabled: true });
    const online = { query: vi.fn(async () => ({ rows: [{ online: true }] })) };
    const stale = { query: vi.fn(async () => ({ rows: [{ online: false }] })) };
    const none = { query: vi.fn(async () => ({ rows: [] })) };
    await expect(queue.workerOnline(online as never)).resolves.toBe(true);
    await expect(queue.workerOnline(stale as never)).resolves.toBe(false);
    await expect(queue.workerOnline(none as never)).resolves.toBe(false);
    expect(online.query.mock.calls[0]).toEqual([expect.stringContaining("stu_comp_ai_worker_status"), [60]]);
  });

  it("expires stale jobs from the student API too, rate-limited, without failing the read", async () => {
    let now = 9_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const queue = createCompetencyAiQueue({ enabled: true });
    const db = { query: vi.fn(async (sql: string) => sql.startsWith("WITH failed") ? Promise.reject(new Error("boom")) : { rows: [{ online: true }] }) };
    const expiries = () => db.query.mock.calls.filter(([sql]) => sql.includes("error_code='worker_timeout'")).length;
    await expect(queue.workerOnline(db as never)).resolves.toBe(true);
    expect(expiries()).toBe(1);
    await expect(queue.workerOnline(db as never)).resolves.toBe(true);
    expect(expiries()).toBe(1);
    now += 61_000;
    const { client, query } = mockClient();
    await expect(queue.enqueue(client, input())).resolves.toBe("queued");
    const sql = sqlOf(query);
    // Expiry runs inside the write transaction before the global queue-size check.
    expect(sql.findIndex((s) => s.includes("error_code='worker_timeout'"))).toBeLessThan(sql.findIndex((s) => s.includes("count(*)")));
    vi.restoreAllMocks();
  });

  it("disabled queue never touches the database for enqueue", async () => {
    const queue = createCompetencyAiQueue({ enabled: false });
    const { client, query } = mockClient();
    expect(queue.enabled).toBe(false);
    await expect(queue.enqueue(client, input())).rejects.toThrow("competency_ai_disabled");
    await expect(queue.cancel(client, { assessmentId: ASSESSMENT, userId: USER })).resolves.toBe(false);
    await expect(queue.workerOnline({ query } as never)).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
