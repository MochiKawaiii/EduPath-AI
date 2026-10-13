import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GraduationData } from "../graduation/model.js";
import { deriveElectiveGroups, transcriptCourses } from "./course-state.js";
import { syntheticCurriculum, syntheticStandards, syntheticTranscript, type TranscriptRow } from "./fixtures/synthetic-k29.js";
import {
  assessGraduation, assessGraduationGpa, decide, electiveQuotas, graduationGroupLabels, graduationInputs, groupCode,
  matchStandardElectiveGroup, programCreditMap, standardCourseCredits,
} from "./graduation.js";
import type { CurriculumCourseInput, GraduationResolution, TriState } from "./types.js";

type Expected = {
  groups: { id: string; lower: number; upper: number; required: number; status: TriState }[];
  groupStatus: TriState;
  credits: { lower: number; upper: number; required: number; source: "printed" | "calculated"; status: TriState };
  gpa: { status: TriState; source: "printed" | "calculated" };
  status: TriState;
};
type SharedFile = {
  term: { academicYear: string; semester: string };
  standard: Pick<GraduationData, "minimumCredits" | "minimumGpa" | "gpaScale" | "groups" | "courses"> & { groups: { id: string; name: string; kind: "mandatory" | "elective"; minimumCredits: number | null }[] };
  cases: { name: string; rows: TranscriptRow[]; summaries: [string, string][]; expected: Expected }[];
};

const shared = JSON.parse(readFileSync(new URL("./fixtures/graduation-cases.json", import.meta.url), "utf8")) as SharedFile;

function sharedStandard(): GraduationData {
  return {
    schemaVersion: 1, name: "Tiêu chuẩn tổng hợp", standardCode: "SYN_TN", cohortCode: "K29", classBlock: "SYN", major: "CNTT", specialty: "",
    educationSystem: "", faculty: "", minimumCredits: shared.standard.minimumCredits, mandatoryCredits: null, electiveCredits: null,
    freeElectiveCredits: null, minimumGpa: shared.standard.minimumGpa, gpaScale: shared.standard.gpaScale, notes: "",
    groups: shared.standard.groups.map((group, index) => ({ ...group, sourceRow: index + 1 })),
    courses: shared.standard.courses.map((course, index) => ({ ...course, sourceRow: index + 10 })),
    sourceWorkbook: "", sourceSheet: "", sourceNotes: [],
  };
}

type GroupSpec = { id: string; name: string; kind: "mandatory" | "elective"; minimumCredits: number | null };
type CourseSpec = { groupId: string; code: string; credits: number | null; conditionOnly?: boolean };

/** A small synthetic standard (minimumCredits null unless given). */
function smallStandard(groups: GroupSpec[], courses: CourseSpec[], extra: Partial<GraduationData> = {}): GraduationData {
  return {
    schemaVersion: 1, name: "Tiêu chuẩn tổng hợp", standardCode: "SYN_TN", cohortCode: "K27", classBlock: "SYN", major: "CNTT", specialty: "",
    educationSystem: "", faculty: "", minimumCredits: null, mandatoryCredits: null, electiveCredits: null, freeElectiveCredits: null,
    minimumGpa: 2, gpaScale: 4, notes: "",
    groups: groups.map((group, index) => ({ ...group, sourceRow: index + 1 })),
    courses: courses.map((course, index) => ({
      id: `c${index + 1}`, groupId: course.groupId, code: course.code, name: `Học phần ${course.code}`, credits: course.credits,
      conditionOnly: course.conditionOnly ?? false, sourceRow: index + 10,
    })),
    sourceWorkbook: "", sourceSheet: "", sourceNotes: [], ...extra,
  };
}

const ctdt = (code: string, credits: number, type = "BB", block = "Kiến thức cơ sở ngành"): CurriculumCourseInput =>
  ({ code, name: `Học phần ${code}`, credits, type, block, specialty: "", semester: 1, studyYear: 1 });

/** One graded term; no CTĐT unless given (the K26–K28 situation). */
function evaluate(data: GraduationData, rows: TranscriptRow[], options: { summaries?: [string, string][]; curriculum?: CurriculumCourseInput[] } = {}) {
  const transcript = syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows, summaries: options.summaries ?? [] }]);
  return assessGraduation({
    resolution: "specialty", standard: { id: "s", revisionId: "r", version: 1, data }, ...graduationInputs(data, options.curriculum ?? [], transcript),
  });
}

