import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminWorkspace from "./AdminWorkspace";
import { adminNavigation } from "./admin-navigation";
import type { AuthenticatedUser } from "./types";

const user: AuthenticatedUser = { userId: "u1", identityKey: "k", tenantId: "t", objectId: "o", name: "Quản trị", email: null, username: null, role: "admin", signedInAt: "2026-10-13T00:00:00Z" };

function render(pathname: string) {
  vi.stubGlobal("window", { location: { pathname, hash: "", search: "" } });
  return renderToStaticMarkup(<AdminWorkspace user={user} busy={false} error={null} onLogout={() => undefined} />);
}

afterEach(() => vi.unstubAllGlobals());

describe("admin workspace", () => {
  it("shows the short names in the sidebar, in order, with the career pages under Quản lý nghề nghiệp", () => {
    const nav = render("/quantri/tai-khoan").match(/<nav id="admin-navigation".*?<\/nav>/s)?.[0] ?? "";
    expect([...nav.matchAll(/<span>([^<]*)<\/span>/g)].map(match => match[1])).toEqual(
      ["Tài khoản", "Sinh viên", "Chương trình", "Tốt nghiệp", "Kế hoạch", "Quản lý nghề nghiệp", "Nghề nghiệp", "Lĩnh vực", "Kỹ năng", "Năng lực"]);
  });

  it("keeps Quản lý nghề nghiệp closed elsewhere and open on its pages", () => {
    const closed = render("/quantri/tai-khoan");
    expect(closed).toContain('<button type="button" class="am-nav-group-toggle" aria-expanded="false" aria-controls="admin-navigation-careers">');
    expect(closed).toContain('<div id="admin-navigation-careers" class="am-nav-sub" hidden="">');
    for (const path of ["/quantri/vi-tri-nghe-nghiep", "/quantri/linh-vuc-nghe-nghiep", "/quantri/ky-nang"]) {
      const open = render(path);
      expect(open).toContain('<button type="button" class="am-nav-group-toggle am-nav-group-current" aria-expanded="true" aria-controls="admin-navigation-careers">');
      expect(open).toContain('<div id="admin-navigation-careers" class="am-nav-sub">');
      expect(open).toContain(`<a href="${path}" aria-current="page">`);
      // The "Gợi ý quản lý nghề nghiệp" box was removed at the user's request (2026-10-17).
      expect(open).not.toContain("Gợi ý quản lý nghề nghiệp");
    }
  });

  it.each(adminNavigation.map(item => [item.label, item.path] as const))("uses %s as the page title and the breadcrumb", (label, path) => {
    const html = render(path);
    expect(html).toContain(`>${label}</h1>`);
    expect(html).toContain(`Quản trị / <strong>${label}</strong>`);
  });
});
