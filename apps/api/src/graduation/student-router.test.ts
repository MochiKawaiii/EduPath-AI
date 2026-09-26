import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import type { GraduationData } from "./model.js";
import { createStudentGraduationRouter } from "./student-router.js";

const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const standardId = "33333333-3333-4333-8333-333333333333";
const lockedId = "44444444-4444-4444-8444-444444444444";
const missingId = "55555555-5555-4555-8555-555555555555";

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

const standard: GraduationData = {
  schemaVersion: 1,
  name: "Graduation standard K29",
  standardCode: "TCTN-K29",
  cohortCode: "K29",
  classBlock: "K29-CNTT",
  major: "Information Technology",
  specialty: "Software Engineering",
  educationSystem: "Full-time",
  faculty: "Information Technology",
  minimumCredits: 126,
  mandatoryCredits: 100,
  electiveCredits: 20,
  freeElectiveCredits: 6,
  minimumGpa: 2,
  notes: "Student-facing note",
  groups: [
    {
      id: "group-1",
      name: "Required courses",
      kind: "mandatory",
      minimumCredits: 100,
      sourceRow: 10,
    },
  ],
  courses: [
    {
      id: "course-1",
      groupId: "group-1",
      code: "71IT000001",
      name: "Introduction to Computing",
      credits: 3,
      conditionOnly: false,
      sourceRow: 12,
    },
  ],
  sourceWorkbook: "secret.xlsx",
  sourceSheet: "K29",
  sourceNotes: ["Internal review note"],
};

const activeListRow = {
  id: standardId,
  cohortCode: "K29",
  name: standard.name,
  major: standard.major,
  specialty: standard.specialty,
  classBlock: standard.classBlock,
  minimumCredits: standard.minimumCredits,
};

type SetupOptions = {
  sessionUser?: AuthenticatedUser | null;
  active?: boolean;
  profileCohort?: string | null;
  listRows?: unknown[];
  detailRows?: unknown[];
};

function setup(options: SetupOptions = {}) {
  const sessionUser =
    options.sessionUser === null ? undefined : options.sessionUser ?? student;
  const listRows = options.listRows ?? [activeListRow];
  const detailRows =
    options.detailRows ?? [{ id: standardId, version: 3, data: standard }];
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT id FROM users")) {
      return {
        rowCount: options.active === false ? 0 : 1,
        rows: options.active === false ? [] : [{ id: studentId }],
      };
    }
    if (sql.includes("SELECT cohort_code FROM student_profiles")) {
      return {
        rowCount: options.profileCohort ? 1 : 0,
        rows: options.profileCohort
          ? [{ cohort_code: options.profileCohort }]
          : [],
      };
    }
    if (sql.includes("SELECT c.id,c.cohort_code"))
      return { rowCount: listRows.length, rows: listRows };
    if (sql.includes("SELECT c.id,r.version,r.data"))
      return { rowCount: detailRows.length, rows: detailRows };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: sessionUser } as typeof req.session;
    next();
  });
  app.use(
    "/graduation",
    createStudentGraduationRouter({ query } as unknown as DatabasePool),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : "unexpected_error" });
    },
  );
  return { app, query };
}

function queryText(query: ReturnType<typeof setup>["query"]) {
  return query.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("student graduation API", () => {
  it("requires authentication and rejects inactive accounts before reading standards", async () => {
    const unauthenticated = setup({ sessionUser: null });
    await request(unauthenticated.app).get("/graduation").expect(401);
    expect(unauthenticated.query).not.toHaveBeenCalled();

    const inactive = setup({ active: false });
    const response = await request(inactive.app).get("/graduation").expect(403);
    expect(response.body).toEqual({ error: "account_unavailable" });
    expect(inactive.query).toHaveBeenCalledTimes(1);
  });

  it("lists active standards and suggests the one matching the profile cohort", async () => {
    const { app, query } = setup({ profileCohort: "K29" });
    const response = await request(app).get("/graduation").expect(200);

    expect(response.body).toEqual({
      items: [activeListRow],
      profileCohort: "K29",
      suggestedId: standardId,
    });
    expect(queryText(query)).toContain("WHERE c.is_active");
    expect(queryText(query)).toContain(
      "JOIN graduation_revisions r ON r.id=c.current_revision",
    );
  });

  it("does not suggest a standard when the cohort has several or no active matches", async () => {
    const several = setup({
      profileCohort: "K29",
      listRows: [activeListRow, { ...activeListRow, id: lockedId }],
    });
    expect(
      (await request(several.app).get("/graduation").expect(200)).body
        .suggestedId,
    ).toBeNull();

    const none = setup({ profileCohort: "K32" });
    const response = await request(none.app).get("/graduation").expect(200);
    expect(response.body.profileCohort).toBe("K32");
    expect(response.body.suggestedId).toBeNull();
  });

  it("projects only student-safe detail fields from the current revision", async () => {
    const { app } = setup();
    const response = await request(app)
      .get(`/graduation/${standardId}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: standardId,
      version: 3,
      name: standard.name,
      cohortCode: "K29",
      classBlock: "K29-CNTT",
      minimumCredits: 126,
      minimumGpa: 2,
      notes: "Student-facing note",
    });
    expect(response.body.groups).toEqual([
      {
        id: "group-1",
        name: "Required courses",
        kind: "mandatory",
        minimumCredits: 100,
      },
    ]);
    expect(response.body.courses).toEqual([
      {
        id: "course-1",
        groupId: "group-1",
        code: "71IT000001",
        name: "Introduction to Computing",
        credits: 3,
        conditionOnly: false,
      },
    ]);
    for (const key of [
      "data",
      "standardCode",
      "sourceWorkbook",
      "sourceSheet",
      "sourceNotes",
      "warnings",
    ]) {
      expect(response.body).not.toHaveProperty(key);
    }
  });

  it.each([lockedId, missingId])(
    "returns 404 for locked or nonexistent standard %s",
    async (id) => {
      const { app, query } = setup({ detailRows: [] });
      const response = await request(app).get(`/graduation/${id}`).expect(404);

      expect(response.body).toEqual({ error: "standard_unavailable" });
      expect(queryText(query)).toContain("WHERE c.id=$1 AND c.is_active");
    },
  );

  it("rejects unknown query parameters and malformed ids", async () => {
    const { app } = setup();
    await request(app).get("/graduation?revision=old").expect(400);
    await request(app)
      .get(`/graduation/${standardId}?revision=old`)
      .expect(400);
    await request(app).get("/graduation/not-a-uuid").expect(400);
  });

  it("allows GET and HEAD while rejecting every write method", async () => {
    const { app } = setup();
    await request(app).get("/graduation").expect(200);
    await request(app).head("/graduation").expect(200);
    for (const response of await Promise.all([
      request(app).post("/graduation"),
      request(app).put(`/graduation/${standardId}`),
      request(app).patch(`/graduation/${standardId}`),
      request(app).delete(`/graduation/${standardId}`),
    ])) {
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("GET, HEAD");
      expect(response.body).toEqual({ error: "read_only" });
    }
  });
});