describe("graduation port: shared web/API cases (spec §7.9)", () => {
  const standard = sharedStandard();

  for (const item of shared.cases) {
    it(item.name, () => {
      const transcript = syntheticTranscript([{ year: shared.term.academicYear, semester: shared.term.semester, rows: item.rows, summaries: item.summaries }]);
      // No CTĐT: the program is the standard, whose credits equal the transcript's.
      const summary = assessGraduation({
        resolution: "specialty", standard: { id: "s", revisionId: "r", version: 1, data: standard }, ...graduationInputs(standard, [], transcript),
      });
      expect(summary.groups.map(({ groupId, lower, upper, required, status }) => ({ id: groupId, lower, upper, required, status }))).toEqual(item.expected.groups);
      expect(summary.groupStatus).toBe(item.expected.groupStatus);
      expect(summary.credits).toMatchObject(item.expected.credits);
      expect(summary.gpa).toMatchObject(item.expected.gpa);
      expect(summary.status).toBe(item.expected.status);
    });
  }

  it("keeps the GPA scale at 4 when the standard has none (K29)", () => {
    const transcript = syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows: [["71ITBS10103", 3, 8, 3.5, "B+", "Đạt"]] }]);
    const gpa = assessGraduationGpa({ minimumGpa: 2, gpaScale: null }, transcript, transcriptCourses(transcript), new Set());
    expect(gpa).toMatchObject({ scale: 4, actual: 3.5, status: "pass", source: "calculated" });
  });
});

describe("standard groups are matched by course codes, never by name", () => {
  const cnpm = syntheticStandards()[0]!.data;
  const electives = deriveElectiveGroups(syntheticCurriculum().courses);

  it("maps TC209 ≡ TC309, TC306 ≡ TC406 and a 'TC102' label that holds the TC002 courses", () => {
    const byCode = Object.fromEntries(electives.map((group) => [group.code, matchStandardElectiveGroup(group.courseCodes, cnpm)?.name ?? null]));
    expect(byCode).toEqual({ TC002: "Nhóm tự chọn TC102", TC102: "Nhóm tự chọn TC102", TC309: "Nhóm tự chọn TC209", TC406: "Nhóm tự chọn TC306" });
    expect(matchStandardElectiveGroup(electives.find((group) => group.code === "TC002")!.courseCodes, cnpm)?.id).toBe("row-60");
  });

  it("takes quotas from the standard, else '(n TC)' in the CTĐT, else unknown", () => {
    const quotas = electiveQuotas(electives, cnpm);
    expect(Object.fromEntries([...quotas].map(([code, quota]) => [code, [quota.quota, quota.source]]))).toEqual({
      TC002: [2, "standard"], TC102: [2, "standard"], TC309: [6, "standard"], TC406: [6, "standard"],
    });
    const withoutStandard = electiveQuotas(electives, null);
    expect(Object.fromEntries([...withoutStandard].map(([code, quota]) => [code, [quota.quota, quota.source]]))).toEqual({
      TC002: [2, "curriculum"], TC102: [2, "curriculum"], TC309: [null, null], TC406: [null, null],
    });
  });
});

