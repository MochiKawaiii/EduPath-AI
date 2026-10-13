import { describe, expect, it } from "vitest";
import { calculateAssessment } from "../competency-assessment/calculate.js";
import { CALC_VERSION } from "../competency-assessment/constants.js";
import {
  syntheticCurriculum, syntheticInputs, syntheticStandards, syntheticStudentTerms, syntheticTranscript, type TranscriptTerm,
} from "../competency-assessment/fixtures/synthetic-k29.js";
import type { AssessmentInputs, CurriculumCourseInput, GraduationStandardInput } from "../competency-assessment/types.js";
import type { TranscriptData } from "../student/transcript-parser.js";
import { evaluateGraduation, type GraduationEvaluation, MAX_IMPROVEMENT_CANDIDATES, MAX_LISTED_COURSES } from "./evaluation.js";

// Synthetic K29 data only (fixtures/synthetic-k29.json); no real student record.
const updatedAt = "2026-10-01T00:00:00.000Z";
const cnpm = () => syntheticStandards()[0]!;
const terms = () => syntheticStudentTerms();
type Row = TranscriptTerm["rows"][number];

function run(options: { terms?: TranscriptTerm[]; transcript?: TranscriptData; standard?: GraduationStandardInput; curriculum?: CurriculumCourseInput[] } = {}) {
  return evaluateGraduation({
    standard: options.standard ?? cnpm(),
    transcript: { version: "00000000-0000-4000-8000-0000000000f1", updatedAt, data: options.transcript ?? syntheticTranscript(options.terms ?? terms()) },
    curriculumCourses: options.curriculum ?? syntheticCurriculum().courses,
  });
}

/** Terms with the printed summaries of the last graded term replaced. */
const withSummaries = (summaries: [string, string][]) => terms().map((term) => (term.summaries ? { ...term, summaries } : term));
/** Terms with rows added to the term of that academic year and semester. */
const withRows = (base: TranscriptTerm[], year: string, semester: string, rows: Row[]) =>
  base.map((term) => (term.year === year && term.semester === semester ? { ...term, rows: [...term.rows, ...rows] } : term));
/** The CNPM standard reduced to one mandatory group of these courses, named "Học phần <index>". */
function oneGroup(courses: [code: string, credits: number | null][], data: Partial<GraduationStandardInput["data"]> = {}): GraduationStandardInput {
  const base = cnpm();
  return {
    ...base,
    data: {
      ...base.data, ...data, groups: [{ id: "BB", name: "Học phần bắt buộc", kind: "mandatory", minimumCredits: null, sourceRow: 1 }],
      courses: courses.map(([code, credits], index) => ({ id: `c${index}`, groupId: "BB", code, name: `Học phần ${index}`, credits, conditionOnly: false, sourceRow: index + 2 })),
    },
  };
}
/** Every course row of the groups, in group order then standard order. */
const courseRows = (evaluation: GraduationEvaluation) => evaluation.groups.flatMap((group) => group.courses);

