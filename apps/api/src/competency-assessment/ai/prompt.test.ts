import { describe, expect, it } from "vitest";
import {
  AI_OPTIONS,
  GEMMA_SPECIAL_TOKENS,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildAiInput,
  buildPromptContext,
  formatDeficit,
  formatNumber,
  formatScore,
  sanitizeText,
  termText
} from "./prompt.js";
import { numbersIn } from "./validate.js";
import { syntheticResult } from "./test-fixture.js";

describe("sanitizeText", () => {
  it("lists the 24 Gemma special tokens", () => {
    expect(GEMMA_SPECIAL_TOKENS).toHaveLength(24);
    expect(new Set(GEMMA_SPECIAL_TOKENS).size).toBe(24);
    for (const token of ["<bos>", "<eos>", "<pad>", "<unk>", "<mask>", "<|turn>", "<turn|>", '<|"|>', "<|video|>"]) {
      expect(GEMMA_SPECIAL_TOKENS).toContain(token);
    }
  });

  it("removes every special token, including ones rebuilt by a removal", () => {
    for (const token of GEMMA_SPECIAL_TOKENS) expect(sanitizeText(`a${token}b`)).toBe("ab");
    expect(sanitizeText("x<bo<bos>s>y")).toBe("xy");
    expect(sanitizeText("x<<|turn>|turn>y")).toBe("xy");
    expect(sanitizeText("a <| b |> c")).toBe("a b c");
    expect(sanitizeText("<BOS>Tên")).toBe("Tên");
  });

  it("turns control characters and line breaks into spaces and drops format characters", () => {
    expect(sanitizeText("Lập\ntrình\r\nweb\tnâng\u0000cao x")).toBe("Lập trình web nâng cao x");
    expect(sanitizeText("Cơ​sở")).toBe("Cơsở");
  });

  it("replaces ASCII double quotes and keeps '#'", () => {
    expect(sanitizeText('Ngôn ngữ "C#/C++"')).toBe("Ngôn ngữ 'C#/C++'");
  });

  it("caps the length by characters with an ellipsis", () => {
    const value = sanitizeText("ă".repeat(300));
    expect(Array.from(value)).toHaveLength(120);
    expect(value.endsWith("…")).toBe(true);
    expect(sanitizeText("abcdef", 4)).toBe("abc…");
    expect(sanitizeText(null)).toBe("");
  });
});

describe("formatting helpers", () => {
  it("prints numbers with a decimal comma and at most two decimals", () => {
    expect(formatNumber(72.5)).toBe("72,5");
    expect(formatNumber(72.456)).toBe("72,46");
    expect(formatNumber(85)).toBe("85");
  });
  it("writes HKyyS term codes in words", () => {
    expect(termText("HK253")).toBe("học kỳ 3 năm học 2025–2026");
    expect(termText("HK261")).toBe("học kỳ 1 năm học 2026–2027");
    expect(termText("HK093")).toBe("học kỳ 3 năm học 2009–2010");
    expect(termText("Học kỳ hè")).toBe("Học kỳ hè");
    expect(termText(null)).toBe("chưa xếp lịch");
  });
  it("prints 100-point scores and deficits exactly as the page (floored score, deficit rounded up, at least 1)", () => {
    expect(formatScore(83.92)).toBe("83");
    expect(formatScore(84.999)).toBe("84");
    expect(formatScore(85)).toBe("85");
    expect(formatScore(0)).toBe("0");
    expect(formatDeficit(9.44)).toBe("10");
    expect(formatDeficit(30)).toBe("30");
    expect(formatDeficit(0.2)).toBe("1");
  });
});