describe("E1: group labels and codes", () => {
  it("labels repeated names with their size and first code, keeps unique names, and reads TCxxx codes", () => {
    const cnpm = syntheticStandards()[0]!.data;
    const summary = evaluate(cnpm, []);
    expect(summary.groups.map((group) => [group.label, group.code, group.curriculumElectiveCode])).toEqual([
      ["Học phần bắt buộc", null, null],
      ["Nhóm tự chọn TC102 · 2 học phần, gồm 71PEKC10062", "TC102", null],
      ["Nhóm tự chọn TC102 · 2 học phần, gồm 71PEBA10052", "TC102", null],
      ["Nhóm tự chọn TC209", "TC209", null],
      ["Nhóm tự chọn TC306", "TC306", null],
    ]);
    // With the CTĐT the CTĐT elective codes are kept next to the standard's codes.
    const withCurriculum = evaluate(cnpm, [], { curriculum: syntheticCurriculum().courses });
    expect(withCurriculum.groups.map((group) => [group.code, group.curriculumElectiveCode])).toEqual([
      [null, null], ["TC102", "TC002"], ["TC102", "TC102"], ["TC209", "TC309"], ["TC306", "TC406"],
    ]);
  });

  it("compares names trimmed, uses normalized codes in standard order and handles an empty repeated group", () => {
    const data = smallStandard(
      [
        { id: "A", name: "Nhóm tự chọn TC102", kind: "elective", minimumCredits: 2 },
        { id: "B", name: " Nhóm tự chọn TC102 ", kind: "elective", minimumCredits: 2 },
        { id: "C", name: "Nhóm tự chọn TC102", kind: "elective", minimumCredits: 2 },
      ],
      [{ groupId: "B", code: " 71pebb10052 ", credits: 2 }, { groupId: "A", code: "71PEKC10062", credits: 2 }, { groupId: "B", code: "71PEBA10052", credits: 2 }],
    );
    expect([...graduationGroupLabels(data).values()]).toEqual([
      "Nhóm tự chọn TC102 · 1 học phần, gồm 71PEKC10062",
      " Nhóm tự chọn TC102  · 2 học phần, gồm 71PEBB10052",
      "Nhóm tự chọn TC102 · 0 học phần",
    ]);
  });

  it("parses the group code from the name only as a whole TCxxx word", () => {
    expect(groupCode("Nhóm tự chọn TC306")).toBe("TC306");
    expect(groupCode("Nhóm tự chọn tc209 (6 TC)")).toBe("TC209");
    expect(groupCode("Học phần bắt buộc")).toBeNull();
    expect(groupCode("Nhóm TC3061")).toBeNull();
  });
});

describe("E2: pass on the lower bound, fail on the upper bound", () => {
  it("decides with a 1e-9 tolerance and passes a met lower bound even without an upper bound", () => {
    expect(decide(6, null, 6)).toBe("pass");
    expect(decide(5.9999999999, 6, 6)).toBe("pass");
    expect(decide(3, null, 6)).toBe("unknown");
    expect(decide(3, 6, 6)).toBe("unknown");
    expect(decide(3, 5, 6)).toBe("fail");
    expect(decide(null, 5, 6)).toBe("fail");
    expect(decide(null, null, 6)).toBe("unknown");
    expect(decide(6, 6, null)).toBe("unknown");
  });

  it("lets an elective group pass while a graded course's credits are unknown", () => {
    const data = smallStandard([{ id: "E", name: "Nhóm tự chọn TC209", kind: "elective", minimumCredits: 3 }], [
      { groupId: "E", code: "71ITSE30603", credits: 3 }, { groupId: "E", code: "71ITIS30203", credits: null },
    ]);
    // 71ITIS30203 is graded with no readable result and has no credit anywhere (0 on the transcript, none in the standard, no CTĐT).
    expect(evaluate(data, [["71ITSE30603", 3, 7, 3, "B"], ["71ITIS30203", 0, 6, 2]]).groups[0]).toMatchObject({ lower: 3, upper: null, required: 3, status: "pass" });
    expect(evaluate({ ...data, groups: [{ ...data.groups[0]!, minimumCredits: 6 }] }, [["71ITSE30603", 3, 7, 3, "B"], ["71ITIS30203", 0, 6, 2]]).groups[0])
      .toMatchObject({ lower: 3, upper: null, status: "unknown" });
  });
});

