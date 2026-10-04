import { describe, expect, it } from "vitest";
import { curriculumCredits } from "./curriculum-credits";
import type { CurriculumCourse, CurriculumData } from "./curriculum-types";

function course(code: string, credits: number, type: string, groupId = "core", specialty = ""): CurriculumCourse {
  return { code, credits, type, groupId, specialty, block: "", position: 1, name: code, englishName: "", semester: null, studyYear: null, prerequisite: "", prior: "", notes: "", department: "", departmentCode: "", hours: { lecture: null, practice: null, project: null, internship: null }, sourceRow: 0, sourceSheet: "", sourceCells: {} };
}
function fixture(totalCredits: number, courses: CurriculumCourse[], groups: CurriculumData["groups"], electives: CurriculumData["electives"] = []): CurriculumData {
  return { schemaVersion: 1, name: "CTĐT", major: "CNTT", cohortCode: "K31", admissionYear: 2025, totalCredits, notes: "", courses, groups, electives, relations: [], warnings: [], sourceWarnings: [] };
}
const group = (id: string, credits: number | null, label = id) => ({ id, credits, label, sourceRow: 0 });

describe("curriculum credit requirements", () => {
  it("counts one specialty and excludes condition credits from the declared degree total", () => {
    const data = fixture(126, [
      course("core", 87, "BB"),
      course("software", 18, "BB", "software", "Phần mềm"),
      course("data", 18, "BB", "data", "Dữ liệu"),
      course("elective-a", 12, "TC309", "elective"),
      course("elective-b", 12, "TC309", "elective"),
      course("sport", 2, "TC002", "condition"),
      course("defence", 11, "BB", "condition"),
    ], [group("core", 87), group("software", 18), group("data", 18), group("elective", 21), group("condition", 13, "Giáo dục thể chất và giáo dục quốc phòng")], [
      { code: "TC309", requiredCredits: 21, courseCodes: ["elective-a", "elective-b"] },
      { code: "TC002", requiredCredits: 2, courseCodes: ["sport"] },
    ]);
    const result = curriculumCredits(data);
    expect(result.requiredCredits).toBe(105);
    expect(result.electiveCredits).toBe(21);
    expect(result.hasSpecialties).toBe(true);
    expect(result.blocks.find((block) => block.id === "condition")).toMatchObject({ conditionOnly: true, electiveCredits: 2 });
  });

  it("counts each explicit elective quota once instead of all offered credits", () => {
    const data = fixture(9, [course("required", 3, "BB"), course("a", 6, "TC006"), course("b", 6, "TC006")], [group("core", 9)], [{ code: "TC006", requiredCredits: 6, courseCodes: ["a", "b"] }]);
    expect(curriculumCredits(data).blocks[0]).toMatchObject({ requiredCredits: 3, electiveCredits: 6, fromBlockTotal: false });
  });

  it("gets an unspecified elective quota from the block requirement minus mandatory credits", () => {
    const data = fixture(21, [course("required", 12, "BB"), course("a", 6, "TC209"), course("b", 6, "TC209")], [group("core", 21)], [{ code: "TC209", requiredCredits: null, courseCodes: ["a", "b"] }]);
    expect(curriculumCredits(data).blocks[0]).toMatchObject({ requiredCredits: 12, electiveCredits: 9, fromBlockTotal: true });
  });

  it("uses a combined block quota without inventing separate quotas for its elective codes", () => {
    const data = fixture(9, [course("a", 6, "TC309"), course("b", 6, "TC306")], [group("core", 9)], [{ code: "TC309", requiredCredits: null, courseCodes: ["a"] }, { code: "TC306", requiredCredits: null, courseCodes: ["b"] }]);
    const block = curriculumCredits(data).blocks[0]!;
    expect(block.electiveCredits).toBe(9);
    expect(block.electives.every((elective) => elective.requiredCredits === null)).toBe(true);
  });

  it("leaves a missing or contradictory source block quota unresolved", () => {
    const courses = [course("required", 4, "BB"), course("a", 6, "TC406")];
    for (const credits of [null, 4, 20]) {
      const data = fixture(10, courses, [group("core", credits)], [{ code: "TC406", requiredCredits: null, courseCodes: ["a"] }]);
      expect(curriculumCredits(data).blocks[0]!.electiveCredits).toBeNull();
    }
  });

  it("does not multiply a quota shared by several blocks", () => {
    const data = fixture(6, [course("a", 6, "TC006", "a"), course("b", 6, "TC006", "b")], [group("a", 6), group("b", 6)], [{ code: "TC006", requiredCredits: 6, courseCodes: ["a", "b"] }]);
    expect(curriculumCredits(data).blocks.every((block) => block.electiveCredits === null)).toBe(true);
  });

  it("does not sum duplicated course rows and rejects conflicting credit values", () => {
    const original = course("a", 3, "BB");
    const data = fixture(3, [original, { ...original }], [group("core", 3)]);
    expect(curriculumCredits(data).requiredCredits).toBe(3);
    data.courses[1]!.credits = 4;
    expect(curriculumCredits(data).requiredCredits).toBeNull();
  });

  it("does not guess when specialty requirements differ or a course type is missing", () => {
    const data = fixture(12, [course("a", 9, "BB", "core", "A"), course("b", 12, "BB", "core", "B")], [group("core", 12)]);
    expect(curriculumCredits(data).requiredCredits).toBeNull();
    data.courses = [course("a", 3, "")];
    expect(curriculumCredits(data).requiredCredits).toBeNull();
  });

  it("excludes BBKTL and recalculates after course edits without negative elective totals", () => {
    const data = fixture(6, [course("a", 3, "BB"), course("b", 3, "TC003"), course("condition", 11, "BBKTL", "condition")], [group("core", 6), group("condition", null)], [{ code: "TC003", requiredCredits: 3, courseCodes: ["b"] }]);
    expect(curriculumCredits(data)).toMatchObject({ requiredCredits: 3, electiveCredits: 3 });
    data.courses[0]!.credits = 7;
    expect(curriculumCredits(data)).toMatchObject({ requiredCredits: 7, electiveCredits: null });
  });

  it("flags resolved elective quotas that conflict with the declared total instead of forcing the sum", () => {
    const data = fixture(12, [course("a", 3, "BB"), course("b", 6, "TC006")], [group("core", 9)], [{ code: "TC006", requiredCredits: 6, courseCodes: ["b"] }]);
    expect(curriculumCredits(data).electiveCredits).toBeNull();
  });
});
