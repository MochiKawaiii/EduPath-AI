import { describe, expect, it } from "vitest";
import type { Transcript } from "./StudentTranscript";
import {
  PASS_LETTERS, attemptOutcome, transcriptCreditCheck, transcriptOutcomes, transcriptResults,
} from "./transcript-results";

type Attempt = { code: string; result: string | null; letter?: string | null; score10?: number | null };
const section = (courses: Attempt[]) => ({ courses });

describe("transcript course results", () => {
  it("normalizes course codes before matching", () => {
    const results = transcriptResults([
      section([{ code: " 71itse30503 ", result: "Đạt" }]),
    ]);

    expect(results.get("71ITSE30503")).toBe("pass");
    expect(results.size).toBe(1);
  });

  it("recognizes both passed and failed results, including Không đạt", () => {
    const results = transcriptResults([
      section([
        { code: "71ITSE30503", result: "Đạt" },
        { code: "71ITSE30504", result: "Không đạt" },
      ]),
    ]);

    expect(results.get("71ITSE30503")).toBe("pass");
    expect(results.get("71ITSE30504")).toBe("fail");
  });

  it("leaves unknown, blank, and missing course results unset", () => {
    const results = transcriptResults([
      section([
        { code: "71ITSE30503", result: "Exempt" },
        { code: "71ITSE30504", result: null },
        { code: "71ITSE30505", result: "MT" },
        { code: "", result: "Đạt" },
        { code: "   ", result: "Không đạt" },
      ]),
    ]);

    expect(results.size).toBe(0);
    expect(results.get("71ITSE99999")).toBeUndefined();
  });

  it("treats a trimmed, lowercase MT letter as a pass when the result is blank", () => {
    const results = transcriptResults([
      section([{ code: "71ITSE30503", result: null, letter: " mt " }]),
    ]);

    expect(results.get("71ITSE30503")).toBe("pass");
  });

  it("keeps MT passed when another attempt for the course failed", () => {
    const results = transcriptResults([
      section([
        { code: "71ITSE30503", result: "Không đạt" },
        { code: "71ITSE30504", result: null, letter: "mt" },
      ]),
      section([
        { code: " 71itse30503 ", result: null, letter: "MT" },
        { code: "71ITSE30504", result: "Không đạt" },
      ]),
    ]);

    expect(results.get("71ITSE30503")).toBe("pass");
    expect(results.get("71ITSE30504")).toBe("pass");
  });

  it("keeps a passing attempt when attempts appear fail then pass or pass then fail", () => {
    const results = transcriptResults([
      section([
        { code: "71ITSE30503", result: "Không đạt" },
        { code: "71ITSE30504", result: "Đạt" },
      ]),
      section([
        { code: "71ITSE30503", result: "Đạt" },
        { code: "71ITSE30504", result: "Không đạt" },
      ]),
    ]);

    expect(results.get("71ITSE30503")).toBe("pass");
    expect(results.get("71ITSE30504")).toBe("pass");
  });
});

type ResultCase = { name: string; result: string | null; letter: string | null; expected: string; inferred: boolean };
type ResultCases = { passLetters: string[]; failLetters: string[]; cases: ResultCase[] };
type FileSystem = { readFileSync(path: URL, encoding: "utf8"): string };
/** The API keeps the same table; read it at test time so no file from the API
    workspace is ever compiled into the web app. */
async function sharedResultCases(): Promise<ResultCases> {
  const nodeFs = "node:fs";
  const fs = (await import(/* @vite-ignore */ nodeFs)) as FileSystem;
  const file = new URL("../../api/src/competency-assessment/fixtures/result-cases.json", import.meta.url);
  return JSON.parse(fs.readFileSync(file, "utf8")) as ResultCases;
}

describe("shared result cases", () => {
  it("decides every shared case the same way as the API", async () => {
    const fixture = await sharedResultCases();
    expect(fixture.cases.length).toBeGreaterThan(0);
    expect([...PASS_LETTERS].sort()).toEqual([...fixture.passLetters].sort());
    expect(fixture.failLetters).toEqual(["F"]);
    for (const { name, result, letter, expected, inferred } of fixture.cases) {
      const outcome = attemptOutcome({ code: "71ITSE30503", result, letter });
      const decided = outcome.status === "pass" || outcome.status === "fail" ? outcome.status : "unknown";
      expect({ name, decided, inferred: outcome.inferred }).toEqual({ name, decided: expected, inferred });
      const course = transcriptResults([section([{ code: "71ITSE30503", result, letter }])]).get("71ITSE30503");
      expect({ name, course }).toEqual({ name, course: expected === "unknown" ? undefined : expected });
    }
  });
});

