import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { GraduationData } from "./model.js";
import { normalizeCohortCode, profileSpecialty, resolveCohortStandard, resolveStudentStandard, standardIdentity } from "./resolve.js";

// Synthetic standards only: ids and names are invented, program codes follow the public 7480201-0x scheme.
type Row = { id: string; revision_id: string; version: number; cohort: string; data: Partial<GraduationData> };
const standard = (id: string, cohort: string, data: Partial<GraduationData>): Row => ({
  id, revision_id: `${id}-rev`, version: 2, cohort,
  data: { name: `Tiêu chuẩn ${id}`, standardCode: "TN", classBlock: "71K29CNTT", specialty: "", gpaScale: null, groups: [], courses: [], ...data },
});

function fakeDb(rows: Row[]) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (!sql.includes("FROM graduation_standards")) throw new Error(`unexpected query: ${sql}`);
    const list = rows.filter((row) => row.cohort === params[0]).map(({ cohort: _cohort, ...row }) => row);
    return { rowCount: list.length, rows: list };
  });
  // A client for the code under test that keeps the mock's API for the assertions.
  return { query } as unknown as Pick<PoolClient, "query"> & { query: typeof query };
}

const cnpm = standard("std-cnpm", "K29", { specialty: "Công nghệ phần mềm (7480201-03)", classBlock: "71K29CNTT_7480201-03" });
const cndl = standard("std-cndl", "K29", { specialty: "Công nghệ dữ liệu", classBlock: "71K29CNTT", standardCode: "71K29CNTT_7480201-02_TN04", gpaScale: 10 });
const general = standard("std-k27", "K27", { specialty: "Công nghệ thông tin", classBlock: "71K27CNTT" });

describe("profile values", () => {
  it("normalizes the cohort like the standards store it and keeps only known specialty codes", () => {
    expect(normalizeCohortCode(" k29 ")).toBe("K29");
    for (const blank of [null, undefined, "", "   "]) expect(normalizeCohortCode(blank)).toBeNull();
    expect(profileSpecialty("CNDL")).toBe("CNDL");
    for (const other of ["cnpm", "Công nghệ phần mềm", null, 3]) expect(profileSpecialty(other)).toBeNull();
    expect(standardIdentity({ specialty: "a", classBlock: "b", standardCode: "c" })).toEqual({ specialty: "a", classBlock: "b", standardCode: "c" });
  });
});

describe("resolveCohortStandard (D3)", () => {
  it("reads active current standards of the cohort in a deterministic order", async () => {
    const db = fakeDb([cnpm, cndl]);
    await resolveCohortStandard(db, "K29", "CNPM");
    const [sql, params] = db.query.mock.calls[0]!;
    expect(sql).toContain("JOIN graduation_revisions r ON r.id=g.current_revision WHERE g.is_active AND g.cohort_code=$1 ORDER BY g.id");
    expect(params).toEqual(["K29"]);
  });

  it("picks the student's specialty with the full identity, standardCode included, and defaults gpaScale to 4", async () => {
    const db = fakeDb([cnpm, cndl]);
    expect(await resolveCohortStandard(db, "K29", "CNPM")).toEqual({
      resolution: "specialty", standard: { id: "std-cnpm", revisionId: "std-cnpm-rev", version: 2, data: { ...cnpm.data, gpaScale: 4 } },
    });
    // CNDL's program code is only in its standardCode.
    expect(await resolveCohortStandard(db, "K29", "CNDL")).toMatchObject({ resolution: "specialty", standard: { id: "std-cndl", data: { gpaScale: 10 } } });
  });

  it("never falls back to another specialty's standard", async () => {
    const db = fakeDb([cnpm, cndl]);
    expect(await resolveCohortStandard(db, "K29", "TTNT")).toEqual({ resolution: "not_found", standard: null });
    expect(await resolveCohortStandard(db, "K29", null)).toEqual({ resolution: "specialty_unset", standard: null });
  });

  it("uses a single general standard, and reports none or several", async () => {
    expect(await resolveCohortStandard(fakeDb([general]), "K27", "CNPM")).toMatchObject({ resolution: "general", standard: { id: "std-k27" } });
    expect(await resolveCohortStandard(fakeDb([general]), "K27", null)).toMatchObject({ resolution: "general", standard: { id: "std-k27" } });
    expect(await resolveCohortStandard(fakeDb([cnpm, cndl]), "K30", "CNPM")).toEqual({ resolution: "not_found", standard: null });
    expect(await resolveCohortStandard(fakeDb([cnpm, { ...cnpm, id: "std-cnpm-2" }]), "K29", "CNPM")).toEqual({ resolution: "ambiguous", standard: null });
  });
});

describe("resolveStudentStandard", () => {
  it("is cohort_unknown without a cohort and reads no standard", async () => {
    const db = fakeDb([cnpm, cndl]);
    expect(await resolveStudentStandard(db, { cohortCode: null, specialty: "CNPM" })).toEqual({ resolution: "cohort_unknown", standard: null });
    expect(await resolveStudentStandard(db, { cohortCode: "  ", specialty: "CNPM" })).toEqual({ resolution: "cohort_unknown", standard: null });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("normalizes the profile cohort before reading", async () => {
    const db = fakeDb([cnpm, cndl]);
    expect(await resolveStudentStandard(db, { cohortCode: " k29 ", specialty: "CNPM" })).toMatchObject({ resolution: "specialty", standard: { id: "std-cnpm" } });
    expect(db.query.mock.calls[0]![1]).toEqual(["K29"]);
  });
});