describe("evaluation = the competency engine's numbers (D1, D2)", () => {
  const compare = (inputs: AssessmentInputs) => {
    const competency = calculateAssessment(inputs).graduation;
    const evaluation = evaluateGraduation({
      standard: inputs.graduation.standard!, transcript: { version: inputs.transcript.version, updatedAt, data: inputs.transcript.data },
      curriculumCourses: inputs.curriculum.courses,
    });
    expect(evaluation.groups.map((group) => ({
      groupId: group.id, label: group.label, kind: group.kind, code: group.code, unit: group.unit, lower: group.lower, upper: group.upper,
      required: group.required, status: group.status, accumulatedCredits: group.accumulatedCredits, curriculumElectiveCode: group.curriculumElectiveCode,
    }))).toEqual(competency.groups);
    const { remaining: _credits, ...credits } = evaluation.credits!;
    expect(credits).toEqual(competency.credits);
    const { remaining: _gpa, ...gpa } = evaluation.gpa;
    expect(gpa).toEqual(competency.gpa);
    expect({ status: evaluation.status, groupStatus: evaluation.groupStatus, needsImprovement: evaluation.needsImprovement })
      .toEqual({ status: competency.status, groupStatus: competency.groupStatus, needsImprovement: competency.needsImprovement });
    return evaluation;
  };

  it("gives the same groups, printed credits and GPA as calculateAssessment", () => {
    expect(compare(syntheticInputs())).toMatchObject({ calcVersion: CALC_VERSION, credits: { source: "printed" }, gpa: { source: "printed" } });
  });

  it("gives the same estimates when nothing is printed", () => {
    const evaluation = compare(syntheticInputs({ terms: withSummaries([]) }));
    expect(evaluation).toMatchObject({ credits: { lower: 27, upper: 27, source: "calculated" }, gpa: { source: "calculated" } });
  });

  it("estimates over the program in both engines: the standard's credit first, standard courses outside the CTĐT included", () => {
    const inputs = syntheticInputs({ terms: withSummaries([]) });
    const standard = inputs.graduation.standard!;
    // 71ITSE30503 has 4 credits in the standard (3 in the CTĐT); this CTĐT lacks 71ITSE30103.
    inputs.graduation.standard = {
      ...standard,
      data: { ...standard.data, courses: standard.data.courses.map((course) => (course.code === "71ITSE30503" ? { ...course, credits: 4 } : course)) },
    };
    inputs.curriculum.courses = inputs.curriculum.courses.filter((course) => course.code !== "71ITSE30103");
    // compare() checks that calculateAssessment gives the same credits: 27 − 3 + 4 = 28 over the program
    // (the CTĐT credits alone would give 24).
    expect(compare(inputs).credits).toEqual({ lower: 28, upper: 28, required: 126, status: "fail", source: "calculated", remaining: 98 });
  });
});

describe("evaluateGraduation on the synthetic CNPM student", () => {
  const evaluation = run();
  const course = (code: string) => courseRows(evaluation).find((item) => item.code === code)!;

  it("dates the result and keeps the standard's groups in order with E1 labels and codes", () => {
    expect(evaluation.asOf).toEqual({ transcriptVersion: "00000000-0000-4000-8000-0000000000f1", transcriptUpdatedAt: updatedAt, latestTerm: "HK243" });
    // A repeated name stays as stored in `name`; only `label` tells the two TC102 groups apart.
    expect(evaluation.groups.map((group) => [group.id, group.name, group.label, group.code, group.curriculumElectiveCode])).toEqual([
      ["row-10", "Học phần bắt buộc", "Học phần bắt buộc", null, null],
      ["row-60", "Nhóm tự chọn TC102", "Nhóm tự chọn TC102 · 2 học phần, gồm 71PEKC10062", "TC102", "TC002"],
      ["row-64", "Nhóm tự chọn TC102", "Nhóm tự chọn TC102 · 2 học phần, gồm 71PEBA10052", "TC102", "TC102"],
      ["row-79", "Nhóm tự chọn TC209", "Nhóm tự chọn TC209", "TC209", "TC309"],
      ["row-92", "Nhóm tự chọn TC306", "Nhóm tự chọn TC306", "TC306", "TC406"],
    ]);
  });

  it("reports bounds, remaining amounts and counts per group", () => {
    expect(evaluation.groups.map((group) => [group.id, group.unit, group.lower, group.upper, group.required, group.remaining, group.status, group.passedCount, group.courseCount]))
      .toEqual([
        ["row-10", "môn", 8, 8, 10, 2, "fail", 8, 10],
        ["row-60", "TC", 2, 2, 2, null, "pass", 1, 2],
        ["row-64", "TC", 2, 2, 2, null, "pass", 1, 2],
        ["row-79", "TC", 6, 6, 6, null, "pass", 2, 6],
        ["row-92", "TC", 0, 0, 6, 6, "fail", 0, 3],
      ]);
    expect(evaluation.groups[4]).toMatchObject({ kind: "elective", minimumCredits: 6, accumulatedCredits: 0 });
    expect(evaluation.groups[0]!.courses.map((item) => item.code)).toEqual(cnpm().data.courses.filter((item) => item.groupId === "row-10").map((item) => item.code));
    expect(evaluation).toMatchObject({ status: "fail", groupStatus: "fail", needsImprovement: false });
  });

  it("describes every standard course with its selected attempt", () => {
    expect(course("71ITBS10203")).toEqual({
      code: "71ITBS10203", name: "Cơ sở lập trình", credits: 3, conditionOnly: false, groupId: "row-10", state: "passed", inferred: true,
      attempts: 2, score10: 6.6, score4: 2.5, letter: "C+", term: "HK232",
    });
    expect(course("71ITIS30103")).toMatchObject({ state: "exempt", inferred: false, attempts: 2, score10: null, score4: null, letter: "MT", term: "HK241" });
    expect(course("71ITSE41203")).toMatchObject({ state: "in_progress", attempts: 1, letter: null, term: "HK251" });
    expect(course("71ITIN40304")).toMatchObject({ state: "not_taken", attempts: 0, credits: 4, score10: null, letter: null, term: null });
    expect(course("71NAD110013")).toMatchObject({ conditionOnly: true, state: "passed" });
    expect(evaluation.inProgress.map((item) => item.code)).toEqual(["71ITSE41203"]);
    expect(evaluation.unknownResults).toEqual([]);
  });

  it("keeps the printed credits and GPA with what is left to reach them", () => {
    expect(evaluation.credits).toEqual({ lower: 27, upper: 27, required: 126, status: "fail", source: "printed", remaining: 99 });
    expect(evaluation.gpa).toEqual({ actual: 2.85, required: 2, scale: 4, status: "pass", source: "printed", reason: "", remaining: null });
    expect(evaluation.creditCheck).toEqual({ status: "match", printed: 27, computedLower: 27, computedUpper: 27 });
    expect(evaluation.improvementCandidates).toEqual([]);
  });

  it("leaves credits.remaining empty unless the credits fail", () => {
    const base = cnpm();
    const minimum = (minimumCredits: number): GraduationStandardInput => ({ ...base, data: { ...base.data, minimumCredits } });
    expect(run({ standard: minimum(27) }).credits).toEqual({ lower: 27, upper: 27, required: 27, status: "pass", source: "printed", remaining: null });
    // Nothing printed and 71ITSE30903 graded without a readable result: 27 certain credits, up to 30.
    const open = withRows(withSummaries([]), "2024-2025", "HK03", [["71ITSE30903", 3, 6.5, 2.5]]);
    expect(run({ standard: minimum(28), terms: open }).credits)
      .toEqual({ lower: 27, upper: 30, required: 28, status: "unknown", source: "calculated", remaining: null });
  });

  it("warns about inferred results on the standard's courses only", () => {
    // 12 transcript courses are inferred; 71ENG010000 is outside the standard.
    expect(evaluation.warnings).toEqual([{ code: "results_inferred", count: 11 }]);
  });
});