describe("letter grade fallback for blank result cells", () => {
  it("passes A+ to D, fails F, and marks both as inferred", () => {
    for (const letter of ["A+", "A", "B+", "B", "C+", "C", "D+", "D", " b+ "])
      expect(attemptOutcome({ code: "X", result: null, letter })).toEqual({ status: "pass", inferred: true, exempt: false });
    expect(attemptOutcome({ code: "X", result: "  ", letter: "F" })).toEqual({ status: "fail", inferred: true, exempt: false });
    expect(attemptOutcome({ code: "X", result: null, letter: "MT" })).toEqual({ status: "pass", inferred: false, exempt: true });
  });

  it("lets a printed result win and never reads the letter behind unreadable text", () => {
    expect(attemptOutcome({ code: "X", result: "Đạt", letter: "F" })).toMatchObject({ status: "pass", inferred: false });
    expect(attemptOutcome({ code: "X", result: "Không đạt", letter: "A" })).toMatchObject({ status: "fail", inferred: false });
    expect(attemptOutcome({ code: "X", result: "Exempt", letter: "B" })).toMatchObject({ status: "unknown", inferred: false });
  });

  it("tells graded rows with no readable result apart from ungraded registrations", () => {
    expect(attemptOutcome({ code: "X", result: null, letter: null, score10: 7 }).status).toBe("unknown");
    expect(attemptOutcome({ code: "X", result: null, letter: null, score10: null }).status).toBe("pending");
    const outcomes = transcriptOutcomes([
      section([{ code: "A1", result: null, letter: "F" }, { code: "A2", result: null, letter: null }]),
      section([{ code: "A1", result: null, letter: null, score10: 6 }, { code: "A2", result: null, letter: "F" }]),
    ]);
    // A later graded attempt with no readable result might be a pass, so the course stays open.
    expect(outcomes.get("A1")?.status).toBe("unknown");
    expect(outcomes.get("A2")).toEqual({ status: "fail", inferred: true, exempt: false });
  });

  it("keeps any pass across repeats and only marks it inferred when no attempt printed or exempted it", () => {
    const outcomes = transcriptOutcomes([
      section([
        { code: "R1", result: "Không đạt" },
        { code: "R2", result: null, letter: "B" },
        { code: "R3", result: null, letter: "C" },
      ]),
      section([
        { code: "r1 ", result: null, letter: "B" },
        { code: "R2", result: "Đạt", letter: "A" },
        { code: "R3", result: null, letter: "MT" },
      ]),
    ]);
    expect(outcomes.get("R1")).toEqual({ status: "pass", inferred: true, exempt: false });
    expect(outcomes.get("R2")).toEqual({ status: "pass", inferred: false, exempt: false });
    expect(outcomes.get("R3")).toEqual({ status: "pass", inferred: false, exempt: true });
    expect(transcriptResults([section([{ code: "R1", result: null, letter: "F" }])]).get("R1")).toBe("fail");
  });
});

type Course = Transcript["data"]["sections"][number]["courses"][number];
type Section = Transcript["data"]["sections"][number];
const row = (code: string, credits: number, letter: string | null, overrides: Partial<Course> = {}): Course => ({
  ordinal: 1, code, name: code, credits, letter, result: null, conditional: false, sourcePage: 1,
  score10: letter && letter !== "MT" ? 7 : null, score4: letter && letter !== "MT" ? 3 : null, ...overrides,
});
/** id "2024-2025-HK01"; `cumulative` is the printed "Tổng số tín chỉ tích lũy". */
const term = (id: string, courses: Course[], cumulative?: string): Section => ({
  id, label: id, academicYear: id.slice(0, 9), semester: id.slice(10), courses,
  summaries: cumulative === undefined ? [] : [
    { label: "Số tín chỉ đạt học kỳ", value: "99" },
    { label: "Tổng số tín chỉ tích lũy", value: cumulative },
  ],
});
const transfer = (courses: Course[]): Section => ({
  id: "transfer", label: "Điểm bảo lưu", academicYear: null, semester: null, courses, summaries: [],
});
const transcriptOf = (...sections: Section[]) => ({ data: { sections } }) as Transcript;
/** Synthetic native-style transcript: blank results, a retake, GDTC/GDQP and transfer rows. */
function nativeStyle(cumulative: string) {
  return transcriptOf(
    transfer([row("71XXTR10003", 3, "MT"), row("71XXAV10002", 2, "MT")]),
    term("2024-2025-HK01", [
      row("71XXIT10003", 3, "B"),
      row("71XXIT10103", 3, "F", { score10: 3, score4: 0 }),
      row("71PEXX10012", 1, "A"),
      row("71NADX10022", 2, "B"),
    ], "6"),
    term("2024-2025-HK02", [row("71XXIT10103", 3, "C"), row("71XXIT10204", 4, "D+")], cumulative),
  );
}

