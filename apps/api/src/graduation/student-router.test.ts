import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import { CALC_VERSION } from "../competency-assessment/constants.js";
import { syntheticCurriculum, syntheticStandards, syntheticStudentTerms, syntheticTranscript } from "../competency-assessment/fixtures/synthetic-k29.js";
import type { DatabasePool } from "../db/pool.js";
import type { GraduationData } from "./model.js";
import { createStudentGraduationRouter } from "./student-router.js";

// Synthetic K29 standards and transcript only (fixtures/synthetic-k29.json); no real student data.
const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const [cnpm, cndl] = syntheticStandards();
const k27Id = "33333333-3333-4333-8333-333333333333";

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
  sessionUser?: AuthenticatedUser | null;
  active?: boolean;
  noPool?: boolean;
  profile?: { cohort_code: string | null; specialty: string | null } | null;
  transcript?: boolean;
  /** Overrides of the CNPM standard's data. */
  cnpmData?: Partial<GraduationData>;
};

function setup(options: SetupOptions = {}) {
  const sessionUser = options.sessionUser === null ? undefined : options.sessionUser ?? student;
  const profile = options.profile === undefined ? { cohort_code: "K29", specialty: "CNPM" } : options.profile;
  const standards = [
    { id: cnpm!.id, revision_id: cnpm!.revisionId, version: cnpm!.version, cohort: "K29", data: { ...cnpm!.data, ...options.cnpmData } },
    { id: cndl!.id, revision_id: cndl!.revisionId, version: cndl!.version, cohort: "K29", data: cndl!.data },
    { id: k27Id, revision_id: "k27-rev", version: 1, cohort: "K27", data: { ...cnpm!.data, name: "Tiêu chuẩn K27", cohortCode: "K27", specialty: "", classBlock: "71K27CNTT", standardCode: "71K27CNTT_TN" } },
  ];
  const rows = (list: unknown[]) => ({ rowCount: list.length, rows: list });
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT id FROM users")) return options.active === false ? rows([]) : rows([{ id: studentId }]);
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return rows([]);
    if (sql.includes("FROM student_profiles")) return rows(profile ? [profile] : []);
    if (sql.includes("FROM graduation_standards")) {
      return rows(standards.filter((row) => row.cohort === params[0]).map(({ cohort: _cohort, ...row }) => row));
    }
    if (sql.includes("FROM student_transcripts")) {
      return rows(options.transcript === false ? [] : [{
        version: "00000000-0000-4000-8000-0000000000f1", data: syntheticTranscript(syntheticStudentTerms()), updated_at: new Date("2026-10-01T08:00:00Z"),
      }]);
    }
    if (sql.includes("FROM curricula")) return rows(params[0] === "K29" ? [{ revision_id: "ctdt-rev" }] : []);
    if (sql.includes("FROM curriculum_courses")) {
      return rows(syntheticCurriculum().courses.map((course) => ({
        code: course.code, name: course.name, credits: String(course.credits), type: course.type, block: course.block,
        specialty: course.specialty, semester: course.semester, study_year: course.studyYear,
      })));
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const release = vi.fn();
  const pool = { query, connect: vi.fn(async () => ({ query, release })) } as unknown as DatabasePool;
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: sessionUser } as typeof req.session;
    next();
  });
  app.use("/graduation", createStudentGraduationRouter(options.noPool ? undefined : pool));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "unexpected_error" });
  });
  return { app, query, release };
}

const queryText = (query: ReturnType<typeof setup>["query"]) => query.mock.calls.map((call) => String(call[0])).join("\n");

