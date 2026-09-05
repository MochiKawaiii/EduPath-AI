import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import { toAuthenticatedUser } from "./auth/security.js";
import type {
  AppRole,
  AuthTransaction,
  AuthenticatedUser,
  MicrosoftAuthClient,
  MicrosoftIdentity
} from "./auth/types.js";
import type { UserRepository } from "./users/user-repository.js";

const clientId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";

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
    url: "postgresql://test:test@localhost:5432/edupath_test",
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
  authDefaultRole: "student"
};

class FakeMicrosoftAuthClient implements MicrosoftAuthClient {
  public transaction: AuthTransaction | null = null;
  public nextRoles: string[] = [];
  public exchangeCount = 0;

  public async getAuthorizationUrl(transaction: AuthTransaction): Promise<string> {
    this.transaction = transaction;
    const url = new URL("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    url.searchParams.set("state", transaction.state);
    url.searchParams.set("code_challenge", transaction.codeChallenge);
    return url.toString();
  }

  public async exchangeAuthorizationCode(
    _code: string,
    _codeVerifier: string,
    nonce: string
  ): Promise<MicrosoftIdentity> {
    this.exchangeCount += 1;
    return {
      tenantId,
      objectId: "33333333-3333-4333-8333-333333333333",
      subject: "subject",
      name: "Test User",
      email: "test@example.edu",
      username: "test@example.edu",
      roles: this.nextRoles,
      nonce,
      audience: clientId,
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    };
  }

  public getLogoutUrl(id?: string): string {
    return `https://login.microsoftonline.com/${id ?? "organizations"}/logout`;
  }
}

class FakeUserRepository implements UserRepository {
  public readonly users = new Map<string, AuthenticatedUser>();
  public upsertCount = 0;
  public shouldFail = false;

  public async upsertMicrosoftUser(
    identity: MicrosoftIdentity,
    role: AppRole
  ): Promise<AuthenticatedUser> {
    this.upsertCount += 1;
    if (this.shouldFail) throw new Error("Database unavailable");

    const identityKey = `${identity.tenantId}:${identity.objectId}`;
    const existing = this.users.get(identityKey);
    const user = toAuthenticatedUser(
      identity,
      role,
      existing?.userId ?? "55555555-5555-4555-8555-555555555555"
    );
    this.users.set(identityKey, user);
    return user;
  }
}

function createTestApp(
  authClient: FakeMicrosoftAuthClient,
  userRepository = new FakeUserRepository()
) {
  return createApp({
    config,
    microsoftAuthClient: authClient,
    userRepository
  });
}

async function login(
  agent: ReturnType<typeof request.agent>,
  authClient: FakeMicrosoftAuthClient
) {
  const start = await agent
    .get("/api/auth/microsoft/start")
    .query({ returnTo: "/dashboard" })
    .expect(302);
  const state = new URL(start.headers.location).searchParams.get("state");
  expect(state).toBeTruthy();

  return agent
    .get("/api/auth/microsoft/callback")
    .query({ code: "test-code", state })
    .expect(302);
}

describe("Microsoft authentication routes", () => {
  it("creates PKCE state and a secure local session cookie before redirecting", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const agent = request.agent(createTestApp(authClient));

    const response = await agent.get("/api/auth/microsoft/start").expect(302);

    expect(response.headers.location).toContain("login.microsoftonline.com");
    expect(authClient.transaction?.state).toBeTruthy();
    expect(authClient.transaction?.nonce).toBeTruthy();
    expect(authClient.transaction?.codeVerifier).toBeTruthy();
    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");
  });

  it("creates a Student session after a valid callback", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const userRepository = new FakeUserRepository();
    const agent = request.agent(createTestApp(authClient, userRepository));

    const callback = await login(agent, authClient);
    expect(callback.headers.location).toContain("/auth/callback?returnTo=%2Fdashboard");

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.authenticated).toBe(true);
    expect(me.body.user.role).toBe("student");
    expect(me.body.user.userId).toBe("55555555-5555-4555-8555-555555555555");
    expect(me.body.user.identityKey).toBe(
      `${tenantId}:33333333-3333-4333-8333-333333333333`
    );
    expect(userRepository.upsertCount).toBe(1);
    expect(userRepository.users.size).toBe(1);
  });

  it("upserts the same Microsoft identity instead of creating a duplicate", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const userRepository = new FakeUserRepository();
    const agent = request.agent(createTestApp(authClient, userRepository));

    await login(agent, authClient);
    await login(agent, authClient);

    expect(userRepository.upsertCount).toBe(2);
    expect(userRepository.users.size).toBe(1);
  });

  it("does not create an authenticated session when persistence fails", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const userRepository = new FakeUserRepository();
    userRepository.shouldFail = true;
    const agent = request.agent(createTestApp(authClient, userRepository));

    const callback = await login(agent, authClient);
    expect(callback.headers.location).toContain("authError=callback_failed");

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body).toEqual({ authenticated: false });
  });

  it("rejects an invalid state without exchanging an authorization code", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const agent = request.agent(createTestApp(authClient));
    await agent.get("/api/auth/microsoft/start").expect(302);

    const callback = await agent
      .get("/api/auth/microsoft/callback")
      .query({ code: "test-code", state: "wrong-state" })
      .expect(302);

    expect(callback.headers.location).toContain("authError=invalid_state");
    expect(authClient.exchangeCount).toBe(0);
  });

  it("consumes state once and rejects a replayed callback", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const agent = request.agent(createTestApp(authClient));
    const start = await agent.get("/api/auth/microsoft/start").expect(302);
    const state = new URL(start.headers.location).searchParams.get("state");

    await agent
      .get("/api/auth/microsoft/callback")
      .query({ code: "first-code", state })
      .expect(302);
    const replay = await agent
      .get("/api/auth/microsoft/callback")
      .query({ code: "second-code", state })
      .expect(302);

    expect(replay.headers.location).toContain("authError=invalid_state");
    expect(authClient.exchangeCount).toBe(1);
  });

  it("allows Admin role and blocks Student from the admin endpoint", async () => {
    const studentClient = new FakeMicrosoftAuthClient();
    const student = request.agent(createTestApp(studentClient));
    await login(student, studentClient);
    await student.get("/api/admin/summary").expect(403);

    const adminClient = new FakeMicrosoftAuthClient();
    adminClient.nextRoles = ["Admin"];
    const admin = request.agent(createTestApp(adminClient));
    await login(admin, adminClient);
    await admin.get("/api/admin/summary").expect(200);
  });

  it("destroys the local session on logout and checks the request origin", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const agent = request.agent(createTestApp(authClient));
    await login(agent, authClient);

    await agent
      .post("/api/auth/logout")
      .set("Origin", "https://evil.example")
      .expect(403);

    const logout = await agent
      .post("/api/auth/logout")
      .set("Origin", config.webOrigin)
      .expect(200);
    expect(logout.body.logoutUrl).toContain(tenantId);
    expect(logout.headers["set-cookie"]?.[0]).toContain("edupath.sid=");

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body).toEqual({ authenticated: false });
  });
});