describe("E3: course credits fall back standard → CTĐT → transcript", () => {
  const data = smallStandard([{ id: "E", name: "Nhóm tự chọn TC209", kind: "elective", minimumCredits: 4 }], [{ groupId: "E", code: "71ITSE30603", credits: null }]);

  it("uses the CTĐT credit, then the selected attempt's transcript credit, else null", () => {
    const passed: TranscriptRow[] = [["71ITSE30603", 3, 7, 3, "B"]];
    expect(evaluate(data, passed, { curriculum: [ctdt("71ITSE30603", 4, "TC309")] }).groups[0]).toMatchObject({ lower: 4, status: "pass" });
    expect(evaluate(data, passed).groups[0]).toMatchObject({ lower: 3, upper: 3, status: "fail" });
    expect(evaluate(data, [["71ITSE30603", 0, 7, 3, "B"]]).groups[0]).toMatchObject({ lower: null, upper: null, status: "unknown" });
  });

  it("keeps the standard's own credit first", () => {
    const transcript = syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows: [["71ITSE30603", 3, 7, 3, "B"]] }]);
    const record = transcriptCourses(transcript).get("71ITSE30603");
    expect(standardCourseCredits({ code: "71itse30603", credits: 2 }, new Map([["71ITSE30603", 4]]), record)).toBe(2);
    expect(standardCourseCredits({ code: "71itse30603", credits: null }, new Map([["71ITSE30603", 4]]), record)).toBe(4);
    expect(standardCourseCredits({ code: "71ITSE30603", credits: null }, new Map([["71ITSE30603", null]]), record)).toBe(3);
    expect(standardCourseCredits({ code: "71ITSE30603", credits: null }, new Map(), undefined)).toBeNull();
  });

  it("builds the program from the standard and the CTĐT (standard credit wins, null stays in the program)", () => {
    const standard = smallStandard([{ id: "E", name: "E", kind: "elective", minimumCredits: 2 }], [
      { groupId: "E", code: "a1", credits: 2 }, { groupId: "E", code: "B1", credits: null }, { groupId: "E", code: "C1", credits: null },
    ]);
    expect(Object.fromEntries(programCreditMap(standard, new Map([["A1", 3], ["B1", 4], ["D1", 0]])))).toEqual({ A1: 2, B1: 4, C1: null, D1: 0 });
  });
});

describe("E4: the credit estimate accumulates the program (standard ∪ CTĐT)", () => {
  const data = smallStandard(
    [{ id: "BB", name: "Học phần bắt buộc", kind: "mandatory", minimumCredits: null }, { id: "PE", name: "Nhóm tự chọn TC002", kind: "elective", minimumCredits: 2 }],
    [
      { groupId: "BB", code: "71ITBS10103", credits: 3 }, { groupId: "BB", code: "71ITBS10203", credits: 3 },
      { groupId: "BB", code: "71NAD110013", credits: 3, conditionOnly: true }, { groupId: "PE", code: "71PEKC10062", credits: 2, conditionOnly: true },
    ],
    { minimumCredits: 6 },
  );
  const rows: TranscriptRow[] = [
    ["71ITBS10103", 3, 8, 3.5, "B+"], ["71ITBS10203", 3, 7, 3, "B"], ["71NAD110013", 3, 7, 3, "B"], ["71PEKC10062", 2, 9, 4, "A"],
    ["71ENG010012", 2, null, null, "MT"],
  ];

  it("estimates a cohort without a CTĐT from the standard's courses (K26–K28 no longer estimate 0)", () => {
    expect(evaluate(data, rows).credits).toEqual({ lower: 6, upper: 6, required: 6, status: "pass", source: "calculated" });
  });

  it("adds CTĐT courses outside the standard but never codes outside the program or condition-only courses", () => {
    const curriculum = [ctdt("71ITBS10103", 3), ctdt("71ITBS10203", 3), ctdt("71ITSE30903", 3, "TC309"), ctdt("71NAD110013", 3, "BB", "Giáo dục thể chất và giáo dục quốc phòng")];
    const extra: TranscriptRow[] = [["71ITSE30903", 3, 6, 2, "C"], ["71ITXX99903", 3, 8, 3.5, "B+"]];
    expect(evaluate(data, [...rows, ...extra], { curriculum }).credits).toMatchObject({ lower: 9, upper: 9, status: "pass", source: "calculated" });
  });

  it("adds graded courses with an unreadable result to the upper bound only", () => {
    expect(evaluate(data, [["71ITBS10103", 3, 8, 3.5, "B+"], ["71ITBS10203", 3, 7, 3]]).credits).toMatchObject({ lower: 3, upper: 6, status: "unknown" });
  });
});

