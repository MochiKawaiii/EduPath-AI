import { describe, expect, it } from "vitest";
import {
  aiAnnouncement, aiErrorMessage, aiRetryErrorMessage, aiScoringFailure, aiStateCopy, bucketSkills, canRegenerate, cleanKeyText, cloudModelName, dataUsedLine,
  deficitText, eligibilityDisplay, errorMessage, filterSkills, formatElapsed, formatScore, gapStatusDisplay, groupEvidenceCounts, historySentence, historyYears,
  isAiScored, isCloudModel, isPreconditionError, PRIORITY_LABELS, levelStep, mapAiOutput, modelLabel, needsNewAssessment, plansFor, scoreDifference, shouldPoll,
  shownResult, showsConfidence, sortRequirements, termLabel, EMPTY_SKILL_FILTERS, TRANSCRIPT_CHANGED_RETRY,
} from "./student-competency-data";
import { fixtureAiAssessment, fixtureAiOutput, fixtureAiResult, fixtureAssessment, fixtureResult } from "./student-competency.fixture";
import type { CareerRequirementResult } from "./competency-assessment-types";

describe("polling and AI actions", () => {
  it("polls only while the AI comment can still change", () => {
    expect(shouldPoll("queued")).toBe(true);
    expect(shouldPoll("processing")).toBe(true);
    for (const status of ["disabled", "deferred", "completed", "failed", "cancelled", null] as const) expect(shouldPoll(status)).toBe(false);
  });
  it("offers regeneration for failed, cancelled, deferred and disabled-once-enabled", () => {
    expect(canRegenerate("failed", false)).toBe(true);
    expect(canRegenerate("cancelled", false)).toBe(true);
    expect(canRegenerate("deferred", false)).toBe(true);
    expect(canRegenerate("disabled", false)).toBe(false);
    expect(canRegenerate("disabled", true)).toBe(true);
    expect(canRegenerate("completed", true)).toBe(false);
    expect(canRegenerate("queued", true)).toBe(false);
  });
  it("tells a waiting queue apart from an offline worker", () => {
    expect(aiStateCopy("queued", true, true).title).toBe("Đang xếp hàng tạo nhận xét");
    expect(aiStateCopy("queued", false, true).title).toBe("Đang chờ máy AI kết nối");
    expect(aiStateCopy("disabled", false, false).title).toBe("Nhận xét AI chưa được bật");
  });
  it("names the local model", () => {
    expect(modelLabel("gemma4:e4b")).toBe("Gemma 4 E4B");
    expect(modelLabel(null)).toBe("Gemma 4 E4B");
    expect(modelLabel("other-model")).toBe("other-model");
  });
});

describe("errors", () => {
  it("separates precondition errors from failures and maps codes to Vietnamese", () => {
    expect(isPreconditionError("competency_weights_unavailable")).toBe(true);
    expect(isPreconditionError("transcript_required")).toBe(true);
    expect(isPreconditionError("assessment_too_frequent")).toBe(false);
    expect(isPreconditionError(undefined)).toBe(false);
    expect(errorMessage("assessment_too_frequent")).toContain("một phút");
    expect(errorMessage("unknown_code")).toBe("Thao tác chưa thành công. Vui lòng thử lại.");
  });
});

