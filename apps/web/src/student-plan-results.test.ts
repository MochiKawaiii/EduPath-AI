import { describe, expect, it } from "vitest";
import { passedPhysicalEducationCourses, studentPlanResult } from "./student-plan-results";
import { transcriptResults } from "./transcript-results";

const passed = "\u0110\u1ea1t";
const failed = "Kh\u00f4ng \u0111\u1ea1t";

describe("student plan course results", () => {
  it("counts distinct passed courses across both physical education groups", () => {
    const results = new Map([
      ["71TC0020001", "pass"],
      ["71TC1020001", "pass"],
      ["71TC2090001", "pass"],
    ] as const);
    const count = passedPhysicalEducationCourses(
      ["71TC0020001", "71TC1020001"],
      results,
    );

    expect(count).toBe(2);
    expect(studentPlanResult({ code: "", name: "GDTC 1" }, results, count)).toBe("pass");
    expect(studentPlanResult({ code: "", name: "GDTC 2" }, results, count)).toBe("pass");
  });

  it("passes only the first slot with one course and leaves both blank with none", () => {
    const oneCourse = new Map([["71TC0020001", "pass"]] as const);
    const one = passedPhysicalEducationCourses(["71TC0020001"], oneCourse);
    expect(one).toBe(1);
    expect(studentPlanResult({ code: "", name: "GDTC 1" }, oneCourse, one)).toBe("pass");
    expect(studentPlanResult({ code: "", name: "GDTC 2" }, oneCourse, one)).toBeUndefined();

    const none = passedPhysicalEducationCourses(["71TC0020001"], new Map());
    expect(none).toBe(0);
    expect(studentPlanResult({ code: "", name: "GDTC 1" }, new Map(), none)).toBeUndefined();
    expect(studentPlanResult({ code: "", name: "GDTC 2" }, new Map(), none)).toBeUndefined();
  });

  it("does not count failed or unknown physical education results", () => {
    const results = transcriptResults([
      { courses: [
        { code: "71TC0020001", result: failed },
        { code: "71TC1020001", result: "Exempt" },
        { code: "71TC1020002", result: null },
      ] },
    ]);
    const count = passedPhysicalEducationCourses(
      ["71TC0020001", "71TC1020001", "71TC1020002"],
      results,
    );

    expect(count).toBe(0);
    expect(studentPlanResult({ code: "", name: "GDTC 1" }, results, count)).toBeUndefined();
  });

  it("deduplicates codes across groups and retakes, counting an MT course as passed", () => {
    const results = transcriptResults([
      { courses: [
        { code: "71TC0020001", result: failed },
        { code: "71TC1020001", result: passed },
      ] },
      { courses: [
        { code: " 71tc0020001 ", result: null, letter: " MT " },
        { code: "71TC1020001", result: failed },
      ] },
    ]);
    const count = passedPhysicalEducationCourses(
      ["71TC0020001", " 71tc0020001 ", "71TC1020001", "71TC1020001 "],
      results,
    );

    expect(count).toBe(2);
    expect(studentPlanResult({ code: "", name: "Gi\u00e1o d\u1ee5c th\u1ec3 ch\u1ea5t 2" }, results, count)).toBe("pass");
  });

  it("keeps regular course results tied to their normalized course code", () => {
    const results = new Map([
      ["71REGULAR0001", "pass"],
      ["71REGULAR0002", "fail"],
    ] as const);

    expect(studentPlanResult({ code: " 71regular0001 ", name: "Regular course" }, results, 0)).toBe("pass");
    expect(studentPlanResult({ code: "71REGULAR0002", name: "Another regular course" }, results, 2)).toBe("fail");
  });
});
