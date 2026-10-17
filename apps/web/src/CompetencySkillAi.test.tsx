import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CompetencySkillAi from "./CompetencySkillAi";
import type { CourseAiItem, CourseAiStatus, CourseAiSuggestion } from "./competency-ai";
import type { CurriculumRevision } from "./competency-types";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

const revision = (patch: Partial<CurriculumRevision>): CurriculumRevision => ({ curriculumId: "c1", revisionId: "r31", cohortCode: "K31", name: "CTĐT K31", version: 1,
  isCurrent: true, isActive: true, courseCount: 88, configuredCount: 0, activeCount: 0, draftCount: 0, ...patch });
const revisions = [revision({}), revision({ revisionId: "r32", cohortCode: "K32", name: "CTĐT K32" }), revision({ revisionId: "r33", cohortCode: "K33", name: "CTĐT K33", courseCount: 0 })];
const online: CourseAiStatus = { enabled: true, worker: { online: true, supportsSuggestions: true, seenAt: "2026-10-17T05:00:00.000Z" } };
const item = (patch: Partial<CourseAiItem>): CourseAiItem => ({ index: 0, skillId: "s-git", skillName: "Git", groupId: "g1", groupName: "Chuyên môn",
  hasProfile: false, isNewSkill: false, alreadyLinked: false, percent: null, reason: "Học phần DevOps dùng Git.", scope: "Đánh giá qua đồ án nhóm.", description: "", ...patch });
const suggestion = (patch: Partial<CourseAiSuggestion>): CourseAiSuggestion => ({ id: "sug-1", revisionId: "r32", courseCode: null, mode: "skills", batchId: null,
  status: "completed", errorCode: null, createdAt: "2026-10-17T05:00:00.000Z", updatedAt: "2026-10-17T05:01:40.000Z", completedAt: "2026-10-17T05:01:40.000Z",
  appliedAt: null, model: "gemma4:e4b", promptVersion: "comp-skill-v1", items: [], stale: false, ...patch });

function render(latest: CourseAiSuggestion | null, status: CourseAiStatus = online) {
  const urls: string[] = [];
  liveData.mockImplementation((url: string) => {
    urls.push(url);
    if (url.endsWith("/curricula")) return { data: { items: revisions }, error: null, loading: false };
    if (url.endsWith("/status")) return { data: status, error: null, loading: false };
    if (url.includes("/skills/latest?")) return { data: { suggestion: latest }, error: null, loading: false };
    return { data: { items: [{ id: "g1", name: "Chuyên môn", description: "", isActive: true, version: "v", skillCount: 3 }] }, error: null, loading: false };
  });
  return { html: renderToStaticMarkup(createElement(CompetencySkillAi, { close: () => {}, saved: () => {} })), urls };
}

describe("CompetencySkillAi", () => {
  it("starts on the newest current revision with courses and keeps student data out", () => {
    const { html, urls } = render(null);
    expect(html).toContain("Thêm kỹ năng bằng AI");
    expect(html).toMatch(/<option value="r32" selected="">K32 · CTĐT K32 · v1 · Hiện hành<\/option>/);
    expect(html).not.toContain("K33");
    expect(urls.some((url) => url.endsWith("/ai/skills/latest?revisionId=r32"))).toBe(true);
    expect(html).toContain("88 học phần");
    expect(html).toContain("không nhận dữ liệu sinh viên");
    expect(html).toMatch(/<button type="button" class="am-primary">.*Tạo đề xuất<\/button>/);
  });

  it("shows the waiting and failed states", () => {
    expect(render(suggestion({ status: "processing", completedAt: null })).html).toContain("AI đang đọc chương trình và đề xuất kỹ năng…");
    expect(render(suggestion({ status: "failed", errorCode: "ai_output_truncated" })).html).toContain("Kết quả của AI bị cắt giữa chừng");
  });

  it("reviews skills: career skills ticked with group and scope, new skills opt-in, catalog skills locked", () => {
    const { html } = render(suggestion({ items: [
      item({}),
      item({ index: 1, skillId: null, skillName: "Kiểm thử phần mềm", isNewSkill: true, description: "Viết ca kiểm thử.", groupId: null, groupName: null }),
      item({ index: 2, skillId: "s-web", skillName: "Lập trình web", alreadyLinked: true }),
    ] }));
    expect(html).toContain("AI đề xuất 3 kỹ năng cho danh mục");
    expect(html).toContain("Kỹ năng nghề chưa đo");
    expect(html).toContain("Kỹ năng mới");
    expect(html).toContain("Đã có trong danh mục");
    expect(html).toContain("Đánh giá qua đồ án nhóm.");
    expect(html).toContain("Viết ca kiểm thử.");
    expect(html).toContain("Lưu 1 kỹ năng");
  });

  it("says so when the AI found nothing to add", () => {
    const { html } = render(suggestion({ items: [] }));
    expect(html).toContain("AI chưa thấy kỹ năng nào cần bổ sung");
    expect(html).not.toContain("Lưu 0 kỹ năng");
  });
});
