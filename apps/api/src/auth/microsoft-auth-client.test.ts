import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { MsalMicrosoftAuthClient } from "./microsoft-auth-client.js";

describe("Microsoft logout destinations", () => {
  const client = new MsalMicrosoftAuthClient(loadConfig({
    NODE_ENV: "test",
    SESSION_SECRET: "test-session-secret-at-least-32-characters",
    ENTRA_CLIENT_ID: "11111111-1111-4111-8111-111111111111",
    ENTRA_CLIENT_SECRET: "test-only-secret",
    ENTRA_TENANT_ID: "22222222-2222-4222-8222-222222222222",
    WEB_ORIGIN: "https://edupath.example"
  }));

  it.each(["/", "/quantri"] as const)("uses the fixed destination %s", (path) => {
    const url = new URL(client.getLogoutUrl("test-tenant", path));
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toBe("/test-tenant/oauth2/v2.0/logout");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(`https://edupath.example${path}`);
  });

  it("preserves the default Student introduction destination", () => {
    expect(new URL(client.getLogoutUrl()).searchParams.get("post_logout_redirect_uri")).toBe("https://edupath.example/");
  });

  it("passes the login hint on so Microsoft skips its account picker", () => {
    const url = new URL(client.getLogoutUrl("test-tenant", "/", "opaque-login-hint"));
    expect(url.searchParams.get("logout_hint")).toBe("opaque-login-hint");
  });

  it("omits the hint when the tenant does not release the login_hint claim", () => {
    expect(new URL(client.getLogoutUrl("test-tenant")).searchParams.has("logout_hint")).toBe(false);
  });
});
