import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TranscriptData } from "../student/transcript-parser.js";
import { FAIL_LETTERS, PASS_LETTERS } from "./constants.js";
import {
  attemptOutcome, conditionOnlyCodes, courseState, creditCrossCheck, currentTermCode, curriculumCreditMap, curriculumTermCode, deriveElectiveGroups,
  electiveCodeOf, estimateProgramCredits, isConditionOnly, printedCumulativeCredits, selectAttempt, termCode, transcriptCourses, uniqueCurriculumCourses,
} from "./course-state.js";

type ResultCase = { name: string; result: string | null; letter: string | null; expected: "pass" | "fail" | "unknown"; inferred: boolean };
const shared = JSON.parse(readFileSync(new URL("./fixtures/result-cases.json", import.meta.url), "utf8")) as {
  passLetters: string[]; failLetters: string[]; cases: ResultCase[];
};

type Row = { code: string; credits?: number; score10?: number | null; score4?: number | null; letter?: string | null; result?: string | null; conditional?: boolean };
function transcript(terms: { year?: string | null; semester?: string | null; rows: Row[]; summaries?: [string, string][] }[]): TranscriptData {
  return {
    schemaVersion: 1, parserVersion: "vlu-native-1", pageCount: 1, warnings: [],
    courseCount: terms.reduce((sum, term) => sum + term.rows.length, 0),
    sections: terms.map((term, index) => ({
      id: term.year ? `${term.year}-${term.semester}` : "transfer",
      academicYear: term.year ?? null, semester: term.semester ?? null, label: term.year ? `${term.year} · ${term.semester}` : "Điểm bảo lưu",
      summaries: (term.summaries ?? []).map(([label, value]) => ({ label, value })),
      courses: term.rows.map((row, ordinal) => ({
        ordinal: ordinal + 1, code: row.code, name: "Học phần tổng hợp", credits: row.credits ?? 3,
        score10: row.score10 === undefined ? 7 : row.score10, score4: row.score4 === undefined ? (row.score10 === null ? null : 3) : row.score4,
        letter: row.letter === undefined ? "B" : row.letter, result: row.result ?? null, conditional: row.conditional ?? false, sourcePage: index + 1,
      })),
    })),
  };
}

describe("attempt outcome (spec §5)", () => {
  it("decides every shared case exactly like the web", () => {
    expect(shared.cases.length).toBeGreaterThan(0);
    for (const item of shared.cases) {
      const outcome = attemptOutcome(item.result, item.letter);
      expect({ name: item.name, outcome: outcome.outcome, inferred: outcome.inferred })
        .toEqual({ name: item.name, outcome: item.expected, inferred: item.inferred });
    }
  });

  it("uses the same pass and fail letters as the OCR pipeline", () => {
    expect([...PASS_LETTERS].sort()).toEqual([...shared.passLetters].sort());
    expect([...FAIL_LETTERS]).toEqual(shared.failLetters);
  });

  it("treats MT as an exemption and never infers behind unreadable text", () => {
    expect(attemptOutcome(null, " mt ")).toEqual({ outcome: "pass", inferred: false, exempt: true });
    expect(attemptOutcome("Exempt", "B")).toEqual({ outcome: "unknown", inferred: false, exempt: false });
    expect(attemptOutcome("Chưa đạt", "A")).toMatchObject({ outcome: "fail", inferred: false });
    expect(attemptOutcome(null, " b+ ")).toEqual({ outcome: "pass", inferred: true, exempt: false });
  });
});

describe("terms", () => {
  it("converts transcript and curriculum terms to HKyyS", () => {
    expect(termCode({ academicYear: "2025-2026", semester: "HK03" })).toBe("HK253");
    expect(termCode({ academicYear: "2023-2024", semester: "HK1" })).toBe("HK231");
    expect(termCode({ academicYear: null, semester: null })).toBeNull();
    expect(termCode({ academicYear: "2025-2026", semester: "HK04" })).toBeNull();
    expect(curriculumTermCode(2023, 3, 2)).toBe("HK252");
    expect(curriculumTermCode(2023, 1, 1)).toBe("HK231");
    expect(curriculumTermCode(2023, null, 1)).toBeNull();
  });

  it("takes the latest term with grades as the current term, not a later registration-only term", () => {
    const data = transcript([
      { year: "2024-2025", semester: "HK03", rows: [{ code: "A1" }] },
      { year: "2025-2026", semester: "HK01", rows: [{ code: "A2", score10: null, score4: null, letter: null }] },
      { year: "2023-2024", semester: "HK01", rows: [{ code: "A3" }] },
    ]);
    expect(currentTermCode(data)).toBe("HK243");
    expect(currentTermCode(transcript([{ rows: [{ code: "AV0", score10: null, letter: "MT" }] }]))).toBeNull();
  });
});