describe("formatting", () => {
  it("shows whole scores rounded down so a shown score never crosses a threshold", () => {
    expect(formatScore(86.6)).toBe("86");
    expect(formatScore(84.6)).toBe("84");
    expect(formatScore(69.5)).toBe("69");
    expect(formatScore(85)).toBe("85");
    expect(formatScore(84.99999999999)).toBe("85");
    expect(formatScore(null)).toBe("—");
    expect(termLabel("HK253")).toBe("HK3 · 2025–2026");
    expect(termLabel(null)).toBe("Chưa xếp lịch");
  });
  it("maps levels to the four ramp steps", () => {
    expect([levelStep("proficient"), levelStep("good"), levelStep("basic"), levelStep("needs_work"), levelStep("no_evidence"), levelStep("exempt")]).toEqual([4, 3, 2, 1, 0, 0]);
  });
  it("never says 'thiếu 0 điểm'", () => {
    expect(deficitText(0.3)).toBe("Dưới ngưỡng · thiếu 1 điểm");
    expect(deficitText(5.6)).toBe("Dưới ngưỡng · thiếu 6 điểm");
    expect(deficitText(5)).toBe("Dưới ngưỡng · thiếu 5 điểm");
    expect(deficitText(null)).toBe("Dưới ngưỡng");
  });
  it("summarises the data used", () => {
    const line = dataUsedLine(fixtureAssessment());
    expect(line).toContain("CTĐT phiên bản 3");
    expect(line).toContain("bảng điểm 8 học phần đến HK252");
  });
});

describe("career gaps", () => {
  const reqs = fixtureResult.career!.requirements;
  it("uses green/red only for met and below, neutral for upcoming and missing data", () => {
    const byStatus = (status: CareerRequirementResult["status"]) => gapStatusDisplay(reqs.find((req) => req.status === status)!);
    expect(byStatus("met")).toEqual({ tone: "pass", glyph: "✓", text: "Đạt ngưỡng" });
    expect(byStatus("below").tone).toBe("fail");
    expect(byStatus("upcoming")).toEqual({ tone: "neutral", glyph: "○", text: "Sắp học · HK261" });
    expect(byStatus("no_data")).toEqual({ tone: "neutral", glyph: "?", text: "Chưa đủ dữ liệu" });
    expect(gapStatusDisplay({ status: "not_studied", deficit: null, upcomingTerm: null, exemptOnly: false }).tone).toBe("unknown");
  });
  it("sorts Bắt buộc first, then the largest shortfall", () => {
    expect(sortRequirements(reqs).map((req) => req.requirementId)).toEqual(["q2", "q1", "q3", "q4", "q5"]);
  });
  it("describes prerequisite states", () => {
    expect(eligibilityDisplay("eligible", []).glyph).toBe("✓");
    expect(eligibilityDisplay("not_eligible", [{ code: "X1", name: "Môn X" }]).text).toBe("Cần học trước Môn X (X1)");
    expect(eligibilityDisplay("review", []).glyph).toBe("?");
  });
});

describe("skills", () => {
  it("filters by group, career skills, needs-work and accent-insensitive search", () => {
    expect(filterSkills(fixtureResult.skills, { ...EMPTY_SKILL_FILTERS, careerOnly: true }).map((s) => s.key)).toEqual(["S01", "S03", "S04", "S07"]);
    expect(filterSkills(fixtureResult.skills, { ...EMPTY_SKILL_FILTERS, needsWork: true }).map((s) => s.key)).toEqual(["S04"]);
    expect(filterSkills(fixtureResult.skills, { ...EMPTY_SKILL_FILTERS, search: "giai thuat" }).map((s) => s.key)).toEqual(["S04"]);
    expect(filterSkills(fixtureResult.skills, { ...EMPTY_SKILL_FILTERS, group: "G2" }).map((s) => s.key)).toEqual(["S05", "S06"]);
  });
  it("keeps condition-only, not-applicable and no-evidence skills out of the engine groups, no-evidence last", () => {
    const buckets = bucketSkills(fixtureResult, fixtureResult.skills);
    expect(buckets.map((b) => [b.id, b.skills.map((s) => s.key)])).toEqual([
      ["G1", ["S01", "S02", "S03", "S04"]], ["G2", ["S05"]], ["condition", ["S06"]], ["not-applicable", ["S08"]], ["no-evidence", ["S07"]],
    ]);
    expect(buckets.at(-1)!.note).toContain("Không phải điểm yếu");
  });
  it("counts a group's skills with the overall rule, whatever a stored skillCount says", () => {
    // Regression: "49/65" next to an overall "62/66" — not-applicable skills (S08) are not in the denominator.
    // fixtureResult's G1 skillCount (6) is the pre-comp-calc-v3 value that still counted S08.
    expect(groupEvidenceCounts(fixtureResult.skills, "G1")).toEqual({ withEvidence: 4, total: 5 });
    // S06 is condition-only and S05 exempt-only (counts as evidence).
    expect(groupEvidenceCounts(fixtureResult.skills, "G2")).toEqual({ withEvidence: 1, total: 1 });
    const sum = fixtureResult.groups.map((group) => groupEvidenceCounts(fixtureResult.skills, group.key))
      .reduce((total, counts) => ({ withEvidence: total.withEvidence + counts.withEvidence, total: total.total + counts.total }), { withEvidence: 0, total: 0 });
    const counted = fixtureResult.skills.filter((skill) => !skill.conditionOnly && skill.status !== "not_applicable");
    expect(sum).toEqual({ withEvidence: counted.filter((skill) => skill.status === "scored" || skill.status === "exempt_only").length, total: counted.length });
    // The group rows add up to the overall "Dựa trên x/y kỹ năng" line.
    expect(sum).toEqual({ withEvidence: fixtureResult.overall.basis.skillsWithEvidence, total: fixtureResult.overall.basis.applicableSkills });
  });
});

