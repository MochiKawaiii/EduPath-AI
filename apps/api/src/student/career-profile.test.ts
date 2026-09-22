import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { createStudentDataRouter } from "./router.js";

const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const careerId = "33333333-3333-4333-8333-333333333333";
const otherCareerId = "44444444-4444-4444-8444-444444444444";
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

type SetupOptions = {
  careerRow?: { deleted_at: string | null } | null;
  previousCareer?: string | null;
};

function setup(options: SetupOptions = {}) {
  const clientQuery = vi.fn(async (sql: string) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
    if (sql.includes("SELECT id FROM users")) return { rowCount: 1, rows: [{ id: studentId }] };
    if (sql.includes("SELECT deleted_at FROM career_positions")) {
      return options.careerRow === null
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [options.careerRow ?? { deleted_at: null }] };
    }
    if (sql.includes("SELECT career_position_id FROM student_profiles")) {
      return { rowCount: 1, rows: [{ career_position_id: options.previousCareer ?? null }] };
    }
    return { rowCount: 1, rows: [] };
  });
  const connect = vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: student } as typeof req.session;
    next();
  });
  app.use("/student", createStudentDataRouter({ connect } as unknown as DatabasePool, origin));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "unexpected_error" });
  });
  return { app, clientQuery };
}

const profile = {
  className: "CNTT08",
  interests: "AI và dữ liệu",
  careerGoal: "Tôi muốn xây dựng sản phẩm dữ liệu hữu ích.",
  currentSemester: 2,
};

describe("student career selection", () => {
  it("saves a catalog selection while preserving stored class and free-text goal", async () => {
    const { app, clientQuery } = setup({ previousCareer: null });
    await request(app)
      .patch("/student/profile")
      .set("Origin", origin)
      .send({ ...profile, careerPositionId: careerId })
      .expect(200, { saved: true });
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO student_profiles"),
      [studentId, null, profile.interests, null, profile.currentSemester],
    );
    const insertSql = clientQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO student_profiles"))?.[0] as string;
    expect(insertSql).toContain("interests=EXCLUDED.interests");
    expect(insertSql).not.toContain("class_name=EXCLUDED");
    expect(insertSql).not.toContain("career_goal=EXCLUDED");
    expect(clientQuery).toHaveBeenCalledWith(
      "UPDATE student_profiles SET career_position_id=$2 WHERE user_id=$1",
      [studentId, careerId],
    );
  });

  it("rejects missing or newly deleted positions and rolls back the transaction", async () => {
    for (const options of [{ careerRow: null }, { careerRow: { deleted_at: "2026-09-22T00:00:00Z" }, previousCareer: otherCareerId }]) {
      const { app, clientQuery } = setup(options);
      await request(app)
        .patch("/student/profile")
        .set("Origin", origin)
        .send({ ...profile, careerPositionId: careerId })
        .expect(409, { error: "career_unavailable" });
      expect(clientQuery).toHaveBeenCalledWith("ROLLBACK");
      expect(clientQuery).not.toHaveBeenCalledWith(
        "UPDATE student_profiles SET career_position_id=$2 WHERE user_id=$1",
        [studentId, careerId],
      );
    }
  });

  it("allows the previously selected deleted position and clears a selection explicitly", async () => {
    const retained = setup({ careerRow: { deleted_at: "2026-09-22T00:00:00Z" }, previousCareer: careerId });
    await request(retained.app)
      .patch("/student/profile")
      .set("Origin", origin)
      .send({ ...profile, careerPositionId: careerId })
      .expect(200);
    const cleared = setup({ previousCareer: careerId });
    await request(cleared.app)
      .patch("/student/profile")
      .set("Origin", origin)
      .send({ ...profile, careerPositionId: null })
      .expect(200);
    expect(cleared.clientQuery).toHaveBeenCalledWith(
      "UPDATE student_profiles SET career_position_id=$2 WHERE user_id=$1",
      [studentId, null],
    );
  });
});
