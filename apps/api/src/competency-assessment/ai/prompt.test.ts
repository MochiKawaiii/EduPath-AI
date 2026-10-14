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
  const noCareer = buildAiInput(syntheticResult({ career: false }));
  /** One data block section, from its heading to the next one. */
  const sectionOf = (user: string, heading: string) => {
    const start = user.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    return user.slice(start).split("\n\n[")[0]!;
  };

  it("uses the spec system prompt verbatim plus the output description", () => {
    expect(PROMPT_VERSION).toBe("comp-v5");
    expect(input.promptVersion).toBe("comp-v5");
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
    expect(noCareer.system).toBe(SYSTEM_PROMPT);
  });

  it("asks for concrete course advice, only about the target career, and no graduation comments (comp-v4, comp-v5)", () => {
    const system = input.system;
    expect(system).toContain("Lời khuyên cụ thể (bắt buộc):");
    expect(system).toContain('9. Không viết câu chung chung như "nền tảng yếu", "cần tập trung", "cần chú ý cải thiện", "nên xem xét các học phần liên quan" mà không kèm việc cụ thể.');
    expect(system).toContain("10. Mỗi mục improvements và mỗi bước nextSteps phải nêu tên một học phần cụ thể (học mới, học lại, học cải thiện hoặc ôn lại nội dung của học phần đã học) lấy từ danh sách gợi ý của đúng kỹ năng đó; chỉ khi kỹ năng không có học phần nào mới gợi ý tự học kèm một sản phẩm cụ thể để kiểm chứng.");
    expect(system).toContain('11. Nếu học phần "chưa đủ điều kiện", nói rõ cần đạt học phần tiên quyết nào trước.');
    expect(system).toContain('Học phần đã đạt thì nói "học cải thiện" hoặc "ôn lại", không nói "học mới".');
    expect(system).toContain("12. Khi sinh viên đã chọn nghề mục tiêu, improvements và nextSteps chỉ nói về kỹ năng của nghề đó (mục [4] và [6]). Không khuyên học lại, học cải thiện hay ôn lại cho kỹ năng không thuộc nghề mục tiêu (ví dụ kỹ năng mạng khi nghề là kỹ sư phần mềm).");
    expect(system).toContain("13. Khi mọi kỹ năng của nghề đã đạt ngưỡng: khuyên nâng các kỹ năng nghề chưa đạt mức Thành thạo bằng học phần trong mục [6], hoặc một sản phẩm, dự án cụ thể gắn với nghề khi không còn học phần.");
    expect(system).toContain("14. groupInsights cho nhóm dưới mức Khá: nêu tên 1–2 kỹ năng thấp nhất của nhóm; nếu kỹ năng đó không thuộc nghề mục tiêu thì nói rõ là ngoài yêu cầu của nghề và không đề xuất học lại hay học cải thiện;");
    expect(system).toContain("15. Không nhận xét về điều kiện xét tốt nghiệp (trang Điều kiện xét tốt nghiệp đã có kết quả và lời khuyên riêng); progress chỉ nói về tiến độ so với kế hoạch đào tạo.");
    expect(system).toContain("- summary: 2–3 câu tổng quan, tối đa 600 ký tự; nếu đã chọn nghề, nêu tình trạng so với nghề mục tiêu;");
    expect(system).toContain("về điểm mạnh, ưu tiên kỹ năng của nghề mục tiêu;");
    expect(system).toContain("courses: tối đa 2 mục { courseCode: mã trong danh sách của đúng kỹ năng đó ở mục [6]");
    expect(system).toContain("(khi đã chọn nghề, đó chỉ là kỹ năng của nghề: dưới ngưỡng, hoặc đã đạt ngưỡng nhưng chưa Thành thạo)");
    expect(system).toContain("- progress: tối đa 500 ký tự, chỉ về tiến độ so với kế hoạch đào tạo (mục [8]); không nhận xét về xét tốt nghiệp.");
    expect(system).not.toContain("kế hoạch đào tạo và xét tốt nghiệp");
  });

  it("sends the fixed Ollama options", () => {
    expect(input.options).toEqual({ num_ctx: 16384, num_predict: 4096, temperature: 0.4, top_p: 0.95, top_k: 64 });
    expect(AI_OPTIONS.num_ctx).toBe(16384);
  });

  it("renders a delimited data block with every section and the job's keys", () => {
    for (const [user, sixth] of [[input.user, "[6. KỸ NĂNG CỦA NGHỀ MỤC TIÊU"], [noCareer.user, "[6. KỸ NĂNG DƯỚI MỨC KHÁ"]] as const) {
      expect(user.startsWith("=== BẮT ĐẦU DỮ LIỆU")).toBe(true);
      expect(user).toContain("=== KẾT THÚC DỮ LIỆU ===");
      const sections = ["[1. HỒ SƠ]", "[2. ĐIỂM TỔNG", "[3. KỸ NĂNG]", "[4. NGHỀ MỤC TIÊU]", "[5. ỨNG VIÊN", sixth, "[7. KỸ NĂNG CẦN TỰ HỌC", "[8. TIẾN ĐỘ", "[9. CẢNH BÁO"];
      for (const section of sections) expect(user).toContain(section);
      expect(sections.map((section) => user.indexOf(section))).toEqual(sections.map((section) => user.indexOf(section)).sort((a, b) => a - b));
    }
    const user = input.user;
    expect(user).toContain("S01 | Lập trình hướng đối tượng | nhóm G1 | thuộc nghề mục tiêu | điểm 88 | Thành thạo");
    expect(user).toContain("S04 | Làm việc nhóm | nhóm G2 | ngoài nghề mục tiêu | Chưa có minh chứng");
    expect(user).toContain("S05 | Điện toán đám mây | Chưa đủ dữ liệu");
    expect(user).toContain("  - TST202 | Đảm bảo chất lượng phần mềm | 3 TC | chưa học | chưa đủ điều kiện: cần đạt trước Kiểm thử phần mềm cơ bản (TST201) | kế hoạch: học kỳ 2 năm học 2026–2027\n");
    expect(user).toContain("thiếu 30 (Thiếu nhiều)");
    expect(user).toContain("Ảnh hưởng: Điểm kỹ năng có thể thấp hơn thực tế.");
    expect(user).toContain("Có thể nêu là điểm mạnh: S01\n");
    expect(user).toContain("Có thể nêu là cần cải thiện: S02, S03\n");
    expect(noCareer.user).toContain("S01 | Lập trình hướng đối tượng | nhóm G1 | điểm 88 | Thành thạo");
    expect(noCareer.user).toContain("Có thể nêu là điểm mạnh: S01, S02\n");
    expect(noCareer.user).toContain("Có thể nêu là cần cải thiện: S06, S07, S03\n");
  });

  it("with a career, offers only its skills: below its threshold, or met and still below Thành thạo (comp-v5)", () => {
    const sixth = sectionOf(input.user, "[6. ");
    expect(sixth).toBe([
      "[6. KỸ NĂNG CỦA NGHỀ MỤC TIÊU CẦN CẢI THIỆN HOẶC NÂNG LÊN VÀ HỌC PHẦN GỢI Ý] (dùng cho improvements; chỉ chọn học phần trong danh sách của đúng kỹ năng)",
      "S02 Cơ sở dữ liệu (kỹ năng của nghề mục tiêu đã đạt ngưỡng, có thể nâng lên mức Thành thạo):",
      "  - TST240 | Hệ quản trị cơ sở dữ liệu | 3 TC | chưa học | đủ điều kiện đăng ký | kế hoạch: học kỳ 1 năm học 2026–2027",
      "  - TST130 | Nhập môn cơ sở dữ liệu | 3 TC | đã đạt, điểm 6,8 (C+) – có thể học cải thiện",
      "S03 Kiểm thử phần mềm (kỹ năng của nghề mục tiêu dưới ngưỡng):",
      "  - TST201 | Kiểm thử phần mềm cơ bản | 3 TC | chưa học | đủ điều kiện đăng ký | kế hoạch: học kỳ 1 năm học 2026–2027",
      "  - TST202 | Đảm bảo chất lượng phần mềm | 3 TC | chưa học | chưa đủ điều kiện: cần đạt trước Kiểm thử phần mềm cơ bản (TST201) | kế hoạch: học kỳ 2 năm học 2026–2027"
    ].join("\n"));
    // Mạng máy tính and Sử dụng tiếng Anh are below Khá but outside the career: context only, no courses at all.
    for (const text of ["S06 |", "S07 |", "TST120", "TST310"]) expect(input.user).not.toContain(text);
    const selfStudy = syntheticResult();
    selfStudy.skillPlans[0] = { ...selfStudy.skillPlans[0]!, take: [], improve: [], selfStudy: true };
    expect(buildAiInput(selfStudy).user).toContain("S02 Cơ sở dữ liệu (kỹ năng của nghề mục tiêu đã đạt ngưỡng, có thể nâng lên mức Thành thạo):\n" +
      "  (không còn học phần phù hợp; gợi ý một sản phẩm hoặc dự án cụ thể gắn với nghề mục tiêu để kiểm chứng)\n");
    const none = syntheticResult();
    none.skillPlans = [];
    none.career!.requirements = none.career!.requirements.filter((req) => req.status !== "below");
    expect(sectionOf(buildAiInput(none).user, "[6. ")).toContain("\nKhông có kỹ năng nào của nghề mục tiêu cần cải thiện hoặc nâng lên.");
  });

  it("without a career, offers the skills below Khá to strengthen, in plain words (comp-v4)", () => {
    expect(sectionOf(noCareer.user, "[6. ")).toBe([
      "[6. KỸ NĂNG DƯỚI MỨC KHÁ VÀ HỌC PHẦN GỢI Ý] (dùng cho improvements; chỉ chọn học phần trong danh sách của đúng kỹ năng)",
      "S06 Mạng máy tính (dưới mức Khá):",
      "  - TST310 | Quản trị mạng | 3 TC | chưa học | chưa đủ điều kiện: cần đạt trước Hệ điều hành (TST210) | kế hoạch: học kỳ 2 năm học 2026–2027",
      // Planned before the latest graded term (học kỳ 3 năm học 2025–2026): overdue.
      "  - TST150 | Toán rời rạc | 3 TC | chưa đạt – cần học lại | đủ điều kiện đăng ký | kế hoạch: học kỳ 2 năm học 2025–2026 (đã qua)",
      "  - TST120 | Mạng máy tính căn bản | 3 TC | đã đạt, điểm 6,5 (C+) – có thể học cải thiện",
      "S07 Sử dụng tiếng Anh (dưới mức Khá):",
      "  (không có học phần phù hợp; gợi ý tự học kèm sản phẩm kiểm chứng)",
      "S03 Kiểm thử phần mềm (dưới mức Khá):",
      "  - TST201 | Kiểm thử phần mềm cơ bản | 3 TC | chưa học | đủ điều kiện đăng ký | kế hoạch: học kỳ 1 năm học 2026–2027",
      "  - TST202 | Đảm bảo chất lượng phần mềm | 3 TC | chưa học | chưa đủ điều kiện: cần đạt trước Kiểm thử phần mềm cơ bản (TST201) | kế hoạch: học kỳ 2 năm học 2026–2027"
    ].join("\n"));
    const none = syntheticResult({ career: false });
    none.skillPlans = [];
    expect(sectionOf(buildAiInput(none).user, "[6. ")).toContain("\nKhông có kỹ năng nào cần cải thiện.");
  });

  it("words ongoing courses, unconfirmed or prior conditions and unscheduled terms", () => {
    const result = syntheticResult();
    const plan = result.skillPlans[0]!;
    const take = plan.take[0]!;
    plan.take = [
      { ...take, code: "TST401", name: "Cơ sở dữ liệu phân tán", eligibility: "review", eligibilityLabel: "Cần xác nhận", term: null, termLabel: "Chưa xếp lịch" },
      { ...take, code: "TST402", name: "Kho dữ liệu", eligibility: "not_eligible", eligibilityLabel: "Chưa đủ điều kiện", missing: [{ code: "TST210", name: "Hệ điều hành", kind: "prior" }, { code: "TST499", name: null, kind: "prerequisite" }] },
      { ...take, code: "TST403", name: "Khai phá dữ liệu", state: "in_progress" },
      { ...take, code: "TST404", name: "Dữ liệu lớn", state: "graded_unknown", term: "HK253" }
    ];
    const user = buildAiInput(result).user;
    expect(user).toContain("  - TST401 | Cơ sở dữ liệu phân tán | 3 TC | chưa học | cần xác nhận điều kiện với Khoa | chưa xếp lịch\n");
    expect(user).toContain("  - TST402 | Kho dữ liệu | 3 TC | chưa học | chưa đủ điều kiện: cần đạt trước học phần TST499; cần học trước Hệ điều hành (TST210) | kế hoạch: học kỳ 1 năm học 2026–2027\n");
    expect(user).toContain("  - TST403 | Khai phá dữ liệu | 3 TC | đang học\n");
    expect(user).toContain("  - TST404 | Dữ liệu lớn | 3 TC | đã có điểm, chưa rõ kết quả | đủ điều kiện đăng ký | kế hoạch: học kỳ 3 năm học 2025–2026 (đã qua)\n");
  });

  it("names the weakest skills of each group below Khá and, with a career, whether each belongs to it", () => {
    expect(input.user).toContain("G2 | Kỹ năng bổ trợ | điểm 55 | Cơ bản | tin cậy Thấp | 1/2 kỹ năng có minh chứng\n" +
      "  kỹ năng thấp nhất của nhóm: S03 Kiểm thử phần mềm (điểm 55, thuộc nghề mục tiêu); S06 Mạng máy tính (điểm 65, ngoài nghề mục tiêu)\n");
    expect(noCareer.user).toContain("  kỹ năng thấp nhất của nhóm: S03 Kiểm thử phần mềm (điểm 55); S06 Mạng máy tính (điểm 65)\n");
    // G1 is at Khá: no line, although Sử dụng tiếng Anh (61) belongs to it.
    expect(input.user).toContain("G1 | Kỹ thuật phần mềm | điểm 80 | Khá | tin cậy Trung bình | 2/2 kỹ năng có minh chứng\nG2 |");
  });

  it("does not list thesis replacements off that path as courses to come (comp-calc-v7)", () => {
    const result = syntheticResult();
    result.courses.push({ ...result.courses.find((course) => course.code === "TST240")!, code: "TST405", name: "Chuyên đề tốt nghiệp", electiveGroup: "TC406" });
    result.skills[1] = {
      ...result.skills[1]!,
      evidenceCourses: [
        { code: "TST101", weight: 0.5, contribution: 1.5, share: 0.5, role: "score" },
        { code: "TST405", weight: 1, contribution: 3, share: null, role: "planned" },
        { code: "TST240", weight: 1, contribution: 3, share: 0.5, role: "planned" }
      ]
    };
    result.excludedThesisReplacements = ["TST405"];
    const line = (value: typeof result) => buildAiInput(value).user.split("\n").find((text) => text.startsWith("S02 |"))!;
    expect(line(result)).toContain("| sắp học (chưa phải minh chứng): TST240 Hệ quản trị cơ sở dữ liệu (sắp học vào học kỳ 1 năm học 2026–2027)");
    expect(line(result)).not.toContain("TST405");
    // A result stored before comp-calc-v7 has no such list.
    delete (result as Partial<typeof result>).excludedThesisReplacements;
    expect(line(result)).toContain("TST405 Chuyên đề tốt nghiệp");
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
    expect(user).toContain("S01 | Lập trình hướng đối tượng | nhóm G1 | thuộc nghề mục tiêu | điểm 93 | Thành thạo | tin cậy Trung bình | độ phủ 46%");
    expect(user).toContain("ngưỡng 85 | điểm 75 | Thấp hơn ngưỡng | thiếu 10 (Thiếu nhiều)");
    for (const shown of [83.92, 89.56, 93.44, 75.56, 9.44, 45.67]) expect(numbersIn(user)).not.toContain(shown);
    // Course scores stay on the 10-point scale with up to two decimals, like the page.
    expect(user).toContain("TST101 Nhập môn lập trình (điểm 8,5, A)");
    expect(user).toContain("Học kỳ gần nhất có điểm: học kỳ 3 năm học 2025–2026");
    expect(user).toContain("Học kỳ hiện tại: học kỳ 3 năm học 2025–2026; học kỳ kế tiếp: học kỳ 1 năm học 2026–2027");
    expect(user).toContain("- trễ: TST150 Toán rời rạc (kế hoạch: học kỳ 2 năm học 2025–2026)");
    for (const user of [input.user, noCareer.user]) expect(user).not.toMatch(/HK\d{3}/);
  });

  it("sanitizes names taken from the database", () => {
    expect(input.user).toContain("Kỹ sư phần mềm 'thử nghiệm'");
    expect(input.user).not.toContain("<|");
    expect(input.user).not.toContain('"');
  });

  it("stays far below the ~10K token budget for a small result", () => {
    for (const built of [input, noCareer]) expect(built.system.length + built.user.length).toBeLessThan(30_000);
  });
});