describe("lists outside the groups", () => {
  it("keeps at most MAX_LISTED_COURSES in-progress and unknown-result courses each, in standard order", () => {
    const codes = Array.from({ length: 50 }, (_, index) => `71ITXX${String(index).padStart(5, "0")}`);
    // The first 25 are registered without grades, the other 25 graded without a readable result; the transcript lists them backwards.
    const rows = codes.map((code, index): Row => (index < 25 ? [code, 3] : [code, 3, 6, 2])).reverse();
    const evaluation = run({ standard: oneGroup(codes.map((code): [string, number] => [code, 3])), curriculum: [], terms: [{ year: "2025-2026", semester: "HK01", rows }] });
    expect(MAX_LISTED_COURSES).toBe(20);
    expect(evaluation.inProgress.map((item) => item.code)).toEqual(codes.slice(0, 20));
    expect(evaluation.unknownResults.map((item) => item.code)).toEqual(codes.slice(25, 45));
    expect(evaluation.groups[0]!.courses).toHaveLength(50);
  });
});

describe("credit cross-check (E7)", () => {
  it("matches any printed total within the estimate's bounds and flags one below or above them", () => {
    const open = withRows(terms(), "2024-2025", "HK03", [["71ITSE30903", 3, 6.5, 2.5]]);
    for (const printed of ["27", "28.5", "30"]) {
      const withPrinted = open.map((term) => (term.summaries ? { ...term, summaries: [["Tổng số tín chỉ tích lũy", printed]] as [string, string][] } : term));
      expect(run({ terms: withPrinted }).creditCheck).toEqual({ status: "match", printed: Number(printed), computedLower: 27, computedUpper: 30 });
    }
    for (const printed of [26, 31]) {
      const outside = run({ terms: withSummaries([["Tổng số tín chỉ tích lũy", String(printed)]]) });
      expect(outside.creditCheck).toEqual({ status: "mismatch", printed, computedLower: 27, computedUpper: 27 });
      expect(outside.warnings).toEqual([
        { code: "results_inferred", count: 11 }, { code: "credits_mismatch", printed, computedLower: 27, computedUpper: 27 },
      ]);
    }
    expect(run({ terms: open }).unknownResults.map((item) => item.code)).toEqual(["71ITSE30903"]);
  });

  it("is unavailable without a readable printed total and falls back to the estimate (E5)", () => {
    const missing = run({ terms: withSummaries([]) });
    expect(missing.creditCheck).toEqual({ status: "unavailable", printed: null, computedLower: 27, computedUpper: 27 });
    // A term that prints no total is not an unreadable total.
    expect(missing.warnings).toEqual([{ code: "results_inferred", count: 11 }]);
    const unreadable = run({ terms: withSummaries([["Tổng số tín chỉ tích lũy", "27"], ["Số tín chỉ tích lũy", "28"]]) });
    expect(unreadable.creditCheck.status).toBe("unavailable");
    expect(unreadable.credits).toMatchObject({ lower: 27, upper: 27, source: "calculated" });
    expect(unreadable.warnings).toEqual([{ code: "results_inferred", count: 11 }, { code: "printed_credits_unreadable" }]);
  });
});

