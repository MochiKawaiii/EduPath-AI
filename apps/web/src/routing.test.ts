import { describe, expect, it } from "vitest";
import { resolveAppRoute, safeReturnTo } from "./routing";

describe("public and authenticated routes", () => {
  it("opens the public overview without an authentication decision", () => {
    expect(resolveAppRoute("/", "")).toBe("landing");
    expect(resolveAppRoute("/", "?utm_source=vlu")).toBe("landing");
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
