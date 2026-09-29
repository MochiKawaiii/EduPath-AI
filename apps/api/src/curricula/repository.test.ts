import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { readWorkbook } from "./parser.js";
import { CurriculumRepository } from "./repository.js";
import type { CurriculumData } from "./model.js";

let k29: CurriculumData;

beforeAll(async () => {
  k29 = await readWorkbook(
    await readFile(new URL("../../data/curricula/K29.xlsx", import.meta.url)),
  );
}, 30000);

describe("CurriculumRepository revision persistence", () => {
  it("keeps duplicate rows in revision JSON and writes unique lookup projections", async () => {
    const data = structuredClone(k29);
    const first = data.courses[0]!;
    const targetCode = data.courses[1]!.code;
    first.prerequisite = targetCode;
    const duplicate = {
      ...first,
      position: data.courses.length + 1,
      sourceRow: 250,
    };
    data.courses.push(duplicate);
    const duplicateCode = first.code;
    const expectedSourceRows = data.courses
      .filter((course) => course.code === duplicateCode)
      .map((course) => course.sourceRow);

    const query = vi.fn(async (sql: string, _parameters?: unknown[]) => ({
      rowCount: sql.includes("SELECT id FROM curricula") ? 0 : 1,
      rows: [] as unknown[],
    }));
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) };
    const repository = new CurriculumRepository(pool as unknown as DatabasePool);

    await repository.create(data, Buffer.from("curriculum source"), "K29.xlsx");

    const revisionParameters = query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO curriculum_revisions"),
    )?.[1];
    const courseParameters = query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO curriculum_courses"),
    )?.[1];
    const catalogParameters = query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO course_catalog"),
    )?.[1];
    const relationParameters = query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO curriculum_relations"),
    )?.[1];

    expect(revisionParameters).toBeDefined();
    expect(courseParameters).toBeDefined();
    expect(catalogParameters).toBeDefined();
    expect(relationParameters).toBeDefined();

    const revisionData = JSON.parse(String(revisionParameters?.[2])) as CurriculumData;
    const indexedCourses = JSON.parse(String(courseParameters?.[1])) as CurriculumData["courses"];
    const catalogCourses = JSON.parse(String(catalogParameters?.[0])) as CurriculumData["courses"];
    const indexedRelations = JSON.parse(String(relationParameters?.[1])) as CurriculumData["relations"];
    const revisionDuplicateRows = revisionData.courses.filter((course) => course.code === duplicateCode);
    const revisionDuplicateRelations = revisionData.relations.filter((relation) =>
      relation.courseCode === duplicateCode && relation.kind === "prerequisite",
    );

    expect(revisionDuplicateRows.map((course) => course.sourceRow)).toEqual(expectedSourceRows);
    expect(revisionDuplicateRelations).toHaveLength(2);
    expect(revisionDuplicateRelations.every((relation) => relation.reviewRequired)).toBe(true);
    expect(indexedCourses.filter((course) => course.code === duplicateCode)).toHaveLength(1);
    expect(catalogCourses.filter((course) => course.code === duplicateCode)).toHaveLength(1);
    expect(indexedRelations.filter((relation) =>
      relation.courseCode === duplicateCode && relation.kind === "prerequisite",
    )).toHaveLength(1);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
