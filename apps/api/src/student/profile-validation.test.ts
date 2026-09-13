import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createStudentDataRouter } from "./router.js";
import type { DatabasePool } from "../db/pool.js";

function setup() {
  const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { session: { user: { userId: "student-id", tenantId: "tenant-id", role: "student" } } });
    next();
  });
  app.use("/student", createStudentDataRouter({ connect } as unknown as DatabasePool, "https://edupath.example"));
  return { app, query, connect };
}
const profile = { className: "CNTT08", interests: null, careerGoal: null };
describe("student profile semester bounds", () => {
  it("saves a profile without the removed current semester field", async () => {
    const { app } = setup();
    await request(app).patch("/student/profile").set("Origin", "https://edupath.example").send(profile).expect(200);
  });
  it.each([1, 2, 3, null])("saves semester %s", async currentSemester => {
    const { app, query } = setup();
    await request(app).patch("/student/profile").set("Origin", "https://edupath.example").send({ ...profile, currentSemester }).expect(200);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO student_profiles"), ["student-id", "CNTT08", null, null, currentSemester]);
  });
  it.each([0, 4, 20, 1.5, "3"])("rejects invalid semester %s before accessing the database", async currentSemester => {
    const { app, connect } = setup();
    await request(app).patch("/student/profile").set("Origin", "https://edupath.example").send({ ...profile, currentSemester }).expect(400);
    expect(connect).not.toHaveBeenCalled();
  });
});
