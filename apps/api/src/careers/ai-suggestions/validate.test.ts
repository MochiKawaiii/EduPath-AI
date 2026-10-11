import { describe, expect, it } from "vitest";
import { buildCareerSuggestionInput } from "./prompt.js";
import { careerSource, fixtureId as id } from "./test-fixture.js";
import { suggestionContextFromAiInput, validateCareerSuggestionOutput, type CareerSuggestionContext } from "./validate.js";

// S001 Rèn luyện thể chất, S002 SQL, S003 Trực quan hóa dữ liệu; Python is already linked.
const context = suggestionContextFromAiInput(buildCareerSuggestionInput(careerSource())) as CareerSuggestionContext;
const item = (skillKey: string, extra: Record<string, unknown> = {}) => ({
  skillKey, priority: "preferred", title: "Viết truy vấn SQL để tổng hợp dữ liệu", description: "Dùng hằng ngày.", reason: "Mô tả vị trí nhắc tới dữ liệu.", ...extra
});
const newSkill = (name: string, extra: Record<string, unknown> = {}) => ({
  name, priority: "preferred", title: "Xây dựng báo cáo tự động", description: "Dùng để báo cáo.", reason: "Danh mục chưa có.", ...extra
});
const validate = (suggestions: unknown[], newSkills: unknown[] = []) => validateCareerSuggestionOutput({ suggestions, newSkills }, context);
const items = (result: ReturnType<typeof validate>) => (result.ok ? result.result.items : []);

describe("suggestionContextFromAiInput", () => {
  it("reads the key map and linked skills back from the stored input", () => {
    expect(context.catalog.map((entry) => entry.key)).toEqual(["S001", "S002", "S003"]);
    expect(context.linked).toEqual([{ id: id(1), name: "Python" }]);
  });

  it("returns null for a malformed input", () => {
    expect(suggestionContextFromAiInput(null)).toBeNull();
    expect(suggestionContextFromAiInput({ catalog: [{ key: "S001" }], linked: [] })).toBeNull();
    expect(suggestionContextFromAiInput({ catalog: [], linked: "x" })).toBeNull();
  });
});

describe("validateCareerSuggestionOutput", () => {
  it("resolves keys to catalog skills and maps the priority", () => {
    const result = validate([item("S002", { priority: "required" }), item("S003")]);
    expect(result).toEqual({ ok: true, result: { returned: 2, dropped: 0, items: [
      { skillId: id(2), skillName: "SQL", isNewSkill: false, isRequired: true, title: "Viết truy vấn SQL để tổng hợp dữ liệu", description: "Dùng hằng ngày.", reason: "Mô tả vị trí nhắc tới dữ liệu." },
      { skillId: id(3), skillName: "Trực quan hóa dữ liệu", isNewSkill: false, isRequired: false, title: "Viết truy vấn SQL để tổng hợp dữ liệu", description: "Dùng hằng ngày.", reason: "Mô tả vị trí nhắc tới dữ liệu." }
    ] } });
  });

  it("drops unknown and repeated keys but keeps the rest", () => {
    const result = validate([item("S002"), item("S099"), item("S002", { title: "Lần hai" })]);
    expect(items(result).map((row) => row.skillId)).toEqual([id(2)]);
    expect(result.ok && result.result.dropped).toBe(2);
  });

  it("replaces keys written in prose with names and strips control tokens", () => {
    const [row] = items(validate([item("S002", {
      title: "Viết truy vấn SQL (S002)<|turn> cho báo cáo",
      description: "Kết hợp S003 với\nSQL.",
      reason: "Cần <eos>S002 - SQL hằng ngày."
    })]));
    expect(row).toMatchObject({ title: "Viết truy vấn SQL cho báo cáo", description: "Kết hợp Trực quan hóa dữ liệu với SQL.", reason: "Cần SQL hằng ngày." });
  });

  it("drops items whose text has a link, an email or HTML", () => {
    const result = validate([
      item("S001", { description: "Xem https://example.org" }),
      item("S002", { reason: "Liên hệ admin@example.edu" }),
      item("S003", { title: "<b>Trình bày</b> dữ liệu" })
    ], [newSkill("Power BI", { description: "Học tại www.example.com" })]);
    expect(result).toEqual({ ok: false, reason: "no_valid_items", path: "" });
  });

  it("caps the text lengths", () => {
    const [row] = items(validate([item("S002", { title: "a".repeat(400), description: "b".repeat(900), reason: "c".repeat(500) })]));
    expect(Array.from(row!.title)).toHaveLength(160);
    expect(row!.title.endsWith("…")).toBe(true);
    expect(Array.from(row!.description)).toHaveLength(600);
    expect(Array.from(row!.reason)).toHaveLength(300);
  });

  it("turns a new name that is already in the catalog into that skill and dedupes new names", () => {
    const result = validate([item("S003")], [
      newSkill("sql"),
      newSkill("Truc quan hoa du lieu"),
      newSkill("PYTHON"),
      newSkill("Power BI", { priority: "required" }),
      newSkill("power bi")
    ].slice(0, 3));
    expect(items(result).map((row) => [row.skillId, row.skillName, row.isNewSkill])).toEqual([
      [id(3), "Trực quan hóa dữ liệu", false],
      [id(2), "SQL", false]
    ]);
    const fresh = items(validate([], [newSkill("Power BI", { priority: "required" }), newSkill("power bi"), newSkill("  ")]));
    expect(fresh).toEqual([{ skillId: null, skillName: "Power BI", isNewSkill: true, isRequired: true,
      title: "Xây dựng báo cáo tự động", description: "Dùng để báo cáo.", reason: "Danh mục chưa có." }]);
  });

  it("accepts an empty answer and rejects a wrong shape", () => {
    expect(validate([], [])).toEqual({ ok: true, result: { items: [], returned: 0, dropped: 0 } });
    expect(validateCareerSuggestionOutput({ suggestions: [] }, context)).toMatchObject({ ok: false, reason: "schema" });
    expect(validateCareerSuggestionOutput("{}", context)).toMatchObject({ ok: false, reason: "schema" });
    expect(validate([item("S002", { level: "advanced" })])).toMatchObject({ ok: false, reason: "schema", path: "suggestions.0" });
    expect(validate([item("S002", { priority: "high" })])).toMatchObject({ ok: false, reason: "schema" });
    expect(validate(Array.from({ length: 13 }, () => item("S002")))).toMatchObject({ ok: false, reason: "schema" });
    expect(validate([], Array.from({ length: 4 }, (_, i) => newSkill(`Kỹ năng ${i}`)))).toMatchObject({ ok: false, reason: "schema" });
  });
});
