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
  it("shows the short names in the sidebar, in order", () => {
    const nav = render("/quantri/tai-khoan").match(/<nav id="admin-navigation".*?<\/nav>/s)?.[0] ?? "";
    expect([...nav.matchAll(/<span>([^<]*)<\/span>/g)].map(match => match[1])).toEqual(adminNavigation.map(item => item.label));
  });

  it.each(adminNavigation.map(item => [item.label, item.path] as const))("uses %s as the page title and the breadcrumb", (label, path) => {
    const html = render(path);
    expect(html).toContain(`>${label}</h1>`);
    expect(html).toContain(`Quản trị / <strong>${label}</strong>`);
  });
});
