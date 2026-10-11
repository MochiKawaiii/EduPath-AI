import { describe, expect, it } from "vitest";
import { courseKey, deriveElectiveGroups, electiveCodeOf } from "./course-state.js";
import { syntheticCurriculum, syntheticPlan, syntheticStandards } from "./fixtures/synthetic-k29.js";
import { electiveQuotas } from "./graduation.js";
import { choiceRule, physicalEducationGroupsFor, physicalEducationSlot, planProgress, type PlanCourseInfo } from "./plan-progress.js";
import { classifyCurriculumSpecialty } from "./specialty.js";
import type { CourseState, SpecialtyCode } from "./types.js";

const curriculum = syntheticCurriculum();
const plan = syntheticPlan();
const standards = syntheticStandards();

/** Course map as calculate.ts builds it: applicability from the CTĐT specialty, never the section label. */
function courses(states: Record<string, CourseState>, specialty: SpecialtyCode | null = "CNPM") {
  return new Map<string, PlanCourseInfo>(curriculum.courses.map((course) => {
    const code = courseKey(course.code);
    const state = states[code] ?? "not_taken";
    const kind = classifyCurriculumSpecialty(course.specialty);
    const applicable = kind.kind === "common" || kind.code === specialty || state !== "not_taken";
    return [code, { code, name: course.name, credits: course.credits, state, applicable, electiveCode: electiveCodeOf(course.type) }];
  }));
}

const quotas = electiveQuotas(deriveElectiveGroups(curriculum.courses), standards[0]!.data);
const run = (currentTerm: string | null, states: Record<string, CourseState>, specialty: SpecialtyCode | null = "CNPM", data = plan.data) =>
  planProgress({ plan: data, physicalEducationGroups: plan.physicalEducationGroups, currentTerm, courses: courses(states, specialty), quotas });

const passedThroughHK243: Record<string, CourseState> = {
  "71ITBS10103": "passed", "71ITBS10203": "passed", "71NAD110013": "passed", "71ITSE30103": "passed", "71PEKC10062": "passed",
  "71ITIS30103": "exempt", "71PETT10012": "passed", "71ITSE30503": "passed", "71ITSE30603": "passed", "71ITSE41003": "passed",
  "71ITAI40103": "passed", "71ITIS30303": "passed",
};

describe("section labels (real K29 strings)", () => {
  it("reads k from the folded label, with or without a space", () => {
    expect(choiceRule("Chọn1 trong 3 môn sau")).toEqual({ k: 1, stated: 3, choice: true, informational: false });
    expect(choiceRule("Chọn 1 trong 2 môn sau")).toMatchObject({ k: 1, stated: 2, informational: false });
    expect(choiceRule("Chọn 2 trong 6 HP tự chọn Cơ sở ngành")).toMatchObject({ k: 2, stated: 6, choice: true });
  });

  it("treats sections without k or '(Không tính vào tích lũy)' as reference only", () => {
    expect(choiceRule("Chọn  các môn sau (Không tính vào tích lũy)")).toMatchObject({ k: null, choice: true, informational: true });
    expect(choiceRule("Chọn 1 môn sau (Không tính vào tích lũy)")).toMatchObject({ k: 1, informational: true });
    expect(choiceRule("Chuyên ngành CNPM")).toMatchObject({ choice: false, informational: false });
    expect(choiceRule("Chuyên ngành Trí tuệ Nhân tạo")).toMatchObject({ choice: false });
  });

  it("recognises GDTC placeholders (DGT0010/DGT0020 are not real codes)", () => {
    expect(physicalEducationSlot("GDTC 1")).toBe(1);
    expect(physicalEducationSlot("GDTC2")).toBe(2);
    expect(physicalEducationSlot("Giáo dục thể chất 1")).toBe(1);
    expect(physicalEducationSlot("GDQP1: Đường lối QP và AN của ĐCSVN")).toBeNull();
    expect(physicalEducationGroupsFor(curriculum.courses)).toEqual({ TC002: ["71PEKC10062", "71PESW10042"], TC102: ["71PEBA10052", "71PETT10012"] });
  });
});

