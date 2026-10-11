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
    minimumGpa: 2,
    gpaScale: 4,
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

  it("reminds students to improve grades even after every required course passed", () => {
    const data = standard([group("BB", "mandatory", 3)], [course("CS-101", "BB", 3)]);
    data.minimumGpa = 5.5;
    data.gpaScale = 10;
    const result = assessGraduation(data, transcript([{ ...attempt("CS-101"), score10: 5, score4: 1 }]));
    expect(result.groupStatus).toBe("pass");
    expect(result.results.get("CS-101")).toBe("pass");
    expect(result.scores.get("CS-101")?.score10).toBe(5);
    expect(result.gpa).toMatchObject({ actual: 5, required: 5.5, scale: 10, status: "fail" });
    expect(result.status).toBe("fail");
    expect(result.needsImprovement).toBe(true);
  });

  it("accepts GPA equal to the configured threshold and follows subsequent threshold changes", () => {
    const data = standard([group("BB", "mandatory", 3)], [course("CS-101", "BB", 3)]);
    data.minimumGpa = 5.5;
    data.gpaScale = 10;
    const grades = transcript([{ ...attempt("CS-101"), score10: 5.5 }]);
    expect(assessGraduation(data, grades)).toMatchObject({ status: "pass", needsImprovement: false });
    data.minimumGpa = 6;
    expect(assessGraduation(data, grades)).toMatchObject({ status: "fail", needsImprovement: true });
  });

  it("uses scale 4 for legacy standards and keeps a missing threshold unknown", () => {
    const data = standard([group("BB", "mandatory", 3)], [course("CS-101", "BB", 3)]);
    const grades = transcript([attempt("CS-101")]);
    data.gpaScale = null;
    const legacyResult = assessGraduation(data, grades);
    expect(legacyResult).toMatchObject({ groupStatus: "pass", status: "pass", gpa: { scale: 4 }, needsImprovement: false });
    expect(legacyResult.gpa.actual).toBeCloseTo(3.2);
    delete data.gpaScale;
    const missingScale = assessGraduation(data, grades).gpa;
    expect(missingScale).toMatchObject({ scale: 4, status: "pass" });
    expect(missingScale.actual).toBeCloseTo(3.2);
    data.gpaScale = 4;
    data.minimumGpa = null;
    expect(assessGraduation(data, grades).status).toBe("unknown");
  });
});

