import { describe, expect, it } from "vitest";
import {
  calculateAssessment, compareSkills, confidenceOf, deficitBand, fitCodeOf, fitCredit, levelOf,
} from "./calculate.js";
import { CALC_VERSION } from "./constants.js";
import {
  SKILL, syntheticCareer, syntheticInputs, syntheticStudentTerms, syntheticTranscript, type TranscriptTerm,
} from "./fixtures/synthetic-k29.js";
import type { AssessmentInputs, AssessmentResult, CareerInput, SpecialtyCode } from "./types.js";

const byName = (result: AssessmentResult, name: string) => {
  const skill = result.skills.find((item) => item.name === name);
  if (!skill) throw new Error(`skill ${name} missing`);
  return skill;
};
const career = (requirements: [string, boolean][], extra: Partial<CareerInput> = {}): CareerInput => {
  const base = syntheticCareer();
  const names = new Map(base.requirements.map((item) => [item.skillId, item.skillName]));
  const skillNames: Record<string, string> = {
    [SKILL.mobile]: "Lập trình di động", [SKILL.machineLearning]: "Học máy nhập môn", [SKILL.presenting]: "Thuyết trình",
    [SKILL.bigData]: "Phân tích dữ liệu lớn", [SKILL.csharp]: "Lập trình C#", [SKILL.teamwork]: "Làm việc nhóm",
  };
  return {
    ...base, ...extra,
    requirements: requirements.map(([skillId, isRequired], index) => {
      const name = names.get(skillId) ?? skillNames[skillId] ?? "Kỹ năng";
      return { id: `00000000-0000-4000-8000-00000000d1${String(index).padStart(2, "0")}`, skillId, skillName: name, title: name, isRequired };
    }),
  };
};
const mapTerms = (map: (row: TranscriptTerm["rows"][number]) => TranscriptTerm["rows"][number]) =>
  syntheticStudentTerms().map((term) => ({ ...term, rows: term.rows.map(map) }));

describe("formula helpers (spec §7.3, §7.5, §7.6)", () => {
  it("classifies levels on unrounded scores", () => {
    expect(levelOf(84.999)).toBe("good");
    expect(levelOf(85)).toBe("proficient");
    expect(levelOf(69.99)).toBe("basic");
    expect(levelOf(49.99)).toBe("needs_work");
    expect(levelOf(null)).toBe("no_evidence");
    expect(levelOf(null, true)).toBe("exempt");
  });

  it("takes confidence as the lower of the coverage and evidence bands", () => {
    expect(confidenceOf(1, 0.9)).toBe("low");
    expect(confidenceOf(1, 1)).toBe("medium");
    expect(confidenceOf(0.7, 2.5)).toBe("high");
    expect(confidenceOf(0.69, 10)).toBe("medium");
    expect(confidenceOf(0.29, 10)).toBe("low");
    expect(confidenceOf(null, 10)).toBe("low");
  });

  it("bands deficits", () => {
    expect([deficitBand(5), deficitBand(5.01), deficitBand(15), deficitBand(15.5)]).toEqual(["near", "moderate", "moderate", "large"]);
  });

  it("scores requirements: met 1, below 0.5·clamp((s−40)/(thr−40)), not studied 0, upcoming/no data excluded", () => {
    expect(fitCredit("met", 90, 85)).toBe(1);
    expect(fitCredit("below", 55, 70)).toBeCloseTo(0.25);
    expect(fitCredit("below", 30, 70)).toBe(0);
    expect(fitCredit("below", 84.99, 85)).toBeLessThan(0.5);
    expect(fitCredit("not_studied", null, 70)).toBe(0);
    expect(fitCredit("upcoming", null, 70)).toBeNull();
    expect(fitCredit("no_data", null, 70)).toBeNull();
    expect([fitCodeOf(0.8, 1), fitCodeOf(0.79, 1), fitCodeOf(0.5, 1), fitCodeOf(0.49, 1), fitCodeOf(1, 0.49), fitCodeOf(null, 1)])
      .toEqual(["fit", "fairly_fit", "fairly_fit", "needs_more", "insufficient_data", "insufficient_data"]);
  });

  it("never labels a profile whose requirements are all below threshold 'Phù hợp' or even 'Khá phù hợp'", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const required = seed % 3 === 0;
      const threshold = required ? 85 : 70;
      const score = 40 + ((seed * 7919) % 1000) / 1000 * (threshold - 40 - 0.001);
      expect(fitCodeOf(fitCredit("below", score, threshold), 1)).toBe("needs_more");
    }
  });

  it("orders skills by score, then evidence, then key (§7.11)", () => {
    const items = [
      { key: "S03", score: 80, evidence: 1 }, { key: "S01", score: 80, evidence: 1 }, { key: "S02", score: 80, evidence: 2 },
      { key: "S04", score: null, evidence: 5 }, { key: "S05", score: 90, evidence: 0.1 },
    ];
    expect([...items].sort(compareSkills).map((item) => item.key)).toEqual(["S05", "S02", "S01", "S03", "S04"]);
  });
});