describe("student graduation API guards", () => {
  it("requires authentication and rejects inactive accounts before reading anything", async () => {
    const unauthenticated = setup({ sessionUser: null });
    await request(unauthenticated.app).get("/graduation").expect(401);
    expect(unauthenticated.query).not.toHaveBeenCalled();

    const inactive = setup({ active: false });
    const response = await request(inactive.app).get("/graduation").expect(403);
    expect(response.body).toEqual({ error: "account_unavailable" });
    expect(inactive.query).toHaveBeenCalledTimes(1);
  });

  it("needs a database", async () => {
    const response = await request(setup({ noPool: true }).app).get("/graduation").expect(503);
    expect(response.body).toEqual({ error: "database_required" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects unknown query parameters", async () => {
    const response = await request(setup().app).get("/graduation?standard=other").expect(400);
    expect(response.body).toEqual({ error: "invalid_graduation_query" });
  });

  it("allows GET and HEAD while rejecting every write method", async () => {
    const { app } = setup();
    await request(app).get("/graduation").expect(200);
    await request(app).head("/graduation").expect(200);
    for (const response of await Promise.all([
      request(app).post("/graduation"),
      request(app).put(`/graduation/${cnpm!.id}`),
      request(app).patch(`/graduation/${cnpm!.id}`),
      request(app).delete(`/graduation/${cnpm!.id}`),
    ])) {
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("GET, HEAD");
      expect(response.body).toEqual({ error: "read_only" });
    }
  });

  it("has no way to read a standard by id (GET /:id is removed)", async () => {
    for (const id of [cndl!.id, cnpm!.id, k27Id, "not-a-uuid"]) {
      const { app, query } = setup();
      const response = await request(app).get(`/graduation/${id}`).expect(404);
      expect(JSON.stringify(response.body)).not.toContain("Tiêu chuẩn");
      expect(queryText(query)).not.toContain("graduation_standards");
    }
  });
});

describe("GET /api/student/graduation", () => {
  it("returns the student's own standard, the transcript version and the server evaluation", async () => {
    const { app, release } = setup();
    const response = await request(app).get("/graduation").expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(response.body).sort()).toEqual(["evaluation", "profile", "resolution", "specialtySuggestion", "standard", "transcript"]);
    expect(response.body).toMatchObject({
      profile: { cohortCode: "K29", specialty: "CNPM" },
      resolution: "specialty",
      transcript: { version: "00000000-0000-4000-8000-0000000000f1", updatedAt: "2026-10-01T08:00:00.000Z" },
      specialtySuggestion: null,
      evaluation: { calcVersion: CALC_VERSION, status: "fail", credits: { lower: 27, source: "printed" }, asOf: { latestTerm: "HK243" } },
    });
    expect(response.body.standard).toMatchObject({
      id: cnpm!.id, revisionId: cnpm!.revisionId, version: cnpm!.version, name: cnpm!.data.name, cohortCode: "K29",
      classBlock: cnpm!.data.classBlock, minimumCredits: 126, minimumGpa: 2, gpaScale: 4,
    });
    expect(response.body.standard.groups[0]).toEqual({ id: "row-10", name: "Học phần bắt buộc", kind: "mandatory", minimumCredits: null });
    expect(response.body.standard.courses[0]).toEqual({
      id: "c-row-10-71ITBS10103", groupId: "row-10", code: "71ITBS10103", name: "Nhập môn Công nghệ thông tin", credits: 3, conditionOnly: false,
    });
    for (const key of ["data", "standardCode", "sourceWorkbook", "sourceSheet", "sourceNotes", "warnings", "items", "suggestedId"]) {
      expect(response.body.standard).not.toHaveProperty(key);
      expect(response.body).not.toHaveProperty(key);
    }
    expect(response.body.evaluation.groups.map((group: { label: string }) => group.label)).toContain("Nhóm tự chọn TC102 · 2 học phần, gồm 71PEKC10062");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("never returns another specialty's or cohort's standard", async () => {
    const asCnpm = JSON.stringify((await request(setup().app).get("/graduation").expect(200)).body);
    expect(asCnpm).toContain(cnpm!.id);
    for (const foreign of [cndl!.id, cndl!.revisionId, cndl!.data.name, "7480201-02", "71ITDS40303", k27Id, "Tiêu chuẩn K27"]) expect(asCnpm).not.toContain(foreign);

    const asCndl = (await request(setup({ profile: { cohort_code: "k29", specialty: "CNDL" } }).app).get("/graduation").expect(200)).body;
    expect(asCndl.standard.id).toBe(cndl!.id);
    expect(JSON.stringify(asCndl)).not.toContain(cnpm!.id);
  });

  it("gives standard: null in K29 while the specialty is unset, with a suggestion", async () => {
    const response = await request(setup({ profile: { cohort_code: "K29", specialty: null } }).app).get("/graduation").expect(200);
    expect(response.body).toEqual({
      profile: { cohortCode: "K29", specialty: null }, resolution: "specialty_unset", standard: null,
      transcript: { version: "00000000-0000-4000-8000-0000000000f1", updatedAt: "2026-10-01T08:00:00.000Z" }, evaluation: null,
      specialtySuggestion: { code: "CNPM", label: "Công nghệ phần mềm", count: 1 },
    });
  });

  it("is cohort_unknown when the account has no cohort and reads no standard", async () => {
    for (const profile of [{ cohort_code: null, specialty: "CNPM" }, null]) {
      const { app, query } = setup({ profile });
      const response = await request(app).get("/graduation").expect(200);
      expect(response.body).toMatchObject({ profile: { cohortCode: null }, resolution: "cohort_unknown", standard: null, evaluation: null, specialtySuggestion: null });
      expect(queryText(query)).not.toContain("graduation_standards");
    }
  });

  it("returns the standard without an evaluation before a transcript is uploaded", async () => {
    const response = await request(setup({ transcript: false }).app).get("/graduation").expect(200);
    expect(response.body).toMatchObject({ resolution: "specialty", standard: { id: cnpm!.id }, transcript: null, evaluation: null });
  });

  it.each([[null, 4], [4, 4], [10, 10]] as const)("exposes the configured GPA scale %s as %s", async (gpaScale, expected) => {
    const response = await request(setup({ cnpmData: { gpaScale, minimumGpa: 2 } }).app).get("/graduation").expect(200);
    expect(response.body.standard.gpaScale).toBe(expected);
    expect(response.body.evaluation.gpa.scale).toBe(expected);
  });
});
