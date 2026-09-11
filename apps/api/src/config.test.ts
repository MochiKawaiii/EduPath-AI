import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const baseEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  SESSION_SECRET: "a-secure-session-secret-with-at-least-32-characters",
  DATABASE_URL: "postgresql://test:test@localhost:5432/edupath_test",
  ENTRA_CLIENT_ID: "11111111-1111-4111-8111-111111111111",
  ENTRA_CLIENT_SECRET: "test-client-secret",
  ENTRA_TENANT_ID: "22222222-2222-4222-8222-222222222222",
  ENTRA_ALLOW_ANY_TENANT: "false",
  AUTH_DEFAULT_ROLE: "student"
};

describe("loadConfig", () => {
  it.each([undefined, "", "   "])("allows a preview without DATABASE_URL (%s)", (url) => {
    const config = loadConfig({ ...baseEnvironment, DATABASE_URL: url });
    expect(config.database.url).toBeUndefined();
    expect(config.entra.allowAnyTenant).toBe(false);
    expect(config.session.secure).toBe(true);
  });
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
    expect(config.database.maxConnections).toBe(10);
    expect(config.database.autoMigrate).toBe(true);
  });

  it("keeps configured origins and returns logout to the introduction page", () => {
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
      "https://example.edu.vn/"
    );
  });

  it.each(["/", "/login", "/dashboard", "/auth/callback?returnTo=%2Fdashboard"])(
    "normalizes a legacy logout destination %s to the introduction page",
    (path) => {
      const config = loadConfig({
        ...baseEnvironment,
        ENTRA_POST_LOGOUT_REDIRECT_URI: `https://example.edu.vn${path}`
      });
      expect(config.entra.postLogoutRedirectUri).toBe("https://example.edu.vn/");
    }
  );

  it("allows explicitly configured multitenant Student registration in production", () => {
    const config = loadConfig({
      ...baseEnvironment,
      ENTRA_ALLOW_ANY_TENANT: "true"
    });
    expect(config.entra.allowAnyTenant).toBe(true);
    expect(config.authDefaultRole).toBe("student");
    expect(config.session.secure).toBe(true);
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        DATABASE_URL: "https://database.example.com"
      })
    ).toThrow("DATABASE_URL must be a valid PostgreSQL connection URL");
  });
});
