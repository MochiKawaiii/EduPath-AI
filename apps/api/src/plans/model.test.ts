import { describe, expect, it } from "vitest";
import type { CurriculumCourse, CurriculumData } from "../curricula/model.js";
import { reviewPlan, type PlanData, type PlanItem } from "./model.js";

function item(
  position: number,
  code: string,
  termCode: string,
  sourceRow: number,
  name = `Course ${position}`,
): PlanItem {
  const semester = Number(termCode.at(-1));
  return {
    id: `row-${position}`,
    position,
    code,
    name,
    credits: 3,
    type: "BB",
    termCode,
    semester,
    studyYear: 1,
    sectionId: "",
    prerequisite: "",
    prior: "",
    notes: "",
    hours: { lecture: null, practice: null, project: null, internship: null },
    sourceRow,
    sourceSheet: "Plan K29",
    sourceCells: {},
  };
}

function plan(items: PlanItem[]): PlanData {
  const terms = [...new Map(items.map((course) => [course.termCode, course])).values()]
    .map((course) => ({
      code: course.termCode,
      semester: course.semester,
      studyYear: course.studyYear,
      sourceCredits: null,
    }));
  return {
    schemaVersion: 1,
    name: "Plan K29",
    major: "Information Technology",
    cohortCode: "K29",
    admissionYear: 2023,
    totalCredits: null,
    notes: "",
    items,
    terms,
    sections: [],
    sourceWarnings: [],
    warnings: [],
    curriculum: {
      id: "curriculum-id",
      revisionId: "revision-id",
      version: 2,
      name: "Curriculum K29",
    },
  };
}

function course(
  code: string,
  overrides: Partial<CurriculumCourse> = {},
): CurriculumCourse {
  return {
    position: 1,
    code,
    name: "Matched course",
    englishName: "Matched course",
    credits: 3,
    type: "BB",
    block: "",
    specialty: "",
    semester: 1,
    studyYear: 1,
    prerequisite: "",
    prior: "",
    notes: "",
    department: "",
    departmentCode: "",
    hours: { lecture: null, practice: null, project: null, internship: null },
    groupId: "",
    sourceRow: 1,
    sourceSheet: "Curriculum K29",
    sourceCells: {},
    ...overrides,
  };
}

function curriculum(courses: CurriculumCourse[] = []): CurriculumData {
  return {
    schemaVersion: 1,
    name: "Curriculum K29",
    major: "Information Technology",
    cohortCode: "K29",
    admissionYear: 2023,
    totalCredits: 120,
    notes: "",
    courses,
    groups: [],
    electives: [],
    relations: [],
    warnings: [],
    sourceWarnings: [],
  };
}

describe("reviewPlan course-code review", () => {
  it("reports same-term repeated codes with each source allocation and keeps both rows", () => {
    const data = plan([
      item(1, "71ITSE0001", "HK231", 18),
      item(2, "71ITSE0001", "HK231", 27),
    ]);
    const originalItems = structuredClone(data.items);

    reviewPlan(data, curriculum([course("71ITSE0001", { name: "Repeated course" })]));

    const duplicateWarnings = data.warnings.filter((warning) =>
      warning.row === 27 &&
      warning.message.includes("71ITSE0001") &&
      warning.message.includes("18") &&
      warning.message.includes("27"),
    );
    expect(duplicateWarnings).toHaveLength(1);
    expect(duplicateWarnings[0]).toMatchObject({ row: 27 });
    expect(duplicateWarnings[0]!.message).toContain("71ITSE0001");
    expect(duplicateWarnings[0]!.message).toContain("Plan K29");
    expect(duplicateWarnings[0]!.message.match(/HK 1/g)).toHaveLength(2);
    expect(data.items).toEqual(originalItems);
  });

  it("reports repeated codes across terms without merging their allocations", () => {
    const data = plan([
      item(1, "71ITSE0001", "HK231", 18),
      item(2, "71ITSE0001", "HK232", 42),
    ]);
    const originalItems = structuredClone(data.items);

    reviewPlan(data, curriculum([course("71ITSE0001", { name: "Repeated course" })]));

    const duplicateWarning = data.warnings.find((warning) =>
      warning.row === 42 &&
      warning.message.includes("71ITSE0001") &&
      warning.message.includes("18") &&
      warning.message.includes("42"),
    );
    expect(duplicateWarning?.message).toContain("Plan K29");
    expect(duplicateWarning?.message).toContain("HK 1");
    expect(duplicateWarning?.message).toContain("HK 2");
    expect(data.items).toEqual(originalItems);
  });

  it("warns on missing and cohort-curriculum-unknown codes while preserving source data", () => {
    const data = plan([
      item(1, "", "HK231", 18, "Uncoded course"),
      item(2, "71ITSE0099", "HK232", 42),
    ]);
    const originalItems = structuredClone(data.items);

    reviewPlan(data, curriculum([course("71ITSE0001")]));

    expect(data.warnings.some((warning) =>
      warning.row === 18 && warning.message.includes("Uncoded course"),
    )).toBe(true);
    expect(data.warnings.some((warning) =>
      warning.row === 42 && warning.message.includes("71ITSE0099") && warning.message.includes("K29"),
    )).toBe(true);
    expect(data.items).toEqual(originalItems);
  });

  it("matches curriculum codes after trimming and uppercasing", () => {
    const data = plan([
      item(1, " 71itse0001 ", "HK231", 18, "Matched course"),
    ]);
    data.items[0]!.credits = 3;
    data.items[0]!.type = "BB";
    const originalItems = structuredClone(data.items);

    reviewPlan(data, curriculum([course("71ITSE0001")]));

    expect(data.warnings).toEqual([]);
    expect(data.items).toEqual(originalItems);
  });
});
