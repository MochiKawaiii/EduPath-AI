import { describe, expect, it } from "vitest";
import type { GraduationData } from "./graduation-types";
import type { Transcript } from "./StudentTranscript";
import { assessGraduation } from "./graduation-assessment";

type TranscriptSection = Transcript["data"]["sections"][number];
type TranscriptCourse = TranscriptSection["courses"][number];
const passed = "\u0110\u1ea1t";
const failed = "Kh\u00f4ng \u0111\u1ea1t";

function group(
  id: string,
  kind: "mandatory" | "elective",
  minimumCredits: number | null,
): GraduationData["groups"][number] {
  return { id, name: id, kind, minimumCredits, sourceRow: 1 };
}

function course(
  code: string,
  groupId: string,
  credits: number,
  conditionOnly = false,
  id = code,
): GraduationData["courses"][number] {
  return { id, groupId, code, name: code, credits, conditionOnly, sourceRow: 2 };
}

function standard(
  groups: GraduationData["groups"],
  courses: GraduationData["courses"],
): GraduationData {
  return {
    schemaVersion: 1,
    name: "Test standard",
    standardCode: "STD-1",
    cohortCode: "K29",
    classBlock: "A",
    major: "Information Technology",
    specialty: "",
    educationSystem: "Standard",
    faculty: "Computing",
    minimumCredits: null,
    mandatoryCredits: null,
    electiveCredits: null,
    freeElectiveCredits: null,
    minimumGpa: null,
    notes: "",
    groups,
    courses,
    sourceWorkbook: "test.xlsx",
    sourceSheet: "Standard",
    sourceNotes: [],
  };
}

function attempt(
  code: string,
  result: string | null = passed,
  letter: string | null = null,
): TranscriptCourse {
  return {
    ordinal: 1,
    code,
    name: code,
    credits: 3,
    score10: 8,
    score4: 3.2,
    letter,
    result,
    conditional: false,
    sourcePage: 1,
  };
}

function transcript(courses: TranscriptCourse[] = []): Transcript {
  const section: TranscriptSection = {
    id: "2025-2026/HK01",
    label: "2025-2026 HK01",
    academicYear: "2025-2026",
    semester: "HK01",
    courses,
    summaries: [],
  };
  return {
    version: "v1",
    filename: "transcript.pdf",
    fileSize: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    data: {
      schemaVersion: 1,
      parserVersion: "test",
      pageCount: 1,
      courseCount: courses.length,
      sections: [section],
      warnings: [],
    },
  };
}

function fiveGroupFixture() {
  const codes = {
    GDQP: Array.from({ length: 4 }, (_, index) => `71GDQP${String(index + 1).padStart(4, "0")}`),
    TC002: Array.from({ length: 3 }, (_, index) => `71TC002${String(index + 1).padStart(4, "0")}`),
    TC102: Array.from({ length: 14 }, (_, index) => `71TC102${String(index + 1).padStart(4, "0")}`),
    TC209: Array.from({ length: 3 }, (_, index) => `71TC209${String(index + 1).padStart(4, "0")}`),
    TC306: Array.from({ length: 2 }, (_, index) => `71TC306${String(index + 1).padStart(4, "0")}`),
  };
  const groups = [
    group("GDQP", "mandatory", null),
    group("TC002", "elective", 2),
    group("TC102", "elective", 2),
    group("TC209", "elective", 9),
    group("TC306", "elective", 6),
  ];
  const courses = [
    ...codes.GDQP.map((code) => course(code, "GDQP", 2, true)),
    ...codes.TC002.map((code, index) => course(code, "TC002", 2, index === 0)),
    ...codes.TC102.map((code) => course(code, "TC102", 2)),
    ...codes.TC209.map((code) => course(code, "TC209", 3)),
    ...codes.TC306.map((code) => course(code, "TC306", 3)),
  ];
  const passedAttempts = [
    ...codes.GDQP.map((code) => attempt(code)),
    attempt(codes.TC002[0]!, null, " MT "),
    attempt(codes.TC102[0]!),
    ...codes.TC209.map((code) => attempt(code)),
    ...codes.TC306.map((code) => attempt(code)),
  ];
  return { data: standard(groups, courses), codes, passedAttempts };
}

const byGroup = (
  result: ReturnType<typeof assessGraduation>,
  id: string,
) => result.checks.find((check) => check.label === id);