describe("buildAiInput", () => {
  const input = buildAiInput(syntheticResult());

  it("uses the spec system prompt verbatim plus the output description", () => {
    expect(PROMPT_VERSION).toBe("comp-v3");
    expect(input.promptVersion).toBe("comp-v3");
    expect(input.system).toBe(SYSTEM_PROMPT);
    expect(input.system.startsWith("Bạn là cố vấn học tập của EduPath AI, đồng hành cùng sinh viên ngành Công nghệ Thông tin, Trường Đại học Văn Lang.\n")).toBe(true);
    expect(input.system).toContain("1. Không tự tính, ước lượng hay làm tròn lại bất kỳ con số nào.");
    expect(input.system).toContain("7. Nếu có cảnh báo dữ liệu, nói ngắn gọn cảnh báo đó ảnh hưởng thế nào tới độ chính xác.");
    expect(input.system).toContain("Chỉ trả về một đối tượng JSON đúng cấu trúc được mô tả bên dưới, không thêm bất kỳ văn bản nào bên ngoài JSON.\n");
    for (const field of ["summary", "groupInsights", "strengths", "improvements", "careerFit", "gaps", "progress", "nextSteps"]) {
      expect(input.system).toContain(`- ${field}:`);
    }
    expect(input.system).not.toContain("<mô tả");
    expect(input.system).toContain("không viết khóa S…/G… và không viết mã học phần");
    expect(input.system).toContain("không đưa ra chỉ số hay phần trăm phù hợp");
    expect(input.system).toContain("chép đúng từng chữ số như trong dữ liệu, không thêm chữ số thập phân");
    expect(input.system).toContain('8. Gọi học kỳ bằng chữ đúng như trong dữ liệu, ví dụ "học kỳ 3 năm học 2025–2026"; không viết mã học kỳ dạng HK253.');
    expect(input.system).toContain('"high" (cần làm sớm) | "medium" (nên làm) | "low" (có thể để sau)');
  });

  it("sends the fixed Ollama options", () => {
    expect(input.options).toEqual({ num_ctx: 16384, num_predict: 4096, temperature: 0.4, top_p: 0.95, top_k: 64 });
    expect(AI_OPTIONS.num_ctx).toBe(16384);
  });

  it("renders a delimited data block with every section and the job's keys", () => {
    const user = input.user;
    expect(user.startsWith("=== BẮT ĐẦU DỮ LIỆU")).toBe(true);
    expect(user).toContain("=== KẾT THÚC DỮ LIỆU ===");
    for (const section of ["[1. HỒ SƠ]", "[2. ĐIỂM TỔNG", "[3. KỸ NĂNG]", "[4. NGHỀ MỤC TIÊU]", "[5. ỨNG VIÊN", "[6. KỸ NĂNG CẦN TỰ HỌC", "[7. TIẾN ĐỘ", "[8. XÉT TỐT NGHIỆP", "[9. CẢNH BÁO"]) {
      expect(user).toContain(section);
    }
    expect(user).toContain("S01 | Lập trình hướng đối tượng | nhóm G1 | điểm 88 | Thành thạo");
    expect(user).toContain("S05 | Điện toán đám mây | Chưa đủ dữ liệu");
    expect(user).toContain("TST202 | Đảm bảo chất lượng phần mềm | 3 TC | học mới | Chưa đủ điều kiện; thiếu: TST201");
    expect(user).toContain("thiếu 30 (Thiếu nhiều)");
    expect(user).toContain("Ảnh hưởng: Điểm kỹ năng có thể thấp hơn thực tế.");
    expect(user).toContain("Có thể nêu là điểm mạnh: S01, S02");
    expect(user).toContain("Có thể nêu là cần cải thiện: S03");
  });

  it("does not send the numeric fit index, only the label", () => {
    expect(input.user).toContain("Mức phù hợp: Khá phù hợp\n");
    expect(input.user).not.toContain("chỉ số");
    expect(input.user).not.toContain("0,79");
  });

  it("lists ongoing and planned courses apart from the evidence", () => {
    const result = syntheticResult();
    const s01 = result.skills[0]!;
    s01.evidenceCourses = [
      { code: "TST101", weight: 0.5, contribution: 1.5, share: 0.5, role: "score" },
      { code: "TST201", weight: 1, contribution: 3, share: 0.5, role: "planned" },
      { code: "TST202", weight: 1, contribution: 3, share: 0.5, role: "in_progress" }
    ];
    const line = buildAiInput(result).user.split("\n").find((text) => text.startsWith("S01 |"))!;
    expect(line).toContain("| minh chứng: TST101 Nhập môn lập trình (điểm 8,5, A)");
    expect(line).toContain("| đang học: TST202 Đảm bảo chất lượng phần mềm (đang học)");
    expect(line).toContain("| sắp học (chưa phải minh chứng): TST201 Kiểm thử phần mềm cơ bản (sắp học vào học kỳ 1 năm học 2026–2027)");
    expect(line.indexOf("minh chứng: TST101")).toBeLessThan(line.indexOf("đang học"));
    expect(line.split("minh chứng:")[1]!.split("|")[0]).not.toContain("TST201");
  });

  it("sends the numbers the page shows: whole 100-point scores, whole percentages, no term codes", () => {
    const result = syntheticResult();
    result.overall.score = 83.92;
    result.groups[0] = { ...result.groups[0]!, score: 89.56 };
    result.skills[0] = { ...result.skills[0]!, score: 93.44, coverage: 0.4567 };
    result.career!.requirements[2] = { ...result.career!.requirements[2]!, score: 75.56, deficit: 9.44 };
    const user = buildAiInput(result).user;
    expect(user).toContain("Điểm tổng: 83 | Khá");
    expect(user).toContain("G1 | Kỹ thuật phần mềm | điểm 89 | Khá");
    expect(user).toContain("S01 | Lập trình hướng đối tượng | nhóm G1 | điểm 93 | Thành thạo | tin cậy Trung bình | độ phủ 46%");
    expect(user).toContain("ngưỡng 85 | điểm 75 | Thấp hơn ngưỡng | thiếu 10 (Thiếu nhiều)");
    for (const shown of [83.92, 89.56, 93.44, 75.56, 9.44, 45.67]) expect(numbersIn(user)).not.toContain(shown);
    // Course scores stay on the 10-point scale with up to two decimals, like the page.
    expect(user).toContain("TST101 Nhập môn lập trình (điểm 8,5, A)");
    expect(user).toContain("Học kỳ gần nhất có điểm: học kỳ 3 năm học 2025–2026");
    expect(user).toContain("Học kỳ hiện tại: học kỳ 3 năm học 2025–2026; học kỳ kế tiếp: học kỳ 1 năm học 2026–2027");
    expect(user).toContain("- trễ: TST150 Toán rời rạc (kế hoạch: học kỳ 2 năm học 2025–2026)");
    expect(user).not.toMatch(/HK\d{3}/);
  });

  it("sanitizes names taken from the database", () => {
    expect(input.user).toContain("Kỹ sư phần mềm 'thử nghiệm'");
    expect(input.user).not.toContain("<|");
    expect(input.user).not.toContain('"');
  });

  it("stays far below the ~10K token budget for a small result", () => {
    expect(input.system.length + input.user.length).toBeLessThan(30_000);
  });
});

