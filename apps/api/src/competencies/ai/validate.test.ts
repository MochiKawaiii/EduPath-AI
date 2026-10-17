import { describe, expect, it } from "vitest";
import { buildCourseAiInput, buildSkillAiInput } from "./prompt.js";
import { courseAiContextFromInput, normalizePercents, validateCourseAiOutput } from "./validate.js";
import { courseSource, GROUP_CORE, GROUP_SOFT, SKILL_DB, SKILL_DOCKER, SKILL_GIT, SKILL_TEAM, SKILL_WEB, skillSource } from "./test-fixture.js";

const contextFor = (mode: "links" | "weights" | "full", source = courseSource()) => {
  const context = courseAiContextFromInput(JSON.parse(JSON.stringify(buildCourseAiInput(source, mode))));
  if (!context) throw new Error("no context");
  return context;
};
const linkedSource = () => courseSource({ links: [
  { skillId: SKILL_WEB, name: "Lập trình web", groupId: GROUP_CORE, description: "", weight: 0 },
  { skillId: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", groupId: GROUP_CORE, description: "", weight: 0 },
  { skillId: SKILL_TEAM, name: "Làm việc nhóm", groupId: GROUP_SOFT, description: "", weight: 0 }
] });

describe("normalizePercents", () => {
  it("returns whole percents that add up to exactly 100", () => {
    expect(normalizePercents([50, 30, 20])).toEqual([50, 30, 20]);
    expect(normalizePercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(normalizePercents([60, 60])).toEqual([50, 50]);
    expect(normalizePercents([70, 20, 5])).toEqual([74, 21, 5]);
    expect(normalizePercents([0, 0])).toEqual([50, 50]);
    expect(normalizePercents([-5, 150, Number.NaN])).toEqual([0, 100, 0]);
    expect(normalizePercents([])).toEqual([]);
    for (const values of [[33.3, 33.3, 33.4], [7, 11, 13, 17], [99, 1, 1]]) {
      expect(normalizePercents(values).reduce((sum, value) => sum + value, 0)).toBe(100);
    }
  });
});

describe("validateCourseAiOutput", () => {
  it("links: keeps known keys once, never a linked skill, and names a career skill's group", () => {
    const context = contextFor("links", courseSource({ links: [{ skillId: SKILL_DB, name: "Thiết kế cơ sở dữ liệu", groupId: GROUP_CORE, description: "", weight: 1 }] }));
    const result = validateCourseAiOutput({
      links: [
        { skillKey: "S001", groupKey: "G2", reason: "Học phần xây dựng ứng dụng S001 hoàn chỉnh." },
        { skillKey: "S001", groupKey: "G1", reason: "lặp" },
        { skillKey: "S099", groupKey: "G1", reason: "không có" },
        { skillKey: "S003", groupKey: "G1", reason: "Đóng gói bản triển khai bằng container." }
      ],
      newSkills: [
        { name: "Kỹ năng  kiểm thử API", groupKey: "G1", reason: "Học phần có phần kiểm thử API." },
        { name: "thiết kế cơ sở dữ liệu", groupKey: "G1", reason: "đã liên kết" }
      ]
    }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.items).toEqual([
      // A profile keeps its own group whatever the model wrote; the key in prose became the name.
      { skillId: SKILL_WEB, skillName: "Lập trình web", groupId: GROUP_CORE, hasProfile: true, isNewSkill: false, percent: null, reason: "Học phần xây dựng ứng dụng Lập trình web hoàn chỉnh." },
      { skillId: SKILL_DOCKER, skillName: "Docker", groupId: GROUP_CORE, hasProfile: false, isNewSkill: false, percent: null, reason: "Đóng gói bản triển khai bằng container." },
      { skillId: null, skillName: "Kiểm thử API", groupId: GROUP_CORE, hasProfile: false, isNewSkill: true, percent: null, reason: "Học phần có phần kiểm thử API." }
    ]);
    expect(result.result.returned).toBe(6);
    expect(result.result.dropped).toBe(3);
  });

  it("links: an empty answer is a valid empty proposal; only bad items fail the job", () => {
    const context = contextFor("links");
    expect(validateCourseAiOutput({ links: [], newSkills: [] }, context)).toMatchObject({ ok: true, result: { items: [] } });
    expect(validateCourseAiOutput({ links: [{ skillKey: "S099", groupKey: "G1", reason: "x" }], newSkills: [] }, context))
      .toEqual({ ok: false, reason: "no_valid_items", path: "" });
    expect(validateCourseAiOutput({ links: [], newSkills: [], extra: 1 }, context)).toMatchObject({ ok: false, reason: "schema" });
  });

  it("weights: covers every linked skill once and scales the model's numbers to exactly 100", () => {
    const context = contextFor("weights", linkedSource());
    // Keys follow name order: S001 Làm việc nhóm, S002 Lập trình web, S003 Thiết kế cơ sở dữ liệu.
    const result = validateCourseAiOutput({ weights: [
      { skillKey: "S002", percent: 60, reason: "Trọng tâm của học phần." },
      { skillKey: "S003", percent: 30, reason: "Dùng cơ sở dữ liệu trong đồ án." },
      { skillKey: "S003", percent: 99, reason: "lặp" }
    ] }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.items.map((item) => [item.skillName, item.percent])).toEqual([
      ["Làm việc nhóm", 0], ["Lập trình web", 67], ["Thiết kế cơ sở dữ liệu", 33]
    ]);
    expect(result.result.modelTotal).toBe(90);
    expect(result.result.items.reduce((sum, item) => sum + (item.percent ?? 0), 0)).toBe(100);
    expect(validateCourseAiOutput({ weights: [{ skillKey: "S099", percent: 100, reason: "x" }] }, context))
      .toEqual({ ok: false, reason: "no_valid_items", path: "" });
  });

  it("full: keeps the chosen skills with percents that add up to 100", () => {
    const context = contextFor("full");
    const result = validateCourseAiOutput({ links: [
      { skillKey: "S001", groupKey: "G1", percent: 70, reason: "Trọng tâm." },
      { skillKey: "S003", groupKey: "G1", percent: 20, reason: "Triển khai." },
      { skillKey: "S004", groupKey: "G2", percent: 20, reason: "Làm nhóm." }
    ] }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.items.map((item) => [item.skillName, item.percent, item.hasProfile])).toEqual([
      ["Lập trình web", 64, true], ["Làm việc nhóm", 18, true], ["Docker", 18, false]
    ]);
    expect(validateCourseAiOutput({ links: [{ skillKey: "S001", groupKey: "G1", percent: 100, reason: "x" }], newSkills: [] }, context))
      .toMatchObject({ ok: false, reason: "schema" });
  });

  it("skills: keeps career skills by key, maps a new name onto a career skill and never repeats the catalog", () => {
    const context = courseAiContextFromInput(JSON.parse(JSON.stringify(buildSkillAiInput(skillSource()))));
    if (!context) throw new Error("no context");
    expect(context.existing).toEqual(["Lập trình web", "Làm việc nhóm"]);
    const checked = validateCourseAiOutput({
      links: [
        { skillKey: "S002", groupKey: "G1", scope: "Đánh giá qua đồ án nhóm có dùng S002.", reason: "Học phần DevOps dùng Git." },
        { skillKey: "S002", groupKey: "G2", scope: "Lặp lại", reason: "Lặp lại" },
        { skillKey: "S099", groupKey: "G1", scope: "Không có", reason: "Không có" }
      ],
      newSkills: [
        { name: "Kỹ năng Docker", groupKey: "G1", description: "Container", scope: "Triển khai ứng dụng.", reason: "Học phần DevOps." },
        { name: "lập trình  WEB", groupKey: "G1", description: "Trùng", scope: "Trùng", reason: "Trùng" },
        { name: "Kiểm thử phần mềm", groupKey: "G9", description: "Viết ca kiểm thử.", scope: "Đánh giá qua bài kiểm thử.", reason: "Học phần web nâng cao." },
        { name: "Kiểm thử  phần mềm", groupKey: "G1", description: "Lặp lại", scope: "Lặp lại", reason: "Lặp lại" }
      ]
    }, context);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.result).toMatchObject({ mode: "skills", returned: 7, dropped: 4, modelTotal: null });
    expect(checked.result.items).toEqual([
      { skillId: SKILL_GIT, skillName: "Git", groupId: GROUP_CORE, hasProfile: false, isNewSkill: false, percent: null,
        reason: "Học phần DevOps dùng Git.", scope: "Đánh giá qua đồ án nhóm có dùng Git." },
      { skillId: SKILL_DOCKER, skillName: "Docker", groupId: GROUP_CORE, hasProfile: false, isNewSkill: false, percent: null,
        reason: "Học phần DevOps.", scope: "Triển khai ứng dụng." },
      // An unknown group falls back to the first group.
      { skillId: null, skillName: "Kiểm thử phần mềm", groupId: GROUP_CORE, hasProfile: false, isNewSkill: true, percent: null,
        reason: "Học phần web nâng cao.", scope: "Đánh giá qua bài kiểm thử.", description: "Viết ca kiểm thử." }
    ]);
    expect(validateCourseAiOutput({ links: [], newSkills: [] }, context)).toMatchObject({ ok: true, result: { mode: "skills", items: [] } });
    expect(validateCourseAiOutput({ links: [{ skillKey: "S001", groupKey: "G1", reason: "x" }], newSkills: [] }, context)).toMatchObject({ ok: false, reason: "schema" });
    expect(validateCourseAiOutput({ links: [], newSkills: [{ name: "Làm việc nhóm", groupKey: "G2", description: "", scope: "", reason: "" }] }, context))
      .toEqual({ ok: false, reason: "no_valid_items", path: "" });
  });

  it("rejects a malformed stored input", () => {
    expect(courseAiContextFromInput(null)).toBeNull();
    expect(courseAiContextFromInput({ mode: "links", skills: [{ key: "S001" }], groups: [], linked: [] })).toBeNull();
    expect(courseAiContextFromInput({ mode: "other", skills: [], groups: [], linked: [] })).toBeNull();
    expect(courseAiContextFromInput({ mode: "skills", skills: [], groups: [], linked: [], existing: [1] })).toBeNull();
  });
});