describe("course state and attempt choice (spec §7.1)", () => {
  it("lets MT override every other attempt, including an earlier F", () => {
    const records = transcriptCourses(transcript([
      { year: "2023-2024", semester: "HK01", rows: [{ code: "71ITBS10103", score10: 3, score4: 0, letter: "F", result: "Không đạt" }] },
      { year: "2023-2024", semester: "HK02", rows: [{ code: " 71itbs10103 ", score10: null, score4: null, letter: "MT" }] },
    ]));
    const record = records.get("71ITBS10103")!;
    expect(record.state).toBe("exempt");
    expect(record.selected.exempt).toBe(true);
    expect(record.attempts).toHaveLength(2);
  });

  it("prefers the best passing attempt over a higher failing score, then the best score", () => {
    const records = transcriptCourses(transcript([
      { year: "2023-2024", semester: "HK01", rows: [{ code: "X1", score10: 4.8, letter: "F", result: "Không đạt" }] },
      { year: "2023-2024", semester: "HK02", rows: [{ code: "X1", score10: 4.2, letter: "D", result: null }] },
      { year: "2023-2024", semester: "HK03", rows: [{ code: "X1", score10: 6.5, letter: "C+", result: null }] },
    ]));
    expect(records.get("X1")).toMatchObject({ state: "passed", inferred: true, selected: { score10: 6.5, termCode: "HK233" } });
  });

  it("orders states: MT > passed > graded with unknown result > registered > failed", () => {
    const attempt = (outcome: "pass" | "fail" | "unknown", graded = true, exempt = false) => ({
      code: "X", credits: 3, score10: graded ? 5 : null, score4: graded ? 2 : null, letter: null, result: null, conditional: false,
      termCode: null, outcome, inferred: false, exempt, graded,
    });
    expect(courseState([attempt("fail"), attempt("pass", true, true)])).toBe("exempt");
    expect(courseState([attempt("fail"), attempt("pass")])).toBe("passed");
    expect(courseState([attempt("fail"), attempt("unknown")])).toBe("graded_unknown");
    expect(courseState([attempt("fail"), attempt("unknown", false)])).toBe("in_progress");
    expect(courseState([attempt("fail"), attempt("fail")])).toBe("failed");
    expect(selectAttempt([attempt("fail"), attempt("unknown", false)]).graded).toBe(true);
  });

  it("marks a pass as inferred only when no printed result confirms it", () => {
    const records = transcriptCourses(transcript([
      { year: "2023-2024", semester: "HK01", rows: [{ code: "P1", letter: "B" }, { code: "P2", letter: "A", score10: 8.6 }, { code: "F1", score10: 2, letter: "F" }] },
      { year: "2023-2024", semester: "HK02", rows: [{ code: "P2", letter: "B", result: "Đạt" }] },
    ]));
    expect(records.get("P1")).toMatchObject({ state: "passed", inferred: true });
    expect(records.get("P2")).toMatchObject({ state: "passed", inferred: false, selected: { score10: 8.6 } });
    expect(records.get("F1")).toMatchObject({ state: "failed", inferred: true });
  });

  it("merges 'Điểm bảo lưu' attempts and keeps 0-credit rows", () => {
    const records = transcriptCourses(transcript([
      { rows: [{ code: "71ENG010012", credits: 2, score10: null, letter: "MT" }] },
      { year: "2023-2024", semester: "HK01", rows: [{ code: "71ENG010000", credits: 0, score10: 6, letter: "C" }] },
    ]));
    expect(records.get("71ENG010012")).toMatchObject({ state: "exempt", selected: { termCode: null } });
    expect(records.get("71ENG010000")).toMatchObject({ state: "passed", selected: { credits: 0 } });
  });
});