describe("training-plan progress (spec §7.8)", () => {
  it("reports nothing late for an on-track student, even with reference-only sections and TC406 alternatives", () => {
    const result = run("HK253", { ...passedThroughHK243, "71ITSE41203": "passed", "71ITIN40304": "passed", "71ITIS30403": "in_progress" });
    expect(result.late).toEqual([]);
    expect(result).toMatchObject({ currentTerm: "HK253", nextTerm: "HK261", lateCount: 0, lateCredits: 0 });
    expect(result.informationalSections).toEqual([expect.objectContaining({ label: "Chọn  các môn sau (Không tính vào tích lũy)", termCode: "HK252" })]);
    // HK261 alternatives (Đồ án / Chuyên đề) are one quota choice, partly filled by the course in progress.
    expect(result.next).toEqual([expect.objectContaining({ kind: "choice", label: "Nhóm tự chọn TC406: chọn 6 tín chỉ", unit: "credit", remaining: 3 })]);
  });

  it("counts a course that appears in two choice sections once, for the earliest section", () => {
    const states = { ...passedThroughHK243 };
    delete states["71ITIS30303"];
    const result = run("HK243", states);
    expect(result.late).toEqual([expect.objectContaining({ kind: "choice", label: "Chọn1 trong 3 môn sau", termCode: "HK243", missing: 1, missingCredits: 3 })]);
    expect(result).toMatchObject({ lateCount: 1, lateCredits: 3 });
  });

  it("lists late courses, GDTC slots and choices, but never in-progress courses", () => {
    const result = run("HK241", {
      "71ITBS10103": "passed", "71ITBS10203": "failed", "71NAD110013": "passed", "71ITSE30103": "in_progress", "71PEKC10062": "passed",
      "71ITIS30103": "graded_unknown",
    });
    expect(result.late.map((entry) => [entry.kind, "code" in entry ? entry.code : entry.label, entry.termCode])).toEqual([
      ["course", "71ITBS10203", "HK231"],
      ["physical_education", "GDTC 2", "HK233"],
      ["course", "71ITSE30503", "HK241"],
      ["choice", "Chọn 1 trong 2 môn sau", "HK241"],
    ]);
    expect(result.late.find((entry) => entry.kind === "physical_education")).toMatchObject({ required: 2, passed: 1, missingCredits: 2 });
    expect(result).toMatchObject({ lateCount: 4, lateCredits: 3 + 2 + 3 + 3 });
  });

  it("does not count an ongoing PE elective as late", () => {
    const result = run("HK233", { "71ITBS10103": "passed", "71ITBS10203": "passed", "71NAD110013": "passed", "71ITSE30103": "passed", "71ITIS30103": "passed", "71PEKC10062": "passed", "71PEBA10052": "in_progress" });
    expect(result.late).toEqual([]);
  });

  it("decides applicability from the CTĐT specialty, not from the section label", () => {
    const states = { ...passedThroughHK243 };
    delete states["71ITSE41003"];
    delete states["71ITAI40103"];
    const late = (specialty: SpecialtyCode | null) => run("HK243", states, specialty).late.map((entry) => ("code" in entry ? entry.code : entry.label));
    // 71ITAI40103 is a common course listed under the "Chuyên ngành Trí tuệ Nhân tạo" section.
    expect(late("CNPM")).toEqual(["71ITSE41003", "71ITAI40103"]);
    expect(late("CNDL")).toEqual(["71ITDS40303", "71ITAI40103"]);
    expect(late(null)).toEqual(["71ITAI40103"]);
  });

  it("treats the TC406 alternatives as one quota choice in credits", () => {
    const result = run("HK261", { ...passedThroughHK243, "71ITSE41203": "passed", "71ITIN40304": "passed", "71ITGR40206": "failed" });
    expect(result.late).toEqual([expect.objectContaining({ kind: "choice", unit: "credit", required: 6, missingCredits: 6, missing: 1 })]);
    const unknown = run("HK261", { ...passedThroughHK243, "71ITSE41203": "passed", "71ITIN40304": "passed", "71ITGR40206": "graded_unknown" });
    expect(unknown.late).toEqual([]);
    const done = run("HK261", { ...passedThroughHK243, "71ITSE41203": "passed", "71ITIN40304": "passed", "71ITGR40203": "passed", "71ITIS30403": "passed" });
    expect(done.late).toEqual([]);
  });

  it("warns when the 'trong n' of a label differs from the real item count", () => {
    const data = structuredClone(plan.data);
    data.sections = data.sections.map((section) => (section.id === "section-36" ? { ...section, label: "Chọn 1 trong 4 môn sau" } : section));
    expect(run("HK241", passedThroughHK243, "CNPM", data).countMismatches).toEqual([{ label: "Chọn 1 trong 4 môn sau", termCode: "HK241", stated: 4, actual: 2 }]);
    expect(run("HK241", passedThroughHK243).countMismatches).toEqual([]);
  });

  it("has nothing late before the first graded term", () => {
    expect(run(null, {})).toMatchObject({ currentTerm: null, nextTerm: "HK231", late: [] });
  });
});
