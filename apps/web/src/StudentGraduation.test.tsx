import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import StudentGraduation from "./StudentGraduation";
import type { Transcript } from "./StudentTranscript";
import type { GraduationData } from "./graduation-types";

const liveData = vi.hoisted(() => vi.fn());
vi.mock("./use-live-data", () => ({ useLiveData: liveData }));

type Options = {
  score?: number; score4?: number; gpaScale?: 4 | 10 | null; minimumGpa?: number; sameCohort?: boolean; error?: string; loading?: boolean;
  /** Printed result of CS-101 (default "Đạt"); null is a blank, icon-only cell. */
  result?: string | null; letter?: string | null;
  /** Printed "Tổng số tín chỉ tích lũy" of the term. */
  cumulative?: string;
  /** Adds CS-102 to the mandatory group, graded but with no readable result. */
  unreadable?: boolean;
};
function render(options: Options = {}) {
  const rules: GraduationData = {
    schemaVersion: 1, name: "Tiêu chuẩn thử nghiệm", standardCode: "TEST", cohortCode: "K29",
    classBlock: "K29", major: "CNTT", specialty: "", educationSystem: "", faculty: "",
    minimumCredits: 3, mandatoryCredits: 3, electiveCredits: 0, freeElectiveCredits: 0,
    minimumGpa: options.minimumGpa ?? 2, gpaScale: options.gpaScale === undefined ? 4 : options.gpaScale, notes: "",
    groups: [{ id: "BB", name: "Bắt buộc", kind: "mandatory", minimumCredits: 3, sourceRow: 1 }],
    courses: [
      { id: "A", code: "CS-101", name: "Lập trình", credits: 3, groupId: "BB", conditionOnly: false, sourceRow: 2 },
      ...(options.unreadable ? [{ id: "B", code: "CS-102", name: "Cơ sở dữ liệu", credits: 3, groupId: "BB", conditionOnly: false, sourceRow: 3 }] : []),
    ],
    sourceWorkbook: "", sourceSheet: "", sourceNotes: [],
  };
  const transcript: Transcript = {
    version: "test", filename: "bang-diem.pdf", fileSize: 100,
    createdAt: "2026-10-05T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z",
    data: { schemaVersion: 1, parserVersion: "test", pageCount: 1, courseCount: 1, warnings: [], sections: [{
    id: "2025-2026/HK01", label: "HK01", academicYear: "2025-2026", semester: "HK01",
    summaries: options.cumulative === undefined ? [] : [{ label: "Tổng số tín chỉ tích lũy", value: options.cumulative }],
    courses: [
      { ordinal: 1, code: "CS-101", name: "Lập trình", credits: 3, score10: options.score ?? 5,
        score4: options.score4 ?? 1, letter: options.letter === undefined ? "D" : options.letter,
        result: options.result === undefined ? "Đạt" : options.result, conditional: false, sourcePage: 1 },
      ...(options.unreadable ? [{ ordinal: 2, code: "CS-102", name: "Cơ sở dữ liệu", credits: 3, score10: 7,
        score4: 3, letter: null, result: null, conditional: false, sourcePage: 1 }] : []),
    ],
  }] } };
  liveData.mockImplementation((url: string) => ({
    loading: url === "/api/student/transcript" && Boolean(options.loading),
    error: url === "/api/student/transcript" ? options.error ?? null : null,
    data: url === "/api/student/graduation" ? {
      suggestedId: "standard", profileCohort: options.sameCohort === false ? "K30" : "K29",
      items: [{ id: "standard", ...rules }],
    } : url === "/api/student/transcript" ? { transcript } : rules,
  }));
  return renderToStaticMarkup(createElement(StudentGraduation));
}

