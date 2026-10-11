import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { AssessmentError, loadAssessmentInputs, readAssessmentInputs } from "./inputs.js";

// Synthetic rows only. Course codes follow the public K29 curriculum; everything else is invented.
const userId = "11111111-1111-4111-8111-111111111111";
const curriculumId = "c0000000-0000-4000-8000-000000000001";
const currentRevision = "c0000000-0000-4000-8000-000000000002";
const olderRevision = "c0000000-0000-4000-8000-000000000003";
const transcriptData = {
  schemaVersion: 1, parserVersion: "vlu-native-1", pageCount: 1, courseCount: 2, warnings: [],
  sections: [{
    id: "s1", academicYear: "2023-2024", semester: "HK1", label: "HK1", summaries: [],
    courses: [
      { ordinal: 1, code: "71ITBS10103", name: "Tên in trên bảng điểm", credits: 3, score10: 8, score4: 3.5, letter: "B+", result: null, conditional: false, sourcePage: 1 },
      { ordinal: 2, code: "71av010003", name: "Anh văn", credits: 0, score10: null, score4: null, letter: "MT", result: null, conditional: false, sourcePage: 1 },
    ],
  }],
};
const standardData = (specialty: string, classBlock: string) => ({
  name: `Chuẩn ${specialty}`, standardCode: "TCTN", classBlock, specialty, groups: [], courses: [], minimumCredits: 120, minimumGpa: 2,
});

type Tables = {
  profile: Record<string, unknown> | null; transcript: boolean; curricula: number; weights: boolean;
  specialty: string | null; plans: { linked: boolean; major: string }[]; career: boolean;
};

function fakeDb(overrides: Partial<Tables> = {}) {
  const t: Tables = { profile: { cohort_code: " k29 ", specialty: "CNDL", career_position_id: "p1" }, transcript: true, curricula: 1, weights: true,
    specialty: "CNDL", plans: [{ linked: false, major: "Công nghệ thông tin" }, { linked: true, major: "Công nghệ thông tin" }], career: true, ...overrides };
  if (overrides.profile === undefined && overrides.specialty !== undefined) t.profile = { cohort_code: "K29", specialty: overrides.specialty, career_position_id: "p1" };
  const rows = (list: unknown[]) => ({ rowCount: list.length, rows: list });
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return rows([]);
    if (sql.includes("FROM student_profiles")) return rows(t.profile ? [t.profile] : []);
    if (sql.includes("FROM student_transcripts")) return rows(t.transcript ? [{ version: "v1", data: transcriptData }] : []);
    if (sql.includes("FROM curricula")) return rows(Array.from({ length: t.curricula }, (_, i) => ({
      id: i ? `other-${i}` : curriculumId, identity_key: "cong nghe thong tin:K29", revision_id: currentRevision, version: 3, name: "CTĐT K29", admission_year: 2023,
    })));
    if (sql.includes("FROM curriculum_courses")) return rows([
      { code: "71ITBS10103", name: "Nhập môn Công nghệ thông tin", credits: "3", type: "BB", block: "Kiến thức cơ sở khối ngành", specialty: "", semester: 1, study_year: 1 },
      { code: "71PEKC10062", name: "Cờ vua", credits: "2", type: "TC002 (2TC)", block: "Giáo dục thể chất và giáo dục quốc phòng", specialty: "", semester: 2, study_year: 1 },
    ]);
    if (sql.includes("FROM curriculum_relations")) return rows([{ course_code: "71ITBS10103", kind: "prior", raw: "", target_codes: [], unresolved_codes: [], review_required: false }]);
    if (sql.includes("FROM curriculum_revisions r JOIN ad_comp_course_configs")) return rows(t.weights ? [{ id: olderRevision, version: 2, active_count: 5, max_updated: new Date("2026-10-01T00:00:00Z") }] : []);
    if (sql.includes("JOIN ad_comp_course_links")) return rows([{ course_code: "71ITBS10103", skill_id: "k1", weight: "0.5000000000" }]);
    if (sql.includes("FROM ad_comp_skills")) return rows([{ skill_id: "k1", name: "Lập trình", description: "", scope: "Phạm vi", group_id: "g1" }]);
    if (sql.includes("FROM ad_comp_groups")) return rows([{ id: "g1", name: "Chuyên môn" }]);
    if (sql.includes("FROM graduation_standards")) return rows([
      { id: "std-cnpm", revision_id: "r1", version: 1, data: standardData("Công nghệ phần mềm", "7480201-03") },
      { id: "std-cndl", revision_id: "r2", version: 4, data: standardData("Công nghệ dữ liệu", "7480201-02") },
    ]);
    if (sql.includes("FROM training_plans")) return rows(t.plans.map((plan, i) => ({
      id: `plan-${i}`, revision_id: `pr-${i}`, version: 1, linked: plan.linked, data: { major: plan.major, cohortCode: "K29", admissionYear: 2023, sections: [], items: [], terms: [] },
    })));
    if (sql.includes("FROM career_positions")) return rows(t.career ? [{ id: "p1", code: "NN009", name_vi: "Kỹ sư dữ liệu", name_en: "Data Engineer", version: "pv", deleted: false }] : []);
    if (sql.includes("FROM career_requirements")) return rows([{ id: "req1", skill_id: "k1", skill_name: "Lập trình", title: "Lập trình", is_required: true }]);
    if (sql.includes("FROM course_catalog")) return rows([{ code: "71AV010003", name: "Anh văn đầu vào" }]);
    throw new Error(`unexpected query: ${sql}`);
  });
  return { query, sql: () => query.mock.calls.map(([text]) => String(text)) };
}

