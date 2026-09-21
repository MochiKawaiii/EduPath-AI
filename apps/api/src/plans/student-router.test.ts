import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import type { PlanData } from "./model.js";
import { createStudentPlansRouter } from "./student-router.js";

const studentId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const planId = "33333333-3333-4333-8333-333333333333";
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

const plan: PlanData = {
  schemaVersion: 1,
  name: "Bachelor of Computing plan",
  major: "Information Technology",
  cohortCode: "K29",
  admissionYear: 2023,
  totalCredits: 126,
  notes: "Administrative plan notes",
  items: [
    {
      id: "row-1",
      position: 1,
      code: "71IT000001",
      name: "Introduction to Computing",
      credits: 3,
      type: "BB",
      termCode: "HK011",
      semester: 1,
      studyYear: 1,
      sectionId: "section-1",
      prerequisite: "",
      prior: "",
      notes: "Student-facing item note",
      hours: {
        lecture: 30,
        practice: 15,
        project: null,
        internship: null,
      },
      sourceRow: 12,
      sourceSheet: "K29",
      sourceCells: { A: "secret source value" },
    },
  ],
  terms: [
    { code: "HK011", semester: 1, studyYear: 1, sourceCredits: 20 },
  ],
  sections: [
    {
      id: "section-1",
      termCode: "HK011",
      label: "Required courses",
      kind: "choice",
      sourceRow: 10,
    },
  ],
  sourceWarnings: [{ row: 12, message: "Internal source warning" }],
  warnings: [{ row: 12, message: "Internal review warning" }],
  curriculum: {
    id: "66666666-6666-4666-8666-666666666666",
    revisionId: "77777777-7777-4777-8777-777777777777",
    version: 2,
    name: "Linked curriculum",
  },
};

const activeListRow = {
  id: planId,
  cohortCode: "K29",
  name: plan.name,
  major: plan.major,
  totalCredits: plan.totalCredits,
  itemCount: plan.items.length,
  version: 2,
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
  const detailRows = options.detailRows ?? [{ id: planId, version: 2, data: plan }];
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
    "/plans",
    createStudentPlansRouter({ query } as unknown as DatabasePool),
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

describe("student plans API", () => {
  it("requires authentication and rejects inactive accounts before reading plans", async () => {
    const unauthenticated = setup({ sessionUser: null });
    await request(unauthenticated.app).get("/plans").expect(401);
    expect(unauthenticated.query).not.toHaveBeenCalled();

    const inactive = setup({ active: false });
    const response = await request(inactive.app).get("/plans").expect(403);
    expect(response.body).toEqual({ error: "account_unavailable" });
    expect(inactive.query).toHaveBeenCalledTimes(1);
  });

  it("lists active current plans and suggests the one matching the profile cohort", async () => {
    const { app, query } = setup({ profileCohort: "K29" });
    const response = await request(app).get("/plans").expect(200);

    expect(response.body).toEqual({
      items: [activeListRow],
      profileCohort: "K29",
      suggestedId: planId,
    });
    expect(queryText(query)).toContain("WHERE c.is_active");
    expect(queryText(query)).toContain(
      "JOIN training_plan_revisions r ON r.id=c.current_revision",
    );
  });

  it("does not suggest a plan when the student cohort has no exact active match", async () => {
    const { app } = setup({ profileCohort: "K32" });
    const response = await request(app).get("/plans").expect(200);

    expect(response.body.items).toEqual([activeListRow]);
    expect(response.body.profileCohort).toBe("K32");
    expect(response.body.suggestedId).toBeNull();
  });

  it("projects only student-safe detail fields from the current revision", async () => {
    const { app } = setup();
    const response = await request(app).get(`/plans/${planId}`).expect(200);

    expect(response.body).toMatchObject({
      id: planId,
      version: 2,
      name: plan.name,
      major: plan.major,
      cohortCode: plan.cohortCode,
      admissionYear: plan.admissionYear,
      totalCredits: plan.totalCredits,
    });
    expect(response.body.terms).toEqual([
      { code: "HK011", semester: 1, studyYear: 1, sourceCredits: 20 },
    ]);
    expect(response.body.sections).toEqual([
      { id: "section-1", termCode: "HK011", label: "Required courses", kind: "choice" },
    ]);
    expect(response.body.items[0]).toMatchObject({
      id: "row-1",
      code: "71IT000001",
      name: "Introduction to Computing",
      notes: "Student-facing item note",
    });
    expect(response.body).not.toHaveProperty("data");
    for (const key of ["notes", "sourceWarnings", "warnings", "curriculum"]) {
      expect(response.body).not.toHaveProperty(key);
    }
    for (const key of ["position", "sourceRow", "sourceSheet", "sourceCells"]) {
      expect(response.body.items[0]).not.toHaveProperty(key);
    }
    expect(response.body.sections[0]).not.toHaveProperty("sourceRow");
  });

  it.each([lockedId, missingId])(
    "returns 404 for locked or nonexistent plan %s",
    async (id) => {
      const { app, query } = setup({ detailRows: [] });
      const response = await request(app).get(`/plans/${id}`).expect(404);

      expect(response.body).toEqual({ error: "plan_unavailable" });
      expect(queryText(query)).toContain(
        "WHERE c.id=$1 AND c.is_active",
      );
    },
  );

  it("rejects unknown query parameters and malformed ids", async () => {
    const { app, query } = setup();
    await request(app).get("/plans?revision=old").expect(400);
    await request(app).get(`/plans/${planId}?revision=old`).expect(400);
    await request(app).get("/plans/not-a-uuid").expect(400);
    expect(query).toHaveBeenCalled();
  });

  it("allows GET and HEAD while rejecting every write method", async () => {
    const { app } = setup();
    await request(app).get("/plans").expect(200);
    await request(app).head("/plans").expect(200);
    for (const response of await Promise.all([
      request(app).post("/plans"),
      request(app).put(`/plans/${planId}`),
      request(app).patch(`/plans/${planId}`),
      request(app).delete(`/plans/${planId}`),
    ])) {
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("GET, HEAD");
      expect(response.body).toEqual({ error: "read_only" });
    }
  });
});