describe("cohorts without a CTĐT", () => {
  it("evaluates from the standard alone", () => {
    const evaluation = run({ curriculum: [], terms: withSummaries([]) });
    expect(evaluation.groups.map((group) => group.curriculumElectiveCode)).toEqual([null, null, null, null, null]);
    expect(evaluation.credits).toMatchObject({ lower: 27, upper: 27, source: "calculated" });
    expect(evaluation.groups.map((group) => group.status)).toEqual(["fail", "pass", "pass", "pass", "fail"]);
    expect(evaluation.creditCheck).toEqual({ status: "unavailable", printed: null, computedLower: 27, computedUpper: 27 });
    expect(evaluation.warnings).toEqual([{ code: "results_inferred", count: 11 }]);
  });
});

describe("GPA shortfall and improvement candidates", () => {
  const strict = (minimumGpa: number, gpaScale: 4 | 10 = 4): GraduationStandardInput => {
    const standard = cnpm();
    return { ...standard, data: { ...standard.data, minimumGpa, gpaScale } };
  };
  /** Passed GPA courses of the synthetic student below 3.2 on scale 4, in candidate order. */
  const passedBelow = ["71ITAI40103", "71ITSE30603", "71ITBS10203", "71ITIS30303", "71ITSE30503"];

  it("lists passed GPA courses below the required GPA, lowest score first, without MT or (*) courses", () => {
    const evaluation = run({ standard: strict(3.2) });
    expect(evaluation.gpa).toMatchObject({ actual: 2.85, required: 3.2, status: "fail", source: "printed" });
    expect(evaluation.gpa.remaining).toBeCloseTo(0.35, 9);
    expect(evaluation.improvementCandidates).toEqual([
      { code: "71ITAI40103", name: "Trí tuệ nhân tạo", credits: 3, score: 1.5, scale: 4, letter: "D+", state: "passed" },
      { code: "71ITSE30603", name: "Phát triển ứng dụng di động", credits: 3, score: 2, scale: 4, letter: "C", state: "passed" },
      { code: "71ITBS10203", name: "Cơ sở lập trình", credits: 3, score: 2.5, scale: 4, letter: "C+", state: "passed" },
      { code: "71ITIS30303", name: "Phân tích thiết kế hệ thống", credits: 3, score: 3, scale: 4, letter: "B", state: "passed" },
      { code: "71ITSE30503", name: "Lập trình ứng dụng Web", credits: 3, score: 3, scale: 4, letter: "B", state: "passed" },
    ]);
    // A grade equal to the required GPA is not below it.
    expect(run({ standard: strict(3) }).improvementCandidates.map((item) => item.code)).toEqual(["71ITAI40103", "71ITSE30603", "71ITBS10203"]);
  });

  it("adds failed, never passed courses (học lại) but not a course retaken now or graded without a readable result", () => {
    // 71ITIN40304 failed once; 71ITGR40203 failed and is registered again; 71ITGR40206 has no readable result.
    const graded = withRows(
      withRows(terms(), "2024-2025", "HK03", [["71ITIN40304", 4, 3, 0, "F"], ["71ITGR40203", 3, 2.5, 0, "F"], ["71ITGR40206", 6, 4, 1]]),
      "2025-2026", "HK01", [["71ITGR40203", 3]],
    );
    const evaluation = run({ standard: strict(3.2), terms: graded });
    expect(courseRows(evaluation).filter((row) => ["71ITIN40304", "71ITGR40203", "71ITGR40206"].includes(row.code)).map((row) => [row.code, row.state]))
      .toEqual([["71ITIN40304", "failed"], ["71ITGR40206", "graded_unknown"], ["71ITGR40203", "in_progress"]]);
    expect(evaluation.improvementCandidates.map((item) => item.code)).toEqual(["71ITIN40304", ...passedBelow]);
    expect(evaluation.improvementCandidates[0]).toEqual({ code: "71ITIN40304", name: "Đồ án thực tập", credits: 4, score: 0, scale: 4, letter: "F", state: "failed" });
  });

  it("lists a failed course at the F score the GPA estimate counts", () => {
    const rows: Row[] = [["71ITXX00001", 3, 8, 3.5, "B+"], ["71ITXX00002", 3, 3, 0, "F"], ["71ITXX00003", 3, 5.5, 2, "C"]];
    const standard = oneGroup(rows.map((row): [string, number] => [row[0], row[1]]), { minimumGpa: 6, gpaScale: 10 });
    const evaluation = run({ standard, curriculum: [], terms: [{ year: "2024-2025", semester: "HK01", rows }] });
    // (8·3 + 3·3 + 5.5·3) / 9 = 5.5; without the F the estimate would be 6.75.
    expect(evaluation.gpa).toMatchObject({ actual: 5.5, required: 6, scale: 10, status: "fail", source: "calculated", remaining: 0.5 });
    expect(evaluation.improvementCandidates).toEqual([
      { code: "71ITXX00002", name: "Học phần 1", credits: 3, score: 3, scale: 10, letter: "F", state: "failed" },
      { code: "71ITXX00003", name: "Học phần 2", credits: 3, score: 5.5, scale: 10, letter: "C", state: "passed" },
    ]);
  });

  it("uses the GPA's scale, prefers more credits on equal scores and keeps at most eight", () => {
    const rows = Array.from({ length: 10 }, (_, index): Row => [`71ITXX${String(index).padStart(5, "0")}`, index === 3 ? 4 : 3, 5, 1, "D"]);
    const standard = oneGroup(rows.map((row): [string, number] => [row[0], row[1]]), { minimumGpa: 6, gpaScale: 10 });
    const evaluation = run({ standard, curriculum: [], terms: [{ year: "2024-2025", semester: "HK01", rows }] });
    expect(evaluation.gpa).toMatchObject({ actual: 5, status: "fail", scale: 10, source: "calculated", remaining: 1 });
    expect(evaluation.needsImprovement).toBe(true);
    expect(evaluation.improvementCandidates).toHaveLength(MAX_IMPROVEMENT_CANDIDATES);
    expect(evaluation.improvementCandidates[0]).toEqual({ code: "71ITXX00003", name: "Học phần 3", credits: 4, score: 5, scale: 10, letter: "D", state: "passed" });
    expect(evaluation.improvementCandidates.slice(1).map((item) => item.code)).toEqual(["71ITXX00000", "71ITXX00001", "71ITXX00002", "71ITXX00004", "71ITXX00005", "71ITXX00006", "71ITXX00007"]);
  });

  it("treats GDTC/GDQP courses as condition-only by CTĐT block or 71NAD/71PE code when the standard has no flags, and never lists them", () => {
    const base = strict(3.2);
    const gdtc = { code: "GDTC0010", name: "Giáo dục thể chất tổng hợp", credits: 1 };
    const unflagged: GraduationStandardInput = {
      ...base,
      data: {
        ...base.data,
        courses: [
          ...base.data.courses.map((item) => ({ ...item, conditionOnly: false })),
          { id: "c-gdtc", groupId: "row-10", ...gdtc, conditionOnly: false, sourceRow: 99 },
        ],
      },
    };
    const curriculum: CurriculumCourseInput[] = [
      ...syntheticCurriculum().courses,
      { ...gdtc, type: "BB", block: "Giáo dục thể chất và giáo dục quốc phòng", specialty: "", semester: 1, studyYear: 1 },
    ];
    // GDTC0010 (D) and 71NAD110013, 71PETT10012 (B) are below the required 3.2 as well.
    const graded = withRows(terms(), "2023-2024", "HK01", [["GDTC0010", 1, 5, 1, "D"]]);
    const conditionOnly = (evaluation: GraduationEvaluation) => courseRows(evaluation).filter((row) => row.conditionOnly).map((row) => row.code);

    const withCurriculum = run({ standard: unflagged, curriculum, terms: graded });
    expect(conditionOnly(withCurriculum)).toEqual(["71NAD110013", "GDTC0010", "71PEKC10062", "71PESW10042", "71PEBA10052", "71PETT10012"]);
    expect(withCurriculum.improvementCandidates.map((item) => item.code)).toEqual(passedBelow);
    // Without a CTĐT only the 71NAD/71PE codes say so: GDTC0010 then counts like any course.
    const withoutCurriculum = run({ standard: unflagged, curriculum: [], terms: graded });
    expect(conditionOnly(withoutCurriculum)).toEqual(["71NAD110013", "71PEKC10062", "71PESW10042", "71PEBA10052", "71PETT10012"]);
    expect(withoutCurriculum.improvementCandidates.map((item) => item.code)).toEqual(["GDTC0010", ...passedBelow]);
  });

  it("leaves out 0-credit courses: 0 in the standard, or a 0-credit attempt the GPA estimate skips", () => {
    const base = strict(3.2);
    const standard: GraduationStandardInput = {
      ...base,
      data: {
        ...base.data,
        courses: [
          // 71ITAI40103 (D+, 3 credits on the transcript) is listed with 0 credits.
          ...base.data.courses.map((item) => (item.code === "71ITAI40103" ? { ...item, credits: 0 } : item)),
          // 3 credits in the standard, 0 on the transcript.
          { id: "c-zero", groupId: "row-10", code: "71ITXX00100", name: "Học phần tổng hợp", credits: 3, conditionOnly: false, sourceRow: 99 },
        ],
      },
    };
    const evaluation = run({ standard, terms: withRows(terms(), "2023-2024", "HK01", [["71ITXX00100", 0, 4.5, 1, "D"]]) });
    expect(courseRows(evaluation).filter((row) => row.code === "71ITAI40103" || row.code === "71ITXX00100").map((row) => [row.code, row.state, row.credits]))
      .toEqual([["71ITAI40103", "passed", 0], ["71ITXX00100", "passed", 3]]);
    expect(evaluation.improvementCandidates.map((item) => item.code)).toEqual(passedBelow.filter((code) => code !== "71ITAI40103"));
  });
});