describe("condition-only courses", () => {
  const courses = [
    { code: "71NAD110013", name: "GDQP1", credits: 3, type: "BB", block: "Giáo dục thể chất và giáo dục quốc phòng", specialty: "", semester: 1, studyYear: 1 },
    { code: "71PEKC10062", name: "Cờ vua", credits: 2, type: "TC002 (2TC)", block: "Giáo dục thể chất và giáo dục quốc phòng", specialty: "", semester: 2, studyYear: 1 },
    { code: "GDX01", name: "Học phần khối GDTC", credits: 1, type: "BB", block: "Giáo dục thể chất và giáo dục quốc phòng", specialty: "", semester: 1, studyYear: 1 },
    { code: "71ITBS10103", name: "Nhập môn", credits: 3, type: "BB", block: "Kiến thức cơ sở khối ngành", specialty: "", semester: 1, studyYear: 1 },
  ];

  it("uses the standard's conditionOnly flags when a standard is selected", () => {
    const codes = conditionOnlyCodes({ courses: [{ id: "1", groupId: "g", code: "71NAD110013", name: "x", credits: 3, conditionOnly: true, sourceRow: 1 }] }, courses);
    expect([...codes]).toEqual(["71NAD110013"]);
    // The 71NAD/71PE prefix rule still applies to codes the standard does not list.
    expect(isConditionOnly("71PEKC10062", codes)).toBe(true);
    expect(isConditionOnly("GDX01", codes)).toBe(false);
  });

  it("falls back to the CTĐT block or the 71NAD/71PE prefix without a standard", () => {
    expect([...conditionOnlyCodes(null, courses)].sort()).toEqual(["71NAD110013", "71PEKC10062", "GDX01"]);
  });
});

describe("elective groups", () => {
  it("derives groups and '(n TC)' quotas from course types", () => {
    expect(electiveCodeOf("TC102 (2TC)")).toBe("TC102");
    expect(electiveCodeOf("BB")).toBeNull();
    expect(deriveElectiveGroups([
      { code: "a", type: "TC002 (2TC)" }, { code: "b", type: "TC002 (2TC)" }, { code: "c", type: "TC309" }, { code: "d", type: "BB" },
    ])).toEqual([
      { code: "TC002", requiredCredits: 2, courseCodes: ["A", "B"] },
      { code: "TC309", requiredCredits: null, courseCodes: ["C"] },
    ]);
  });
});

describe("credit cross-check (spec §5)", () => {
  const credits = new Map([["71ITBS10103", 3], ["71ITBS10203", 3], ["71NAD110013", 3], ["71ITSE30103", 3]]);
  const conditionCodes = new Set(["71NAD110013"]);
  const rows: Row[] = [
    { code: "71ITBS10103", letter: "A", score10: 8.6 }, { code: "71ITBS10203", letter: "B" }, { code: "71ITSE30103", letter: "F", score10: 3 },
    { code: "71NAD110013", letter: "B" }, { code: "71ENG010000", credits: 0, letter: "C", score10: 6 },
  ];

  it("counts passed CTĐT courses without condition-only courses and AV0-like codes outside the CTĐT", () => {
    const data = transcript([
      { rows: [{ code: "71ENG010012", credits: 2, score10: null, letter: "MT" }] },
      { year: "2023-2024", semester: "HK01", rows, summaries: [["Tổng số tín chỉ tích lũy", "6"]] },
    ]);
    expect(creditCrossCheck(data, transcriptCourses(data), credits, conditionCodes)).toEqual({ computed: 6, printed: 6, status: "match" });
  });

  it("reports a mismatch and an unavailable printed total", () => {
    const mismatch = transcript([{ year: "2023-2024", semester: "HK01", rows, summaries: [["Tổng số tín chỉ tích lũy", "9"]] }]);
    expect(creditCrossCheck(mismatch, transcriptCourses(mismatch), credits, conditionCodes)).toEqual({ computed: 6, printed: 9, status: "mismatch" });
    const missing = transcript([{ year: "2023-2024", semester: "HK01", rows }]);
    expect(creditCrossCheck(missing, transcriptCourses(missing), credits, conditionCodes)).toEqual({ computed: 6, printed: null, status: "unavailable" });
  });
});

