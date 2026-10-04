import { describe, expect, it } from "vitest";
import type { Transcript } from "./StudentTranscript";
import { assessGraduationGpa, graduationCourseScores } from "./graduation-scores";

type Course = Transcript["data"]["sections"][number]["courses"][number];
type Section = Transcript["data"]["sections"][number];
const course = (code: string, overrides: Partial<Course> = {}): Course => ({
  ordinal: 1, code, name: code, credits: 3, score10: 5, score4: 1, letter: "D",
  result: "Đạt", conditional: false, sourcePage: 1, ...overrides,
});
const section = (year: string, courses: Course[], summaries: Section["summaries"] = []): Section => ({
  id: year, label: year, academicYear: year, semester: "HK01", courses, summaries,
});
const transcript = (...sections: Section[]) => ({ data: { sections } }) as Transcript;
const standard = (gpaScale: 4 | 10 | null = 10, minimumGpa: number | null = 5.5) => ({
  gpaScale, minimumGpa, courses: [] as { code: string; conditionOnly: boolean }[],
});

describe("graduation course scores", () => {
  it("shows a matching passing attempt, not a later failed repeat, without mutating source rows", () => {
    const attempts = [course(" cs-101 ", { score10: 6 }), course("CS-101", { score10: 0, score4: 0, letter: "F", result: "Không đạt" })];
    const data = transcript(section("2025-2026", attempts));
    expect(graduationCourseScores(data).get("CS-101")).toMatchObject({ score10: 6, result: "Đạt", attemptCount: 2 });
    expect(attempts[0]?.code).toBe(" cs-101 ");
  });
  it("preserves zero scores and shows MT rather than inventing a numeric grade", () => {
    const data = transcript(section("2025-2026", [
      course("ZERO", { score10: 0, score4: 0, result: "Không đạt" }),
      course("MT", { score10: null, score4: null, letter: " mt ", result: null }),
    ]));
    expect(graduationCourseScores(data).get("ZERO")?.score10).toBe(0);
    expect(graduationCourseScores(data).get("MT")).toMatchObject({ score10: null, score4: null, letter: " mt " });
    expect(graduationCourseScores(null).size).toBe(0);
  });
});

describe("graduation cumulative GPA", () => {
  it("uses the latest printed cumulative GPA on the configured scale, not semester GPA or row averages", () => {
    const data = transcript(
      section("2025-2026", [course("NEW", { score4: 3.2 })], [
        { label: "Điểm TB học kỳ (Hệ 4)", value: "3,5" },
        { label: "Điểm TB tích lũy (Hệ 4)", value: "1,8" },
      ]),
      section("2024-2025", [course("OLD")], [{ label: "Điểm TB tích lũy (Hệ 4)", value: "3.1" }]),
    );
    expect(assessGraduationGpa(standard(4, 2), data))
      .toMatchObject({ actual: 1.8, scale: 4, source: "printed", status: "fail" });
  });
  it("calculates with credit weights on the same scale when no cumulative summary is printed", () => {
    const data = transcript(section("2025-2026", [course("A"), course("B", { credits: 1, score10: 9 })]));
    expect(assessGraduationGpa(standard(10, 6), data))
      .toMatchObject({ actual: 6, source: "calculated", status: "pass" });
  });
  it("excludes starred courses and MT, and counts the highest repeated grade once", () => {
    const rules = standard(10, 7);
    rules.courses = [{ code: "STAR", conditionOnly: true }];
    const data = transcript(section("2025-2026", [
      course("REPEAT", { score10: 4, result: "Không đạt" }),
      course(" repeat ", { score10: 8 }),
      course("STAR", { score10: 1, credits: 10 }),
      course("PDF-STAR", { score10: 0, conditional: true }),
      course("MT", { score10: null, score4: null, letter: "MT", result: null }),
      course("FUTURE", { score10: null, score4: null, letter: null, result: null }),
    ]));
    expect(assessGraduationGpa(rules, data)).toMatchObject({ actual: 8, status: "pass" });
  });
  it("never substitutes the other scale or converts it by multiplying", () => {
    const data = transcript(section("2025-2026", [course("A", { score10: null, score4: 3.5 })], [
      { label: "Điểm TB tích lũy (Hệ 4)", value: "3.5" },
    ]));
    expect(assessGraduationGpa(standard(10), data)).toMatchObject({ actual: null, status: "unknown", source: null });
    expect(assessGraduationGpa(standard(4, 2), data)).toMatchObject({ actual: 3.5, status: "pass", source: "printed" });
  });
  it("does not use an outdated cumulative GPA when a newer graded term lacks its summary", () => {
    const data = transcript(
      section("2024-2025", [course("A")], [{ label: "Điểm TB tích lũy (Hệ 10)", value: "9" }]),
      section("2025-2026", [course("B")]),
    );
    expect(assessGraduationGpa(standard(), data)).toMatchObject({ actual: 5, status: "fail", source: "calculated" });
  });
  it("leaves malformed/conflicting summaries, missing grades and missing configuration unknown", () => {
    const records = [course("A")];
    for (const summaries of [
      [{ label: "Điểm TB tích lũy (Hệ 10)", value: "invalid" }],
      [{ label: "Điểm TB tích lũy (Hệ 10)", value: "5" }, { label: "Điểm TB tích lũy (Hệ 10)", value: "8" }],
    ]) {
      expect(assessGraduationGpa(standard(), transcript(section("2025-2026", records, summaries))).status).toBe("unknown");
    }
    const missing = transcript(section("2025-2026", [course("A", { score10: null, score4: null })]));
    expect(assessGraduationGpa(standard(), missing).status).toBe("unknown");
    expect(assessGraduationGpa(standard(), null).status).toBe("unknown");
    expect(assessGraduationGpa(standard(null), transcript(section("2025-2026", records))).status).toBe("unknown");
    expect(assessGraduationGpa(standard(4, 5.5), transcript(section("2025-2026", records))).status).toBe("unknown");
  });
});
