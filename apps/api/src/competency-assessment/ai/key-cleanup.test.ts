import { describe, expect, it } from "vitest";
import { cleanAiOutputKeys, cleanKeyText, keyNamesFrom } from "./key-cleanup.js";
import type { AiOutput } from "./schema.js";
import { syntheticResult } from "./test-fixture.js";

const names = new Map([["S12", "API"], ["S03", "Kiểm thử phần mềm"], ["S07", "C#"], ["G1", "Chuyên môn"], ["G2", "Kỹ năng mềm"]]);

describe("cleanKeyText", () => {
  it("drops a key next to its own name instead of repeating the name", () => {
    // Regression: "(API - S12)" was shown as "(API - API)".
    expect(cleanKeyText("Khả năng phát triển dịch vụ và tích hợp (API - S12) của bạn rất tốt.", names))
      .toBe("Khả năng phát triển dịch vụ và tích hợp (API) của bạn rất tốt.");
    expect(cleanKeyText("API (S12) đạt mức Thành thạo.", names)).toBe("API đạt mức Thành thạo.");
    expect(cleanKeyText("S12 - API đạt mức Thành thạo.", names)).toBe("API đạt mức Thành thạo.");
    expect(cleanKeyText("Ôn (S12: API), (S12) API và S12 (API).", names)).toBe("Ôn (API), API và API.");
    expect(cleanKeyText("Lập trình C# (S07) và api, S12.", names)).toBe("Lập trình C# và api.");
  });

  it("handles group keys the same way", () => {
    expect(cleanKeyText("Nhóm Chuyên môn (G1) mạnh nhất.", names)).toBe("Nhóm Chuyên môn mạnh nhất.");
    expect(cleanKeyText("Nhóm G2 - Kỹ năng mềm cần thêm minh chứng.", names)).toBe("Nhóm Kỹ năng mềm cần thêm minh chứng.");
    expect(cleanKeyText("G1 là thế mạnh của bạn.", names)).toBe("Chuyên môn là thế mạnh của bạn.");
  });

  it("replaces a bare key elsewhere, drops a bracketed one and leaves unknown keys and keyless text alone", () => {
    expect(cleanKeyText("Bạn nên luyện kỹ năng S12 thêm.", names)).toBe("Bạn nên luyện kỹ năng API thêm.");
    expect(cleanKeyText("Kỹ năng kiểm thử (S03) cần thêm sản phẩm.", names)).toBe("Kỹ năng kiểm thử cần thêm sản phẩm.");
    expect(cleanKeyText("Mã S99, G9 và S120 giữ nguyên.", names)).toBe("Mã S99, G9 và S120 giữ nguyên.");
    const keyless = "Điểm  2 / 4 ( giữ nguyên ) .";
    expect(cleanKeyText(keyless, names)).toBe(keyless);
  });
});

describe("cleanAiOutputKeys", () => {
  const output = (): AiOutput => ({
    summary: "Kiểm thử phần mềm (S03) cần cải thiện.",
    groupInsights: [{ groupKey: "G1", comment: "Nhóm G1 vững." }],
    strengths: [{ skillKey: "S12", comment: "Tốt (API - S12)." }],
    improvements: [{ skillKey: "S03", priority: "high", comment: "S03 - Kiểm thử phần mềm còn thấp." }],
    careerFit: { comment: "Phù hợp với S12." },
    gaps: [{ skillKey: "S03", priority: "medium", explanation: "Thiếu S03.", courses: [{ courseCode: "TST201", reason: "Đo S03." }], selfStudy: ["Viết kiểm thử (S03)."] }],
    progress: "Đúng tiến độ.",
    nextSteps: ["Ôn S12.", "Làm dự án.", "Học G2."]
  });

  it("cleans every prose field and keeps the key fields", () => {
    const cleaned = cleanAiOutputKeys(output(), names);
    expect(cleaned).toEqual({
      summary: "Kiểm thử phần mềm cần cải thiện.",
      groupInsights: [{ groupKey: "G1", comment: "Nhóm Chuyên môn vững." }],
      strengths: [{ skillKey: "S12", comment: "Tốt (API)." }],
      improvements: [{ skillKey: "S03", priority: "high", comment: "Kiểm thử phần mềm còn thấp." }],
      careerFit: { comment: "Phù hợp với API." },
      gaps: [{ skillKey: "S03", priority: "medium", explanation: "Thiếu Kiểm thử phần mềm.", courses: [{ courseCode: "TST201", reason: "Đo Kiểm thử phần mềm." }], selfStudy: ["Viết kiểm thử."] }],
      progress: "Đúng tiến độ.",
      nextSteps: ["Ôn API.", "Làm dự án.", "Học Kỹ năng mềm."]
    });
  });

  it("returns the output unchanged without names", () => {
    const raw = output();
    expect(cleanAiOutputKeys(raw, new Map())).toBe(raw);
  });

  it("reads names from a stored result's skill directory and groups", () => {
    const result = syntheticResult();
    const map = keyNamesFrom(result.skillDirectory, result.groups);
    expect(map.get("S05")).toBe("Điện toán đám mây");
    expect(map.get("G2")).toBe("Kỹ năng bổ trợ");
    expect(keyNamesFrom(null, [{ key: "G1" }, { key: 1, name: "x" }, { key: "G2", name: " " }]).size).toBe(0);
  });
});
