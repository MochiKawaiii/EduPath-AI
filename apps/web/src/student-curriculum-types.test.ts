import { describe, expect, it } from "vitest";
import {
  courseKind,
  courseTypeLabel,
  searchableCourse,
  searchTerm,
  termLabel,
  type StudentCourse,
} from "./student-curriculum-types";

describe("student curriculum display helpers", () => {
  it("keeps required and elective course filters aligned with curriculum type codes", () => {
    expect(courseKind("BB")).toBe("required");
    expect(courseKind("BBKTL")).toBe("required");
    expect(courseKind("TC309 (9 TC)")).toBe("elective");
    expect(courseTypeLabel("TC309")).toContain("TC309");
    expect(courseTypeLabel("unrecognised")).toBe("unrecognised");
  });

  it("spells out the planned year and semester, skipping a missing part", () => {
    expect(termLabel(1, 2)).toBe("Năm 1 · HK 2");
    expect(termLabel(null, 3)).toBe("HK 3");
    expect(termLabel(4, null)).toBe("Năm 4");
    expect(termLabel(null, null)).toBe("—");
  });

  it("builds a stable search index from the public course fields", () => {
    const course = {
      code: "71IT000001",
      name: "Advanced Databases",
      englishName: "Database Systems",
    } as StudentCourse;
    expect(searchableCourse(course)).toBe(
      "71it000001 advanced databases database systems",
    );
    expect(searchTerm("  Advanced Databases ")).toBe("advanced databases");
  });

  it("removes accents so a plain-text search finds an accented course name", () => {
    const course = {
      code: "71IT000002",
      name: "Café dữ liệu",
      englishName: "Data Cafe",
    } as StudentCourse;
    expect(searchableCourse(course)).toContain("cafe du lieu");
    expect(searchTerm("  CAFÉ DỮ LIỆU ")).toBe("cafe du lieu");
  });
});
