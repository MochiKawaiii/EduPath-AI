import { describe, expect, it } from "vitest";
import { applyLinkItems, assessWeightRows, batchProgress, batchPending, failureMessage, linkRows, skipReason, validateLinkRows, weightRows, type CourseAiBatch, type CourseAiItem } from "./competency-ai";

const item = (patch: Partial<CourseAiItem>): CourseAiItem => ({
  index: 0, skillId: "s-web", skillName: "Lập trình web", groupId: "g-core", groupName: "Chuyên môn", hasProfile: true,
  isNewSkill: false, alreadyLinked: false, percent: null, reason: "Học phần dạy trực tiếp.", ...patch,
});

describe("link review", () => {
  const items = [
    item({}),
    item({ index: 1, skillId: "s-team", skillName: "Làm việc nhóm", alreadyLinked: true }),
    item({ index: 2, skillId: "s-docker", skillName: "Docker", hasProfile: false, groupId: null, groupName: null }),
    item({ index: 3, skillId: null, skillName: "Kiểm thử API", hasProfile: false, isNewSkill: true }),
  ];

  it("ticks catalog skills, never a linked one, and leaves new skills to the admin", () => {
    expect(linkRows(items).map((row) => [row.skillName, row.checked])).toEqual([
      ["Lập trình web", true], ["Làm việc nhóm", false], ["Docker", true], ["Kiểm thử API", false],
    ]);
  });

  it("needs a group for a skill without a profile and a name for a new skill", () => {
    const rows = linkRows(items);
    const check = validateLinkRows(rows);
    expect(check.valid).toBe(false);
    expect(check.selected).toBe(2);
    expect(check.errors["row-2"]).toEqual(["Chọn nhóm năng lực."]);
    const fixed = rows.map((row) => row.key === "row-2" ? { ...row, groupId: "g-core" } : row.key === "row-3" ? { ...row, checked: true, skillName: "  " } : row);
    expect(validateLinkRows(fixed).errors["row-3"]).toEqual(["Nhập tên kỹ năng mới."]);
    const ready = fixed.map((row) => row.key === "row-3" ? { ...row, skillName: "Kiểm thử  API" } : row);
    expect(validateLinkRows(ready).valid).toBe(true);
    expect(applyLinkItems(ready)).toEqual([
      { skillId: "s-web", skillName: "", groupId: null },
      { skillId: "s-docker", skillName: "", groupId: "g-core" },
      { skillId: null, skillName: "Kiểm thử API", groupId: "g-core" },
    ]);
  });

  it("refuses an empty selection and the same new name twice", () => {
    expect(validateLinkRows(linkRows([item({ alreadyLinked: true })])).valid).toBe(false);
    const twice = linkRows([item({ skillId: null, isNewSkill: true, hasProfile: false, skillName: "Kiểm thử API" }),
      item({ index: 1, skillId: null, isNewSkill: true, hasProfile: false, skillName: "kiem thu api" })]).map((row) => ({ ...row, checked: true }));
    expect(validateLinkRows(twice).errors["row-1"]).toEqual(["Kỹ năng này đã có ở dòng khác."]);
  });
});

describe("weight review", () => {
  const rows = weightRows([item({ percent: 60 }), item({ index: 1, skillId: "s-db", skillName: "Thiết kế cơ sở dữ liệu", percent: 40 })]);

  it("starts from the AI percents and can apply only at exactly 100%", () => {
    expect(assessWeightRows(rows)).toMatchObject({ total: 100, valid: true, canActivate: true, edited: 0, weights: [{ skillId: "s-web", percent: 60 }, { skillId: "s-db", percent: 40 }] });
    const lower = rows.map((row, index) => index === 0 ? { ...row, percent: "50" } : row);
    expect(assessWeightRows(lower)).toMatchObject({ total: 90, valid: true, canActivate: false, edited: 1 });
    const wrong = rows.map((row, index) => index === 0 ? { ...row, percent: "120" } : row);
    expect(assessWeightRows(wrong)).toMatchObject({ valid: false, canActivate: false, errors: { "row-0": "Nhập số từ 0 đến 100." } });
  });
});

describe("whole-program run", () => {
  const batch = (patch: Partial<CourseAiBatch>): CourseAiBatch => ({ id: "b1", createdAt: "2026-10-16T05:00:00.000Z", total: 10, queued: 2, processing: 1,
    completed: 6, failed: 1, cancelled: 0, applied: 0, ready: 5, items: [], ...patch });

  it("counts finished jobs and knows when it still runs", () => {
    expect(batchProgress(batch({}))).toEqual({ done: 7, percent: 70 });
    expect(batchPending(batch({}))).toBe(true);
    expect(batchPending(batch({ queued: 0, processing: 0 }))).toBe(false);
    expect(batchPending(null)).toBe(false);
    expect(batchProgress(batch({ total: 0, completed: 0, failed: 0 }))).toEqual({ done: 0, percent: 0 });
  });

  it("explains failures and skipped courses in the admin's words", () => {
    expect(failureMessage("worker_timeout")).toContain("chưa xử lý xong");
    expect(failureMessage("other")).toBe("Chưa tạo được đề xuất.");
    expect(skipReason("course_already_linked")).toBe("đã có liên kết kỹ năng");
    expect(skipReason("x")).toBe("không lưu được");
  });
});
