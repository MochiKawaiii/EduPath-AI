import { describe, expect, it } from "vitest";
import type { GraduationData } from "./graduation-types";
import type { Transcript } from "./StudentTranscript";
import { assessGraduation } from "./graduation-assessment";

type TranscriptSection = Transcript["data"]["sections"][number];
type TranscriptCourse = TranscriptSection["courses"][number];
type Summary = TranscriptSection["summaries"][number];

const coreCode = "71ITCORE1001";
const passText = "\u0110\u1ea1t";
const failText = "Kh\u00f4ng \u0111\u1ea1t";
const cumulativeGpaLabel = "\u0110i\u1ec3m TB t\u00edch l\u0169y (H\u1ec7 4)";
const semesterGpaLabel = "\u0110i\u1ec3m TB h\u1ecdc k\u1ef3 (H\u1ec7 4)";
const gpaCheckLabel = "\u0110i\u1ec3m TB t\u00edch l\u0169y h\u1ec7 4 theo b\u1ea3ng \u0111i\u1ec3m m\u1edbi nh\u1ea5t";

function group(
  id: string,
  kind: "mandatory" | "elective" = "mandatory",
  minimumCredits: number | null = 3,
): GraduationData["groups"][number] {
  return { id, name: id, kind, minimumCredits, sourceRow: 1 };
}

function course(
  code: string,
  overrides: Partial<GraduationData["courses"][number]> = {},
): GraduationData["courses"][number] {
  return {
    id: code,
    groupId: "mandatory",
    code,
    name: code,
    credits: 3,
    conditionOnly: false,
    sourceRow: 2,
    ...overrides,
  };
}

function standard(overrides: Partial<GraduationData> = {}): GraduationData {
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
    minimumCredits: 3,
    mandatoryCredits: 3,
    electiveCredits: 0,
    freeElectiveCredits: 0,
    minimumGpa: 2,
    notes: "",
    groups: [group("mandatory")],
    courses: [course(coreCode)],
    sourceWorkbook: "test.xlsx",
    sourceSheet: "Standard",
    sourceNotes: [],
    ...overrides,
  };
}

function attempt(
  code: string,
  result: string | null = passText,
  overrides: Partial<TranscriptCourse> = {},
): TranscriptCourse {
  return {
    ordinal: 1,
    code,
    name: code,
    credits: 3,
    score10: 8,
    score4: 3.2,
    letter: null,
    result,
    conditional: false,
    sourcePage: 1,
    ...overrides,
  };
}

function section(
  academicYear: string,
  semester: string,
  courses: TranscriptCourse[],
  summaries: Summary[] = [],
): TranscriptSection {
  return {
    id: `${academicYear}/${semester}`,
    label: `${academicYear} ${semester}`,
    academicYear,
    semester,
    courses,
    summaries,
  };
}

function transcript(sections: TranscriptSection[]): Transcript {
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
      courseCount: sections.reduce((count, item) => count + item.courses.length, 0),
      sections,
      warnings: [],
    },
  };
}

function gradedTranscript(courses: TranscriptCourse[] = [attempt(coreCode)]) {
  return transcript([
    section("2025-2026", "HK01", courses, [
      { label: cumulativeGpaLabel, value: "3.50" },
    ]),
  ]);
}

function checkByLabel(
  result: ReturnType<typeof assessGraduation>,
  label: string,
) {
  return result.checks.find((check) => check.label === label);
}