describe("data warnings", () => {
  it("flags OCR review and a standard whose course codes repeat", () => {
    const ocr = syntheticTranscript(terms(), "vlu-ocr-1.1");
    ocr.ocr = { needsReview: true, pages: [], semesters: [] };
    expect(run({ transcript: ocr }).warnings.map((warning) => warning.code)).toEqual(["results_inferred", "ocr_needs_review"]);
    const base = cnpm();
    const repeated: GraduationStandardInput = { ...base, data: { ...base.data, courses: [...base.data.courses, { ...base.data.courses[0]!, id: "dup", groupId: "row-92" }] } };
    const evaluation = run({ standard: repeated });
    expect(evaluation.warnings.map((warning) => warning.code)).toContain("standard_ambiguous_codes");
    expect(evaluation.groups.every((group) => group.status === "unknown")).toBe(true);
    expect(evaluation.groupStatus).toBe("unknown");
    // A repeated code is listed once outside the groups.
    expect(evaluation.groups[4]!.courses.map((item) => item.code)).toContain("71ITBS10103");
    expect(evaluation.warnings.find((warning) => warning.code === "results_inferred")).toEqual({ code: "results_inferred", count: 11 });
  });

  it("keeps the remaining amount of a group that is still open", () => {
    const open = terms().map((term) => term.year === "2024-2025" && term.semester === "HK01"
      ? { ...term, rows: term.rows.map((row) => (row[0] === "71ITSE30603" ? [row[0], row[1], row[2], row[3]] as Row : row)) } : term);
    const group = run({ terms: open }).groups.find((item) => item.id === "row-79")!;
    expect(group).toMatchObject({ lower: 3, upper: 6, required: 6, remaining: 3, status: "unknown" });
  });
});
