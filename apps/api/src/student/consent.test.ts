import { readFile } from "node:fs/promises";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { TRANSCRIPT_POLICY_VERSION } from "./consent.js";
import { createStudentDataRouter } from "./router.js";

const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const transcriptVersion = "33333333-3333-4333-8333-333333333333";
const origin = "https://edupath.example";
const student = {
  userId: studentId,
  identityKey: `${tenantId}:${studentId}`,
  tenantId,
  objectId: studentId,
  name: "Student User",
  email: "student@example.edu",
  username: "student@example.edu",
  role: "student",
  signedInAt: new Date(0).toISOString(),
} satisfies AuthenticatedUser;
const pdf = Buffer.from("%PDF-1.7\n%test\n");

function setup() {
  const clientQuery = vi.fn(async (sql: string) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
    if (sql.includes("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: studentId }] };
    if (sql.includes("SELECT version FROM student_transcripts")) return { rowCount: 0, rows: [] };
    if (sql.includes("SELECT id FROM transcript_jobs")) return { rowCount: 0, rows: [] };
    if (sql.includes("count(*)")) return { rowCount: 1, rows: [{ count: 0 }] };
    if (sql.includes("INSERT INTO transcript_jobs")) return { rowCount: 1, rows: [{ id: "job", status: "queued" }] };
    return { rowCount: 1, rows: [] };
  });
  const connect = vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() });
  const pool = { connect, query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }) } as unknown as DatabasePool;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: student } as typeof req.session;
    next();
  });
  app.use("/student", createStudentDataRouter(pool, origin, true));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "unexpected_error" });
  });
  return { app, clientQuery, connect };
}

function upload(app: express.Express, consentVersion?: string) {
  const call = request(app).post("/student/transcript").set("Origin", origin)
    .set("Content-Type", "application/pdf").set("X-File-Name", "bang-diem.pdf").set("X-Confirm-Own-Transcript", "true");
  return (consentVersion ? call.set("X-Consent-Policy-Version", consentVersion) : call).send(pdf);
}

const sqlCalls = (query: ReturnType<typeof setup>["clientQuery"]) => query.mock.calls.map(([sql]) => String(sql));

describe("transcript processing consent", () => {
  it("rejects an import without consent to the privacy policy", async () => {
    const { app, connect } = setup();
    await upload(app).expect(400, { error: "consent_required" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects consent given to an outdated policy version", async () => {
    const { app, connect } = setup();
    await upload(app, "2000-01-01").expect(409, { error: "policy_outdated" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("records consent to the current policy before queueing the transcript", async () => {
    const { app, clientQuery } = setup();
    await upload(app, TRANSCRIPT_POLICY_VERSION).expect(202);

    const calls = sqlCalls(clientQuery);
    const superseded = calls.findIndex((sql) => sql.includes("end_reason='superseded'"));
    const granted = calls.findIndex((sql) => sql.includes("INSERT INTO data_consents"));
    const queued = calls.findIndex((sql) => sql.includes("INSERT INTO transcript_jobs"));
    expect(superseded).toBeGreaterThan(-1);
    expect(granted).toBeGreaterThan(superseded);
    expect(queued).toBeGreaterThan(granted);
    expect(clientQuery.mock.calls[granted]?.[1]).toEqual([expect.any(String), studentId, TRANSCRIPT_POLICY_VERSION]);
    expect(calls.at(-1)).toBe("COMMIT");
  });

  it("records the withdrawal when the student deletes the transcript", async () => {
    const { app, clientQuery } = setup();
    await request(app).delete("/student/transcript").set("Origin", origin)
      .send({ version: transcriptVersion, confirmed: true }).expect(200, { deleted: true });

    const withdrawn = clientQuery.mock.calls.find(([sql]) => String(sql).includes("end_reason='withdrawn'"));
    expect(withdrawn?.[1]).toEqual([studentId]);
    expect(sqlCalls(clientQuery).at(-1)).toBe("COMMIT");
  });

  it("matches the policy version shown on the web policy page", async () => {
    const source = await readFile(new URL("../../../web/src/public-information.ts", import.meta.url), "utf8");
    expect(source).toContain(`export const policyVersion = "${TRANSCRIPT_POLICY_VERSION}";`);
  });
});