describe("history (STU-COMP-07)", () => {
  const point = (term: string, schoolYear: string, semester: number, score: number | null) => ({
    term, schoolYear, semester, gradedCourses: semester * 3,
    overall: { score, level: "good" as const, levelLabel: "Khá", skillsWithEvidence: 1, applicableSkills: 2 }, groups: [],
  });
  it("groups the terms by school year with whole-point changes and the newest term marked", () => {
    const years = historyYears([point("HK231", "2023–2024", 1, 70.9), point("HK232", "2023–2024", 2, null), point("HK233", "2023–2024", 3, 72.2), point("HK241", "2024–2025", 1, 71.99)]);
    expect(years.map((year) => [year.schoolYear, year.rows.map((row) => row.change), year.end.term])).toEqual([
      // 70,9 → shown 70; a term without a score breaks nothing; 72,2 → 72: +2; 71,99 → 71: −1.
      ["2023–2024", [null, null, 2], "HK233"], ["2024–2025", [-1], "HK241"],
    ]);
    expect(years.flatMap((year) => year.rows).filter((row) => row.latest).map((row) => row.term)).toEqual(["HK241"]);
    expect(historyYears([])).toEqual([]);
  });
  it("says the trend in one sentence, with the peak only when it stands out", () => {
    expect(historySentence([point("HK231", "2023–2024", 1, 68.5), point("HK242", "2024–2025", 2, 81), point("HK252", "2025–2026", 2, 79.4)]))
      .toBe("Điểm năng lực tổng tăng từ 68 (học kỳ 1 năm học 2023–2024) lên 79 (học kỳ 2 năm học 2025–2026). Cao nhất là 81 vào học kỳ 2 năm học 2024–2025.");
    expect(historySentence([point("HK231", "2023–2024", 1, 80), point("HK232", "2023–2024", 2, 76.5)]))
      .toBe("Điểm năng lực tổng giảm từ 80 (học kỳ 1 năm học 2023–2024) xuống 76 (học kỳ 2 năm học 2023–2024).");
    expect(historySentence([point("HK231", "2023–2024", 1, 75.2), point("HK232", "2023–2024", 2, 75.9)]))
      .toBe("Điểm năng lực tổng giữ ở mức 75 từ học kỳ 1 năm học 2023–2024 đến học kỳ 2 năm học 2023–2024.");
    expect(historySentence([point("HK231", "2023–2024", 1, 75)])).toBeNull();
  });
});

