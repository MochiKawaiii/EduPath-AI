import { describe, expect, it } from "vitest";
import {
  applyItems, failureMessage, foldName, formatElapsed, hasEdits, requestErrorMessage, rowsFromSuggestion, similarLinkedSkillOf, validateRows, workerLine,
  type CareerAiSuggestionItem,
} from "./career-ai-suggestions";

const catalog = [
  { id: "s-sql", name: "SQL" },
  { id: "s-py", name: "Lập trình Python" },
  { id: "s-viz", name: "Trực quan hóa dữ liệu" },
];
const item = (patch: Partial<CareerAiSuggestionItem>): CareerAiSuggestionItem => ({
  index: 0, skillId: "s-sql", skillName: "SQL", isNewSkill: false, alreadyLinked: false, similarLinkedSkill: null, isRequired: false,
  title: "Viết truy vấn SQL để trích xuất dữ liệu", description: "Dùng hằng ngày.", reason: "Cốt lõi của nghề.", ...patch,
});
const items = [
  item({}),
  item({ index: 1, skillId: "s-py", skillName: "Lập trình Python", isRequired: true }),
  item({ index: 2, skillId: "s-viz", skillName: "Trực quan hóa dữ liệu", alreadyLinked: true }),
  item({ index: 3, skillId: null, skillName: "Kể chuyện bằng dữ liệu", isNewSkill: true }),
];