describe("buildPromptContext", () => {
  it("with a career: improvements are its skills below the threshold or with a plan to deepen, never strengths (comp-v5)", () => {
    expect(buildPromptContext(syntheticResult())).toEqual({
      groupKeys: ["G1", "G2"],
      // Career skills, then the top/bottom of the rest; the weak skills outside the career are not added.
      skillKeys: ["S01", "S02", "S03", "S05", "S04"],
      // Cơ sở dữ liệu (72,5, met) is to deepen, so it is no strength.
      strengthKeys: ["S01"],
      improvementKeys: ["S02", "S03"],
      improvementSkills: [{ key: "S02", courseCodes: ["TST240", "TST130"] }, { key: "S03", courseCodes: ["TST201", "TST202"] }],
      gapSkills: [{ key: "S03", courseCodes: ["TST201", "TST202"] }, { key: "S05", courseCodes: [] }]
    });
  });

  it("with a career never offers a skill outside it, even one sent as context or with a comp-calc-v6 plan", () => {
    const result = syntheticResult();
    // Mạng máy tính sent among the weakest other skills, with a plan stored by comp-calc-v6 (no purpose).
    result.promptSelection.bottomSkillKeys = ["S06"];
    const old = { ...syntheticResult({ career: false }).skillPlans[2]! };
    delete (old as Partial<typeof old>).purpose;
    result.skillPlans.push(old);
    const context = buildPromptContext(result);
    expect(context.skillKeys).toContain("S06");
    expect(context.improvementKeys).toEqual(["S02", "S03"]);
    expect(context.strengthKeys).toEqual(["S01"]);
    const user = buildAiInput(result).user;
    expect(user).toContain("S06 | Mạng máy tính | nhóm G2 | ngoài nghề mục tiêu | điểm 65 | Cơ bản");
    expect(user).not.toContain("TST310");
  });

  it("keeps strengths and improvements apart from each other and from missing evidence", () => {
    const result = syntheticResult();
    // A Khá skill below a Bắt buộc threshold is an improvement, never a strength.
    result.skillPlans = [];
    result.skills[1] = { ...result.skills[1]!, score: 73, level: "good", levelLabel: "Khá" };
    result.career!.requirements[1] = { ...result.career!.requirements[1]!, isRequired: true, threshold: 85, score: 73, status: "below" };
    const context = buildPromptContext(result);
    expect(context.strengthKeys).toEqual(["S01"]);
    expect(context.improvementKeys).toEqual(["S02", "S03"]);
    expect(context.improvementSkills[0]).toEqual({ key: "S02", courseCodes: [] });
    // S04 has no evidence and S05 no data: neither list.
    for (const key of ["S04", "S05"]) {
      expect(context.strengthKeys).not.toContain(key);
      expect(context.improvementKeys).not.toContain(key);
    }
  });

  it("without a career: improvements are the skills below Khá with a plan to strengthen (comp-v4)", () => {
    expect(buildPromptContext(syntheticResult({ career: false }))).toEqual({
      groupKeys: ["G1", "G2"],
      // The 5 strongest, the plans and the weakest of the groups below Khá (already among them).
      skillKeys: ["S01", "S02", "S06", "S07", "S03"],
      strengthKeys: ["S01", "S02"],
      improvementKeys: ["S06", "S07", "S03"],
      // Plan take courses, then the one to improve; a plan without any course.
      improvementSkills: [
        { key: "S06", courseCodes: ["TST310", "TST150", "TST120"] }, { key: "S07", courseCodes: [] }, { key: "S03", courseCodes: ["TST201", "TST202"] }
      ],
      gapSkills: []
    });
    // A skill below Khá without a plan (e.g. beyond MAX_SKILL_PLANS) is sent but not offered.
    const result = syntheticResult({ career: false });
    result.skillPlans = result.skillPlans.filter((plan) => plan.skillKey !== "S06");
    const context = buildPromptContext(result);
    expect(context.skillKeys).toContain("S06");
    expect(context.improvementKeys).toEqual(["S07", "S03"]);
    expect(context.strengthKeys).not.toContain("S06");
  });

  it("still renders a result stored before skill plans (comp-calc-v6)", () => {
    // Without a career: every sent skill below Khá (comp-v3), not claiming that no course exists.
    const plain = syntheticResult({ career: false });
    delete (plain as Partial<typeof plain>).skillPlans;
    const context = buildPromptContext(plain);
    expect(context.improvementSkills).toEqual([{ key: "S06", courseCodes: [] }, { key: "S07", courseCodes: [] }, { key: "S03", courseCodes: [] }]);
    expect(buildAiInput(plain).user).toContain("S06 Mạng máy tính (dưới mức Khá):\n  (chưa có danh sách học phần gợi ý; có thể gợi ý ôn lại học phần minh chứng ở mục [3])\n");
    // With a career: only its gap; its met Khá skill is a strength again.
    const career = syntheticResult();
    delete (career as Partial<typeof career>).skillPlans;
    expect(buildPromptContext(career)).toMatchObject({ strengthKeys: ["S01", "S02"], improvementKeys: ["S03"], improvementSkills: [{ key: "S03", courseCodes: ["TST201", "TST202"] }] });
  });

  it("has no gap candidates when no career is selected", () => {
    const input = buildAiInput(syntheticResult({ career: false }));
    expect(buildPromptContext(syntheticResult({ career: false })).gapSkills).toEqual([]);
    expect(input.user).toContain("Bạn chưa chọn nghề mục tiêu.");
  });
});
