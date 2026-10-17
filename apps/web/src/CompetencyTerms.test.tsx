import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CompetencyManagement from "./CompetencyManagement";
import { CompetencyGroupsTab, CompetencySkillsTab } from "./CompetencyProfiles";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));
const group = { id: "g1", name: "Chuyên môn", description: "", isActive: true, version: "v", skillCount: 1 };
const skill = { id: "s1", name: "SQL", description: "", scope: "", groupId: "g1", groupName: "Chuyên môn", groupActive: true, isActive: true, courseCount: 1, careerCount: 1, version: "v" };
liveData.mockImplementation((url: string) => ({ data: { items: url.includes("/skills") ? [skill] : url.includes("/groups") ? [group] : [] }, error: null, loading: false }));
const props = { canManage: true, revision: 0, onSaved: () => {} };

// Terms agreed on 2026-10-17: Nhóm năng lực (the groups), Kỹ năng (one skill), Cấu hình năng lực (a skill
// set up for assessment: group, scope, state).
describe("competency terms", () => {
  it("shows one part per page of Quản lý năng lực, without tabs", () => {
    const page = (section: "groups" | "profiles" | "courses") => renderToStaticMarkup(createElement(CompetencyManagement, { canManage: true, section }));
    const [groups, profiles, courses] = [page("groups"), page("profiles"), page("courses")];
    expect(groups).toContain("Thêm nhóm năng lực");
    expect(groups).not.toContain("Thêm cấu hình năng lực");
    expect(profiles).toContain("Thêm cấu hình năng lực");
    expect(profiles).not.toContain("Thêm nhóm năng lực");
    expect(courses).toContain("Khóa tuyển sinh");
    expect(courses).not.toMatch(/Thêm nhóm năng lực|Thêm cấu hình năng lực/);
    for (const html of [groups, profiles, courses]) expect(html).not.toContain("aria-pressed");
  });

  it("uses the new names on both tabs and never the old ones", () => {
    const groups = renderToStaticMarkup(createElement(CompetencyGroupsTab, props));
    const skills = renderToStaticMarkup(createElement(CompetencySkillsTab, props));
    expect(groups).toContain("Thêm nhóm năng lực");
    expect(skills).toContain("Thêm cấu hình năng lực");
    expect(skills).toContain("<th>Nhóm năng lực</th>");
    for (const html of [groups, skills]) expect(html).not.toMatch(/nhóm kỹ năng|hồ sơ|Danh mục kỹ năng/i);
  });
});
