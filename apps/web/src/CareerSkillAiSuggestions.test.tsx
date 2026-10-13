import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CareerSkillAiSuggestions from "./CareerSkillAiSuggestions";
import type { CareerAiStatus, CareerAiSuggestion, CareerAiSuggestionItem } from "./career-ai-suggestions";
import type { Career } from "./career-types";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

const career: Career = { id: "career-1", code: "DA01", nameVi: "Chuyên viên phân tích dữ liệu", nameEn: "Data Analyst", category: "1", description: "", skills: [], version: "v1", deletedAt: null };
const catalog = { data: { items: [{ id: "s-sql", name: "SQL" }, { id: "s-py", name: "Lập trình Python" }, { id: "s-viz", name: "Trực quan hóa dữ liệu" }] }, error: null, loading: false, retry: () => {} };
const online: CareerAiStatus = { enabled: true, worker: { online: true, supportsSuggestions: true, seenAt: "2026-10-11T05:00:00.000Z" } };
const item = (patch: Partial<CareerAiSuggestionItem>): CareerAiSuggestionItem => ({
  index: 0, skillId: "s-sql", skillName: "SQL", isNewSkill: false, alreadyLinked: false, similarLinkedSkill: null, isRequired: true,
  title: "Viết truy vấn SQL để trích xuất và tổng hợp dữ liệu", description: "Truy vấn kho dữ liệu hằng ngày.", reason: "Công việc cốt lõi của vị trí.", ...patch,
});
const suggestion = (patch: Partial<CareerAiSuggestion>): CareerAiSuggestion => ({
  id: "sug-1", careerPositionId: career.id, status: "completed", errorCode: null,
  createdAt: "2026-10-11T05:00:00.000Z", updatedAt: "2026-10-11T05:00:40.000Z", completedAt: "2026-10-11T05:00:40.000Z", appliedAt: null,
  model: "gemma4:e4b", promptVersion: "career-skill-v1", items: [], ...patch,
});
const completed = suggestion({ items: [
  item({}),
  item({ index: 1, skillId: "s-py", skillName: "Lập trình Python", isRequired: false, title: "Viết script Python để làm sạch dữ liệu" }),
  item({ index: 2, skillId: "s-viz", skillName: "Trực quan hóa dữ liệu", alreadyLinked: true, isRequired: false }),
  item({ index: 3, skillId: null, skillName: "Kể chuyện bằng dữ liệu", isNewSkill: true, isRequired: false, title: "Trình bày kết quả phân tích cho người không chuyên" }),
] });

function render(latest: CareerAiSuggestion | null, options: { status?: CareerAiStatus; linked?: { skillId: string; skillName: string }[] } = {}) {
  liveData.mockImplementation((url: string) => url.endsWith("/status") ? { data: options.status ?? online, error: null, loading: false }
    : url.includes("/latest?") ? { data: { suggestion: latest }, error: null, loading: false }
      : { data: { items: (options.linked ?? [{ skillId: "s-viz", skillName: "Trực quan hóa dữ liệu" }]).map((link, at) => ({ id: `r${at}`, ...link })) }, error: null, loading: false });
  return renderToStaticMarkup(createElement(CareerSkillAiSuggestions, { career, catalog, close: () => {}, saved: () => {} }));
}

