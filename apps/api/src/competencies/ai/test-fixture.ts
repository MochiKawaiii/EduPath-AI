// Synthetic course, groups and catalog for the course AI tests (no real curriculum or student data).
import type { CourseAiSource, SkillAiSource } from "./prompt.js";

export const fixtureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const GROUP_CORE = fixtureId(1);
export const GROUP_SOFT = fixtureId(2);
export const SKILL_WEB = fixtureId(11);
export const SKILL_DB = fixtureId(12);
export const SKILL_TEAM = fixtureId(13);
export const SKILL_DOCKER = fixtureId(14);

export function courseSource(overrides: Partial<CourseAiSource> = {}): CourseAiSource {
  return {
    curriculum: { cohortCode: "K99", name: "CTĐT Công nghệ thông tin K99", version: 2 },
    course: {
      code: "71ITSE40103",
      name: "Lập trình web nâng cao",
      englishName: "Advanced Web Programming",
      description: "Xây dựng ứng dụng web nhiều tầng, làm việc với cơ sở dữ liệu và triển khai theo nhóm.",
      credits: 3,
      type: "BB",
      block: "Kiến thức chuyên ngành",
      specialty: "Công nghệ phần mềm",
      studyYear: 3,
      semester: 1,
      hours: { lecture: 30, practice: 30, project: 0, internship: null }
    },
    groups: [{ id: GROUP_SOFT, name: "Kỹ năng mềm" }, { id: GROUP_CORE, name: "Chuyên môn" }],
    profiles: [
      { id: SKILL_WEB, name: "Lập trình web", description: "Xây dựng giao diện và máy chủ web", groupId: GROUP_CORE },
      { id: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", description: "Mô hình hóa dữ liệu quan hệ", groupId: GROUP_CORE },
      { id: SKILL_TEAM, name: "Làm việc nhóm", description: "Phối hợp trong dự án", groupId: GROUP_SOFT }
    ],
    careerSkills: [{ id: SKILL_DOCKER, name: "Docker", description: "Đóng gói ứng dụng bằng container" }],
    links: [],
    ...overrides
  };
}

/** A small revision for "Thêm kỹ năng (AI)": one profile per group, two career skills without one. */
export const SKILL_GIT = fixtureId(15);
export function skillSource(overrides: Partial<SkillAiSource> = {}): SkillAiSource {
  return {
    curriculum: { cohortCode: "K99", name: "CTĐT Công nghệ thông tin K99", version: 2 },
    groups: [{ id: GROUP_SOFT, name: "Kỹ năng mềm" }, { id: GROUP_CORE, name: "Chuyên môn" }],
    existing: [{ name: "Lập trình web", groupId: GROUP_CORE }, { name: "Làm việc nhóm", groupId: GROUP_SOFT }],
    careerSkills: [
      { id: SKILL_GIT, name: "Git", description: "Quản lý phiên bản mã nguồn" },
      { id: SKILL_DOCKER, name: "Docker", description: "Đóng gói ứng dụng bằng container" }
    ],
    courses: [
      { code: "71ITSE40103", name: "Lập trình web nâng cao", block: "Kiến thức chuyên ngành", credits: 3, description: "Xây dựng ứng dụng web nhiều tầng." },
      { code: "71ITSE40203", name: "Phát triển phần mềm DevOps", block: "Kiến thức chuyên ngành", credits: 3, description: "" }
    ],
    ...overrides
  };
}