describe("graduation bounds, letter grades and credit totals", () => {
  const unreadable = (code: string) => attempt(code, null);
  const registered = (code: string) => ({ ...attempt(code, null), score10: null, score4: null });

  it("decides blank result cells from letter grades and says which groups rely on them", () => {
    const fixture = fiveGroupFixture();
    const attempts = fixture.passedAttempts.map((item) => item.letter ? item : { ...item, result: null, letter: "B" });
    const result = assessGraduation(fixture.data, transcript(attempts));
    expect(result.status).toBe("pass");
    expect(byGroup(result, "TC209")).toMatchObject({ actual: 9, possible: 9, inferred: true, status: "pass" });
    expect(byGroup(result, "TC002")).toMatchObject({ actual: 2, inferred: false, status: "pass" });
    expect(result.outcomes.get(fixture.codes.TC209[0]!)).toEqual({ status: "pass", inferred: true, exempt: false });
    const failing = attempts.map((item) => item.code === fixture.codes.TC306[1] ? { ...item, letter: "F" } : item);
    expect(byGroup(assessGraduation(fixture.data, transcript(failing)), "TC306"))
      .toMatchObject({ actual: 3, possible: 3, status: "fail" });
  });

  it("keeps a group open while graded courses with unreadable results could still decide it", () => {
    const data = standard(
      [group("BB", "mandatory", null), group("TC", "elective", 6)],
      ["BB1", "BB2", "BB3"].map((code) => course(code, "BB", 3)).concat(["TC1", "TC2", "TC3"].map((code) => course(code, "TC", 3))),
    );
    const open = assessGraduation(data, transcript([
      attempt("BB1"), attempt("BB2"), unreadable("BB3"), attempt("TC1"), unreadable("TC2"),
    ]));
    expect(byGroup(open, "BB")).toMatchObject({ actual: 2, possible: 3, required: 3, unknownCourses: 1, status: "unknown" });
    expect(byGroup(open, "TC")).toMatchObject({ actual: 3, possible: 6, required: 6, unknownCourses: 1, status: "unknown" });
    expect(open.status).toBe("unknown");
    const decided = assessGraduation(data, transcript([
      attempt("BB1"), attempt("BB2"), registered("BB3"), attempt("TC1"), attempt("TC2"), unreadable("TC3"),
    ]));
    // An ungraded registration is not a possible pass yet; enough known passes settle a quota.
    expect(byGroup(decided, "BB")).toMatchObject({ actual: 2, possible: 2, unknownCourses: 0, status: "fail" });
    expect(byGroup(decided, "TC")).toMatchObject({ actual: 6, possible: 9, status: "pass" });
    expect(decided.status).toBe("fail");
  });

  it("prefers the printed cumulative credits and otherwise estimates them without condition-only courses", () => {
    const fixture = fiveGroupFixture();
    expect(assessGraduation(fixture.data, transcript(fixture.passedAttempts)).credits).toBeNull();
    fixture.data.minimumCredits = 15;
    // Starred GDQP and TC002 courses add no credits: TC102 3 + TC209 9 + TC306 6 from the transcript rows.
    expect(assessGraduation(fixture.data, transcript(fixture.passedAttempts)).credits)
      .toEqual({ actual: 18, possible: 18, required: 15, source: "calculated", status: "pass" });
    const printed = transcript(fixture.passedAttempts);
    printed.data.sections[0]!.summaries.push({ label: "Tổng số tín chỉ tích lũy", value: "14" });
    const result = assessGraduation(fixture.data, printed);
    expect(result.credits).toEqual({ actual: 14, possible: 14, required: 15, source: "printed", status: "fail" });
    expect(result.creditCheck).toMatchObject({ printed: 14, computed: 18, status: "mismatch" });
    expect(result).toMatchObject({ groupStatus: "pass", status: "fail", needsImprovement: false });
    expect(assessGraduation(fixture.data, null).credits).toMatchObject({ actual: null, source: null, status: "unknown" });
  });

  it("keeps the estimate open while a graded course's result cannot be read", () => {
    const data = standard([group("BB", "mandatory", null)], [course("BB1", "BB", 3), course("BB2", "BB", 3)]);
    data.minimumCredits = 6;
    expect(assessGraduation(data, transcript([attempt("BB1"), unreadable("BB2")])).credits)
      .toEqual({ actual: 3, possible: 6, required: 6, source: "calculated", status: "unknown" });
  });

  it("counts a transferred course only when the standard lists it", () => {
    const data = standard([group("BB", "mandatory", null)], [course("BB1", "BB", 3), course("BB2", "BB", 3)]);
    data.minimumCredits = 6;
    const grades = transcript([attempt("BB1")]);
    grades.data.sections[0]!.summaries.push({ label: "Tổng số tín chỉ tích lũy", value: "6" });
    grades.data.sections.unshift({
      id: "transfer", label: "Điểm bảo lưu", academicYear: null, semester: null, summaries: [],
      courses: [
        { ...attempt("BB2", null, "MT"), score10: null, score4: null },
        { ...attempt("AV0", null, "MT"), credits: 2, score10: null, score4: null },
      ],
    });
    const result = assessGraduation(data, grades);
    expect(result.creditCheck).toMatchObject({ printed: 6, computed: 6, uncertain: 0, status: "match" });
    expect(result.credits).toMatchObject({ actual: 6, source: "printed", status: "pass" });
    expect(result.status).toBe("pass");
  });

  it("matches groups by member courses and tells apart groups that share a name", () => {
    const shared = "Nhóm tự chọn TC102";
    const data = standard(
      [{ ...group("G1", "elective", 2), name: shared }, { ...group("G2", "elective", 2), name: shared }, group("BB", "mandatory", null)],
      [course("71PEKC10062", "G1", 2, true), course("71PEBA10052", "G2", 2, true), course("71PEBB10052", "G2", 2, true), course("BB1", "BB", 3)],
    );
    const result = assessGraduation(data, transcript([{ ...attempt("71PEBA10052"), credits: 2 }, attempt("BB1")]));
    expect(result.checks.map((check) => check.label)).toEqual([
      `${shared} · 1 học phần, gồm 71PEKC10062`, `${shared} · 2 học phần, gồm 71PEBA10052`, "BB",
    ]);
    expect(result.checks.map((check) => check.status)).toEqual(["fail", "pass", "pass"]);
  });
});

