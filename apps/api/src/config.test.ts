import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const baseEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  SESSION_SECRET: "a-secure-session-secret-with-at-least-32-characters",
  ENTRA_CLIENT_ID: "11111111-1111-4111-8111-111111111111",
  ENTRA_CLIENT_SECRET: "test-client-secret",
  ENTRA_TENANT_ID: "22222222-2222-4222-8222-222222222222",
  ENTRA_ALLOW_ANY_TENANT: "false",
  AUTH_DEFAULT_ROLE: "student"
};

describe("loadConfig", () => {
  it("derives production URLs from the Render hostname", () => {
    const config = loadConfig({
      ...baseEnvironment,
      RENDER_EXTERNAL_HOSTNAME: "edupath-ai-vlu.onrender.com"
    });

    expect(config.webOrigin).toBe("https://edupath-ai-vlu.onrender.com");
    expect(config.entra.redirectUri).toBe(
      "https://edupath-ai-vlu.onrender.com/api/auth/microsoft/callback"
    );
    expect(config.entra.postLogoutRedirectUri).toBe(
      "https://edupath-ai-vlu.onrender.com/"
    );
    expect(config.session.secure).toBe(true);
  });

  it("keeps explicitly configured URLs", () => {
    const config = loadConfig({
      ...baseEnvironment,
      WEB_ORIGIN: "https://example.edu.vn/",
      ENTRA_REDIRECT_URI: "https://api.example.edu.vn/api/auth/microsoft/callback",
      ENTRA_POST_LOGOUT_REDIRECT_URI: "https://example.edu.vn/signed-out"
    });

    expect(config.webOrigin).toBe("https://example.edu.vn");
    expect(config.entra.redirectUri).toBe(
      "https://api.example.edu.vn/api/auth/microsoft/callback"
    );
    expect(config.entra.postLogoutRedirectUri).toBe(
      "https://example.edu.vn/signed-out"
    );
  });

  it("rejects an unrestricted production tenant with automatic Student access", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        ENTRA_ALLOW_ANY_TENANT: "true"
      })
    ).toThrow(
      "Production cannot allow every tenant while assigning Student as the default role"
    );
  });
});