describe("graduation assessment", () => {
  it("passes when all credit, required-course, and GPA checks are met", () => {
    const result = assessGraduation(standard(), gradedTranscript());

    expect(result.status).toBe("pass");
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("fails a missed mandatory course even when credit thresholds are met", () => {
    const secondCode = "71ITCORE1002";
    const result = assessGraduation(
      standard({ courses: [course(coreCode), course(secondCode)] }),
      gradedTranscript([
        attempt(coreCode, passText),
        attempt(secondCode, failText),
      ]),
    );

    expect(result.status).toBe("fail");
    expect(result.checks[0]).toMatchObject({ actual: 3, required: 3, status: "pass" });
    expect(result.checks[1]).toMatchObject({ actual: 3, required: 3, status: "pass" });
    expect(result.checks.some((check) =>
      check.label.includes("m\u00f4n ph\u1ea3i \u0111\u1ea1t") && check.status === "fail",
    )).toBe(true);
  });

  it("fails a missing conditional course but excludes it from credit totals", () => {
    const conditionalCode = "71ITCOND1001";
    const result = assessGraduation(
      standard({
        courses: [
          course(coreCode),
          course(conditionalCode, { conditionOnly: true, credits: 2 }),
        ],
      }),
      gradedTranscript([attempt(coreCode)]),
    );

    expect(result.status).toBe("fail");
    expect(result.checks[0]).toMatchObject({ actual: 3, required: 3, status: "pass" });
    expect(result.checks[1]).toMatchObject({ actual: 3, required: 3, status: "pass" });
    expect(result.checks[5]).toMatchObject({ actual: 3, required: 3, status: "pass" });
    expect(result.checks[6]).toMatchObject({ actual: 1, required: 2, status: "fail" });
  });

  it("counts an MT exemption as passing", () => {
    const result = assessGraduation(
      standard(),
      gradedTranscript([attempt(coreCode, null, { letter: "MT" })]),
    );

    expect(result.results.get(coreCode)).toBe("pass");
    expect(result.status).toBe("pass");
    expect(result.checks[0]?.actual).toBe(3);
  });

  it("does not count a repeated transcript attempt as extra standard credits", () => {
    const result = assessGraduation(
      standard(),
      gradedTranscript([attempt(coreCode), attempt(coreCode)]),
    );

    expect(result.results.size).toBe(1);
    expect(result.checks[0]?.actual).toBe(3);
  });

  it("requires only one passed course from an elective alternatives group", () => {
    const firstElective = "71ITELEC1001";
    const secondElective = "71ITELEC1002";
    const result = assessGraduation(
      standard({
        minimumCredits: 6,
        mandatoryCredits: 3,
        electiveCredits: 3,
        groups: [group("mandatory", "mandatory", 3), group("elective", "elective", 3)],
        courses: [
          course(coreCode),
          course(firstElective, { groupId: "elective" }),
          course(secondElective, { groupId: "elective" }),
        ],
      }),
      gradedTranscript([attempt(coreCode), attempt(firstElective)]),
    );

    expect(result.status).toBe("pass");
    expect(result.checks[0]).toMatchObject({ actual: 6, required: 6, status: "pass" });
    expect(result.checks[2]).toMatchObject({ actual: 3, required: 3, status: "pass" });
  });

  it("leaves GPA unknown when the transcript has no cumulative GPA", () => {
    const result = assessGraduation(
      standard(),
      transcript([
        section("2025-2026", "HK01", [attempt(coreCode)], [
          { label: semesterGpaLabel, value: "3.80" },
        ]),
      ]),
    );
    const gpaCheck = checkByLabel(result, gpaCheckLabel);

    expect(result.checks.slice(0, 4).every((check) => check.status === "pass")).toBe(true);
    expect(gpaCheck).toMatchObject({ actual: null, required: 2, status: "unknown" });
    expect(result.status).toBe("unknown");
  });

  it("uses the latest cumulative GPA, not semester GPA, when sections are reversed", () => {
    const latest = section("2025-2026", "HK01", [attempt(coreCode)], [
      { label: cumulativeGpaLabel, value: "3.40" },
      { label: semesterGpaLabel, value: "2.10" },
    ]);
    const older = section("2024-2025", "HK03", [attempt(coreCode)], [
      { label: cumulativeGpaLabel, value: "2.50" },
      { label: semesterGpaLabel, value: "4.00" },
    ]);
    const result = assessGraduation(
      standard({ minimumGpa: 3 }),
      transcript([latest, older]),
    );

    expect(checkByLabel(result, gpaCheckLabel)).toMatchObject({
      actual: 3.4,
      required: 3,
      status: "pass",
    });
    expect(result.status).toBe("pass");
  });

  it("returns unknown when no transcript is available", () => {
    const result = assessGraduation(standard(), null);

    expect(result.status).toBe("unknown");
    expect(result.checks.every((check) => check.status === "unknown")).toBe(true);
  });

  it("leaves a positive free-elective requirement unknown without approved course membership", () => {
    const result = assessGraduation(
      standard({ freeElectiveCredits: 3 }),
      gradedTranscript(),
    );

    expect(result.checks[3]).toMatchObject({ actual: null, required: 3, status: "unknown" });
    expect(result.status).toBe("unknown");
  });

  it("does not pass a standard with duplicate course codes", () => {
    const result = assessGraduation(
      standard({ courses: [course(coreCode), course(coreCode, { id: "duplicate" })] }),
      gradedTranscript(),
    );

    expect(result.status).toBe("unknown");
    expect(result.checks.at(-1)).toMatchObject({ actual: null, required: null, status: "unknown" });
  });
});
