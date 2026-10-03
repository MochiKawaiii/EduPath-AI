import { describe, expect, it } from "vitest";
import { resolveAppRoute, safeReturnTo } from "./routing";

describe("public and authenticated routes", () => {
  it("routes the admin portal independently from student login", () => {
    expect(resolveAppRoute("/quantri", "")).toBe("admin");
    expect(resolveAppRoute("/quantri/", "?authError=admin_required")).toBe("admin");
    expect(resolveAppRoute("/quantri/users", "")).toBe("admin");
    expect(resolveAppRoute("/quantrifake", "")).toBe("authenticated");
    expect(safeReturnTo("?returnTo=%2Fquantri")).toBe("/quantri");
  });
  it("opens the public overview without an authentication decision", () => {
    expect(resolveAppRoute("/", "")).toBe("landing");
    expect(resolveAppRoute("/", "?utm_source=vlu")).toBe("landing");
  });

  it.each([
    ["/chinh-sach-va-dieu-khoan", "policy"],
    ["/chinh-sach-bao-mat", "policy"],
    ["/dieu-khoan-su-dung", "policy"],
    ["/cau-hoi-thuong-gap", "faq"],
  ] as const)("keeps public information route %s public with slash and query variants", (path, route) => {
    expect(resolveAppRoute(path, "")).toBe(route);
    expect(resolveAppRoute(`${path}/`, "?source=footer")).toBe(route);
    expect(resolveAppRoute(`${path}///`, "?authError=invalid_state&source=footer")).toBe(route);
  });

  it.each([
    "/chinh-sach-va-dieu-khoan-extra",
    "/chinh-sach-va-dieu-khoan/chi-tiet",
    "/chinh-sach-bao-mat-extra",
    "/chinh-sach-bao-mat/chi-tiet",
    "/dieu-khoan-su-dung-moi",
    "/dieu-khoan-su-dung/chi-tiet",
    "/cau-hoi-thuong-gap-extra",
    "/cau-hoi-thuong-gap/chi-tiet",
  ])("keeps nearby unsupported path %s behind authentication", (path) => {
    expect(resolveAppRoute(path, "")).toBe("authenticated");
    expect(resolveAppRoute(path, "?authError=invalid_state")).toBe("authenticated");
  });

  it("keeps legacy home-page authentication errors visible on login", () => {
    expect(resolveAppRoute("/", "?authError=invalid_state")).toBe("login");
  });

  it("separates login, dashboard and the Microsoft callback", () => {
    expect(resolveAppRoute("/login", "")).toBe("login");
    expect(resolveAppRoute("/login/", "")).toBe("login");
    expect(resolveAppRoute("/dashboard", "")).toBe("authenticated");
    expect(resolveAppRoute("/auth/callback", "")).toBe("authenticated");
  });
});

describe("post-login return destination", () => {
  it("preserves a dashboard query and fragment", () => {
    expect(safeReturnTo("?returnTo=%2Fdashboard%3Ftab%3Dprofile%23overview")).toBe(
      "/dashboard?tab=profile#overview"
    );
  });

  it.each([
    "",
    "/",
    "/login",
    "/auth/callback",
    "/api/auth/microsoft/start",
    "https://other.example",
    "//other.example",
    "/\\other.example",
    "/dashboard/../login",
    "/%2e%2e/login",
    "/dashboard\n"
  ])("normalizes unsafe or public destination %j to the dashboard", (destination) => {
    const search = new URLSearchParams({ returnTo: destination }).toString();
    expect(safeReturnTo(search)).toBe("/dashboard");
  });
});
