import { describe, expect, it } from "vitest";
import { buildCourseAiInput, buildSkillAiInput, COURSE_AI_PROMPT_VERSIONS, SKILL_AI_LIMITS } from "./prompt.js";
import { courseSource, GROUP_CORE, GROUP_SOFT, SKILL_DB, SKILL_DOCKER, SKILL_GIT, SKILL_TEAM, SKILL_WEB, skillSource } from "./test-fixture.js";

type Schema = { properties: Record<string, { maxItems?: number; items: { properties: Record<string, { enum?: string[]; type?: string }> } }> };

describe("course AI prompt", () => {
  it("offers profiles by group, then career skills without a profile, minus linked skills (links)", () => {
    const input = buildCourseAiInput(courseSource({ links: [{ skillId: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", groupId: GROUP_CORE, description: "", weight: 0.5 }] }), "links");
    expect(input.groups).toEqual([{ key: "G1", id: GROUP_CORE, name: "Chuyên môn" }, { key: "G2", id: GROUP_SOFT, name: "Kỹ năng mềm" }]);
    expect(input.skills).toEqual([
      { key: "S001", id: SKILL_WEB, name: "Lập trình web", groupId: GROUP_CORE },
      { key: "S002", id: SKILL_TEAM, name: "Làm việc nhóm", groupId: GROUP_SOFT },
      { key: "S003", id: SKILL_DOCKER, name: "Docker", groupId: null }
    ]);
    expect(input.linked).toEqual([{ id: SKILL_DB, name: "Thiết kế cơ sở dữ liệu" }]);
    expect(input.promptVersion).toBe(COURSE_AI_PROMPT_VERSIONS.links);
    expect(input.user).toContain("S003 | Docker | kỹ năng nghề, chưa có nhóm");
    expect(input.user).toContain("S001 | Lập trình web | Chuyên môn | Xây dựng giao diện và máy chủ web");
    expect(input.user).toContain("Mã: 71ITSE40103");
    expect(input.user).toContain("Số giờ: lý thuyết 30, thực hành 30");
    expect(input.user).toContain("- Thiết kế cơ sở dữ liệu");
    // The shared part comes before the course, so a whole-program run reuses one prompt prefix.
    expect(input.user.indexOf("[3. DANH MỤC KỸ NĂNG")).toBeLessThan(input.user.indexOf("[4. HỌC PHẦN"));
    const schema = input.schema as Schema;
    expect(schema.properties.links!.items.properties.skillKey!.enum).toEqual(["S001", "S002", "S003"]);
    expect(schema.properties.links!.items.properties.groupKey!.enum).toEqual(["G1", "G2"]);
    expect(schema.properties.links!.maxItems).toBe(3);
    expect(schema.properties.newSkills!.maxItems).toBe(2);
  });

  it("asks only for the linked skills in weights mode, with integer percents", () => {
    const input = buildCourseAiInput(courseSource({ links: [
      { skillId: SKILL_WEB, name: "Lập trình web", groupId: GROUP_CORE, description: "Web", weight: 0 },
      { skillId: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", groupId: GROUP_CORE, description: "CSDL", weight: 0 }
    ] }), "weights");
    expect(input.skills.map((entry) => entry.name)).toEqual(["Lập trình web", "Thiết kế cơ sở dữ liệu"]);
    expect(input.user).not.toContain("Docker");
    expect(input.user).toContain("[3. KỸ NĂNG ĐÃ LIÊN KẾT VỚI HỌC PHẦN]");
    const schema = input.schema as Schema;
    expect(schema.properties.weights!.items.properties.percent!.type).toBe("integer");
    expect(schema.properties.weights!.maxItems).toBe(2);
    expect(input.system).toContain("tổng percent của tất cả kỹ năng bằng đúng 100");
  });

  it("has no new skills in full mode and keeps student data out", () => {
    const input = buildCourseAiInput(courseSource(), "full");
    const schema = input.schema as Schema;
    expect(Object.keys(schema.properties)).toEqual(["links"]);
    expect(schema.properties.links!.items.properties.percent!.type).toBe("integer");
    expect(input.user).not.toMatch(/MSSV|họ tên|email/i);
    expect(input.user).toContain("=== KẾT THÚC DỮ LIỆU ===");
  });

  it("skills: offers the career skills without a profile, lists the catalog and every course", () => {
    const input = buildSkillAiInput(skillSource());
    expect(input.mode).toBe("skills");
    expect(input.promptVersion).toBe(COURSE_AI_PROMPT_VERSIONS.skills);
    expect(input.options.num_predict).toBe(3072);
    expect(input.options.num_ctx).toBe(16384);
    expect(input.skills).toEqual([
      { key: "S001", id: SKILL_DOCKER, name: "Docker", groupId: null },
      { key: "S002", id: SKILL_GIT, name: "Git", groupId: null }
    ]);
    expect(input.existing).toEqual(["Lập trình web", "Làm việc nhóm"]);
    expect(input.user).toContain("Chuyên môn: Lập trình web");
    expect(input.user).toContain("Kỹ năng mềm: Làm việc nhóm");
    expect(input.user).toContain("S002 | Git | Quản lý phiên bản mã nguồn");
    expect(input.user).toContain("- Lập trình web nâng cao | Kiến thức chuyên ngành | 3 | Xây dựng ứng dụng web nhiều tầng.");
    expect(input.user).toContain("- Phát triển phần mềm DevOps | Kiến thức chuyên ngành | 3");
    expect(input.user).not.toMatch(/MSSV|họ tên|email/i);
    const schema = input.schema as Schema;
    expect(schema.properties.links!.items.properties.skillKey!.enum).toEqual(["S001", "S002"]);
    expect(Object.keys(schema.properties.links!.items.properties)).toEqual(["skillKey", "groupKey", "scope", "reason"]);
    expect(Object.keys(schema.properties.newSkills!.items.properties)).toEqual(["name", "groupKey", "description", "scope", "reason"]);
    expect(schema.properties.links!.maxItems).toBe(2);
    expect(schema.properties.newSkills!.maxItems).toBe(SKILL_AI_LIMITS.newSkills);
  });

  it("skills: with no career skill left, links can hold nothing and the enum is never empty", () => {
    const input = buildSkillAiInput(skillSource({ careerSkills: [], existing: [] }));
    const schema = input.schema as Schema;
    expect(schema.properties.links!.maxItems).toBe(0);
    expect(schema.properties.links!.items.properties.skillKey!.enum).toBeUndefined();
    expect(schema.properties.links!.items.properties.skillKey!.type).toBe("string");
    expect(input.user).toContain("[3. KỸ NĂNG ĐÃ CÓ TRONG DANH MỤC] (không đề xuất lại)\nChưa có.");
    expect(input.user).toContain("[4. KỸ NĂNG NGHỀ NGHIỆP CHƯA ĐƯỢC ĐÁNH GIÁ] (khóa | tên | mô tả)\nKhông có.");
  });
});
