// Synthetic career data for the AI suggestion tests (no real catalog or student data).
import type { CareerSuggestionSource } from "./prompt.js";

export const fixtureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function careerSource(overrides: Partial<CareerSuggestionSource> = {}): CareerSuggestionSource {
  return {
    career: {
      code: "15",
      nameVi: "Chuyên viên phân tích dữ liệu",
      nameEn: "Data Analyst",
      description: "Thu thập, làm sạch và phân tích dữ liệu để hỗ trợ ra quyết định.",
      fieldName: "Dữ liệu & Trí tuệ nhân tạo",
      fieldDescription: "Các vị trí làm việc với dữ liệu"
    },
    otherRequirements: ["Có khả năng làm việc nhóm"],
    linkedSkills: [{ id: fixtureId(1), name: "Python", isRequired: true }],
    catalog: [
      { id: fixtureId(1), name: "Python", description: "Ngôn ngữ lập trình" },
      { id: fixtureId(2), name: "SQL", description: "Truy vấn cơ sở dữ liệu quan hệ" },
      { id: fixtureId(3), name: "Trực quan hóa dữ liệu", description: "x".repeat(300) },
      { id: fixtureId(4), name: "Rèn luyện thể chất", description: "" }
    ],
    ...overrides
  };
}