describe("student graduation view", () => {
  it("shows individual scores and an improvement reminder when courses pass but GPA fails", () => {
    const html = render();
    expect(html).toContain('<th class="sg-score">Điểm</th>');
    expect(html).toContain("<strong>1 / 4</strong>");
    expect(html).toContain("5 / 10 · D");
    expect(html).toContain("Điểm trung bình tích lũy (hệ 4)");
    expect(html).toContain("Cần học cải thiện để nâng điểm trung bình");
    expect(html).toContain("Có thể học cải thiện");
    expect(html).toContain("Chưa đủ điều kiện xét tốt nghiệp");
    expect(html).toContain("tính tham khảo theo tín chỉ");
  });
  it("does not show the reminder for sufficient GPA or a different cohort", () => {
    expect(render({ score4: 2 })).not.toContain("Cần học cải thiện để nâng điểm trung bình");
    const other = render({ sameCohort: false });
    expect(other).not.toContain("Có thể học cải thiện");
    expect(other).toContain("tiêu chuẩn đang chọn không cùng khóa");
  });
  it("defaults legacy scales to 4 and respects the administrator's explicit scale 10", () => {
    const legacy = render({ gpaScale: null, score: 9, score4: 1 });
    expect(legacy).toContain("Điểm trung bình tích lũy (hệ 4)");
    expect(legacy).toContain("Có thể học cải thiện");
    const overridden = render({ gpaScale: 10, minimumGpa: 5.5, score: 6, score4: 1 });
    expect(overridden).toContain("Điểm trung bình tích lũy (hệ 10)");
    expect(overridden).not.toContain("Cần học cải thiện để nâng điểm trung bình");
  });
  it("hides stale scores and reminders while transcript data is loading or unavailable", () => {
    for (const options of [{ loading: true }, { error: "Không tải được bảng điểm" }]) {
      const html = render(options);
      expect(html).not.toContain("<strong>1 / 4</strong>");
      expect(html).not.toContain("5 / 10 · D");
      expect(html).not.toContain("Cần học cải thiện để nâng điểm trung bình");
    }
  });
  it("says in text when a result comes from the letter grade because the PDF cell is blank", () => {
    const html = render({ result: null, letter: "B", score: 7, score4: 3 });
    expect(html).toContain("✓ Đạt<small>suy ra từ điểm chữ</small>");
    expect(html).toContain("1 môn trong tiêu chuẩn này có ô Kết quả trống trong PDF");
    expect(html).toContain("Đã đạt các nhóm học phần, số tín chỉ tích lũy và yêu cầu điểm trung bình");
    expect(render({ result: null, letter: "F", score: 3, score4: 0 })).toContain("✗ Chưa đạt<small>suy ra từ điểm chữ</small>");
    expect(render({ score4: 3 })).not.toContain("suy ra từ điểm chữ");
  });
  it("keeps a group undecided while a graded course's result cannot be read", () => {
    const html = render({ unreadable: true, score4: 3 });
    expect(html).toContain("1 môn<small>+1 môn chưa rõ kết quả</small>");
    expect(html).toContain('<td class="sg-status-unknown">? Chưa xác định</td>');
    expect(html).toContain("? Chưa xác định</td>");
    expect(html).toContain("Chưa đủ dữ liệu để kết luận điều kiện xét tốt nghiệp.");
  });
  it("prefers the printed cumulative credits and warns when the course results do not add up", () => {
    const printed = render({ cumulative: "5", score4: 3 });
    expect(printed).toContain("Tín chỉ tích lũy (không tính môn điều kiện)");
    expect(printed).toContain("5 TC<small>Theo bảng điểm</small>");
    expect(printed).toContain("Tổng tín chỉ chưa khớp với bảng điểm");
    expect(printed).toContain("Kết quả chính thức do nhà trường xác nhận.");
    const estimated = render({ score4: 3 });
    expect(estimated).toContain("3 TC<small>Ước tính</small>");
    expect(estimated).toContain("Số tín chỉ trên là ước tính");
    expect(estimated).not.toContain("Tổng tín chỉ chưa khớp với bảng điểm");
    expect(render({ cumulative: "3", score4: 3 })).not.toContain("Tổng tín chỉ chưa khớp với bảng điểm");
    expect(render({ cumulative: "5", score4: 3, sameCohort: false })).not.toContain("Tổng tín chỉ chưa khớp với bảng điểm");
  });
});