type Row = [string, number, number | null, number | null, string | null, string | null];
type Bound = { lower: number | null; upper: number | null; required: number | null; status: string };
type GraduationCase = {
  name: string;
  rows: Row[];
  summaries: [string, string][];
  expected: {
    groups: (Bound & { id: string })[];
    groupStatus: string;
    credits: (Bound & { source: string }) | null;
    gpa: { status: string; source: string | null };
    status: string;
  };
};
type GraduationCases = {
  term: { academicYear: string; semester: string };
  standard: Pick<GraduationData, "minimumCredits" | "minimumGpa"> & {
    gpaScale: 4 | 10 | null;
    groups: Omit<GraduationData["groups"][number], "sourceRow">[];
    courses: Omit<GraduationData["courses"][number], "sourceRow">[];
  };
  cases: GraduationCase[];
};
type FileSystem = { readFileSync(path: URL, encoding: "utf8"): string };
/** The API port reads the same synthetic table; read it at test time so no file
    from the API workspace is compiled into the web app. */
async function sharedGraduationCases(): Promise<GraduationCases> {
  const nodeFs = "node:fs";
  const fs = (await import(/* @vite-ignore */ nodeFs)) as FileSystem;
  const file = new URL("../../api/src/competency-assessment/fixtures/graduation-cases.json", import.meta.url);
  return JSON.parse(fs.readFileSync(file, "utf8")) as GraduationCases;
}

describe("shared graduation cases", () => {
  it("gives the same bounds, credit totals and verdicts as the API fixture", async () => {
    const fixture = await sharedGraduationCases();
    expect(fixture.cases.length).toBeGreaterThan(0);
    const base = standard(
      fixture.standard.groups.map((item) => ({ ...item, sourceRow: 1 })),
      fixture.standard.courses.map((item) => ({ ...item, sourceRow: 2 })),
    );
    const data: GraduationData = {
      ...base,
      minimumCredits: fixture.standard.minimumCredits,
      minimumGpa: fixture.standard.minimumGpa,
      gpaScale: fixture.standard.gpaScale,
    };
    for (const item of fixture.cases) {
      const record = transcript(item.rows.map(([code, credits, score10, score4, letter, result], index) => ({
        ...attempt(code, result, letter), ordinal: index + 1, credits, score10, score4,
      })));
      const section = record.data.sections[0]!;
      section.academicYear = fixture.term.academicYear;
      section.semester = fixture.term.semester;
      section.summaries = item.summaries.map(([label, value]) => ({ label, value }));
      const result = assessGraduation(data, record);
      expect({
        name: item.name,
        groups: result.checks.map((check) => ({
          id: check.groupId, lower: check.actual, upper: check.possible, required: check.required, status: check.status,
        })),
        groupStatus: result.groupStatus,
        credits: result.credits && {
          lower: result.credits.actual, upper: result.credits.possible, required: result.credits.required,
          source: result.credits.source, status: result.credits.status,
        },
        gpa: { status: result.gpa.status, source: result.gpa.source },
        status: result.status,
      }).toEqual({ name: item.name, ...item.expected });
    }
  });
});
