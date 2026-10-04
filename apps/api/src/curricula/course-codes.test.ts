import { describe, expect, it } from "vitest";
import { courseCode, referencedCourseCodes } from "./course-codes.js";

describe("curriculum course identifiers", () => {
  it.each(["X", "101", "BACKEND", "CS-101", "IT/2027.01", "CS_1", "A+B", "MÔN A"])(
    "accepts %s without an institution-specific format",
    (code) => expect(courseCode.parse(code)).toBe(code),
  );

  it("keeps catalog casing consistent and only enforces basic input limits", () => {
    expect(courseCode.parse("  module/2027.01  ")).toBe("MODULE/2027.01");
    expect(courseCode.parse("X".repeat(100))).toHaveLength(100);
    for (const invalid of ["", "  ", "X".repeat(101), "CS\n101", "CS\u0000101"]) {
      expect(courseCode.safeParse(invalid).success, invalid).toBe(false);
    }
  });
});

describe("prerequisite identifiers", () => {
  it("recognizes literal codes with punctuation, spaces, Unicode and numeric-only codes", () => {
    const known = ["CS", "CS 101", "CS-101", "BACKEND", "A+B", "MÔN A", "123"];
    expect(referencedCourseCodes("CS 101, [cs-101]; BACKEND. [a+b] [môn a] 123", known))
      .toEqual(["CS 101", "CS-101", "BACKEND", "A+B", "MÔN A", "123"]);
  });

  it("does not turn a longer identifier into a reference to its prefix", () => {
    expect(referencedCourseCodes("CS-1010", ["CS", "CS-101"]))
      .toEqual(["CS-1010"]);
    expect(referencedCourseCodes("CS+1", ["CS"]))
      .toEqual(["CS+1"]);
  });

  it("preserves missing bracketed and unbracketed identifiers for review", () => {
    expect(referencedCourseCodes("CS-999, [môn mới / A] và 71ITMA10403", []))
      .toEqual(["CS-999", "MÔN MỚI / A", "71ITMA10403"]);
    expect(referencedCourseCodes("[MÔN A]Tên môn [môn a]", []))
      .toEqual(["MÔN A"]);
    expect(referencedCourseCodes("BACKEND", [])).toEqual(["BACKEND"]);
  });
});