describe("graduation group assessment", () => {
  it("checks exactly the five source groups and applies each elective quota", () => {
    const fixture = fiveGroupFixture();
    const result = assessGraduation(fixture.data, transcript(fixture.passedAttempts));

    expect(result.status).toBe("pass");
    expect(result.checks).toHaveLength(5);
    expect(result.checks.map((check) => check.label)).toEqual([
      "GDQP", "TC002", "TC102", "TC209", "TC306",
    ]);
    expect(result.checks.map((check) => check.unit)).toEqual([
      "môn", "TC", "TC", "TC", "TC",
    ]);
    expect(byGroup(result, "GDQP")).toMatchObject({
      actual: 4, required: 4, unit: "môn", accumulatedCredits: 0, status: "pass",
    });
    expect(byGroup(result, "TC002")).toMatchObject({
      actual: 2, required: 2, unit: "TC", accumulatedCredits: 0, status: "pass",
    });
    expect(byGroup(result, "TC102")).toMatchObject({ actual: 2, required: 2, status: "pass" });
    expect(byGroup(result, "TC209")).toMatchObject({
      actual: 9, required: 9, accumulatedCredits: 9, status: "pass",
    });
    expect(byGroup(result, "TC306")).toMatchObject({ actual: 6, required: 6, status: "pass" });
    expect(result.results.get(fixture.codes.TC002[0]!)).toBe("pass");
  });

  it("requires all four starred GDQP mandatory courses", () => {
    const fixture = fiveGroupFixture();
    const attempts = fixture.passedAttempts.filter((item) =>
      item.code !== fixture.codes.GDQP[3],
    );
    const result = assessGraduation(fixture.data, transcript(attempts));

    expect(byGroup(result, "GDQP")).toMatchObject({
      actual: 3, required: 4, unit: "môn", accumulatedCredits: 0, status: "fail",
    });
    expect(result.status).toBe("fail");
  });

  it("fails a below-quota group while other elective groups still pass", () => {
    const fixture = fiveGroupFixture();
    const attempts = fixture.passedAttempts.filter(
      (item) => item.code !== fixture.codes.TC306[1],
    );
    const result = assessGraduation(fixture.data, transcript(attempts));

    expect(byGroup(result, "TC306")).toMatchObject({
      actual: 3, required: 6, status: "fail",
    });
    expect(byGroup(result, "TC002")?.status).toBe("pass");
    expect(byGroup(result, "TC102")?.status).toBe("pass");
    expect(result.status).toBe("fail");
  });

  it("counts a repeated transcript course once and lets any MT or passing attempt satisfy it", () => {
    const fixture = fiveGroupFixture();
    const code = fixture.codes.TC002[0]!;
    const attempts = [
      ...fixture.passedAttempts.filter((item) => item.code !== code),
      attempt(code, failed),
      attempt(` ${code.toLowerCase()} `, null, "mt"),
    ];
    const result = assessGraduation(fixture.data, transcript(attempts));

    expect(result.results.get(code)).toBe("pass");
    expect(byGroup(result, "TC002")).toMatchObject({
      actual: 2, required: 2, accumulatedCredits: 0, status: "pass",
    });
  });

  it("returns unknown for each group when a transcript is missing", () => {
    const fixture = fiveGroupFixture();
    const result = assessGraduation(fixture.data, null);

    expect(result.status).toBe("unknown");
    expect(result.checks).toHaveLength(5);
    expect(result.checks.every((check) => check.status === "unknown")).toBe(true);
  });

  it("marks duplicate normalized course codes as a malformed standard", () => {
    const fixture = fiveGroupFixture();
    const original = fixture.data.courses[0]!;
    const malformed = standard(
      [group("GDQP", "mandatory", null)],
      [original, course(` ${original.code.toLowerCase()} `, "GDQP", 2, true, "duplicate")],
    );
    const result = assessGraduation(malformed, transcript([attempt(original.code)]));

    expect(result.status).toBe("unknown");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({
      actual: 2, required: 2, unit: "môn", status: "unknown",
    });
  });

  it("marks a course that references no source group as malformed", () => {
    const malformed = standard(
      [group("GDQP", "mandatory", null)],
      [course("71GDQP0001", "missing-group", 2)],
    );
    const result = assessGraduation(malformed, transcript([attempt("71GDQP0001")]));

    expect(result.status).toBe("unknown");
    expect(result.checks[0]?.status).toBe("unknown");
  });
});
