import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { syntheticCurriculum, syntheticStandards, syntheticStudentTerms, syntheticTranscript } from "../competency-assessment/fixtures/synthetic-k29.js";
import type { CurriculumCourseInput } from "../competency-assessment/types.js";
import type { DatabasePool } from "../db/pool.js";
import type { TranscriptData } from "../student/transcript-parser.js";
import { GRADUATION_ADVICE_PROMPT_VERSION } from "./advice/prompt.js";
import { evaluateGraduation, type GraduationEvaluation, type GraduationImprovementCandidate } from "./evaluation.js";
import {
  canonicalJson, graduationFingerprint, graduationFingerprintFacts, loadStudentGraduation, readStudentGraduation,
} from "./student-graduation.js";

// Synthetic K29 rows only (fixtures/synthetic-k29.json); no real student data.
const userId = "11111111-1111-4111-8111-111111111111";
const transcriptVersion = "00000000-0000-4000-8000-0000000000f1";
const updatedAt = new Date("2026-10-01T08:00:00Z");

type Tables = {
  profile: { cohort_code: string | null; specialty: string | null } | null;
  transcript: TranscriptData | null;
  curricula: number;
  /** curriculum_courses rows of the CTĐT's current revision. */
  curriculumCourses: CurriculumCourseInput[];
};

