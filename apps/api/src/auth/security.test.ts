import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import type { MicrosoftIdentity } from "./types.js";
import {
  assertIdentityIsAllowed,
  createAuthTransaction,
  normalizeReturnTo,
  resolveAppRole,
  toAuthenticatedUser
} from "./security.js";

const clientId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";

function config(overrides: Partial<AppConfig["entra"]> = {}): AppConfig {
  return {
    nodeEnv: "test",
    port: 4000,
    webOrigin: "http://localhost:5173",
    session: {
      secret: "test-session-secret-that-is-longer-than-32-characters",
      maxAgeMs: 28_800_000,
      secure: false
    },
    trustProxy: false,
    entra: {
      clientId,
      clientSecret: "test-secret",
      tenantId,
      authority: "https://login.microsoftonline.com/organizations",
      redirectUri: "http://localhost:4000/api/auth/microsoft/callback",
      postLogoutRedirectUri: "http://localhost:5173/",
      allowAnyTenant: false,
      allowedTenantIds: new Set([tenantId]),
      ...overrides
    },
    authDefaultRole: "student"
  };
}

function identity(overrides: Partial<MicrosoftIdentity> = {}): MicrosoftIdentity {
  return {
    tenantId,
    objectId: "33333333-3333-4333-8333-333333333333",
    subject: "subject",
    name: "Test Student",
    email: "student@example.edu",
    username: "student@example.edu",
    roles: [],
    nonce: "expected-nonce",
    audience: clientId,
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides
  };
}

describe("authentication security helpers", () => {
  it("creates independent state, nonce and a valid S256 PKCE challenge", () => {
    const first = createAuthTransaction("/dashboard");
    const second = createAuthTransaction("/dashboard");

    expect(first.state).not.toBe(second.state);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(first.codeChallenge).toBe(
      createHash("sha256").update(first.codeVerifier).digest("base64url")
    );
  });

  it.each([
    ["https://evil.example", "/dashboard"],
    ["//evil.example/path", "/dashboard"],
    ["/safe/path?tab=1", "/safe/path?tab=1"],
    [undefined, "/dashboard"]
  ])("normalizes return path %s", (value, expected) => {
    expect(normalizeReturnTo(value)).toBe(expected);
  });

  it("accepts the matching nonce, audience, issuer and tenant", () => {
    const transaction = createAuthTransaction("/dashboard");
    expect(() =>
      assertIdentityIsAllowed(identity({ nonce: transaction.nonce }), transaction, config())
    ).not.toThrow();
  });

  it("rejects an identity from a tenant outside the allowlist", () => {
    const transaction = createAuthTransaction("/dashboard");
    const otherTenant = "44444444-4444-4444-8444-444444444444";
    expect(() =>
      assertIdentityIsAllowed(
        identity({
          tenantId: otherTenant,
          issuer: `https://login.microsoftonline.com/${otherTenant}/v2.0`,
          nonce: transaction.nonce
        }),
        transaction,
        config()
      )
    ).toThrow("tenant is not allowed");
  });

  it("prioritizes Admin, supports Student, and never defaults to Admin", () => {
    expect(resolveAppRole(["Student"], "none")).toBe("student");
    expect(resolveAppRole(["Student", "Admin"], "student")).toBe("admin");
    expect(resolveAppRole([], "student")).toBe("student");
    expect(() => resolveAppRole([], "none")).toThrow("not been assigned");
  });

  it("uses tenant and object IDs as the stable identity key", () => {
    const user = toAuthenticatedUser(identity(), "student");
    expect(user.identityKey).toBe(`${tenantId}:33333333-3333-4333-8333-333333333333`);
    expect(user.role).toBe("student");
  });
});

