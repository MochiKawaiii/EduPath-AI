import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CareerFieldsManagement from "./CareerFieldsManagement";
import CareerSkillsManagement from "./CareerSkillsManagement";
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

  it("adds from the row menu, not from a button above the table", () => {
    const html = render([row]);
    expect([...html.matchAll(/<li>([^<]*)<\/li>/g)].map(match => match[1])).toEqual(["Xem chi tiết", "Chỉnh sửa", add, "Xóa"]);
    expect(html.match(/<div class="career-list-heading">.*?<\/div>/s)?.[0]).not.toContain("<button");
    expect(html).toContain('<span class="am-count">1</span>');
  });

  it("has just a search box, so no clear-filter button", () => {
    const html = render([row]);
    expect(html).toContain('type="search"');
    expect(html).not.toContain("Xóa bộ lọc");
  });

  it("offers the add button under the table when there are no rows", () => {
    expect(render([])).toMatch(new RegExp(`<div class="am-empty"><p>[^<]*</p><button class="am-primary"[^>]*>.*?${add}</button>`, "s"));
  });

  it("offers no way to add to people who cannot manage", () => {
    expect(render([row], false)).not.toContain(add);
    expect(render([], false)).not.toContain(add);
  });
});
