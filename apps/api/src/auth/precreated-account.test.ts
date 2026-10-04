import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import type { AppConfig } from "../config.js";
import type { AuthTransaction, AuthenticatedUser, MicrosoftAuthClient, MicrosoftIdentity } from "./types.js";
import type { UserRepository } from "../users/user-repository.js";

const clientId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const objectId = "33333333-3333-4333-8333-333333333333";

const config: AppConfig = {
  nodeEnv: "test",
  port: 4000,
  webOrigin: "http://localhost:5173",
  session: {
    secret: "test-session-secret-that-is-longer-than-32-characters",
    maxAgeMs: 28_800_000,
    secure: false
  },
  trustProxy: false,
  database: {
    url: undefined,
    maxConnections: 2,
    connectionTimeoutMs: 1_000,
    idleTimeoutMs: 1_000,
    autoMigrate: false
  },
  entra: {
    clientId,
    clientSecret: "test-secret",
    tenantId,
    authority: "https://login.microsoftonline.com/organizations",
    redirectUri: "http://localhost:4000/api/auth/microsoft/callback",
    postLogoutRedirectUri: "http://localhost:5173/",
    allowAnyTenant: true,
    allowedTenantIds: new Set([tenantId])
  },
  authDefaultRole: "none",
  staffEmailDomains: new Set()
};

const identity: MicrosoftIdentity = {
  tenantId,
  objectId,
  subject: "microsoft-subject",
  name: "Approved Administrator",
  email: "admin@outside.example",
  username: "admin@outside.example",
  loginHint: null,
  roles: [],
  nonce: "unused",
  audience: clientId,
  issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
  expiresAt: Math.floor(Date.now() / 1000) + 3_600
};

describe("precreated account authentication", () => {
  it("uses the pending admin grant to enter /quantri when the default role is none", async () => {
    const authClient: MicrosoftAuthClient = {
      getAuthorizationUrl: vi.fn(async (transaction: AuthTransaction) => {
        const url = new URL("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
        url.searchParams.set("state", transaction.state);
        return url.toString();
      }),
      exchangeAuthorizationCode: vi.fn(async (_code: string, _verifier: string, nonce: string) => ({ ...identity, nonce })),
      getLogoutUrl: vi.fn(() => "https://login.microsoftonline.com/logout")
    };
    const user: AuthenticatedUser = {
      authVersion: 4,
      userId: "44444444-4444-4444-8444-444444444444",
      identityKey: `${tenantId}:${objectId}`,
      tenantId,
      objectId,
      name: identity.name,
      email: identity.email,
      username: identity.username,
      role: "admin",
      signedInAt: new Date().toISOString()
    };
    const repository: UserRepository = {
      // Represents the same-tenant pending username grant resolved by the PostgreSQL repository.
      getRoleOverride: vi.fn().mockResolvedValue("admin"),
      upsertMicrosoftUser: vi.fn().mockResolvedValue(user)
    };
    const agent = request.agent(createApp({ config, microsoftAuthClient: authClient, userRepository: repository }));

    expect(config.authDefaultRole).toBe("none");
    const start = await agent.get("/api/auth/microsoft/start").query({ returnTo: "/quantri" }).expect(302);
    const state = new URL(start.headers.location).searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await agent.get("/api/auth/microsoft/callback").query({ code: "authorization-code", state }).expect(302);
    expect(callback.headers.location).toBe(`${config.webOrigin}/quantri`);
    expect(repository.getRoleOverride).toHaveBeenCalledWith(expect.objectContaining({ tenantId, username: identity.username }));
    expect(repository.upsertMicrosoftUser).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, objectId, username: identity.username }),
      "admin",
      { requireRoleOverride: true }
    );
    await agent.get("/api/admin/me").expect(200).expect(({ body }) => {
      expect(body.authenticated).toBe(true);
      expect(body.user.userId).toBe(user.userId);
      expect(body.user.role).toBe("admin");
    });
  });
});