describe("E5: the printed cumulative credits", () => {
  const data = smallStandard([{ id: "BB", name: "Học phần bắt buộc", kind: "mandatory", minimumCredits: null }], [
    { groupId: "BB", code: "71ITBS10103", credits: 3 }, { groupId: "BB", code: "71ITBS10203", credits: 3 },
  ], { minimumCredits: 6 });
  const rows: TranscriptRow[] = [["71ITBS10103", 3, 8, 3.5, "B+"], ["71ITBS10203", 3, 7, 3, "B"]];

  it("reads 'Số tín chỉ tích lũy' like 'Tổng số tín chỉ tích lũy', never a per-term line", () => {
    expect(evaluate(data, rows, { summaries: [["Số tín chỉ tích lũy", "5"]] }).credits).toEqual({ lower: 5, upper: 5, required: 6, status: "fail", source: "printed" });
    expect(evaluate(data, rows, { summaries: [["Số tín chỉ đạt học kỳ", "5"], ["Tổng số tín chỉ đăng ký", "5"]] }).credits)
      .toMatchObject({ lower: 6, source: "calculated", status: "pass" });
  });

  it("falls back to the estimate when the printed value is unreadable or conflicting", () => {
    expect(evaluate(data, rows, { summaries: [["Tổng số tín chỉ tích lũy", "?"]] }).credits).toEqual({ lower: 6, upper: 6, required: 6, status: "pass", source: "calculated" });
    expect(evaluate(data, rows, { summaries: [["Tổng số tín chỉ tích lũy", "5"], ["Số tín chỉ tích lũy", "7"]] }).credits)
      .toMatchObject({ lower: 6, source: "calculated", status: "pass" });
  });
});

describe("E8: mandatory groups count courses, (*) included", () => {
  it("requires every course of a mandatory group, starred ones too", () => {
    const data = smallStandard([{ id: "BB", name: "Học phần bắt buộc", kind: "mandatory", minimumCredits: 120 }], [
      { groupId: "BB", code: "71ITBS10103", credits: 3 }, { groupId: "BB", code: "71NAD110013", credits: 3, conditionOnly: true },
    ]);
    expect(evaluate(data, [["71ITBS10103", 3, 8, 3.5, "B+"]]).groups[0]).toMatchObject({ unit: "môn", lower: 1, upper: 1, required: 2, status: "fail", accumulatedCredits: 3 });
    expect(evaluate(data, [["71ITBS10103", 3, 8, 3.5, "B+"], ["71NAD110013", 3, 7, 3, "B"]]).groups[0])
      .toMatchObject({ unit: "môn", lower: 2, required: 2, status: "pass", accumulatedCredits: 3 });
  });
});

describe("lower and upper bounds", () => {
  const cnpm = syntheticStandards()[0]!;
  const curriculum = syntheticCurriculum();
  const run = (rows: TranscriptRow[], summaries: [string, string][] = []) => {
    const transcript = syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows, summaries }]);
    return assessGraduation({ resolution: "specialty", standard: cnpm, ...graduationInputs(cnpm.data, curriculum.courses, transcript) });
  };

  it("passes on the lower bound, fails on the upper bound and stays unknown in between", () => {
    const tc309 = (rows: TranscriptRow[]) => run(rows).groups.find((group) => group.groupId === "row-79")!;
    expect(tc309([["71ITSE30603", 3, 7, 3, "B"], ["71ITIS30203", 3, 7, 3, "B"]])).toMatchObject({ lower: 6, upper: 6, status: "pass", code: "TC209", curriculumElectiveCode: "TC309" });
    expect(tc309([["71ITSE30603", 3, 7, 3, "B"], ["71ITIS30203", 3, 7, 3, null]])).toMatchObject({ lower: 3, upper: 6, status: "unknown" });
    expect(tc309([["71ITSE30603", 3, 7, 3, "B"], ["71ITIS30203", 3, 3, 0, "F"]])).toMatchObject({ lower: 3, upper: 3, status: "fail" });
  });

  it("estimates total credits without condition-only courses when none is printed", () => {
    const summary = run([["71ITBS10103", 3, 8, 3.5, "B+"], ["71NAD110013", 3, 7, 3, "B"], ["71PEKC10062", 2, 9, 4, "A"], ["71ITBS10203", 3, 6, 2, null]]);
    expect(summary.credits).toMatchObject({ lower: 3, upper: 6, source: "calculated", required: 126, status: "fail" });
  });

  it("flags 'Có thể học cải thiện' only when the groups pass and the GPA fails", () => {
    expect(run([["71ITBS10103", 3, 8, 3.5, "B+"]]).needsImprovement).toBe(false);
  });

  it("explains every unresolved standard without blocking", () => {
    const resolutions: GraduationResolution[] = ["specialty_unset", "not_found", "ambiguous"];
    for (const resolution of resolutions) {
      const summary = assessGraduation({ resolution, standard: null, ...graduationInputs(null, [], syntheticTranscript([])) });
      expect(summary).toMatchObject({ status: "unknown", statusLabel: "Chưa xác định", groups: [], gpa: null, credits: null });
      expect(summary.reason).toBeTruthy();
    }
  });
});
