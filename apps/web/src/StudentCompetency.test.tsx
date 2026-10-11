import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import StudentCompetency from "./StudentCompetency";
import { fixtureAssessment } from "./student-competency.fixture";
import type { AiStatus, LatestAssessmentResponse } from "./competency-assessment-types";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

const profile = { careerPositionId: "career-1", careerPosition: { id: "career-1", nameVi: "Lập trình viên web", nameEn: "Web Developer", deletedAt: null } };
function render(latest: LatestAssessmentResponse | null, options: { loading?: boolean; transcript?: boolean; specialty?: string | null } = {}) {
  liveData.mockImplementation((url: string) => url.endsWith("/latest")
    ? { data: latest, error: null, loading: options.loading ?? false }
    : { data: options.transcript ?? true, error: null, loading: false });
  return renderToStaticMarkup(createElement(StudentCompetency, { profile: { ...profile, specialty: options.specialty === undefined ? "CNPM" : options.specialty } }));
}
const withAi = (status: AiStatus) => render({ assessment: fixtureAssessment(status), aiEnabled: true, workerOnline: true });

describe("StudentCompetency", () => {
  it("renders every section in order with the AI comment right after the overview", () => {
    const html = withAi("completed");
    const order = ["scomp-overview", "scomp-ai", "scomp-career", "scomp-courses", "scomp-skills", "scomp-progress", "scomp-graduation", "scomp-warnings"].map((id) => html.indexOf(`id="${id}"`));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("Đánh giá lại");
    expect(html).toContain("Xóa kết quả đánh giá");
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });
  it("shows the AI text with names, the AI label and the local model footer", () => {
    const html = withAi("completed");
    expect(html).toContain("Nhận xét từ EduPath AI");
    expect(html).toContain(">AI<");
    expect(html).toContain("Gemma 4 E4B, chạy cục bộ");
    expect(html).toContain("có thể chưa chính xác");
    expect(html).toContain("Học phần Kiểm thử phần mềm (TST105)");
    expect(html).not.toContain("XXX999");
    expect(html).not.toContain("Không ánh xạ được");
  });
  it("keeps the full computed result when AI is disabled", () => {
    const html = render({ assessment: fixtureAssessment("disabled"), aiEnabled: false, workerOnline: false });
    expect(html).toContain("Nhận xét AI chưa được bật");
    expect(html).not.toContain("Tạo lại nhận xét");
    expect(html).toContain("Khá phù hợp");
    expect(html).toContain("Chi tiết kỹ năng");
  });
  it("shows a busy AI box with a cancel button while processing", () => {
    const html = withAi("processing");
    // No aria-busy on the AI section: it would hide the pending state from screen readers for minutes.
    expect(html).not.toMatch(/id="scomp-ai"[^>]*aria-busy/);
    expect(html).toContain("EduPath AI đang phân tích kết quả");
    expect(html).toContain("Hủy tạo nhận xét");
  });
  it("offers regeneration after a failure and explains the error", () => {
    const failed = fixtureAssessment("failed", "ai_timeout");
    const html = render({ assessment: failed, aiEnabled: true, workerOnline: true });
    expect(html).toContain("Máy AI xử lý quá thời gian cho phép.");
    expect(html).toContain("Tạo lại nhận xét");
  });
  it("renders gap statuses with glyphs and never colours missing data as a failure", () => {
    const html = withAi("completed");
    expect(html).toContain("✓</span> Đạt ngưỡng");
    expect(html).toContain("Dưới ngưỡng · thiếu 10 điểm");
    expect(html).toContain("Sắp học · HK261");
    expect(html).toMatch(/scomp-status scomp-status-neutral"><span aria-hidden="true">\?<\/span> Chưa đủ dữ liệu/);
    expect(html).toContain("<caption");
  });
  it("lists support courses, improvement courses and self study", () => {
    const html = withAi("completed");
    expect(html).toContain("Học phần nên học");
    expect(html).toContain("Cần học trước Công nghệ phần mềm (TST109)");
    expect(html).toContain("Học cải thiện");
    expect(html).toContain("Kỹ năng cần tự học (CTĐT chưa đo)");
    expect(html).toContain("Đóng gói ứng dụng web của bạn bằng Docker.");
  });
  it("groups skills with no evidence last and says it is not a weakness", () => {
    const html = withAi("completed");
    expect(html.indexOf("Chưa có minh chứng (1)")).toBeGreaterThan(html.indexOf("Kiến thức chuyên môn (4)"));
    expect(html).toContain("Không phải điểm yếu");
    expect(html).toContain("suy ra từ điểm chữ");
  });
  it("shows an introduction when there is no assessment yet", () => {
    const html = render({ assessment: null, aiEnabled: false, workerOnline: false }, { specialty: null });
    expect(html).toContain("Chưa có kết quả đánh giá");
    expect(html).toContain("Đánh giá năng lực</button>");
    expect(html).toContain("Chưa xác định");
    expect(html).not.toContain("Xóa kết quả đánh giá");
  });
  it("shows a loading state while the first request runs", () => {
    const html = render(null, { loading: true });
    expect(html).toContain("Đang tải kết quả đánh giá…");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Đánh giá năng lực<\/button>/);
  });
  it("says when the profile changed after the assessment", () => {
    expect(withAi("completed")).not.toContain("Hồ sơ đã thay đổi sau lần đánh giá này");
    const html = render({ assessment: fixtureAssessment("completed"), aiEnabled: true, workerOnline: true }, { specialty: null });
    expect(html).toContain("Hồ sơ đã thay đổi sau lần đánh giá này");
  });
  it("does not stay on 'Đang kiểm tra…' when the transcript check fails", () => {
    liveData.mockImplementation((url: string) => url.endsWith("/latest")
      ? { data: { assessment: null, aiEnabled: false, workerOnline: false }, error: null, loading: false }
      : { data: null, error: "Chưa kiểm tra được bảng điểm.", loading: false });
    const html = renderToStaticMarkup(createElement(StudentCompetency, { profile: { ...profile, specialty: "CNPM" } }));
    expect(html).toContain("Chưa kiểm tra được — thử tải lại trang");
    expect(html).not.toContain("Đang kiểm tra…");
  });
  it("does not praise a career that has no requirements yet", () => {
    const assessment = fixtureAssessment("completed");
    const result = { ...assessment.result, career: { ...assessment.result.career!, requirements: [] } };
    const html = render({ assessment: { ...assessment, result }, aiEnabled: true, workerOnline: true });
    expect(html).toContain("Nghề này chưa có yêu cầu kỹ năng trong danh mục nên chưa so sánh được.");
    expect(html).not.toContain("Bạn đã đạt mọi kỹ năng có dữ liệu của nghề này.");
  });
});