describe("course plans", () => {
  it("keeps only the target career's plans once a career is chosen", () => {
    const plans = fixtureResult.skillPlans!;
    expect(plansFor(fixtureResult)).toEqual([]);
    expect(plansFor({ ...fixtureResult, career: null }).map((plan) => plan.skillKey)).toEqual(plans.map((plan) => plan.skillKey));
    const deepen = { ...plans[0]!, purpose: "deepen" as const };
    expect(plansFor({ ...fixtureResult, skillPlans: [deepen, plans[1]!] })).toEqual([deepen]);
    expect(plansFor({ ...fixtureResult, skillPlans: undefined })).toEqual([]);
  });
});

describe("scoreDifference", () => {
  it("agrees with the shown score and the deficit", () => {
    // 84,6 shows as 84 against 85: the difference is -1 and the status says 'thiếu 1 điểm'.
    expect(scoreDifference({ score: 84.6, status: "below", deficit: 0.4, threshold: 85 })).toBe(-1);
    expect(scoreDifference({ score: 64.4, status: "below", deficit: 5.6, threshold: 70 })).toBe(-6);
    expect(scoreDifference({ score: 91.7, status: "met", deficit: null, threshold: 85 })).toBe(6);
    expect(scoreDifference({ score: 85, status: "met", deficit: null, threshold: 85 })).toBe(0);
    expect(scoreDifference({ score: null, status: "not_studied", deficit: null, threshold: 85 })).toBeNull();
    expect(scoreDifference({ score: 50, status: "upcoming", deficit: null, threshold: 70 })).toBeNull();
  });
});

describe("cleanKeyText", () => {
  const names = new Map([["S12", "API"], ["S03", "Kiểm thử phần mềm"], ["S07", "C#"], ["G1", "Chuyên môn"], ["G2", "Kỹ năng mềm"]]);
  it("drops a key written next to its own name instead of repeating the name", () => {
    // Regression: "(API - S12)" used to become "(API - API)".
    expect(cleanKeyText("Khả năng tích hợp (API - S12) của bạn rất tốt.", names)).toBe("Khả năng tích hợp (API) của bạn rất tốt.");
    expect(cleanKeyText("API (S12) đạt mức Thành thạo.", names)).toBe("API đạt mức Thành thạo.");
    expect(cleanKeyText("S12 - API đạt mức Thành thạo.", names)).toBe("API đạt mức Thành thạo.");
    expect(cleanKeyText("Ôn (S12: API) và S12 (API).", names)).toBe("Ôn (API) và API.");
    expect(cleanKeyText("Kiểm thử phần mềm (S03), Lập trình C# (S07).", names)).toBe("Kiểm thử phần mềm, Lập trình C#.");
    expect(cleanKeyText("Nhóm Chuyên môn (G1) và nhóm G2 - Kỹ năng mềm.", names)).toBe("Nhóm Chuyên môn và nhóm Kỹ năng mềm.");
  });
  it("replaces a bare key elsewhere, drops a bracketed one and keeps unknown keys", () => {
    expect(cleanKeyText("Bạn nên luyện kỹ năng S12 và nhóm G1.", names)).toBe("Bạn nên luyện kỹ năng API và nhóm Chuyên môn.");
    expect(cleanKeyText("Kỹ năng kiểm thử (S03) cần thêm sản phẩm.", names)).toBe("Kỹ năng kiểm thử cần thêm sản phẩm.");
    expect(cleanKeyText("Mã S99, G9 và S120 giữ nguyên.", names)).toBe("Mã S99, G9 và S120 giữ nguyên.");
    expect(cleanKeyText("Không có khóa nào, 2 / 4 kỹ năng.", names)).toBe("Không có khóa nào, 2 / 4 kỹ năng.");
  });
});

