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
    expect(PROMPT_VERSION).toBe("comp-v4");
    expect(input.promptVersion).toBe("comp-v4");
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

  it("asks for concrete course advice and no graduation comments (comp-v4)", () => {
    const system = input.system;
    expect(system).toContain("Lời khuyên cụ thể (bắt buộc):");
    expect(system).toContain('9. Không viết câu chung chung như "nền tảng yếu", "cần tập trung", "cần chú ý cải thiện", "nên xem xét các học phần liên quan" mà không kèm việc cụ thể.');
    expect(system).toContain("10. Mỗi mục improvements và mỗi bước nextSteps phải nêu tên một học phần cụ thể (học mới, học lại, học cải thiện hoặc ôn lại nội dung của học phần đã học) lấy từ danh sách gợi ý của đúng kỹ năng đó; chỉ khi kỹ năng không có học phần nào mới gợi ý tự học kèm một sản phẩm cụ thể để kiểm chứng.");
    expect(system).toContain('11. Nếu học phần "chưa đủ điều kiện", nói rõ cần đạt học phần tiên quyết nào trước.');
    expect(system).toContain('Học phần đã đạt thì nói "học cải thiện" hoặc "ôn lại", không nói "học mới".');
    expect(system).toContain("12. groupInsights cho nhóm dưới mức Khá: nêu tên 1–2 kỹ năng thấp nhất của nhóm và học phần nên làm.");
    expect(system).toContain("13. Không nhận xét về điều kiện xét tốt nghiệp (trang Điều kiện xét tốt nghiệp đã có kết quả và lời khuyên riêng); progress chỉ nói về tiến độ so với kế hoạch đào tạo.");
    expect(system).toContain("courses: tối đa 2 mục { courseCode: mã trong danh sách của đúng kỹ năng đó ở mục [6]");
    expect(system).toContain("- progress: tối đa 500 ký tự, chỉ về tiến độ so với kế hoạch đào tạo (mục [8]); không nhận xét về xét tốt nghiệp.");
    expect(system).not.toContain("kế hoạch đào tạo và xét tốt nghiệp");
  });

  it("sends the fixed Ollama options", () => {
    expect(input.options).toEqual({ num_ctx: 16384, num_predict: 4096, temperature: 0.4, top_p: 0.95, top_k: 64 });
    expect(AI_OPTIONS.num_ctx).toBe(16384);
  });

  it("renders a delimited data block with every section and the job's keys", () => {
    const user = input.user;
    expect(user.startsWith("=== BẮT ĐẦU DỮ LIỆU")).toBe(true);
    expect(user).toContain("=== KẾT THÚC DỮ LIỆU ===");
    const sections = ["[1. HỒ SƠ]", "[2. ĐIỂM TỔNG", "[3. KỸ NĂNG]", "[4. NGHỀ MỤC TIÊU]", "[5. ỨNG VIÊN", "[6. KỸ NĂNG CẦN CẢI THIỆN", "[7. KỸ NĂNG CẦN TỰ HỌC", "[8. TIẾN ĐỘ", "[9. CẢNH BÁO"];
    for (const section of sections) expect(user).toContain(section);
    expect(sections.map((section) => user.indexOf(section))).toEqual(sections.map((section) => user.indexOf(section)).sort((a, b) => a - b));
    expect(user).toContain("S01 | Lập trình hướng đối tượng | nhóm G1 | điểm 88 | Thành thạo");
    expect(user).toContain("S05 | Điện toán đám mây | Chưa đủ dữ liệu");
    expect(user).toContain("  - TST202 | Đảm bảo chất lượng phần mềm | 3 TC | chưa học | chưa đủ điều kiện: cần đạt trước Kiểm thử phần mềm cơ bản (TST201) | kế hoạch: học kỳ 2 năm học 2026–2027\n");
    expect(user).toContain("thiếu 30 (Thiếu nhiều)");
    expect(user).toContain("Ảnh hưởng: Điểm kỹ năng có thể thấp hơn thực tế.");
    expect(user).toContain("Có thể nêu là điểm mạnh: S01, S02");
    expect(user).toContain("Có thể nêu là cần cải thiện: S03, S07, S06");
  });

  it("lists the courses of every improvement in plain words (comp-v4)", () => {
    const section = input.user.split("[6. KỸ NĂNG CẦN CẢI THIỆN VÀ HỌC PHẦN GỢI Ý]")[1]!.split("[7.")[0]!;
    expect(section).toContain([
      "S06 Mạng máy tính:",
      "  - TST310 | Quản trị mạng | 3 TC | chưa học | chưa đủ điều kiện: cần đạt trước Hệ điều hành (TST210) | kế hoạch: học kỳ 2 năm học 2026–2027",
      // Planned before the latest graded term (học kỳ 3 năm học 2025–2026): overdue.
      "  - TST150 | Toán rời rạc | 3 TC | chưa đạt – cần học lại | đủ điều kiện đăng ký | kế hoạch: học kỳ 2 năm học 2025–2026 (đã qua)",
      "  - TST120 | Mạng máy tính căn bản | 3 TC | đã đạt, điểm 6,5 (C+) – có thể học cải thiện"
    ].join("\n"));
    expect(section).toContain("S07 Sử dụng tiếng Anh:\n  (không có học phần phù hợp; gợi ý tự học kèm sản phẩm kiểm chứng)");
    // A career gap that is also an improvement lists its career courses again.
    expect(section).toContain("S03 Kiểm thử phần mềm:\n  - TST201 | Kiểm thử phần mềm cơ bản | 3 TC | chưa học | đủ điều kiện đăng ký | kế hoạch: học kỳ 1 năm học 2026–2027");
    const none = syntheticResult();
    none.skillPlans = [];
    none.career = null;
    expect(buildAiInput(none).user).toContain("[6. KỸ NĂNG CẦN CẢI THIỆN VÀ HỌC PHẦN GỢI Ý] (dùng cho improvements; chỉ chọn học phần trong danh sách của đúng kỹ năng)\nKhông có kỹ năng nào cần cải thiện.");
  });

  it("words ongoing courses, unconfirmed or prior conditions and unscheduled terms", () => {
    const result = syntheticResult();
    const plan = result.skillPlans[1]!;
    plan.take = [
      { ...plan.take[0]!, code: "TST401", name: "Lập trình mạng", eligibility: "review", eligibilityLabel: "Cần xác nhận", missing: [], term: null, termLabel: "Chưa xếp lịch" },
      { ...plan.take[0]!, code: "TST402", name: "An ninh mạng", missing: [{ code: "TST210", name: "Hệ điều hành", kind: "prior" }, { code: "TST499", name: null, kind: "prerequisite" }] },
      { ...plan.take[0]!, code: "TST403", name: "Điện toán phân tán", state: "in_progress", eligibility: "eligible", eligibilityLabel: "Đủ điều kiện", missing: [] },
      { ...plan.take[0]!, code: "TST404", name: "Mạng không dây", state: "graded_unknown", eligibility: "eligible", eligibilityLabel: "Đủ điều kiện", missing: [], term: "HK253" }
    ];
    const user = buildAiInput(result).user;
    expect(user).toContain("  - TST401 | Lập trình mạng | 3 TC | chưa học | cần xác nhận điều kiện với Khoa | chưa xếp lịch\n");
    expect(user).toContain("  - TST402 | An ninh mạng | 3 TC | chưa học | chưa đủ điều kiện: cần đạt trước học phần TST499; cần học trước Hệ điều hành (TST210) | kế hoạch: học kỳ 2 năm học 2026–2027\n");
    expect(user).toContain("  - TST403 | Điện toán phân tán | 3 TC | đang học\n");
    expect(user).toContain("  - TST404 | Mạng không dây | 3 TC | đã có điểm, chưa rõ kết quả | đủ điều kiện đăng ký | kế hoạch: học kỳ 3 năm học 2025–2026 (đã qua)\n");
  });

  it("names the weakest skills of each group below Khá", () => {
    expect(input.user).toContain("G2 | Kỹ năng bổ trợ | điểm 55 | Cơ bản | tin cậy Thấp | 1/2 kỹ năng có minh chứng\n  kỹ năng thấp nhất của nhóm: S03 Kiểm thử phần mềm (điểm 55); S06 Mạng máy tính (điểm 65)\n");
    // G1 is at Khá: no line, although Sử dụng tiếng Anh (61) belongs to it.
    expect(input.user).toContain("G1 | Kỹ thuật phần mềm | điểm 80 | Khá | tin cậy Trung bình | 2/2 kỹ năng có minh chứng\nG2 |");
  });

  it("no longer sends the graduation check (the graduation page has its own result and advice)", () => {
    const result = syntheticResult();
    result.meta.graduationStandardVersion = 4;
    result.graduation = {
      ...result.graduation, resolution: "specialty", status: "fail", statusLabel: "Chưa đủ điều kiện xét tốt nghiệp", reason: null,
      credits: { lower: 117, upper: 117, required: 126, status: "fail", source: "printed" },
      gpa: { actual: 3.11, required: 2, scale: 4, status: "pass", source: "printed", reason: "" },
      groups: [{ groupId: "row-10", label: "Học phần bắt buộc", kind: "mandatory", code: null, unit: "môn", lower: 31, upper: 31, required: 34, status: "fail", accumulatedCredits: 90, curriculumElectiveCode: null }],
      needsImprovement: true
    };
    const user = buildAiInput(result).user;
    for (const text of ["XÉT TỐT NGHIỆP", "Kết quả tham khảo", "Tín chỉ tích lũy", "Điểm trung bình tích lũy", "Chưa đủ điều kiện xét tốt nghiệp", "Học phần bắt buộc", "điểm trung bình chưa đạt"]) {
      expect(user).not.toContain(text);
    }
    // Neither credits, GPA nor group counts reach the model, so the validator also rejects them in its text.
    for (const value of [117, 126, 3.11, 31, 34]) expect(numbersIn(user)).not.toContain(value);
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
    expect(context.improvementKeys).toEqual(["S02", "S03", "S07", "S06"]);
    expect(context.improvementSkills[0]).toEqual({ key: "S02", courseCodes: [] });
    // S04 has no evidence and S05 no data: neither list.
    for (const key of ["S04", "S05"]) {
      expect(context.strengthKeys).not.toContain(key);
      expect(context.improvementKeys).not.toContain(key);
    }
  });

  it("collects group keys, sent skill keys, improvement and gap candidates with their own courses", () => {
    expect(buildPromptContext(syntheticResult())).toEqual({
      groupKeys: ["G1", "G2"],
      // Career skills, top/bottom of the rest, then the skills with a course plan (comp-v4).
      skillKeys: ["S01", "S02", "S03", "S05", "S04", "S07", "S06"],
      strengthKeys: ["S01", "S02"],
      improvementKeys: ["S03", "S07", "S06"],
      // Career gap courses; a plan without any course; plan take courses, then the one to improve.
      improvementSkills: [
        { key: "S03", courseCodes: ["TST201", "TST202"] }, { key: "S07", courseCodes: [] }, { key: "S06", courseCodes: ["TST310", "TST150", "TST120"] }
      ],
      gapSkills: [{ key: "S03", courseCodes: ["TST201", "TST202"] }, { key: "S05", courseCodes: [] }]
    });
  });

  it("offers only improvements with a course plan or a career gap, so each one can name its courses", () => {
    const result = syntheticResult();
    // S06 keeps no plan (e.g. beyond MAX_SKILL_PLANS) but is still sent as the weakest of its group.
    result.skillPlans = result.skillPlans.filter((plan) => plan.skillKey !== "S06");
    const context = buildPromptContext(result);
    expect(context.skillKeys).toContain("S06");
    expect(context.improvementKeys).toEqual(["S03", "S07"]);
    expect(context.strengthKeys).not.toContain("S06");
  });

  it("keeps the comp-v3 improvements for a result stored before skill plans (comp-calc-v6)", () => {
    const result = syntheticResult();
    delete (result as Partial<typeof result>).skillPlans;
    const context = buildPromptContext(result);
    // S06 is sent as the weakest of its group; S07 (in a Khá group, no plan) is not sent at all.
    expect(context.skillKeys).toEqual(["S01", "S02", "S03", "S05", "S04", "S06"]);
    expect(context.improvementSkills).toEqual([{ key: "S03", courseCodes: ["TST201", "TST202"] }, { key: "S06", courseCodes: [] }]);
    // Without plans it is unknown whether a course exists, so the line does not claim there is none.
    expect(buildAiInput(result).user).toContain("S06 Mạng máy tính:\n  (chưa có danh sách học phần gợi ý; có thể gợi ý ôn lại học phần minh chứng ở mục [3])\n");
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
