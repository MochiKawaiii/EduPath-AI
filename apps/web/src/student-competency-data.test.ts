import { describe, expect, it } from "vitest";
import {
  aiStateCopy, bucketSkills, canRegenerate, dataUsedLine, deficitText, eligibilityDisplay, errorMessage, filterSkills, formatScore,
  gapStatusDisplay, isPreconditionError, levelStep, mapAiOutput, modelLabel, scoreDifference, shouldPoll, sortRequirements, termLabel, EMPTY_SKILL_FILTERS,
} from "./student-competency-data";
import { fixtureAiOutput, fixtureAssessment, fixtureResult } from "./student-competency.fixture";
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
  it("survives missing or malformed fields", () => {
    expect(mapAiOutput(null, fixtureResult)).toBeNull();
    const mapped = mapAiOutput({ summary: "Tóm tắt", strengths: "x", improvements: [{ skillKey: "S99", priority: "high", comment: "?" }] } as never, fixtureResult)!;
    expect(mapped.summary).toBe("Tóm tắt");
    expect(mapped.strengths).toEqual([]);
    expect(mapped.improvements).toEqual([]);
    expect(mapped.careerFit).toBe("");
  });
});
