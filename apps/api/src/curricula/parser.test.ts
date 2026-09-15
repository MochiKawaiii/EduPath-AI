import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { checkArchive, parseCurriculum, readWorkbook } from "./parser.js";
import { courseSchema, rebuild, type CurriculumData } from "./model.js";
import { identity } from "./repository.js";
let k29: CurriculumData, k30: CurriculumData, k31: CurriculumData;
beforeAll(async () => {
  [k29, k30, k31] = await Promise.all(
    [29, 30, 31].map(async (k) =>
      readWorkbook(
        await readFile(
          new URL(`../../data/curricula/K${k}.xlsx`, import.meta.url),
        ),
      ),
    ),
  );
}, 30000);
describe("real faculty curriculum workbooks", () => {
  it("imports exactly the supplied cohorts, preserving every course and authoritative credits", () => {
    for (const [data, count, year] of [
      [k29, 88, 2023],
      [k30, 89, 2024],
      [k31, 89, 2025],
    ] as const) {
      expect(data.courses).toHaveLength(count);
      expect(data.admissionYear).toBe(year);
      expect(data.totalCredits).toBe(126);
      for (const course of data.courses)
        expect(courseSchema.safeParse(course).success, course.code).toBe(true);
      expect(new Set(data.courses.map((c) => c.code)).size).toBe(count);
    }
  });
  it("preserves BBKTL and separates elective requirements from the offered course credits", () => {
    expect(k30.courses.filter((c) => c.type === "BBKTL")).toHaveLength(4);
    expect(k31.electives.find((g) => g.code === "TC309")?.requiredCredits).toBe(
      9,
    );
    expect(
      k29.electives.find((g) => g.code === "TC309")?.requiredCredits,
    ).toBeNull();
    expect(k31.courses.reduce((sum, c) => sum + c.credits, 0)).toBeGreaterThan(
      k31.totalCredits,
    );
  });
  it("retains invalid formula and shifted source cells without inventing semester or department", () => {
    expect(k29.sourceWarnings.some((w) => w.message.includes("#REF!"))).toBe(
      true,
    );
    const shifted = k29.courses.find((c) => c.sourceRow === 108)!;
    expect(shifted.semester).toBeNull();
    expect(shifted.department).toBe("");
    expect(shifted.sourceCells.R).not.toBe("");
    expect(shifted.sourceCells.M).toContain("71ITSE30503");
  });
  it("does not silently map an obsolete prerequisite code by similar course name", () => {
    expect(k31.courses.some((c) => c.code === "71ITMA10404")).toBe(true);
    expect(
      k31.relations.find((r) => r.courseCode === "71ITDS40203"),
    ).toMatchObject({
      kind: "prior",
      reviewRequired: true,
      unresolvedCodes: ["71ITMA10403"],
    });
  });
  it("keeps the two relation kinds and conditional requirements distinct", () => {
    expect(k31.relations.some((r) => r.kind === "prior")).toBe(true);
    expect(k31.relations.some((r) => r.kind === "prerequisite")).toBe(true);
    expect(
      k31.relations
        .filter((r) => r.courseCode === "71ITGR40206")
        .every((r) => r.reviewRequired),
    ).toBe(true);
  });
  it("runs parsing in a real bounded worker, independently of the uploaded filename", async () => {
    const data = await parseCurriculum(
      await readFile(new URL("../../data/curricula/K30.xlsx", import.meta.url)),
    );
    expect(data.cohortCode).toBe("K30");
    expect(data.courses).toHaveLength(89);
  }, 30000);
  it("rejects duplicate codes rather than overwriting a course", () => {
    const data = structuredClone(k29);
    data.courses.push({ ...data.courses[0]! });
    expect(() => rebuild(data)).toThrow("duplicate_course");
  });
  it("accepts an explicit elective requirement appearing after a bare group code", () => {
    const data = structuredClone(k31);
    const electives = data.courses.filter((c) => c.type.startsWith("TC002"));
    electives[0]!.type = "TC002";
    expect(
      rebuild(data).electives.find((g) => g.code === "TC002")?.requiredCredits,
    ).toBe(2);
  });
  it("marks cyclic dependencies for review", () => {
    const data = structuredClone(k31);
    const [a, b] = data.courses;
    a!.prerequisite = b!.code;
    b!.prerequisite = a!.code;
    expect(
      rebuild(data).warnings.some((w) => w.message.includes("chu trình")),
    ).toBe(true);
  });
  it("uses major and cohort identity, not filename or presentation title", () => {
    expect(identity(k29)).toBe(
      identity({ ...k29, name: "Tên mới", major: k29.major.toLowerCase() }),
    );
    expect(identity(k30)).not.toBe(identity(k29));
  });
  it("only allows semesters 1, 2, 3 on edits", () => {
    expect(
      courseSchema.safeParse({ ...k29.courses[0], semester: 4 }).success,
    ).toBe(false);
    expect(
      courseSchema.safeParse({ ...k29.courses[0], semester: 3 }).success,
    ).toBe(true);
  });
  it("rejects non-workbooks and archives whose advertised expansion exceeds the limit", async () => {
    expect(() => checkArchive(Buffer.from("%PDF-invalid"))).toThrow(
      "invalid_workbook",
    );
    const file = await readFile(
      new URL("../../data/curricula/K30.xlsx", import.meta.url),
    );
    const index = file.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    file.writeUInt32LE(40 * 1024 * 1024, index + 24);
    expect(() => checkArchive(file)).toThrow("workbook_too_large");
  });
});
