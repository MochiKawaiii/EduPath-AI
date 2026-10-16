import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { calculateAssessment } from "../calculate.js";
import { syntheticInputs } from "../fixtures/synthetic-k29.js";
import { createCloudCompetencyAiQueue } from "./queue.js";

const assessmentId = "44444444-4444-4444-8444-444444444444";
const userId = "11111111-1111-4111-8111-111111111111";
const inputs = syntheticInputs();
const result = calculateAssessment(inputs);

function client(pendingOthers = 0) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("RETURNING assessment_id")) return { rowCount: 0, rows: [] };
    if (sql.includes("count(*)::int")) return { rowCount: 1, rows: [{ count: pendingOthers }] };
    return { rowCount: 1, rows: [] };
  });
  return { client: { query } as unknown as PoolClient, query, sql: () => query.mock.calls.map(([text]) => String(text)) };
}

describe("cloud competency queue (AI 100%)", () => {
  it("queues a runner 'cloud' job with the scoring prompt and marks the assessment AI-scored", async () => {
    const onQueued = vi.fn();
    const queue = createCloudCompetencyAiQueue({ onQueued });
    expect(queue).toMatchObject({ enabled: true, mode: "cloud" });
    const t = client();
    await expect(queue.enqueue(t.client, { assessmentId, userId, result, inputs })).resolves.toBe("queued");
    const insert = t.query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO stu_comp_ai_jobs"))!;
    expect(insert[0]).toContain("'cloud'");
    const aiInput = JSON.parse(String((insert[1] as unknown[])[3]));
    expect(aiInput).toMatchObject({ kind: "cloud_scoring", promptVersion: "comp-ai-v1" });
    expect(aiInput.user).toContain("[4] Kỹ năng");
    expect(t.sql().some((sql) => sql.includes("scoring_mode='ai'") && sql.includes("ai_status='queued'"))).toBe(true);
    expect(t.sql()[0]).toContain("pg_advisory_xact_lock");
  });

  it("defers when the shared queue is full and needs the raw data", async () => {
    const queue = createCloudCompetencyAiQueue();
    const full = client(25);
    await expect(queue.enqueue(full.client, { assessmentId, userId, result, inputs })).resolves.toBe("deferred");
    expect(full.sql().some((sql) => sql.includes("ai_status='deferred'") && sql.includes("scoring_mode='ai'"))).toBe(true);
    expect(full.sql().some((sql) => sql.startsWith("INSERT INTO stu_comp_ai_jobs"))).toBe(false);
    await expect(queue.enqueue(client().client, { assessmentId, userId, result })).rejects.toThrow("cloud_scoring_needs_inputs");
  });

  it("is always online: the API server runs the jobs", async () => {
    const queue = createCloudCompetencyAiQueue();
    await expect(queue.workerOnline({ query: vi.fn(async () => ({ rowCount: 0, rows: [] })) })).resolves.toBe(true);
  });
});
