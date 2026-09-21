import { describe, expect, it } from "vitest";
import { CurriculumError, rebuild, type CurriculumData } from "./model.js";
import { parentGroupIds, putCourse, removeCourse } from "./course-mutations.js";

function course(
  code: string,
  groupId: string,
  position: number,
  overrides: Partial<CurriculumData["courses"][number]> = {},
) {
  return {
    position,
    code,
    name: `Course ${code}`,
    englishName: `Course ${code}`,
    description: "",
    credits: 3,
    type: "BB",
    block: groupId === "general" ? "General" : "Major",
    specialty: "",
    semester: 1,
    studyYear: 1,
    prerequisite: "",
    prior: "",
    notes: "",
    department: "Computer Science",
    departmentCode: "CS",
    hours: { lecture: 30, practice: 15, project: null, internship: null },
    groupId,
    sourceRow: position + 10,
    sourceSheet: "K29",
    sourceCells: { A: code },
    ...overrides,
  };
}

function fixture(): CurriculumData {
  return {
    schemaVersion: 1,
    name: "Fixture curriculum",
    major: "Information Technology",
    cohortCode: "K29",
    admissionYear: 2023,
    totalCredits: 126,
    notes: "",
    groups: [
      { id: "general", label: "General", credits: 30, sourceRow: 1 },
      { id: "major", label: "Major", credits: 60, sourceRow: 2 },
    ],
    courses: [
      course("71ITGEN1001", "general", 1),
      course("71ITGEN1002", "general", 2),
      course("71ITMAJOR01", "major", 3),
    ],
    electives: [],
    relations: [],
    warnings: [],
    sourceWarnings: [],
  };
}

function hierarchyFixture(): CurriculumData {
  const data = fixture();
  data.groups = [
    { id: "a", label: "A. Parent", credits: null, sourceRow: 1 },
    { id: "a1", label: "A1. Child one", credits: null, sourceRow: 2 },
    { id: "a2", label: "A2. Child two", credits: null, sourceRow: 3 },
    { id: "a10", label: "A10. Separate leaf", credits: null, sourceRow: 4 },
    { id: "b", label: "B. Parent", credits: null, sourceRow: 5 },
    { id: "b1", label: "B1. Child one", credits: null, sourceRow: 6 },
    { id: "roman", label: "I. Roman parent", credits: null, sourceRow: 7 },
    { id: "roman1", label: "I.1. Roman child", credits: null, sourceRow: 8 },
    { id: "empty", label: "Tự chọn tự do", credits: null, sourceRow: 9 },
  ];
  data.courses = [course("71ITLEAF1001", "a1", 1)];
  return data;
}

function input(
  code: string,
  groupId: string,
  overrides: Partial<ReturnType<typeof course>> = {},
) {
  const value = course(code, groupId, 99, overrides);
  const { position, sourceRow, sourceSheet, sourceCells, ...editable } = value;
  void position;
  void sourceRow;
  void sourceSheet;
  void sourceCells;
  return editable;
}

function expectCurriculumError(action: () => unknown, code: string, status: number) {
  try {
    action();
    throw new Error("expected CurriculumError");
  } catch (error) {
    expect(error).toBeInstanceOf(CurriculumError);
    expect(error).toMatchObject({ code, status });
  }
}

