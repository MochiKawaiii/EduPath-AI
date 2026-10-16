import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CompetencyCourseAi from "./CompetencyCourseAi";
import type { CourseAiItem, CourseAiStatus, CourseAiSuggestion } from "./competency-ai";
import type { CompetencyCourse, CurriculumRevision } from "./competency-types";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

const curriculum: CurriculumRevision = { curriculumId: "c1", revisionId: "r1", cohortCode: "K99", name: "CTĐT K99", version: 2, isCurrent: true, isActive: true,
  courseCount: 10, configuredCount: 0, activeCount: 0, draftCount: 0 };
const course: CompetencyCourse = { code: "71ITSE40103", name: "Lập trình web nâng cao", credits: 3, type: "BB", block: "Chuyên ngành", specialty: "",
  occurrenceCount: 1, status: "draft", configId: "cfg", version: "v1", skillCount: 2, totalWeight: 0 };
const online: CourseAiStatus = { enabled: true, worker: { online: true, supportsSuggestions: true, seenAt: "2026-10-16T05:00:00.000Z" } };
const item = (patch: Partial<CourseAiItem>): CourseAiItem => ({ index: 0, skillId: "s-web", skillName: "Lập trình web", groupId: "g1", groupName: "Chuyên môn",
  hasProfile: true, isNewSkill: false, alreadyLinked: false, percent: null, reason: "Học phần dạy trực tiếp.", ...patch });
const suggestion = (patch: Partial<CourseAiSuggestion>): CourseAiSuggestion => ({ id: "sug-1", revisionId: "r1", courseCode: course.code, mode: "links", batchId: null,
  status: "completed", errorCode: null, createdAt: "2026-10-16T05:00:00.000Z", updatedAt: "2026-10-16T05:00:40.000Z", completedAt: "2026-10-16T05:00:40.000Z",
  appliedAt: null, model: "gemma4:e4b", promptVersion: "comp-link-v1", items: [], stale: false, ...patch });

function render(mode: "links" | "weights", latest: CourseAiSuggestion | null, status: CourseAiStatus = online) {
  liveData.mockImplementation((url: string) => url.endsWith("/status") ? { data: status, error: null, loading: false }
    : url.includes("/latest?") ? { data: { suggestion: latest }, error: null, loading: false }
      : { data: { items: [{ id: "g1", name: "Chuyên môn", description: "", isActive: true, version: "v", skillCount: 3 }] }, error: null, loading: false });
  return renderToStaticMarkup(createElement(CompetencyCourseAi, { curriculum, course, mode, close: () => {}, saved: () => {} }));
}

describe("CompetencyCourseAi", () => {
  it("introduces each mode and keeps student data out", () => {
    const links = render("links", null);
    expect(links).toContain("Tạo liên kết kỹ năng (AI) · 71ITSE40103");
    expect(links).toContain("không nhận dữ liệu sinh viên");
    expect(links).toMatch(/<button type="button" class="am-primary">.*Tạo đề xuất<\/button>/);
    expect(render("weights", null)).toContain("AI chia 100% trọng số của học phần cho 2 kỹ năng đã liên kết.");
    expect(render("links", null, { enabled: false, worker: { online: false, supportsSuggestions: false, seenAt: null } }))
      .toMatch(/Máy chủ chưa bật tính năng AI\.[\s\S]*<button type="button" class="am-primary" disabled="">/);
  });

  it("shows the waiting and failed states", () => {
    expect(render("links", suggestion({ status: "queued", completedAt: null }))).toContain("Đang chờ máy AI nhận việc…");
    expect(render("weights", suggestion({ status: "processing", completedAt: null }))).toContain("AI đang chia trọng số…");
    expect(render("links", suggestion({ status: "failed", errorCode: "ai_timeout" }))).toContain("Máy AI xử lý quá thời gian cho phép.");
  });

  it("reviews links: a career skill without a profile needs a group, a new skill starts unticked", () => {
    const html = render("links", suggestion({ items: [
      item({}),
      item({ index: 1, skillId: "s-docker", skillName: "Docker", hasProfile: false, groupId: null, groupName: null }),
      item({ index: 2, skillId: null, skillName: "Kiểm thử API", hasProfile: false, isNewSkill: true }),
      item({ index: 3, skillId: "s-team", skillName: "Làm việc nhóm", alreadyLinked: true }),
    ] }));
    expect(html).toContain("AI đề xuất 4 kỹ năng cho 71ITSE40103");
    expect(html).toContain("Kỹ năng nghề chưa đo");
    expect(html).toContain("Kỹ năng mới");
    expect(html).toContain("Đã liên kết");
    expect(html).toContain("Chọn nhóm kỹ năng.");
    expect(html).toContain("Lưu 2 liên kết");
  });

  it("reviews weights with the total and blocks a stale proposal", () => {
    const items = [item({ percent: 70 }), item({ index: 1, skillId: "s-db", skillName: "Thiết kế cơ sở dữ liệu", percent: 30 })];
    const html = render("weights", suggestion({ mode: "weights", items }));
    expect(html).toContain("AI chia trọng số cho 2 kỹ năng của 71ITSE40103");
    expect(html).toMatch(/comp-weight-total comp-weight-valid[\s\S]*100%/);
    expect(html).toMatch(/<button type="button" class="am-primary">.*Lưu và áp dụng<\/button>/);
    const stale = render("weights", suggestion({ mode: "weights", items, stale: true }));
    expect(stale).toContain("Liên kết kỹ năng của học phần đã thay đổi sau khi AI đề xuất.");
    expect(stale).toMatch(/<button type="button" class="am-primary" disabled="">.*Lưu và áp dụng<\/button>/);
  });
});
