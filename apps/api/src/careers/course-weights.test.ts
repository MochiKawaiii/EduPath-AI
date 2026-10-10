import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { createCareersRouter } from "./router.js";

const actorId = "11111111-1111-4111-8111-111111111111";
const careerId = "22222222-2222-4222-8222-222222222222";
const k29RevisionId = "33333333-3333-4333-8333-333333333333";
const k30RevisionId = "44444444-4444-4444-8444-444444444444";
const missingRevisionId = "55555555-5555-4555-8555-555555555555";

type Revision = {
  revisionId: string;
  cohortCode: string;
  name: string;
  version: number;
  isCurrent: boolean;
  isActive: boolean;
  activeCount: number;
};
type Weight = { skillId: string; scope: string; courseCode: string; courseName: string; weight: number };

const k29: Revision = { revisionId: k29RevisionId, cohortCode: "K29", name: "Chương trình K29", version: 2,
  isCurrent: true, isActive: true, activeCount: 88 };
const k30: Revision = { revisionId: k30RevisionId, cohortCode: "K30", name: "Chương trình K30", version: 1,
  isCurrent: true, isActive: true, activeCount: 0 };
const k29Weights: Weight[] = [{ skillId: "66666666-6666-4666-8666-666666666666", scope: "Định tuyến",
  courseCode: "NET201", courseName: "Mạng máy tính", weight: 0.35 }];
const k30Weights: Weight[] = [{ skillId: "77777777-7777-4777-8777-777777777777", scope: "Quản trị Linux",
  courseCode: "SYS301", courseName: "Quản trị hệ thống", weight: 0.2 }];
const origin = "https://edupath.example";
const rows = <T,>(items: T[] = []) => ({ rows: items, rowCount: items.length });

function setup(options: {
  role?: AuthenticatedUser["role"] | null;
  careerExists?: boolean;
  revisions?: Revision[];
  linksByRevision?: Record<string, Weight[]>;
} = {}) {
  const role = options.role === undefined ? "admin" : options.role;
  const user = role ? { userId: actorId, tenantId: actorId, role } as AuthenticatedUser : undefined;
  const revisions = options.revisions ?? [k30, k29];
  const linksByRevision = options.linksByRevision ?? { [k29RevisionId]: k29Weights, [k30RevisionId]: k30Weights };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("FROM users")) return rows([{ id: actorId }]);
    if (sql.includes("FROM career_positions c JOIN career_fields f")) {
      return options.careerExists === false ? rows() : rows([{ id: careerId }]);
    }
    if (sql.includes("FROM curricula c JOIN curriculum_revisions r")) return rows(revisions);
    if (sql.includes("FROM career_requirements r JOIN career_skills s")) {
      return rows(linksByRevision[String(values?.[1])] ?? []);
    }
    return rows();
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user } as typeof req.session;
    next();
  });
  app.use("/careers", createCareersRouter({ query } as unknown as DatabasePool, origin));
  return { app, query };
}

const endpoint = (careerPositionId = careerId, revisionId?: string) => {
  const query = new URLSearchParams({ careerPositionId });
  if (revisionId) query.set("revisionId", revisionId);
  return `/careers/requirements/course-weights?${query}`;
};