describe("buildPromptContext", () => {
  it("keeps strengths and improvements apart from each other and from missing evidence", () => {
    const result = syntheticResult();
    // A Khá skill below a Bắt buộc threshold is an improvement, never a strength.
    result.skills[1] = { ...result.skills[1]!, score: 73, level: "good", levelLabel: "Khá" };
    result.career!.requirements[1] = { ...result.career!.requirements[1]!, isRequired: true, threshold: 85, score: 73, status: "below" };
    const context = buildPromptContext(result);
    expect(context.strengthKeys).toEqual(["S01"]);
    expect(context.improvementKeys).toEqual(["S02", "S03"]);
    // S04 has no evidence and S05 no data: neither list.
    for (const key of ["S04", "S05"]) {
      expect(context.strengthKeys).not.toContain(key);
      expect(context.improvementKeys).not.toContain(key);
    }
  });

  it("collects group keys, sent skill keys and gap candidates with their own courses", () => {
    expect(buildPromptContext(syntheticResult())).toEqual({
      groupKeys: ["G1", "G2"],
      skillKeys: ["S01", "S02", "S03", "S05", "S04"],
      strengthKeys: ["S01", "S02"],
      improvementKeys: ["S03"],
      gapSkills: [{ key: "S03", courseCodes: ["TST201", "TST202"] }, { key: "S05", courseCodes: [] }]
    });
  });

  it("has no gap candidates when no career is selected", () => {
    const result = syntheticResult();
    result.career = null;
    result.selfStudy = [];
    const input = buildAiInput(result);
    expect(buildPromptContext(result).gapSkills).toEqual([]);
    expect(input.user).toContain("Bạn chưa chọn nghề mục tiêu.");
  });
});