describe("CareerSkillAiSuggestions", () => {
  it("introduces the feature when there is no recent suggestion", () => {
    const html = render(null);
    expect(html).toContain("Chuyên viên phân tích dữ liệu");
    expect(html).toContain("AI không nhận dữ liệu sinh viên.");
    expect(html).toContain("Máy AI đang hoạt động");
    expect(html).toMatch(/<button type="button" class="am-primary">.*Tạo đề xuất<\/button>/);
  });
  it("disables creating when the server has AI switched off and explains an old worker", () => {
    expect(render(null, { status: { enabled: false, worker: { online: false, supportsSuggestions: false, seenAt: null } } })).toMatch(/Máy chủ chưa bật tính năng AI\.[\s\S]*<button type="button" class="am-primary" disabled="">/);
    expect(render(null, { status: { enabled: true, worker: { online: true, supportsSuggestions: false, seenAt: null } } })).toContain("Khởi động lại worker AI để dùng tính năng này.");
  });
  it("treats a cancelled suggestion as no suggestion", () => {
    expect(render(suggestion({ status: "cancelled" }))).toContain("Tạo đề xuất</button>");
  });
  it("shows the waiting states with a live region and a cancel button", () => {
    const queued = render(suggestion({ status: "queued", completedAt: null }));
    expect(queued).toMatch(/aria-live="polite">Đang chờ máy AI nhận việc…/);
    expect(queued).toContain("Hủy đề xuất");
    const processing = render(suggestion({ status: "processing", completedAt: null }));
    expect(processing).toContain("AI đang phân tích vị trí nghề nghiệp…");
    expect(processing).toContain("Thường mất khoảng 30–60 giây.");
    expect(processing).toMatch(/class="cai-elapsed"[^>]*>\d{2,}:\d{2}</);
  });
  it("explains a failure and offers a new suggestion", () => {
    const html = render(suggestion({ status: "failed", errorCode: "ai_output_truncated", completedAt: null }));
    expect(html).toContain("Chưa tạo được đề xuất");
    expect(html).toContain("Kết quả của AI bị cắt giữa chừng nên chưa dùng được.");
    expect(html).toContain("Tạo lại đề xuất");
  });
  it("lists catalog and new skills as editable cards with the right defaults", () => {
    const html = render(completed);
    expect(html).toContain("AI đề xuất 4 kỹ năng cho Chuyên viên phân tích dữ liệu");
    expect(html).toContain("Gợi ý bởi gemma4:e4b chạy cục bộ");
    expect(html.indexOf("Kỹ năng trong danh mục")).toBeLessThan(html.indexOf("Kỹ năng chưa có trong danh mục"));
    expect(html).toContain("Khi lưu, kỹ năng mới sẽ được thêm vào mục Kỹ năng.");
    expect(html).toContain("Lý do AI đề xuất: Công việc cốt lõi của vị trí.");
    expect(html).toContain('aria-label="Bỏ đề xuất Lập trình Python"');
    expect(html).toContain("Trực quan hóa dữ liệu — Đã liên kết");
    expect(html).toContain('<span class="cai-tag">Đã liên kết</span>');
    // SQL and Python ticked, the linked row and the new skill not.
    expect(html.match(/<input type="checkbox" checked=""/g)).toHaveLength(2);
    expect(html).toMatch(/<input type="checkbox" disabled=""\/><span>Trực quan hóa dữ liệu/);
    expect(html).toContain("Đã chọn 2/3 kỹ năng · 1 bắt buộc");
    expect(html).toMatch(/<button type="button" class="am-primary">.*Lưu 2 liên kết<\/button>/);
    expect(html).toContain('value="Kể chuyện bằng dữ liệu"');
  });
  it("starts a row close to a linked skill unticked and explains why", () => {
    const html = render(suggestion({ items: [
      item({}),
      item({ index: 1, skillId: "s-py", skillName: "Lập trình Python", isRequired: false, similarLinkedSkill: "Python" }),
      item({ index: 2, skillId: "s-viz", skillName: "Trực quan hóa dữ liệu", alreadyLinked: true, isRequired: false }),
    ] }), { linked: [{ skillId: "s-viz", skillName: "Trực quan hóa dữ liệu" }, { skillId: "s-python", skillName: "Python" }] });
    expect(html).toContain('<span class="cai-tag cai-tag-similar" title="Gần giống: Python">Gần giống: Python</span>');
    expect(html).toContain('<p class="cai-similar">Nghề này đã có kỹ năng “Python”. Chỉ chọn nếu đây là kỹ năng khác.</p>');
    expect(html).toMatch(/<input type="checkbox"\/><span>Lập trình Python/);
    expect(html.match(/cai-tag-similar/g)).toHaveLength(1);
    expect(html).toContain("Đã chọn 1/2 kỹ năng · 1 bắt buộc");
  });
  it("blocks saving a skill that was linked after the suggestion was made", () => {
    const html = render(completed, { linked: [{ skillId: "s-viz", skillName: "Trực quan hóa dữ liệu" }, { skillId: "s-py", skillName: "Lập trình Python" }] });
    expect(html).toContain("Kỹ năng này đã được liên kết với nghề này.");
    expect(html).toMatch(/<button type="button" class="am-primary" disabled="">.*Lưu 2 liên kết<\/button>/);
  });
  it("says so when the AI found nothing to add", () => {
    const html = render(suggestion({ items: [] }));
    expect(html).toContain("AI chưa đề xuất kỹ năng nào cho Chuyên viên phân tích dữ liệu");
    expect(html).toContain("Tạo lại đề xuất");
    expect(html).not.toContain("liên kết</button>");
  });
  it("labels every field of a card", () => {
    const html = render(completed);
    for (const [, id] of html.matchAll(/<(?:input|select|textarea)[^>]*id="([^"]+)"/g)) expect(html).toContain(`for="${id}"`);
  });
});