describe("curriculum course mutations", () => {
  it("identifies numbered parent headings without confusing A1 with A10", () => {
    const groups = hierarchyFixture().groups;

    expect(parentGroupIds(groups)).toEqual(
      new Set(["a", "b", "roman"]),
    );
    expect(parentGroupIds(groups).has("a1")).toBe(false);
    expect(parentGroupIds(groups).has("a10")).toBe(false);
    expect(parentGroupIds(groups).has("empty")).toBe(false);
  });

  it("allows an empty-label leaf and rejects adding or moving into a parent heading", () => {
    const emptyLeaf = hierarchyFixture();
    putCourse(emptyLeaf, input("71ITEMPTY1001", "empty"));
    expect(emptyLeaf.courses.find((item) => item.code === "71ITEMPTY1001")).toMatchObject({
      groupId: "empty",
    });

    const addToParent = hierarchyFixture();
    const beforeAdd = structuredClone(addToParent);
    expectCurriculumError(
      () => putCourse(addToParent, input("71ITPARENT1001", "a")),
      "invalid_course_group",
      400,
    );
    expect(addToParent).toEqual(beforeAdd);

    const moveToParent = hierarchyFixture();
    const beforeMove = structuredClone(moveToParent);
    expectCurriculumError(
      () => putCourse(moveToParent, input("71ITLEAF1001", "a"), "71ITLEAF1001"),
      "invalid_course_group",
      400,
    );
    expect(moveToParent).toEqual(beforeMove);
  });

  it("adds a course to a valid group with direct-edit provenance and a stable order", () => {
    const data = fixture();

    putCourse(data, input("71ITNEW1001", "major"));

    const added = data.courses.find((item) => item.code === "71ITNEW1001");
    expect(added).toMatchObject({
      groupId: "major",
      block: "Major",
      sourceRow: 0,
      sourceSheet: "Thêm trực tiếp",
      sourceCells: {},
    });
    expect(data.courses.map((item) => [item.code, item.position])).toEqual([
      ["71ITGEN1001", 1],
      ["71ITGEN1002", 2],
      ["71ITMAJOR01", 3],
      ["71ITNEW1001", 4],
    ]);
  });

  it("rejects duplicate codes and unknown groups without mutating the data", () => {
    const duplicate = fixture();
    const beforeDuplicate = structuredClone(duplicate);
    expectCurriculumError(
      () => putCourse(duplicate, input("71ITGEN1001", "major")),
      "duplicate_course",
      409,
    );
    expect(duplicate).toEqual(beforeDuplicate);

    const unknownGroup = fixture();
    const beforeUnknownGroup = structuredClone(unknownGroup);
    expectCurriculumError(
      () => putCourse(unknownGroup, input("71ITNEW1001", "missing")),
      "invalid_course_group",
      400,
    );
    expect(unknownGroup).toEqual(beforeUnknownGroup);
  });

  it("moves an existing course between groups while preserving source provenance and reassigning positions", () => {
    const data = fixture();
    const original = structuredClone(data.courses[0]);
    const {
      position,
      sourceRow,
      sourceSheet,
      sourceCells,
      ...moved
    } = { ...original!, block: "General", groupId: "major" };
    void position;
    void sourceRow;
    void sourceSheet;
    void sourceCells;

    putCourse(data, moved, original!.code);

    expect(data.courses.find((item) => item.code === original!.code)).toMatchObject({
      groupId: "major",
      block: "Major",
      sourceRow: original!.sourceRow,
      sourceSheet: original!.sourceSheet,
      sourceCells: original!.sourceCells,
    });
    expect(data.courses.map((item) => [item.code, item.position])).toEqual([
      ["71ITGEN1002", 1],
      ["71ITGEN1001", 2],
      ["71ITMAJOR01", 3],
    ]);
  });

  it("keeps a deleted prerequisite visible as an unresolved warning after rebuild", () => {
    const data = fixture();
    data.courses[0]!.prerequisite = data.courses[1]!.code;
    rebuild(data);
    expect(data.relations[0]).toMatchObject({
      courseCode: "71ITGEN1001",
      unresolvedCodes: [],
      reviewRequired: false,
    });

    removeCourse(data, "71ITGEN1002");
    rebuild(data);

    expect(data.courses.some((item) => item.code === "71ITGEN1002")).toBe(false);
    expect(data.relations[0]).toMatchObject({
      courseCode: "71ITGEN1001",
      targetCodes: ["71ITGEN1002"],
      unresolvedCodes: ["71ITGEN1002"],
      reviewRequired: true,
    });
    expect(data.warnings.some((warning) => warning.message.includes("71ITGEN1002"))).toBe(
      true,
    );
  });

  it("rejects deleting an unknown course", () => {
    expectCurriculumError(() => removeCourse(fixture(), "71ITMISSING1"), "not_found", 404);
  });
});
