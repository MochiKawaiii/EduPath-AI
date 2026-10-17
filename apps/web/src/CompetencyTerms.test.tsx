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
  it("names the tabs Nhóm năng lực, Cấu hình năng lực, Cấu hình học phần", () => {
    const html = renderToStaticMarkup(createElement(CompetencyManagement, { canManage: true }));
    expect([...html.matchAll(/<button aria-pressed="(?:true|false)"><svg[^>]*>.*?<\/svg>([^<]+)<\/button>/g)].map((match) => match[1]))
      .toEqual(["Nhóm năng lực", "Cấu hình năng lực", "Cấu hình học phần"]);
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