describe("mapAiOutput", () => {
  it("replaces internal keys written in prose with names", () => {
    const mapped = mapAiOutput({
      ...fixtureAiOutput,
      summary: "Bạn mạnh ở Lập trình web (S01) và nhóm G1; kỹ năng S04 cần ôn. Mã S99 (S99) giữ nguyên.",
      nextSteps: ["Luyện thêm kỹ năng S03.", "Ôn Giải thuật (S04).", "Làm dự án."],
    }, fixtureResult)!;
    expect(mapped.summary).toBe("Bạn mạnh ở Lập trình web và nhóm Kiến thức chuyên môn; kỹ năng Giải thuật cần ôn. Mã S99 (S99) giữ nguyên.");
    expect(mapped.nextSteps).toEqual(["Luyện thêm kỹ năng Thiết kế cơ sở dữ liệu.", "Ôn Giải thuật.", "Làm dự án."]);
  });
  it("never shows a weak or below-threshold skill as a strength", () => {
    const mapped = mapAiOutput({
      ...fixtureAiOutput,
      strengths: [
        { skillKey: "S01", comment: "Tốt." },
        { skillKey: "S03", comment: "Dưới ngưỡng nghề nhưng bị nêu là điểm mạnh." },
        { skillKey: "S04", comment: "Cũng nằm trong mục cần cải thiện." },
      ],
    }, fixtureResult)!;
    expect(mapped.strengths.map((item) => item.key)).toEqual(["S01"]);
  });
  it("maps keys to names and drops what cannot be mapped", () => {
    const mapped = mapAiOutput(fixtureAiOutput, fixtureResult)!;
    expect(mapped.groupInsights.map((g) => g.name)).toEqual(["Kiến thức chuyên môn"]);
    expect(mapped.strengths[0]).toMatchObject({ key: "S01", name: "Lập trình web" });
    expect(mapped.gaps[0].courses).toEqual([{ code: "TST105", name: "Kiểm thử phần mềm", reason: "Đo trực tiếp kỹ năng kiểm thử." }]);
    expect(mapped.gaps[1]).toMatchObject({ key: "S09", name: "Docker" });
    expect(mapped.nextSteps).toHaveLength(3);
  });
  it("labels AI priorities apart from the career property 'Ưu tiên'", () => {
    expect(PRIORITY_LABELS).toEqual({ high: "Cần làm sớm", medium: "Nên làm", low: "Có thể để sau" });
    for (const label of Object.values(PRIORITY_LABELS)) expect(label).not.toMatch(/Ưu tiên/);
  });
  it("survives missing or malformed fields", () => {
    expect(mapAiOutput(null, fixtureResult)).toBeNull();
    const mapped = mapAiOutput({ summary: "Tóm tắt", strengths: "x", improvements: [{ skillKey: "S99", priority: "high", comment: "?" }] } as never, fixtureResult)!;
    expect(mapped.summary).toBe("Tóm tắt");
    expect(mapped.strengths).toEqual([]);
    expect(mapped.improvements).toEqual([]);
    expect(mapped.careerFit).toBe("");
  });
});

