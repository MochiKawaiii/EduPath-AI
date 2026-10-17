import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CareerFieldsManagement from "./CareerFieldsManagement";
import CareerSkillsManagement from "./CareerSkillsManagement";
import CareersManagement from "./CareersManagement";
import { useData } from "./admin-ui";

vi.mock("./admin-ui", async importOriginal => ({
  ...await importOriginal<typeof import("./admin-ui")>(),
  useData: vi.fn(),
  // The real menu lists its items only once opened; list them all so the markup shows what a row offers.
  ActionMenu: ({ items }: { items: { label: string }[] }) => <ul>{items.map(item => <li key={item.label}>{item.label}</li>)}</ul>,
}));

const pages: [string, string, typeof CareerFieldsManagement, unknown][] = [
  ["Lĩnh vực", "Thêm lĩnh vực", CareerFieldsManagement, { id: "f1", code: "1", name: "An ninh mạng", description: "", version: "1" }],
  ["Kỹ năng", "Thêm kỹ năng", CareerSkillsManagement, { id: "s1", name: "SQL", description: "", version: "1", careerCount: 0 }],
];

describe.each(pages)("%s page", (_name, add, Page, row) => {
  function render(items: unknown[], canManage = true) {
    vi.mocked(useData).mockReturnValue({ data: { items }, error: null, loading: false, retry: () => undefined } as never);
    return renderToStaticMarkup(<Page canManage={canManage} />);
  }

  it("adds from the red button at the top right of the card, not from the row menu", () => {
    const html = render([row]);
    // Every item is a verb plus the noun (user, 2026-10-17): "Thêm lĩnh vực" → "lĩnh vực".
    const noun = add.replace(/^Thêm /, "");
    expect([...html.matchAll(/<li>([^<]*)<\/li>/g)].map(match => match[1])).toEqual([`Xem chi tiết ${noun}`, `Chỉnh sửa ${noun}`, `Xóa ${noun}`]);
    expect(html).toMatch(new RegExp(`<div class="career-list-heading"><div><h2>.*?</h2><p>[^<]*</p></div><button class="am-primary">.*?${add}</button></div>`, "s"));
    expect(html).toContain('<span class="am-count">1</span>');
  });

  it("has just a search box, so no clear-filter button", () => {
    const html = render([row]);
    expect(html).toContain('type="search"');
    expect(html).not.toContain("Xóa bộ lọc");
  });

  it("keeps the one add button at the top when there are no rows", () => {
    const html = render([]);
    expect(html).toMatch(/<p class="am-empty">[^<]+<\/p>/);
    expect(html.split(add)).toHaveLength(2);
  });

  it("offers no way to add to people who cannot manage", () => {
    expect(render([row], false)).not.toContain(add);
    expect(render([], false)).not.toContain(add);
  });
});

describe("Nghề nghiệp page", () => {
  const career = { id: "c1", code: "NN001", nameVi: "Kỹ sư dữ liệu", nameEn: "Data engineer", category: "1", description: "", skills: [], version: "1", deletedAt: null };
  function render(items: unknown[], canManage = true) {
    vi.mocked(useData).mockReturnValue({ data: { items }, error: null, loading: false, retry: () => undefined } as never);
    return renderToStaticMarkup(<CareersManagement canManage={canManage} />);
  }

  it("adds from the red button at the top right of the card, not from the row menu", () => {
    const html = render([career]);
    expect([...html.matchAll(/<li>([^<]*)<\/li>/g)].map(match => match[1])).toEqual(
      ["Xem chi tiết vị trí nghề nghiệp", "Chỉnh sửa vị trí nghề nghiệp", "Tạo liên kết kỹ năng", "Xóa vị trí nghề nghiệp"]);
    expect(html).toMatch(/<div class="career-list-heading"><div><h2>.*?<\/h2><p>[^<]*<\/p><\/div><button class="am-primary">.*?Thêm vị trí nghề nghiệp<\/button><\/div>/s);
    expect(render([]).split("Thêm vị trí nghề nghiệp")).toHaveLength(2);
  });

  it("offers no way to add to people who cannot manage", () => {
    expect(render([career], false)).not.toContain("Thêm vị trí nghề nghiệp");
  });
});
