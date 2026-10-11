import { describe, expect, it } from "vitest";
import { similarSkillNames, skillTokens } from "./similarity.js";

describe("skillTokens", () => {
  it("lowercases, splits on punctuation, keeps C# and C++ and drops stopwords and 'kỹ năng'", () => {
    expect([...skillTokens("Kỹ năng Truy vấn dữ liệu bằng SQL")]).toEqual(["truy", "vấn", "dữ", "liệu", "sql"]);
    expect([...skillTokens("Lập trình C#/C++ và C")]).toEqual(["lập", "trình", "c#", "c++", "c"]);
    expect([...skillTokens("Linux/Windows Server")]).toEqual(["linux", "windows", "server"]);
    expect([...skillTokens("ASP.NET Core (C#)")]).toEqual(["asp", "net", "core", "c#"]);
    expect([...skillTokens("Kĩ năng + và")]).toEqual([]);
    // Only the phrase is dropped: "kỹ" in "kỹ thuật" and "năng" in "hiệu năng" stay.
    expect([...skillTokens("Kỹ thuật kiểm thử hiệu năng")]).toEqual(["kỹ", "thuật", "kiểm", "thử", "hiệu", "năng"]);
    // NFD input is read the same as NFC.
    expect([...skillTokens("Thống kê".normalize("NFD"))]).toEqual(["thống", "kê"]);
  });
});

describe("similarSkillNames", () => {
  it.each([
    ["Giao tiếp", "Giao tiếp và thuyết trình"],
    ["SQL", "Truy vấn dữ liệu bằng SQL"],
    ["Python", "Lập trình Python"],
    ["Linux", "Linux/Windows Server"],
    ["Thống kê", "Phân tích thống kê"],
    ["Phân tích yêu cầu", "Phân tích và quản lý yêu cầu"],
    ["HTML/CSS", "Phát triển giao diện web (HTML/CSS/JavaScript)"],
    ["React", "Phát triển giao diện với React"],
    ["Kiểm thử phần mềm", "kiem thu phan mem"],
    // Not a subset, but 6 of 8 tokens shared (Jaccard 0.75).
    ["Lập trình máy chủ với Node.js/Express", "Lập trình máy chủ với Node.js/NestJS"],
    // Tone position does not matter ("hóa" = "hoá"), the tone itself does (see below).
    ["Trực quan hóa dữ liệu", "Trực quan hoá dữ liệu bằng Power BI"],
    ["C#", "Lập trình C#"],
    ["C++", "C/C++"],
    ["ASP.NET", "Phát triển web với ASP.NET Core"],
    ["OOP", "Lập trình hướng đối tượng (OOP)"],
    ["Kỹ năng giao tiếp", "Giao tiếp"]
  ])("%s ~ %s", (left, right) => {
    expect(similarSkillNames(left, right)).toBe(true);
    expect(similarSkillNames(right, left)).toBe(true);
  });

  it.each([
    ["Viết tài liệu", "Viết báo cáo"],
    ["Thiết kế cơ sở dữ liệu", "Lập trình với cơ sở dữ liệu"],
    ["Phân tích dữ liệu", "Phân tích thống kê"],
    ["Bảo mật hệ thống thông tin", "Bảo mật ứng dụng"],
    ["Tư duy thuật toán", "Tư duy phản biện và giải quyết vấn đề"],
    ["Git", "GitHub Actions"],
    ["C#", "C++"],
    ["C#", "C/C++"],
    ["Lập trình C", "Lập trình C#"],
    ["Node.js", "React.js"],
    ["Lập trình Java", "Lập trình JavaScript"],
    // Without tones these share every syllable: "thống kê" (statistics) vs "hệ thống", "thiết kế".
    ["Thống kê", "Phân tích và thiết kế hệ thống"],
    ["Phân tích thống kê", "Phân tích và thiết kế hệ thống"],
    ["Kỹ thuật", "Tư duy thuật toán"],
    // Siblings that share most syllables stay apart (Jaccard 0.67 and 0.71 are under the threshold).
    ["Phát triển ứng dụng Android", "Phát triển ứng dụng desktop"],
    ["Xây dựng mô hình học máy", "Xây dựng mô hình học sâu"],
    ["Quản trị mạng máy tính", "Quản trị mạng máy chủ"],
    ["Kỹ năng", "Giao tiếp"],
    ["", "SQL"]
  ])("%s ≁ %s", (left, right) => {
    expect(similarSkillNames(left, right)).toBe(false);
    expect(similarSkillNames(right, left)).toBe(false);
  });
});