describe("AI 100%", () => {
  it("shows the engine's result for a system assessment, the AI's as it is for an AI-100% one, none while the AI works", () => {
    expect(shownResult(fixtureAssessment())).toBe(fixtureResult);
    expect(shownResult({ ...fixtureAssessment(), scoring: "system" })).toBe(fixtureResult);
    // A row stored before AI 100% has no scoring: the engine's.
    expect(shownResult({ ...fixtureAssessment(), scoring: undefined, aiResult: undefined })).toBe(fixtureResult);
    expect(shownResult(fixtureAiAssessment())).toBe(fixtureAiResult);
    for (const status of ["queued", "processing", "failed", "cancelled", "deferred"] as const) expect(shownResult(fixtureAiAssessment(status))).toBeNull();
    // An AI-100% assessment never falls back to the engine's numbers.
    expect(shownResult({ ...fixtureAiAssessment(), aiResult: undefined })).toBeNull();
    expect([isAiScored(fixtureAiAssessment()), isAiScored(fixtureAssessment()), isAiScored(null)]).toEqual([true, false, false]);
  });
  it("leaves out confidence and coverage only when the result has none", () => {
    expect(showsConfidence(fixtureResult)).toBe(true);
    expect(showsConfidence(fixtureAiResult)).toBe(false);
  });
  it("counts the wait in mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(83_400)).toBe("01:23");
    expect(formatElapsed(59 * 60_000 + 59_999)).toBe("59:59");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    // Clock skew or a bad date never shows a negative or broken time.
    expect(formatElapsed(-5_000)).toBe("00:00");
    expect(formatElapsed(Number.NaN)).toBe("00:00");
  });
  it("names Claude and never the team's machine in cloud mode", () => {
    expect(modelLabel("claude-haiku-5-5")).toBe("Claude Haiku 5.5");
    expect(modelLabel("claude-haiku-5-5-20261001")).toBe("Claude Haiku 5.5");
    expect(modelLabel("claude-opus-5")).toBe("Claude Opus 5");
    expect([isCloudModel("claude-haiku-5-5"), isCloudModel("gemma4:e4b"), isCloudModel(null)]).toEqual([true, false, false]);
    expect([cloudModelName(null), cloudModelName("gemma4:e4b"), cloudModelName("claude-haiku-5-5")]).toEqual(["Claude Haiku 5.5", "Claude Haiku 5.5", "Claude Haiku 5.5"]);
    for (const code of ["ai_timeout", "worker_timeout", "ai_output_truncated", "invalid_ai_output", "ai_failed", "ollama_unavailable", null]) {
      expect(aiErrorMessage(code, true)).not.toMatch(/máy/i);
    }
    expect(aiErrorMessage("ai_timeout")).toBe("Máy AI xử lý quá thời gian cho phép.");
    expect(aiStateCopy("queued", false, true, true).title).toBe("Đang xếp hàng tạo nhận xét");
    expect(aiStateCopy("disabled", false, false, true).text).not.toMatch(/máy/i);
  });
  it("explains a failed AI run and the errors of a retry in the student's words", () => {
    expect(aiScoringFailure("failed", "ai_timeout")).toBe("AI xử lý quá thời gian cho phép.");
    expect(aiScoringFailure("deferred", null)).toBe("Hàng đợi AI đang đầy nên yêu cầu chưa được xử lý.");
    expect(aiScoringFailure("cancelled", null)).toBe("Yêu cầu tính kết quả đã bị hủy.");
    expect(aiRetryErrorMessage("transcript_changed")).toBe(TRANSCRIPT_CHANGED_RETRY);
    // Both 409s that need a new assessment say which data changed and point to "Đánh giá lại".
    expect([needsNewAssessment("transcript_changed"), needsNewAssessment("assessment_outdated"), needsNewAssessment("queue_full"), needsNewAssessment(null)]).toEqual([true, true, false, false]);
    expect(aiRetryErrorMessage("assessment_outdated")).toBe("Chương trình đào tạo hoặc trọng số kỹ năng đã thay đổi sau lần đánh giá này nên không tính lại được. Hãy bấm “Đánh giá lại” để tạo lần đánh giá mới.");
    expect(TRANSCRIPT_CHANGED_RETRY).toContain("“Đánh giá lại”");
    expect(aiRetryErrorMessage("queue_full")).not.toContain("nhận xét");
    expect(aiRetryErrorMessage("assessment_not_found")).toBe(errorMessage("assessment_not_found"));
  });
  it("announces the AI's progress", () => {
    const scoring = { aiScored: true, hasResult: false, cloud: true, workerOnline: false, aiEnabled: true };
    expect(aiAnnouncement("processing", scoring)).toBe("AI đang tính kết quả của bạn.");
    expect(aiAnnouncement("failed", scoring)).toBe("AI chưa tính được kết quả.");
    expect(aiAnnouncement("completed", { ...scoring, hasResult: true })).toBe("AI đã tính xong kết quả của bạn.");
    expect(aiAnnouncement("queued", { ...scoring, aiScored: false })).toBe("Đang xếp hàng tạo nhận xét");
    expect(aiAnnouncement("queued", { ...scoring, aiScored: false, cloud: false })).toBe("Đang chờ máy AI kết nối");
    expect(aiAnnouncement("completed", { ...scoring, aiScored: false })).toBe("Đã có nhận xét từ EduPath AI.");
  });
});