function fakeDb(overrides: Partial<Tables> = {}) {
  const t: Tables = {
    profile: { cohort_code: " k29 ", specialty: "CNPM" }, transcript: syntheticTranscript(syntheticStudentTerms()), curricula: 1,
    curriculumCourses: syntheticCurriculum().courses, ...overrides,
  };
  const rows = (list: unknown[]) => ({ rowCount: list.length, rows: list });
  const standards = syntheticStandards().map((item) => ({ id: item.id, revision_id: item.revisionId, version: item.version, cohort: "K29", data: item.data }));
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return rows([]);
    if (sql.includes("FROM student_profiles")) return rows(t.profile ? [t.profile] : []);
    if (sql.includes("FROM graduation_standards")) return rows(standards.filter((row) => row.cohort === params[0]).map(({ cohort: _cohort, ...row }) => row));
    if (sql.includes("FROM student_transcripts")) return rows(t.transcript ? [{ version: transcriptVersion, data: t.transcript, updated_at: updatedAt }] : []);
    if (sql.includes("FROM curricula")) return rows(params[0] === "K29" ? Array.from({ length: t.curricula }, (_, index) => ({ revision_id: `rev-${index}` })) : []);
    if (sql.includes("FROM curriculum_courses")) {
      // NUMERIC credits arrive as strings.
      return rows(t.curriculumCourses.map((course) => ({
        code: course.code, name: course.name, credits: String(course.credits), type: course.type, block: course.block,
        specialty: course.specialty, semester: course.semester, study_year: course.studyYear,
      })));
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  // A client for the code under test that keeps the mock's API for the assertions.
  const client = { query, sql: () => query.mock.calls.map(([text]) => String(text)) };
  return client as unknown as Pick<PoolClient, "query"> & typeof client;
}

describe("readStudentGraduation", () => {
  it("reads the profile, the resolved standard, the transcript and the CTĐT with plain ordered SELECTs", async () => {
    const db = fakeDb();
    const loaded = await readStudentGraduation(db, userId);
    const standard = syntheticStandards()[0]!;
    expect(loaded.profile).toEqual({ cohortCode: "K29", specialty: "CNPM" });
    expect(loaded.resolution).toBe("specialty");
    expect(loaded.standard).toEqual({ ...standard, data: { ...standard.data, gpaScale: 4 } });
    expect(loaded.transcript).toEqual({ version: transcriptVersion, updatedAt: "2026-10-01T08:00:00.000Z" });
    expect(loaded.evaluation).toEqual(evaluateGraduation({
      standard: loaded.standard!, transcript: { version: transcriptVersion, updatedAt: "2026-10-01T08:00:00.000Z", data: syntheticTranscript(syntheticStudentTerms()) },
      curriculumCourses: syntheticCurriculum().courses,
    }));
    expect(loaded.evaluation!.groups.map((group) => group.curriculumElectiveCode)).toEqual([null, "TC002", "TC102", "TC309", "TC406"]);
    expect(loaded.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.fingerprint).toBe(graduationFingerprint({ profile: loaded.profile, standard: loaded.standard!, evaluation: loaded.evaluation! }));
    expect(loaded.specialtySuggestion).toBeNull();
    const calls = db.sql();
    expect(calls.some((sql) => /FOR (UPDATE|SHARE|NO KEY|KEY)/i.test(sql))).toBe(false);
    for (const sql of calls.filter((text) => !/FROM (student_profiles|student_transcripts) WHERE/.test(text))) expect(sql).toMatch(/ORDER BY/);
    // Interests, career goals and identity never leave the profile table.
    expect(calls.find((sql) => sql.includes("FROM student_profiles"))).not.toMatch(/interests|career_goal|full_name|student_code|class_name/);
    expect(db.query.mock.calls.find(([sql]) => String(sql).includes("FROM curriculum_courses"))?.[1]).toEqual(["rev-0"]);
  });

  it("evaluates without a CTĐT when the cohort has none or several", async () => {
    for (const curricula of [0, 2]) {
      const db = fakeDb({ curricula });
      const loaded = await readStudentGraduation(db, userId);
      expect(loaded.evaluation!.groups.map((group) => group.curriculumElectiveCode)).toEqual([null, null, null, null, null]);
      expect(loaded.evaluation!.credits).toMatchObject({ source: "printed", lower: 27 });
      expect(db.sql().some((sql) => sql.includes("FROM curriculum_courses"))).toBe(false);
    }
  });

  it("has no evaluation without a transcript and reads no CTĐT", async () => {
    const db = fakeDb({ transcript: null });
    const loaded = await readStudentGraduation(db, userId);
    expect(loaded).toMatchObject({ resolution: "specialty", transcript: null, evaluation: null, fingerprint: null, specialtySuggestion: null });
    expect(loaded.standard?.id).toBe(syntheticStandards()[0]!.id);
    expect(db.sql().some((sql) => sql.includes("FROM curricula"))).toBe(false);
  });

  it("is cohort_unknown without a cohort (or a profile) and never reads standards", async () => {
    for (const profile of [{ cohort_code: null, specialty: "CNPM" }, null]) {
      const db = fakeDb({ profile });
      const loaded = await readStudentGraduation(db, userId);
      expect(loaded).toMatchObject({ profile: { cohortCode: null }, resolution: "cohort_unknown", standard: null, evaluation: null, fingerprint: null });
      expect(db.sql().some((sql) => sql.includes("FROM graduation_standards") || sql.includes("FROM curricula"))).toBe(false);
    }
  });

  it("asks for a specialty in K29 and suggests the one the passed courses point to", async () => {
    const loaded = await readStudentGraduation(fakeDb({ profile: { cohort_code: "K29", specialty: null } }), userId);
    expect(loaded).toMatchObject({ profile: { cohortCode: "K29", specialty: null }, resolution: "specialty_unset", standard: null, evaluation: null, fingerprint: null });
    expect(loaded.specialtySuggestion).toEqual({ code: "CNPM", label: "Công nghệ phần mềm", count: 1 });
    const unknown = await readStudentGraduation(fakeDb({ profile: { cohort_code: "K29", specialty: "XYZ" }, transcript: null }), userId);
    expect(unknown).toMatchObject({ profile: { specialty: null }, resolution: "specialty_unset", specialtySuggestion: null });
  });

  it("finds no standard for another cohort or a specialty without one", async () => {
    expect(await readStudentGraduation(fakeDb({ profile: { cohort_code: "K31", specialty: "CNPM" } }), userId))
      .toMatchObject({ resolution: "not_found", standard: null, evaluation: null });
    expect(await readStudentGraduation(fakeDb({ profile: { cohort_code: "K29", specialty: "TTNT" } }), userId))
      .toMatchObject({ resolution: "not_found", standard: null, evaluation: null });
  });
});

describe("loadStudentGraduation", () => {
  it("reads in a REPEATABLE READ READ ONLY snapshot and releases the client", async () => {
    const db = fakeDb();
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query: db.query, release }) } as unknown as DatabasePool;
    const loaded = await loadStudentGraduation(pool, userId);
    expect(loaded.resolution).toBe("specialty");
    expect(db.sql()[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(db.sql().at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back, releases and rethrows on failure", async () => {
    const db = fakeDb();
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM student_transcripts")) throw new Error("boom");
      return { rowCount: 0, rows: [] };
    });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query: db.query, release }) } as unknown as DatabasePool;
    await expect(loadStudentGraduation(pool, userId)).rejects.toThrow("boom");
    expect(db.sql().at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("fingerprint", () => {
  it("serializes facts canonically", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: null, e: undefined }, undefined], f: "x" })).toBe('{"a":[{"c":null,"d":2},null],"b":1,"f":"x"}');
  });

  it("is stable for the same facts and changes with the transcript, the standard revision, the profile or a course state", async () => {
    const base = await readStudentGraduation(fakeDb(), userId);
    const again = await readStudentGraduation(fakeDb(), userId);
    expect(again.fingerprint).toBe(base.fingerprint);
    const input = { profile: base.profile, standard: base.standard!, evaluation: base.evaluation! };
    const facts = graduationFingerprintFacts(input);
    expect(facts).toMatchObject({ standardRevisionId: base.standard!.revisionId, transcriptVersion, calcVersion: base.evaluation!.calcVersion, status: "fail" });
    // Not-passed courses of the groups that are not passed, with their state (code, state, credits, attempts, condition-only).
    expect(facts.groups[0]!.missing).toEqual([["71ITIN40304", "not_taken", 4, 0, false], ["71ITSE41203", "in_progress", 3, 1, false]]);
    expect(facts.groups[1]!.missing).toEqual([]);
    expect(graduationFingerprint({ ...input, standard: { revisionId: "other-revision" } })).not.toBe(base.fingerprint);
    expect(graduationFingerprint({ ...input, profile: { ...input.profile, cohortCode: "K30" } })).not.toBe(base.fingerprint);
    const newer = { ...input.evaluation, asOf: { ...input.evaluation.asOf, transcriptVersion: "00000000-0000-4000-8000-0000000000f2" } };
    expect(graduationFingerprint({ ...input, evaluation: newer })).not.toBe(base.fingerprint);
    // The upload time alone is not a fact the advice is written from.
    const touched = { ...input.evaluation, asOf: { ...input.evaluation.asOf, transcriptUpdatedAt: "2026-10-02T00:00:00.000Z" } };
    expect(graduationFingerprint({ ...input, evaluation: touched })).toBe(base.fingerprint);
    const terms = syntheticStudentTerms();
    terms[6]!.rows = [["71ITSE41203", 3, 8, 3.5, "B+"]];
    const passed = await readStudentGraduation(fakeDb({ transcript: syntheticTranscript(terms) }), userId);
    expect(passed.fingerprint).not.toBe(base.fingerprint);
  });

  it("changes with each AI-relevant fact on its own", async () => {
    const base = await readStudentGraduation(fakeDb(), userId);
    const input = { profile: base.profile, standard: base.standard!, evaluation: base.evaluation! };
    const hash = graduationFingerprint(input);
    const edited = (edit: (evaluation: GraduationEvaluation) => void) => {
      const evaluation = structuredClone(input.evaluation);
      edit(evaluation);
      return graduationFingerprint({ ...input, evaluation });
    };
    const candidate = (code: string, state: "passed" | "failed", credits = 3): GraduationImprovementCandidate =>
      ({ code, name: "Học phần tổng hợp", credits, score: 1.5, scale: 4, letter: "D+", state });
    const improvement = edited((evaluation) => { evaluation.improvementCandidates = [candidate("71ITAI40103", "passed")]; });
    const facts: [string, string][] = [
      ["gpa.actual", edited((evaluation) => { evaluation.gpa.actual = 2.86; })],
      ["credits.lower", edited((evaluation) => { evaluation.credits!.lower = 28; })],
      ["group lower", edited((evaluation) => { evaluation.groups[4]!.lower = 3; })],
      ["group status", edited((evaluation) => { evaluation.groups[4]!.status = "unknown"; })],
      ["group remaining", edited((evaluation) => { evaluation.groups[4]!.remaining = 3; })],
      ["improvement candidate", improvement],
      ["warning added", edited((evaluation) => { evaluation.warnings.push({ code: "ocr_needs_review" }); })],
      ["warning count", edited((evaluation) => { evaluation.warnings[0]!.count = 12; })],
      // A new row: the listed row is the same object as the group's row, whose credits are a fact of their own.
      ["in-progress credits", edited((evaluation) => { evaluation.inProgress[0] = { ...evaluation.inProgress[0]!, credits: 4 }; })],
      // A CTĐT that marks a missing course condition-only (the credit note of the advice leaves it out).
      ["missing course condition-only", edited((evaluation) => {
        const course = evaluation.groups[0]!.courses.find((row) => row.code === "71ITIN40304")!;
        course.conditionOnly = true;
      })],
      ["profile.specialty", graduationFingerprint({ ...input, profile: { ...input.profile, specialty: "CNDL" } })],
    ];
    for (const [fact, fingerprint] of facts) expect({ fact, changed: fingerprint !== hash }).toEqual({ fact, changed: true });
    // Improvement candidates differ by code, by state (học cải thiện / học lại) and by credits.
    for (const other of [candidate("71ITSE30603", "passed"), candidate("71ITAI40103", "failed"), candidate("71ITAI40103", "passed", 4)]) {
      const fingerprint = edited((evaluation) => { evaluation.improvementCandidates = [other]; });
      expect({ other, changed: fingerprint !== improvement }).toEqual({ other, changed: true });
    }
    // So do the computed bounds of a credit mismatch, which follow the CTĐT credits.
    const mismatch = (computedLower: number) => edited((evaluation) => {
      evaluation.warnings.push({ code: "credits_mismatch", printed: 27, computedLower, computedUpper: computedLower });
    });
    expect(mismatch(29)).not.toBe(mismatch(30));
  });

  it("carries the advice prompt version, so advice written by an older prompt is not current", async () => {
    const base = await readStudentGraduation(fakeDb(), userId);
    const input = { profile: base.profile, standard: base.standard!, evaluation: base.evaluation! };
    const facts = graduationFingerprintFacts(input);
    expect(facts).toMatchObject({ v: 2, promptVersion: GRADUATION_ADVICE_PROMPT_VERSION });
    expect(GRADUATION_ADVICE_PROMPT_VERSION).toBe("grad-advice-v2");
    const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
    expect(hash(facts)).toBe(base.fingerprint);
    expect(hash({ ...facts, promptVersion: "grad-advice-v1" })).not.toBe(base.fingerprint);
  });

  it("changes when only the CTĐT rows differ (same transcript version and standard revision)", async () => {
    const base = await readStudentGraduation(fakeDb(), userId);
    // The CTĐT is re-imported with its graduation electives coded TC407 instead of TC406.
    const recoded = syntheticCurriculum().courses.map((course) => (course.type === "TC406" ? { ...course, type: "TC407" } : course));
    const changed = await readStudentGraduation(fakeDb({ curriculumCourses: recoded }), userId);
    expect(changed.transcript).toEqual(base.transcript);
    expect(changed.standard!.revisionId).toBe(base.standard!.revisionId);
    expect(changed.evaluation!.groups.map((group) => group.curriculumElectiveCode)).toEqual([null, "TC002", "TC102", "TC309", "TC407"]);
    expect(changed.fingerprint).not.toBe(base.fingerprint);
    // A CTĐT edit that changes no fact (a course renamed) keeps the fingerprint.
    const renamed = syntheticCurriculum().courses.map((course) => (course.code === "71ITBS10103" ? { ...course, name: "Nhập môn CNTT" } : course));
    expect((await readStudentGraduation(fakeDb({ curriculumCourses: renamed }), userId)).fingerprint).toBe(base.fingerprint);
  });
});
