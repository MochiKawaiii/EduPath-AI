import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GraduationData } from "../graduation/model.js";
import { conditionOnlyCodes, deriveElectiveGroups, transcriptCourses } from "./course-state.js";
import { syntheticCurriculum, syntheticStandards, syntheticTranscript, type TranscriptRow } from "./fixtures/synthetic-k29.js";
import { assessGraduation, assessGraduationGpa, electiveQuotas, matchStandardElectiveGroup } from "./graduation.js";
import type { GraduationResolution, TriState } from "./types.js";

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

describe("graduation port: shared web/API cases (spec §7.9)", () => {
  const standard = sharedStandard();
  const credits = new Map(standard.courses.map((course) => [course.code, course.credits ?? 0]));

  for (const item of shared.cases) {
    it(item.name, () => {
      const transcript = syntheticTranscript([{ year: shared.term.academicYear, semester: shared.term.semester, rows: item.rows, summaries: item.summaries }]);
      const records = transcriptCourses(transcript);
      const summary = assessGraduation({
        resolution: "specialty", standard: { id: "s", revisionId: "r", version: 1, data: standard }, transcript, records,
        curriculumCredits: credits, electives: [], conditionCodes: conditionOnlyCodes(standard, []),
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

describe("lower and upper bounds", () => {
  const cnpm = syntheticStandards()[0]!;
  const curriculum = syntheticCurriculum();
  const credits = new Map(curriculum.courses.map((course) => [course.code, course.credits]));
  const run = (rows: TranscriptRow[], summaries: [string, string][] = []) => {
    const transcript = syntheticTranscript([{ year: "2024-2025", semester: "HK01", rows, summaries }]);
    return assessGraduation({
      resolution: "specialty", standard: cnpm, transcript, records: transcriptCourses(transcript), curriculumCredits: credits,
      electives: deriveElectiveGroups(curriculum.courses), conditionCodes: conditionOnlyCodes(cnpm.data, curriculum.courses),
    });
  };

  it("passes on the lower bound, fails on the upper bound and stays unknown in between", () => {
    const tc309 = (rows: TranscriptRow[]) => run(rows).groups.find((group) => group.groupId === "row-79")!;
    expect(tc309([["71ITSE30603", 3, 7, 3, "B"], ["71ITIS30203", 3, 7, 3, "B"]])).toMatchObject({ lower: 6, upper: 6, status: "pass", curriculumElectiveCode: "TC309" });
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
      const summary = assessGraduation({
        resolution, standard: null, transcript: syntheticTranscript([]), records: new Map(), curriculumCredits: credits, electives: [], conditionCodes: new Set(),
      });
      expect(summary).toMatchObject({ status: "unknown", statusLabel: "Chưa xác định", groups: [], gpa: null, credits: null });
      expect(summary.reason).toBeTruthy();
    }
  });
});
