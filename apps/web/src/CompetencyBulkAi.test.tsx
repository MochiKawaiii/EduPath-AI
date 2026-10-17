import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ClearRevision, CompetencyBulkAi } from "./CompetencyBulkAi";
import type { CourseAiBatch, CourseAiStatus } from "./competency-ai";
import type { CompetencyCourse, CurriculumRevision } from "./competency-types";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

const curriculum: CurriculumRevision = { curriculumId: "c1", revisionId: "r30", cohortCode: "K30", name: "CTĐT K30", version: 1, isCurrent: true, isActive: true,
  courseCount: 3, configuredCount: 2, activeCount: 2, draftCount: 0 };
const course = (code: string, skillCount: number): CompetencyCourse => ({ code, name: code, credits: 3, type: "BB", block: "", specialty: "", occurrenceCount: 1,
  status: skillCount ? "active" : "missing", configId: null, version: null, skillCount, totalWeight: skillCount ? 1 : 0 });
const online: CourseAiStatus = { enabled: true, worker: { online: true, supportsSuggestions: true, seenAt: "2026-10-17T05:00:00.000Z" } };
const pendingBatch: CourseAiBatch = { id: "b1", createdAt: "2026-10-17T05:00:00.000Z", total: 1, queued: 1, processing: 0, completed: 0, failed: 0, cancelled: 0,
  applied: 0, ready: 0, items: [] };

function render(batch: CourseAiBatch | null) {
  liveData.mockImplementation((url: string) => url.includes("/courses?") ? { data: { items: [course("A", 4), course("B", 2), course("C", 0)] }, error: null, loading: false }
    : url.endsWith("/status") ? { data: online, error: null, loading: false }
      : { data: { batch }, error: null, loading: false });
  return renderToStaticMarkup(createElement(CompetencyBulkAi, { curriculum, canManage: true, revision: 0, onSaved: () => {} }));
}

describe("CompetencyBulkAi", () => {
  it("offers to clear the linked courses and says the AI reasons before answering", () => {
    const html = render(null);
    expect(html).toContain("Xóa liên kết của 2 học phần");
    expect(html).toContain("Chạy AI cho 1 học phần chưa có liên kết");
    expect(html).toContain("AI suy luận trước khi trả lời");
  });

  it("hides the clear button while a run is pending", () => {
    expect(render(pendingBatch)).not.toContain("Xóa liên kết của");
  });

  it("asks for the cohort code before clearing", () => {
    const html = renderToStaticMarkup(createElement(ClearRevision, { curriculum, linked: 2, close: () => {}, cleared: () => {} }));
    expect(html).toContain("Nhập K30 để xác nhận");
    expect(html).toContain("Sinh viên K30 sẽ chưa có điểm năng lực");
    expect(html).toMatch(/<button class="am-primary am-delete" disabled="">/);
  });
});