describe("calculateAssessment on the synthetic CNPM student", () => {
  const result = calculateAssessment(syntheticInputs());

  it("assigns deterministic group and skill keys and stores version labels", () => {
    expect(result.groups.map((group) => [group.key, group.name])).toEqual([["G1", "Chuyên môn"], ["G2", "Kiến thức nền tảng"], ["G3", "Kỹ năng mềm"]]);
    expect(result.skillDirectory.map((item) => item.key)).toEqual(Array.from({ length: 15 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`));
    expect(result.skillDirectory.filter((item) => !item.measured).map((item) => item.name)).toEqual(["C#/C++", "Docker"]);
    expect(result.meta).toMatchObject({
      calcVersion: CALC_VERSION, promptVersion: "comp-v1", transcriptVersion: "00000000-0000-4000-8000-0000000000f1", cohortCode: "K29",
      curriculum: { revisionId: "00000000-0000-4000-8000-000000000002", version: 1 },
      weights: { activeCount: 25, maxConfigUpdatedAt: "2026-10-01T00:00:00.000Z" },
      graduationStandardId: "00000000-0000-4000-8000-000000000011", planRevisionId: "00000000-0000-4000-8000-000000000004",
      career: { id: "00000000-0000-4000-8000-0000000000c1" }, specialty: "CNPM",
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("averages score10 × credits × weight over the selected attempts (retake after F counts its pass)", () => {
    // (6.6·3·0.6 + 7.8·3·0.7 + 7.2·3·0.3) / (1.8 + 2.1 + 0.9) × 10
    expect(byName(result, "Lập trình cơ bản")).toMatchObject({ score: 72.38, level: "good", evidence: 4.8, coverage: 1 });
    expect(result.courses.find((course) => course.code === "71ITBS10203")).toMatchObject({ state: "passed", score10: 6.6, attempts: 2, inferred: true });
  });

  it("counts MT as studied but keeps it out of the average, even after an F", () => {
    const database = byName(result, "Cơ sở dữ liệu quan hệ");
    expect(database).toMatchObject({ score: 70, evidence: 4.5 });
    expect(database.evidenceCourses.find((row) => row.code === "71ITIS30103")).toMatchObject({ role: "exempt" });
    expect(result.courses.find((course) => course.code === "71ITIS30103")).toMatchObject({ state: "exempt", score10: null, letter: "MT" });
  });

  it("uses elective quotas in the coverage denominator", () => {
    // 71ITIN40304 (4 × 0.5) + remaining TC406 quota 6 × average weight 9/12.
    expect(byName(result, "Thuyết trình")).toMatchObject({ denominator: 6.5, coverage: 0, status: "no_evidence", level: "no_evidence", confidence: null });
    // TC309 is full (6/6 credits), and the only applicable course is an unchosen option.
    expect(byName(result, "Phân tích dữ liệu lớn")).toMatchObject({ status: "not_applicable", notApplicableReason: "elective_not_chosen", denominator: 0, otherSpecialtyCourses: ["71ITDS40303"] });
    // PE quotas (TC002/TC102, 2 credits each) are met by one course each: 100 %, not 4/8.
    expect(byName(result, "Rèn luyện thể chất")).toMatchObject({ coverage: 1, conditionOnly: true });
    for (const skill of result.skills) if (skill.coverage !== null) expect(skill.coverage).toBeGreaterThanOrEqual(0), expect(skill.coverage).toBeLessThanOrEqual(1);
  });

  it("applies the confidence bands to real skill exposures", () => {
    expect(byName(result, "Lập trình C#")).toMatchObject({ coverage: 1, evidence: 0.9, confidence: "low" });
    expect(byName(result, "Kiểm thử phần mềm")).toMatchObject({ coverage: 0.3333, evidence: 1.5, confidence: "medium", level: "proficient" });
    expect(byName(result, "Học máy nhập môn")).toMatchObject({ score: 47, level: "needs_work", confidence: "high", otherSpecialtyCourses: ["71ITAI40803"] });
  });

  it("keeps GDTC/GDQP out of group and overall scores but shows their skills", () => {
    const foundation = result.groups.find((group) => group.name === "Kiến thức nền tảng")!;
    expect(foundation).toMatchObject({ score: 80.29, skillCount: 1, skillsWithEvidence: 1 });
    expect(byName(result, "Kiến thức quốc phòng")).toMatchObject({ conditionOnly: true, score: 70 });
    const mean = result.groups.reduce((sum, group) => sum + group.score!, 0) / result.groups.length;
    expect(result.overall.score).toBeCloseTo(mean, 1);
    expect(result.overall).toMatchObject({ groupsWithScore: 3, basis: { skillsWithEvidence: 9, applicableSkills: 10, evidenceCourses: 9 } });
    const conditionKeys = result.skills.filter((skill) => skill.conditionOnly).map((skill) => skill.key);
    expect(conditionKeys).toHaveLength(2);
    for (const key of conditionKeys) {
      expect(result.highlights.strengths).not.toContain(key);
      expect(result.promptSelection.topSkillKeys).not.toContain(key);
      expect(result.promptSelection.bottomSkillKeys).not.toContain(key);
    }
  });

  it("counts group skills with the overall rule: not-applicable and condition-only skills are left out", () => {
    // Regression: the group line read 49/65 while the overview read 62/66 (not-applicable skills in the group denominator).
    const bigData = byName(result, "Phân tích dữ liệu lớn");
    expect(bigData.status).toBe("not_applicable");
    const group = result.groups.find((item) => item.key === bigData.groupKey)!;
    const counted = result.skills.filter((skill) => skill.groupKey === group.key && !skill.conditionOnly && skill.status !== "not_applicable");
    expect(group.skillCount).toBe(counted.length);
    expect(group.skillCount).toBeLessThan(result.skills.filter((skill) => skill.groupKey === group.key && !skill.conditionOnly).length);
    expect(result.groups.reduce((sum, item) => sum + item.skillCount, 0)).toBe(result.overall.basis.applicableSkills);
    expect(result.groups.reduce((sum, item) => sum + item.skillsWithEvidence, 0)).toBe(result.overall.basis.skillsWithEvidence);
  });

  it("sorts skills by score, evidence and key", () => {
    const scored = result.skills.filter((skill) => skill.score !== null).map((skill) => skill.score!);
    expect(scored).toEqual([...scored].sort((a, b) => b - a));
    expect(result.skills.slice(-2).map((skill) => skill.score)).toEqual([null, null]);
  });

  it("summarises the transcript, keeps codes outside the CTĐT as information and checks credits", () => {
    expect(result.transcript).toMatchObject({
      latestTerm: "HK243", passed: 12, exempt: 2, failed: 0, inProgress: 1, inferredCount: 12,
      creditCheck: { computed: 27, printed: 27, status: "match" },
    });
    expect(result.transcript.notInCurriculum.map((row) => row.code)).toEqual(["71ENG010000", "71ENG010012"]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["results_inferred"]);
    expect(result.warnings[0]!.message).toContain("khớp");
  });

  it("matches the CNPM standard and reports graduation with bounds", () => {
    expect(result.graduation).toMatchObject({ resolution: "specialty", status: "fail", gpa: { actual: 2.85, source: "printed", status: "pass" }, credits: { lower: 27, source: "printed" } });
    expect(result.graduation.groups.map((group) => [group.label, group.curriculumElectiveCode, group.status])).toEqual([
      ["Học phần bắt buộc", null, "fail"], ["Nhóm tự chọn TC102", "TC002", "pass"], ["Nhóm tự chọn TC102", "TC102", "pass"],
      ["Nhóm tự chọn TC209", "TC309", "pass"], ["Nhóm tự chọn TC306", "TC406", "fail"],
    ]);
  });

  it("reports progress against the training plan", () => {
    expect(result.progress).toMatchObject({ currentTerm: "HK243", nextTerm: "HK251", lateCount: 0, nextCount: 1 });
  });

  it("lists unmeasured career skills for self-study with similar measured skills as context only", () => {
    expect(result.selfStudy.map((item) => [item.name, item.reason, item.relatedSkillKeys.map((key) => result.skillDirectory.find((entry) => entry.key === key)?.name)])).toEqual([
      ["C#/C++", "not_measured", ["Lập trình C#"]], ["Docker", "not_measured", []],
    ]);
    expect(result.career!.requirements.find((item) => item.title === "C#/C++")).toMatchObject({ status: "no_data", score: null });
  });

  it("does not suggest a specialty once one is chosen", () => {
    expect(result.specialtySuggestion).toBeNull();
  });
});

describe("applicable set A (spec §7.2)", () => {
  const run = (specialty: SpecialtyCode | null) => calculateAssessment(syntheticInputs({ specialty }));

  it("without a specialty: suggests one, keeps attempted specialty courses and never blocks", () => {
    const result = run(null);
    expect(result.specialtySuggestion).toEqual({ code: "CNPM", label: "Công nghệ phần mềm", passedCount: 1, text: "Gợi ý: Công nghệ phần mềm (1 học phần chuyên ngành đã học)" });
    expect(result.graduation).toMatchObject({ resolution: "specialty_unset", status: "unknown" });
    expect(result.warnings.map((warning) => warning.code)).toContain("graduation_standard_unresolved");
    expect(result.courses.filter((course) => course.specialty && course.applicable).map((course) => course.code).sort()).toEqual(["71ITSE41003", "71ITSE41203"]);
    expect(byName(result, "Kiểm thử phần mềm").coverage).toBe(byName(run("CNPM"), "Kiểm thử phần mềm").coverage);
  });

  it("with the wrong specialty: warns about the conflict and keeps coverage within [0, 1]", () => {
    const result = run("CNDL");
    expect(result.warnings.find((warning) => warning.code === "specialty_conflict")?.message).toContain("Công nghệ phần mềm: 1 học phần");
    expect(result.courses.filter((course) => course.specialty && course.applicable).map((course) => course.code).sort()).toEqual(["71ITDS40303", "71ITSE41003", "71ITSE41203"]);
    for (const skill of result.skills) {
      if (skill.coverage !== null) expect(skill.coverage).toBeLessThanOrEqual(1);
      if (skill.score !== null) expect(skill.status).toBe("scored");
    }
    expect(byName(result, "Phân tích dữ liệu lớn")).toMatchObject({ status: "no_evidence", denominator: 3 });
  });

  it("with the right specialty: adds that specialty's courses to A", () => {
    const ttnt = run("TTNT");
    expect(byName(ttnt, "Học máy nhập môn")).toMatchObject({ denominator: 6, coverage: 0.5, otherSpecialtyCourses: [] });
    expect(ttnt.graduation.resolution).toBe("not_found");
  });
});

describe("career gaps and fit (spec §7.5–§7.7)", () => {
  const inputs = syntheticInputs({
    career: career([
      [SKILL.testing, true], [SKILL.mobile, false], [SKILL.machineLearning, true], [SKILL.presenting, false], [SKILL.bigData, false], [SKILL.docker, false],
    ]),
  });
  const result = calculateAssessment(inputs);
  const row = (name: string) => result.career!.requirements.find((item) => item.title === name)!;

  it("gives each of the five statuses with thresholds 85/70 and deficit bands", () => {
    expect(row("Kiểm thử phần mềm")).toMatchObject({ status: "met", threshold: 85, coefficient: 2, priorityLabel: "Bắt buộc", fitCredit: 1 });
    expect(row("Lập trình di động")).toMatchObject({ status: "below", threshold: 70, score: 56, deficit: 14, deficitBand: "moderate", deficitBandLabel: "Thiếu vừa" });
    expect(row("Học máy nhập môn")).toMatchObject({ status: "below", deficit: 38, deficitBand: "large" });
    expect(row("Thuyết trình")).toMatchObject({ status: "upcoming", statusLabel: "Sắp học", upcomingTerm: "HK253", fitCredit: null });
    expect(row("Phân tích dữ liệu lớn")).toMatchObject({ status: "not_studied", deficitBand: "not_studied", fitCredit: 0, selfStudy: true });
    expect(row("Docker")).toMatchObject({ status: "no_data", noDataReason: "not_measured", fitCredit: null, selfStudy: true });
  });

  it("computes the non-saturating fit index, the data share and the count lines", () => {
    const fit = (2 * 1 + 1 * 0.5 * (56 - 40) / 30 + 2 * 0.5 * (47 - 40) / 45 + 0) / 6;
    expect(result.career!.fit).toBeCloseTo(fit, 4);
    expect(result.career).toMatchObject({
      fitCode: "needs_more", fitLabel: "Cần bổ sung nhiều", dataShare: 0.75,
      summaryText: "Đạt 1/6 kỹ năng · 1 sắp học · 1 chưa đủ dữ liệu", dataText: "5/6 kỹ năng có dữ liệu",
      counts: { total: 6, met: 1, below: 2, upcoming: 1, notStudied: 1, noData: 1, withData: 5 },
      weightedMeanScore: 65.2, weightedMeanCount: 3,
    });
    expect(result.career!.requirements.map((item) => item.title)).toEqual([
      "Học máy nhập môn", "Kiểm thử phần mềm", "Phân tích dữ liệu lớn", "Lập trình di động", "Thuyết trình", "Docker",
    ]);
  });

  it("lists support courses by credits × weight with three-state prerequisites and planned terms", () => {
    const courses = row("Thuyết trình").supportCourses;
    expect(courses.map((course) => [course.code, course.eligibility, course.termLabel])).toEqual([
      ["71ITGR40203", "not_eligible", "HK261"], ["71ITGR40206", "eligible", "HK261"], ["71ITIS30403", "review", "HK253"], ["71ITIN40304", "eligible", "HK253"],
    ]);
    // Only the CNPM block of the "SV chuyên ngành …" relation applies; 71ITSE41203 is in progress, not passed.
    expect(courses[0]!.missing).toEqual([{ code: "71ITSE41203", name: "Kiểm thử phần mềm", kind: "prerequisite" }]);
    expect(courses[2]!.reviewNotes).toEqual(["[71ENG010012]Anh văn dự bị (AV0)"]);
    expect(courses[0]!.reason).toBe("3 tín chỉ × trọng số 1 cho kỹ năng này");
  });

  it("asks for confirmation of specialty-dependent prerequisites when no specialty is set", () => {
    const unset = calculateAssessment({ ...inputs, student: { ...inputs.student, specialty: null } });
    const course = unset.career!.requirements.find((item) => item.title === "Thuyết trình")!.supportCourses.find((item) => item.code === "71ITGR40203")!;
    expect(course).toMatchObject({ eligibility: "review", missing: [] });
    expect(course.reviewNotes[0]).toContain("chưa chọn chuyên ngành");
  });

  it("suggests improving passed courses below the threshold and lists self-study skills", () => {
    expect(row("Học máy nhập môn").improveCourses.map((course) => [course.code, course.kind, course.reason])).toEqual([
      ["71ITAI40103", "improve", "Đã đạt nhưng điểm học phần 47/100 thấp hơn ngưỡng 85"],
    ]);
    expect(row("Lập trình di động").supportCourses).toEqual([]);
    expect(result.selfStudy.map((item) => [item.name, item.reason])).toEqual([
      ["Phân tích dữ liệu lớn", "elective_quota_used"], ["Docker", "not_measured"],
    ]);
    // A below skill whose only courses are improve courses is not "no course left" (CS-3).
    for (const name of ["Học máy nhập môn", "Lập trình di động"]) {
      expect(row(name)).toMatchObject({ status: "below", supportCourses: [], selfStudy: false });
      expect(row(name).improveCourses.length).toBeGreaterThan(0);
    }
    // Priority = Σ coefficient × credits × weight: the required skill's improvement (2 × 3 × 1) comes first.
    expect(result.courseSuggestions.slice(0, 2).map((course) => [course.code, course.kind, course.priority])).toEqual([["71ITAI40103", "improve", 6], ["71ITGR40203", "take", 3]]);
    expect(result.courseSuggestions.find((course) => course.kind === "improve")).toMatchObject({ code: "71ITAI40103", skills: [{ key: row("Học máy nhập môn").skillKey, status: "below" }] });
  });

  it("separates 'Sắp học' from 'Chưa học' by the training-plan term", () => {
    const early = calculateAssessment(syntheticInputs({
      terms: [
        { year: "2023-2024", semester: "HK01", rows: [["71ITBS10103", 3, 8, 3.5, "B+"], ["71ITBS10203", 3, 7, 3, "B"]] },
        { year: "2023-2024", semester: "HK02", rows: [["71PEKC10062", 2, 8, 3.5, "B+"]] },
      ],
      career: career([[SKILL.csharp, false], [SKILL.testing, true], [SKILL.web, false]]),
    }));
    expect(early.career!.requirements.map((item) => [item.title, item.status, item.upcomingTerm])).toEqual([
      ["Kiểm thử phần mềm", "upcoming", "HK243"], ["Lập trình C#", "not_studied", null], ["Phát triển web", "upcoming", "HK241"],
    ]);
    expect(early.career).toMatchObject({ fitCode: "insufficient_data", fit: 0, dataShare: 0.25 });
    expect(early.progress!.late.map((entry) => ("code" in entry ? entry.code : entry.label))).toEqual(["71NAD110013", "71ITSE30103"]);
  });

  it("never calls a student 'Phù hợp' when every measured career skill is below threshold", () => {
    const allC = calculateAssessment(syntheticInputs({
      terms: mapTerms((row) => (row[4] === "MT" || row[2] === undefined ? row : [row[0], row[1], 5.5, 2, "C"])),
      career: career([[SKILL.programming, false], [SKILL.web, false], [SKILL.testing, true], [SKILL.database, false], [SKILL.mobile, false]]),
    }));
    expect(allC.career!.requirements.every((item) => item.status === "below")).toBe(true);
    expect(allC.career!.fit!).toBeLessThan(0.5);
    expect(allC.career!.fitCode).toBe("needs_more");
  });

  it("handles a requirement without a skill and a deleted career", () => {
    const base = career([[SKILL.testing, true]], { deleted: true });
    base.requirements.push({ id: "00000000-0000-4000-8000-00000000d199", skillId: null, skillName: null, title: "Tiếng Anh giao tiếp", isRequired: false });
    const deleted = calculateAssessment(syntheticInputs({ career: base }));
    expect(deleted.career!.requirements.find((item) => item.skillId === null)).toMatchObject({ status: "no_data", noDataReason: "no_skill", skillKey: null, selfStudy: false });
    expect(deleted.warnings.map((warning) => warning.code)).toContain("career_deleted");
  });

  it("still assesses competencies without a career", () => {
    const none = calculateAssessment(syntheticInputs({ career: null }));
    expect(none).toMatchObject({ career: null, selfStudy: [], courseSuggestions: [], promptSelection: { careerSkillKeys: [] } });
    expect(none.skills.length).toBe(13);
    expect(none.promptSelection.topSkillKeys).toHaveLength(5);
  });

  it("puts every career skill plus the 5 strongest and weakest other skills in the prompt selection", () => {
    expect(result.promptSelection.careerSkillKeys).toHaveLength(6);
    const others = [...result.promptSelection.topSkillKeys, ...result.promptSelection.bottomSkillKeys];
    expect(others.some((key) => result.promptSelection.careerSkillKeys.includes(key))).toBe(false);
    expect(new Set(others).size).toBe(others.length);
  });
});

describe("data warnings (spec §7.10)", () => {
  const codes = (inputs: AssessmentInputs) => calculateAssessment(inputs).warnings.map((warning) => warning.code);

  it("warns about weights from another revision and low weight coverage", () => {
    const inputs = syntheticInputs();
    inputs.weights = { ...inputs.weights, revisionId: "00000000-0000-4000-8000-0000000000ff", version: 0 };
    inputs.weights.links = inputs.weights.links.filter((link) => link.courseCode.startsWith("71ITBS") || link.courseCode.startsWith("71ITSE"));
    const warnings = calculateAssessment(inputs).warnings;
    expect(warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(["weights_revision_differs", "weights_coverage_low"]));
    for (const warning of warnings) expect(warning.consequence.length).toBeGreaterThan(10);
  });

  it("warns about OCR review, missing or ambiguous plans and unknown specialty values", () => {
    const ocr = syntheticTranscript(syntheticStudentTerms(), "vlu-ocr-1.1");
    ocr.ocr = { needsReview: true, pages: [], semesters: [] };
    expect(codes(syntheticInputs({ transcript: ocr }))).toContain("transcript_needs_review");
    const noPlan = calculateAssessment(syntheticInputs({ plan: false }));
    expect(noPlan.progress).toBeNull();
    expect(noPlan.warnings.map((warning) => warning.code)).toContain("plan_unavailable");
    expect(codes({ ...syntheticInputs(), plan: { resolution: "ambiguous", revision: null } })).toContain("plan_ambiguous");
    const odd = syntheticInputs();
    odd.curriculum.courses.push({ code: "71ITNW99903", name: "An ninh mạng", credits: 3, type: "BB", block: "", specialty: "An ninh Mạng và IoTs", semester: 1, studyYear: 4 });
    expect(calculateAssessment(odd).warnings.find((warning) => warning.code === "specialty_value_unknown")?.details).toEqual(["An ninh Mạng và IoTs"]);
  });

  it("reports a credit mismatch when printed results need no inference", () => {
    const terms = mapTerms((row) => [row[0], row[1], row[2] ?? null, row[3] ?? null, row[4] ?? null, row[4] === "F" ? "Không đạt" : row[2] !== undefined && row[4] !== "MT" ? "Đạt" : null]);
    terms[5]!.summaries = [["Tổng số tín chỉ tích lũy", "30"]];
    const result = calculateAssessment(syntheticInputs({ terms }));
    expect(result.transcript.inferredCount).toBe(0);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["credits_mismatch"]);
  });
});

describe("determinism", () => {
  it("returns the same result whatever the input order", () => {
    const inputs = syntheticInputs();
    const reversed = structuredClone(inputs);
    reversed.curriculum.courses.reverse();
    reversed.curriculum.relations.reverse();
    reversed.weights.links.reverse();
    reversed.weights.skills.reverse();
    reversed.weights.groups.reverse();
    reversed.career!.requirements.reverse();
    expect(calculateAssessment(reversed)).toEqual(calculateAssessment(inputs));
  });
});