describe("career requirement course-weight read API", () => {
  it("allows an admin to read weights and defaults to the current configured revision", async () => {
    const currentWithoutConfig = { ...k30, activeCount: 0 };
    const currentConfigured = { ...k29, activeCount: 88 };
    const revisions = [currentWithoutConfig, { ...k30, isActive: false, activeCount: 9 }, currentConfigured,
      { ...k29, revisionId: missingRevisionId, isCurrent: false, version: 1, activeCount: 20 }];
    const { app, query } = setup({ revisions });

    const response = await request(app).get(endpoint()).expect(200);
    expect(response.body).toEqual({ careerPositionId: careerId, revisions, revisionId: k29RevisionId, items: k29Weights });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM career_requirements r JOIN career_skills s"),
      [careerId, k29RevisionId]);
  });

  it("denies anonymous and student callers before database access", async () => {
    const anonymous = setup({ role: null });
    await request(anonymous.app).get(endpoint()).expect(401, { error: "authentication_required" });
    expect(anonymous.query).not.toHaveBeenCalled();

    const student = setup({ role: "student" });
    await request(student.app).get(endpoint()).expect(403, { error: "insufficient_role" });
    expect(student.query).not.toHaveBeenCalled();
  });

  it("validates career and revision UUIDs and rejects unknown query parameters", async () => {
    const { app, query } = setup();
    await request(app).get(endpoint("invalid-id")).expect(400, { error: "invalid_requirement" });
    await request(app).get(endpoint(careerId, "invalid-id")).expect(400, { error: "invalid_requirement" });
    await request(app).get(`${endpoint()}&unexpected=true`).expect(400, { error: "invalid_requirement" });
    expect(query.mock.calls.filter(([sql]) => !sql.includes("FROM users"))).toHaveLength(0);
  });

  it("returns not-found errors for an unavailable career or explicit revision", async () => {
    const missingCareer = setup({ careerExists: false });
    await request(missingCareer.app).get(endpoint()).expect(404, { error: "career_not_found" });
    expect(missingCareer.query.mock.calls.some(([sql]) => sql.includes("FROM curricula c JOIN curriculum_revisions r"))).toBe(false);

    const missingRevision = setup();
    await request(missingRevision.app).get(endpoint(careerId, missingRevisionId))
      .expect(404, { error: "curriculum_revision_not_found" });
    expect(missingRevision.query.mock.calls.some(([sql]) => sql.includes("FROM career_requirements r JOIN career_skills s"))).toBe(false);
  });

  it("uses an explicitly selected K30 revision without falling back to configured K29", async () => {
    const { app, query } = setup({ linksByRevision: { [k29RevisionId]: k29Weights } });
    const response = await request(app).get(endpoint(careerId, k30RevisionId)).expect(200);
    expect(response.body.revisionId).toBe(k30RevisionId);
    expect(response.body.items).toEqual([]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM career_requirements r JOIN career_skills s"),
      [careerId, k30RevisionId]);
  });

  it("returns an empty result when no curricula exist and does not query course links", async () => {
    const { app, query } = setup({ revisions: [] });
    await request(app).get(endpoint()).expect(200, { careerPositionId: careerId, revisions: [], revisionId: null, items: [] });
    expect(query.mock.calls.some(([sql]) => sql.includes("FROM career_requirements r JOIN career_skills s"))).toBe(false);
  });

  it("filters out deleted career links, deleted or inactive profiles, inactive groups, zero weights, and non-active configs in SQL", async () => {
    const { app, query } = setup();
    await request(app).get(endpoint(careerId, k29RevisionId)).expect(200, { careerPositionId: careerId, revisions: [k30, k29], revisionId: k29RevisionId, items: k29Weights });
    const call = query.mock.calls.find(([sql]) => sql.includes("FROM career_requirements r JOIN career_skills s"));
    expect(call).toBeDefined();
    const sql = call![0].replace(/\s+/g, " ");
    expect(sql).toContain("JOIN career_skills s ON s.id=r.skill_id AND s.deleted_at IS NULL");
    expect(sql).toContain("JOIN ad_comp_skills cs ON cs.skill_id=s.id AND cs.deleted_at IS NULL AND cs.is_active");
    expect(sql).toContain("JOIN ad_comp_groups g ON g.id=cs.group_id AND g.is_active");
    expect(sql).toContain("JOIN ad_comp_course_links l ON l.skill_id=s.id AND l.weight>0");
    expect(sql).toContain("JOIN ad_comp_course_configs cfg ON cfg.id=l.config_id AND cfg.status='active' AND cfg.revision_id=$2");
    expect(sql).toContain("WHERE r.career_position_id=$1 AND r.deleted_at IS NULL");
    expect(sql).toContain("JOIN curriculum_courses cc ON cc.revision_id=cfg.revision_id AND cc.code=cfg.course_code");
  });
});