describe("readAssessmentInputs", () => {
  it("builds the inputs from plain, ordered SELECTs", async () => {
    const db = fakeDb();
    const inputs = await readAssessmentInputs(db, userId, { promptVersion: "comp-v1" });
    expect(inputs.student).toEqual({ cohortCode: "K29", specialty: "CNDL", careerPositionId: "p1" });
    expect(inputs.transcript.version).toBe("v1");
    expect(inputs.curriculum).toMatchObject({ id: curriculumId, revisionId: currentRevision, version: 3, admissionYear: 2023 });
    expect(inputs.curriculum.courses[0]).toEqual({ code: "71ITBS10103", name: "Nhập môn Công nghệ thông tin", credits: 3, type: "BB",
      block: "Kiến thức cơ sở khối ngành", specialty: "", semester: 1, studyYear: 1 });
    expect(inputs.curriculum.relations).toHaveLength(1);
    expect(inputs.weights).toMatchObject({ revisionId: olderRevision, version: 2, activeCount: 5, maxConfigUpdatedAt: "2026-10-01T00:00:00.000Z",
      links: [{ courseCode: "71ITBS10103", skillId: "k1", weight: 0.5 }], groups: [{ id: "g1", name: "Chuyên môn" }] });
    expect(inputs.graduation.resolution).toBe("specialty");
    expect(inputs.graduation.standard).toMatchObject({ id: "std-cndl", revisionId: "r2", version: 4, data: { gpaScale: 4 } });
    expect(inputs.plan.resolution).toBe("found");
    expect(inputs.plan.revision).toMatchObject({ id: "plan-1", physicalEducationGroups: { TC002: ["71PEKC10062"], TC102: [] } });
    expect(inputs.career).toMatchObject({ id: "p1", code: "NN009", requirements: [{ id: "req1", skillId: "k1", isRequired: true }] });
    expect(inputs.catalogNames).toEqual({ "71AV010003": "Anh văn đầu vào" });
    expect(inputs.promptVersion).toBe("comp-v1");
    const calls = db.sql();
    expect(calls.some((sql) => /FOR (UPDATE|SHARE|NO KEY|KEY)/i.test(sql))).toBe(false);
    for (const sql of calls.filter((text) => !/FROM (student_profiles|student_transcripts|career_positions) WHERE/.test(text)))
      expect(sql).toMatch(/ORDER BY/);
    // Interests and career goals never leave the profile table.
    expect(calls.find((sql) => sql.includes("FROM student_profiles"))).not.toMatch(/interests|career_goal|full_name|student_code/);
    const catalog = db.query.mock.calls.find(([sql]) => String(sql).includes("course_catalog"));
    expect(catalog?.[1]).toEqual([["71AV010003"]]);
  });

  it("reports missing data with the API error codes", async () => {
    const expectCode = async (overrides: Partial<Tables>, code: string) => {
      const error = await readAssessmentInputs(fakeDb(overrides), userId).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AssessmentError);
      expect(error).toMatchObject({ code, status: 409 });
    };
    await expectCode({ transcript: false }, "transcript_required");
    await expectCode({ profile: null }, "cohort_unknown");
    await expectCode({ profile: { cohort_code: "  ", specialty: null, career_position_id: null } }, "cohort_unknown");
    await expectCode({ curricula: 0 }, "curriculum_unavailable");
    await expectCode({ curricula: 2 }, "curriculum_ambiguous");
    await expectCode({ weights: false }, "competency_weights_unavailable");
  });

  it("does not block when the specialty is unset and the cohort has only specialty standards", async () => {
    const inputs = await readAssessmentInputs(fakeDb({ specialty: null }), userId);
    expect(inputs.student.specialty).toBeNull();
    expect(inputs.graduation).toEqual({ resolution: "specialty_unset", standard: null });
  });

  it("marks several unlinked plans as ambiguous and a missing career as none", async () => {
    const inputs = await readAssessmentInputs(fakeDb({ plans: [{ linked: false, major: "Khác" }, { linked: false, major: "Khác 2" }], career: false }), userId);
    expect(inputs.plan).toEqual({ resolution: "ambiguous", revision: null });
    expect(inputs.career).toBeNull();
    const none = await readAssessmentInputs(fakeDb({ plans: [] }), userId);
    expect(none.plan).toEqual({ resolution: "not_found", revision: null });
    const byIdentity = await readAssessmentInputs(fakeDb({ plans: [{ linked: false, major: "Khác" }, { linked: false, major: "Công nghệ thông tin" }] }), userId);
    expect(byIdentity.plan.revision?.id).toBe("plan-1");
  });
});

describe("loadAssessmentInputs", () => {
  it("reads in a REPEATABLE READ READ ONLY snapshot and releases the client", async () => {
    const db = fakeDb();
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query: db.query, release }) } as unknown as DatabasePool;
    await loadAssessmentInputs(pool, userId);
    expect(db.sql()[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(db.sql().at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalled();
  });

  it("rolls back and rethrows on failure", async () => {
    const db = fakeDb({ transcript: false });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query: db.query, release }) } as unknown as DatabasePool;
    await expect(loadAssessmentInputs(pool, userId)).rejects.toMatchObject({ code: "transcript_required" });
    expect(db.sql().at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalled();
  });
});