describe("printed cumulative credit check", () => {
  it("accepts the printed total when transferred courses may or may not belong to the programme", () => {
    // 3 + 3 + 4 from terms, plus the 3-credit transfer the school recognised; preparatory English is not counted.
    const check = transcriptCreditCheck(nativeStyle("13"));
    expect(check).toEqual({ printed: 13, computed: 10, uncertain: 5, undecided: 0, inferredCourses: 3, status: "match" });
  });

  it("counts a transferred course exactly once the programme course list is known", () => {
    const programme = ["71XXTR10003", "71XXIT10003", "71XXIT10103", "71XXIT10204"];
    expect(transcriptCreditCheck(nativeStyle("13"), { programCodes: programme }))
      .toMatchObject({ computed: 13, uncertain: 0, status: "match" });
    expect(transcriptCreditCheck(nativeStyle("13"), { programCodes: programme.slice(1) }))
      .toMatchObject({ computed: 10, uncertain: 0, status: "mismatch" });
  });

  it("flags a printed total outside what the per-course results allow", () => {
    expect(transcriptCreditCheck(nativeStyle("16")).status).toBe("mismatch");
    expect(transcriptCreditCheck(nativeStyle("9")).status).toBe("mismatch");
    expect(transcriptCreditCheck(nativeStyle("12,0")).status).toBe("match");
  });

  it("leaves out condition-only courses by standard list, 71NAD/71PE code, or PDF star", () => {
    const data = transcriptOf(term("2024-2025-HK01", [
      row("71XXIT10003", 3, "A"),
      row("71XXGD10002", 2, "A", { name: "Giáo dục thể chất (*)", conditional: true }),
      row("71XXQP10004", 4, "B"),
      row("71PEXX10012", 1, "A"),
    ], "3"));
    expect(transcriptCreditCheck(data).computed).toBe(7);
    expect(transcriptCreditCheck(data, { conditionCodes: [" 71xxqp10004 "] })).toMatchObject({ computed: 3, status: "match" });
  });

  it("uses only the latest graded term's cumulative line and reports undecided courses", () => {
    const older = transcriptOf(
      term("2024-2025-HK01", [row("71XXIT10003", 3, "A")], "3"),
      term("2024-2025-HK02", [row("71XXIT10204", 4, "B")]),
    );
    expect(transcriptCreditCheck(older)).toMatchObject({ printed: null, computed: 7, status: "unavailable" });
    const registered = transcriptOf(
      term("2024-2025-HK01", [row("71XXIT10003", 3, "A"), row("71XXIT10103", 3, null, { score10: 6, score4: 2 })], "3"),
      term("2025-2026-HK01", [row("71XXIT10204", 4, null, { score10: null, score4: null })]),
    );
    expect(transcriptCreditCheck(registered)).toMatchObject({ printed: 3, computed: 3, undecided: 3, status: "match" });
  });

  it("is unavailable without a transcript or with unclear printed values", () => {
    expect(transcriptCreditCheck(null)).toEqual({
      printed: null, computed: 0, uncertain: 0, undecided: 0, inferredCourses: 0, status: "unavailable",
    });
    const conflicting = term("2024-2025-HK01", [row("71XXIT10003", 3, "A")], "3");
    conflicting.summaries.push({ label: "Tổng số tín chỉ tích lũy", value: "4" });
    expect(transcriptCreditCheck(transcriptOf(conflicting)).status).toBe("unavailable");
    expect(transcriptCreditCheck(transcriptOf(term("2024-2025-HK01", [row("71XXIT10003", 3, "A")], "ba")))
      .status).toBe("unavailable");
  });
});