describe("printed cumulative credits (E5)", () => {
  const printed = (summaries: [string, string][]) =>
    printedCumulativeCredits(transcript([{ year: "2023-2024", semester: "HK01", rows: [{ code: "A1" }], summaries }]));

  it("accepts the cumulative label forms of both parsers", () => {
    // Native layout / OCR adapter labels: the printed text before the colon.
    for (const label of ["Tổng số tín chỉ tích lũy", "Số tín chỉ tích lũy", "TỔNG SỐ TÍN CHỈ TÍCH LŨY", "Tổngsốtínchỉtíchlũy",
      "Tổng số TC tích lũy", "Số tín chỉ đã tích lũy", "Tổng số tín chỉ tích lũy (TC)"]) {
      expect({ label, value: printed([[label, "30"]]) }).toEqual({ label, value: 30 });
    }
  });

  it("never reads a per-term line", () => {
    for (const label of ["Số tín chỉ đạt học kỳ", "Tổng số tín chỉ đăng ký", "Số tín chỉ tích lũy học kỳ", "Số tín chỉ tích lũy HK1",
      "Điểm TB tích lũy (Hệ 4)", "Số tín chỉ tích lũy tối thiểu học kỳ"]) {
      expect({ label, value: printed([[label, "30"]]) }).toEqual({ label, value: null });
    }
    expect(printed([["Số tín chỉ đạt học kỳ", "18"], ["Tổng số tín chỉ tích lũy", "60"]])).toBe(60);
  });

  it("is NaN when unreadable or conflicting, and reads only the latest graded term", () => {
    expect(printed([["Tổng số tín chỉ tích lũy", "?"]])).toBeNaN();
    expect(printed([["Tổng số tín chỉ tích lũy", "60"], ["Số tín chỉ tích lũy", "61"]])).toBeNaN();
    expect(printed([["Tổng số tín chỉ tích lũy", "60"], ["Số tín chỉ tích lũy", "60,0"]])).toBe(60);
    const older = transcript([
      { year: "2023-2024", semester: "HK01", rows: [{ code: "A1" }], summaries: [["Tổng số tín chỉ tích lũy", "3"]] },
      { year: "2023-2024", semester: "HK02", rows: [{ code: "A2" }] },
    ]);
    expect(printedCumulativeCredits(older)).toBeNull();
  });
});

describe("program credit estimate (E4)", () => {
  const conditionCodes = new Set(["71NAD110013"]);

  it("accumulates program codes only, skips condition-only courses and conditional attempts, and falls back to transcript credits", () => {
    const data = transcript([
      { rows: [{ code: "71ENG010012", credits: 2, score10: null, letter: "MT" }] },
      { year: "2023-2024", semester: "HK01", rows: [
        { code: "71ITBS10103", letter: "A" }, { code: "71NAD110013", letter: "B" }, { code: "71PEKC10062", credits: 2, letter: "A" },
        { code: "71ITSE30103", credits: 4, letter: "B" }, { code: "71ITIS30203", letter: null, score10: 6, score4: 2 },
        { code: "71ITSE30603", letter: "B", conditional: true }, { code: "71ITXX99903", letter: "A" }, { code: "71ITSE30903", credits: 0, letter: "C" },
      ] },
    ]);
    const program = new Map<string, number | null>([
      ["71ITBS10103", 3], ["71NAD110013", 3], ["71PEKC10062", 2], ["71ITSE30103", null], ["71ITIS30203", 3], ["71ITSE30603", 3], ["71ITSE30903", null],
    ]);
    // 71ITBS10103 3 + 71ITSE30103 4 (transcript credit, program credit unknown); 71ITIS30203 is graded with an unreadable result.
    expect(estimateProgramCredits(transcriptCourses(data), program, conditionCodes)).toEqual({ certain: 7, unknown: 3 });
  });

  it("keeps the first CTĐT row per code and reads a bad CTĐT credit as 0", () => {
    const courses = [
      { code: " 71itbs10103 ", credits: 3 }, { code: "71ITBS10103", credits: 4 }, { code: "", credits: 2 }, { code: "71ITSE30103", credits: Number.NaN },
    ];
    expect(uniqueCurriculumCourses(courses).map((course) => course.code)).toEqual([" 71itbs10103 ", "71ITSE30103"]);
    expect(Object.fromEntries(curriculumCreditMap(courses))).toEqual({ "71ITBS10103": 3, "71ITSE30103": 0 });
  });
});