describe("career AI suggestion helpers", () => {
  it("describes the worker and only blocks creating when AI is off", () => {
    expect(workerLine({ enabled: false, worker: { online: true, supportsSuggestions: true, seenAt: null } })).toMatchObject({ text: "Máy chủ chưa bật tính năng AI.", canCreate: false });
    expect(workerLine({ enabled: true, worker: { online: true, supportsSuggestions: true, seenAt: null } })).toMatchObject({ text: "Máy AI đang hoạt động", tone: "ok", canCreate: true });
    expect(workerLine({ enabled: true, worker: { online: true, supportsSuggestions: false, seenAt: null } }).text).toContain("phiên bản cũ");
    expect(workerLine({ enabled: true, worker: { online: false, supportsSuggestions: false, seenAt: null } })).toMatchObject({ text: "Máy AI đang tắt. Đề xuất sẽ được xử lý khi máy AI bật lại.", canCreate: true });
    expect(workerLine(null).canCreate).toBe(false);
  });
  it("maps job and request errors to Vietnamese messages", () => {
    expect(failureMessage("ai_timeout")).toBe("Máy AI xử lý quá thời gian cho phép.");
    expect(failureMessage("worker_timeout")).toContain("chưa xử lý xong");
    expect(failureMessage("something_new")).toBe("Chưa tạo được đề xuất.");
    expect(requestErrorMessage("ai_queue_full")).toBe("Hàng đợi AI đang đầy. Vui lòng thử lại sau ít phút.");
    expect(requestErrorMessage("requirement_exists", ["SQL", "Python"])).toBe("Các kỹ năng sau đã được liên kết với nghề này: SQL, Python.");
    // The API answers a bad body under /requirements/ai-suggestions with invalid_ai_suggestion.
    expect(requestErrorMessage("invalid_ai_suggestion")).toBe("Thông tin chưa hợp lệ. Kiểm tra kỹ năng, nội dung yêu cầu và mô tả của các dòng đã chọn.");
    expect(requestErrorMessage("insufficient_role")).toBe("Bạn không còn quyền thực hiện thao tác này.");
    expect(requestErrorMessage(null)).toBe("Không thể thực hiện thao tác. Vui lòng thử lại.");
  });
  it("formats the elapsed time as mm:ss and never below zero", () => {
    const start = "2026-10-11T05:00:00.000Z";
    expect(formatElapsed(start, Date.parse(start) + 75_400)).toBe("01:15");
    expect(formatElapsed(start, Date.parse(start) - 5_000)).toBe("00:00");
    expect(formatElapsed("not a date", Date.now())).toBe("00:00");
  });
  it("folds names like the API", () => {
    expect(foldName("  Đọc   hiểu Tài liệu ")).toBe("doc hieu tai lieu");
  });
  it("ticks catalog rows, leaves new skills and linked skills unticked", () => {
    const rows = rowsFromSuggestion(items);
    expect(rows.map((row) => row.checked)).toEqual([true, true, false, false]);
    expect(rows[3]).toMatchObject({ skillId: null, isNewSkill: true, skillName: "Kể chuyện bằng dữ liệu" });
    expect(validateRows(rows, [], catalog)).toMatchObject({ valid: true, selected: 2, selectable: 3, required: 1 });
  });
  it("leaves rows close to a linked skill unticked and names that skill while the row is unchanged", () => {
    const similar = [
      item({ index: 0, skillId: "s-sql", skillName: "SQL", similarLinkedSkill: null }),
      item({ index: 1, skillId: "s-py", skillName: "Lập trình Python", similarLinkedSkill: "Python" }),
      item({ index: 2, skillId: "s-viz", skillName: "Trực quan hóa dữ liệu", alreadyLinked: true }),
      item({ index: 3, skillId: null, skillName: "Phân tích và quản lý yêu cầu", isNewSkill: true, similarLinkedSkill: "Phân tích yêu cầu" }),
    ];
    const rows = rowsFromSuggestion(similar);
    expect(rows.map((row) => row.checked)).toEqual([true, false, false, false]);
    expect(rows.map((row) => similarLinkedSkillOf(row, similar))).toEqual([null, "Python", null, "Phân tích yêu cầu"]);
    // Ticking it anyway keeps the hint; another skill or another name drops it.
    expect(similarLinkedSkillOf({ ...rows[1]!, checked: true }, similar)).toBe("Python");
    expect(similarLinkedSkillOf({ ...rows[1]!, skillId: "s-sql" }, similar)).toBeNull();
    expect(similarLinkedSkillOf({ ...rows[3]!, skillName: " phan tich va quan ly  yeu cau " }, similar)).toBe("Phân tích yêu cầu");
    expect(similarLinkedSkillOf({ ...rows[3]!, skillName: "Quản lý phạm vi dự án" }, similar)).toBeNull();
    expect(validateRows(rows, [], catalog)).toMatchObject({ valid: true, selected: 1, selectable: 3 });
  });
  it("flags missing titles, missing names, repeated and linked skills on ticked rows only", () => {
    const rows = rowsFromSuggestion(items);
    rows[0] = { ...rows[0]!, title: "  " };
    rows[1] = { ...rows[1]!, skillId: "s-sql" };
    rows[3] = { ...rows[3]!, checked: true, skillName: "" };
    const check = validateRows(rows, [], catalog);
    expect(check.valid).toBe(false);
    expect(check.errors["row-0"]).toEqual(["Kỹ năng này được chọn ở nhiều dòng.", "Nhập nội dung yêu cầu."]);
    expect(check.errors["row-1"]).toEqual(["Kỹ năng này được chọn ở nhiều dòng."]);
    expect(check.errors["row-3"]).toEqual(["Nhập tên kỹ năng mới."]);
    expect(check.errors["row-2"]).toBeUndefined();
    rows[1] = { ...rows[1]!, checked: false };
    expect(validateRows(rows, [], catalog).errors["row-0"]).toEqual(["Nhập nội dung yêu cầu."]);
  });
  it("treats a new name equal to a catalog skill as that skill, and checks the career links", () => {
    const rows = rowsFromSuggestion(items).map((row) => row.isNewSkill ? { ...row, checked: true, skillName: "sql " } : row);
    expect(validateRows(rows, [], catalog).errors["row-3"]).toEqual(["Kỹ năng này được chọn ở nhiều dòng."]);
    const linked = validateRows(rowsFromSuggestion(items), [{ skillId: "s-py", skillName: "Lập trình Python" }], catalog);
    expect(linked.errors["row-1"]).toEqual(["Kỹ năng này đã được liên kết với nghề này."]);
    const byName = rowsFromSuggestion(items).map((row) => row.isNewSkill ? { ...row, checked: true, skillName: "Ke chuyen bang du lieu" } : row);
    expect(validateRows(byName, [{ skillId: "old", skillName: "Kể chuyện bằng dữ liệu" }], catalog).errors["row-3"]).toEqual(["Kỹ năng này đã được liên kết với nghề này."]);
  });
  it("sends only ticked rows with their source index", () => {
    const rows = rowsFromSuggestion(items).map((row) => row.isNewSkill ? { ...row, checked: true, title: " Kể chuyện bằng dữ liệu cho lãnh đạo " } : row);
    expect(applyItems(rows)).toEqual([
      { skillId: "s-sql", skillName: "", title: "Viết truy vấn SQL để trích xuất dữ liệu", description: "Dùng hằng ngày.", isRequired: false, sourceIndex: 0 },
      { skillId: "s-py", skillName: "", title: "Viết truy vấn SQL để trích xuất dữ liệu", description: "Dùng hằng ngày.", isRequired: true, sourceIndex: 1 },
      { skillId: null, skillName: "Kể chuyện bằng dữ liệu", title: "Kể chuyện bằng dữ liệu cho lãnh đạo", description: "Dùng hằng ngày.", isRequired: false, sourceIndex: 3 },
    ]);
  });
  it("notices edits, untick and removals", () => {
    const rows = rowsFromSuggestion(items);
    expect(hasEdits(rows, items)).toBe(false);
    expect(hasEdits(rows.slice(1), items)).toBe(true);
    expect(hasEdits(rows.map((row, at) => at === 0 ? { ...row, checked: false } : row), items)).toBe(true);
    expect(hasEdits(rows.map((row, at) => at === 1 ? { ...row, description: "Khác" } : row), items)).toBe(true);
  });
});
