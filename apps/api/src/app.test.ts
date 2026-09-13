import { describe, expect, it, vi } from "vitest";
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
import { MemoryUserRepository } from "./users/memory-user-repository.js";

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
      loginHint: "test-login-hint",
      roles: this.nextRoles,
      nonce,
      audience: clientId,
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    };
  }

  public getLogoutUrl(id?: string, returnPath: "/" | "/quantri" = "/", logoutHint?: string): string {
    const url = new URL(`https://login.microsoftonline.com/${id ?? "organizations"}/logout`);
    url.searchParams.set("post_logout_redirect_uri", new URL(returnPath, config.webOrigin).toString());
    if (logoutHint) url.searchParams.set("logout_hint", logoutHint);
    return url.toString();
  }
}

class FakeUserRepository implements UserRepository {
  public readonly users = new Map<string, AuthenticatedUser>();
  public upsertCount = 0;
  public shouldFail = false;
  public roleOverride: AppRole | null = null;

  public async getRoleOverride(_identity: MicrosoftIdentity): Promise<AppRole | null> {
    return this.roleOverride;
  }

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
  authClient: FakeMicrosoftAuthClient,
  returnTo = "/dashboard"
) {
  const start = await agent
    .get("/api/auth/microsoft/start")
    .query({ returnTo })
    .expect(302);
  const state = new URL(start.headers.location).searchParams.get("state");
  expect(state).toBeTruthy();

  return agent
    .get("/api/auth/microsoft/callback")
    .query({ code: "test-code", state })
    .expect(302);
}

describe("Microsoft authentication routes", () => {
  it("records successful sign-in and rejects a subsequently revoked session", async () => {
    const client = new FakeMicrosoftAuthClient(); client.nextRoles = ["Admin"];
    const activity = { current: vi.fn().mockResolvedValue(true), record: vi.fn().mockResolvedValue(undefined) };
    const agent = request.agent(createApp({ config, microsoftAuthClient: client, userRepository: new FakeUserRepository(), authActivity: activity }));
    await login(agent, client, "/quantri");
    expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), "success", "signed_in", "admin");
    await agent.get("/api/admin/me").expect(200);
    activity.current.mockResolvedValue(false);
    await agent.get("/api/admin/summary").expect(401);
    activity.current.mockResolvedValue(true);
    await agent.get("/api/admin/me").expect(401);
  });
  it("records verified admin denial but never fabricates an identity for invalid state", async () => {
    const client = new FakeMicrosoftAuthClient();
    const activity = { current: vi.fn().mockResolvedValue(true), record: vi.fn().mockResolvedValue(undefined) };
    const agent = request.agent(createApp({ config, microsoftAuthClient: client, userRepository: new FakeUserRepository(), authActivity: activity }));
    await login(agent, client, "/quantri");
    expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), "denied", "admin_required", "admin");
    activity.record.mockClear();
    await agent.get("/api/auth/microsoft/callback?state=invalid&code=bad").expect(302);
    expect(activity.record).not.toHaveBeenCalled();
  });
  it("does not leave a usable session if history persistence fails", async () => {
    const client = new FakeMicrosoftAuthClient(); client.nextRoles = ["Admin"];
    const activity = { current: vi.fn().mockResolvedValue(true), record: vi.fn().mockRejectedValue(new Error("storage unavailable")) };
    const agent = request.agent(createApp({ config, microsoftAuthClient: client, userRepository: new FakeUserRepository(), authActivity: activity }));
    expect((await login(agent, client, "/quantri")).headers.location).toContain("authError=callback_failed");
    await agent.get("/api/admin/me").expect(401);
  });
  it.each(["faculty_board", "department_head", "lecturer", "admin"] as const)("allows assigned %s to sign in to both portals", async role => {
    const client = new FakeMicrosoftAuthClient();
    const repository = new FakeUserRepository(); repository.roleOverride = role;
    const agent = request.agent(createTestApp(client, repository));
    expect((await login(agent, client, "/quantri")).headers.location).toBe(`${config.webOrigin}/quantri`);
    await agent.get("/api/admin/me").expect(200);
    await agent.post("/api/auth/logout").expect(200);
    expect((await login(agent, client, "/dashboard")).headers.location).toContain("/auth/callback");
    await agent.get("/api/student/summary").expect(200);
    const result = await agent.post("/api/auth/logout").expect(200);
    expect(new URL(result.body.logoutUrl).searchParams.get("post_logout_redirect_uri")).toBe(`${config.webOrigin}/`);
  });
  it("accepts a database-assigned Admin without a Microsoft Admin claim", async () => {
    const client = new FakeMicrosoftAuthClient();
    const repository = new FakeUserRepository();
    repository.roleOverride = "admin";
    const agent = request.agent(createTestApp(client, repository));
    const callback = await login(agent, client, "/quantri");
    expect(callback.headers.location).toBe(`${config.webOrigin}/quantri`);
    expect((await agent.get("/api/admin/me").expect(200)).body.user.role).toBe("admin");
    await agent.post("/api/auth/logout").expect(200);
    await login(agent, client, "/quantri");
    await agent.get("/api/admin/me").expect(200);
  });

  it("honors an explicit Student override even with a Microsoft Admin claim", async () => {
    const client = new FakeMicrosoftAuthClient();
    client.nextRoles = ["Admin"];
    const repository = new FakeUserRepository();
    repository.roleOverride = "student";
    const agent = request.agent(createTestApp(client, repository));
    const callback = await login(agent, client, "/quantri");
    expect(callback.headers.location).toContain("authError=admin_required");
    await agent.get("/api/admin/me").expect(401);
    expect(repository.upsertCount).toBe(0);
  });
  it("admits an Admin via /quantri and ends access after logout", async () => {
    const client = new FakeMicrosoftAuthClient();
    client.nextRoles = ["Admin"];
    const agent = request.agent(createTestApp(client));
    await agent.get("/api/admin/me").expect(401);
    const callback = await login(agent, client, "/quantri");
    expect(callback.headers.location).toBe(`${config.webOrigin}/quantri`);
    const me = await agent.get("/api/admin/me").expect(200);
    expect(me.body.user.role).toBe("admin");
    expect(me.headers["cache-control"]).toBe("no-store");
    const result = await agent.post("/api/auth/logout?portal=admin").expect(200);
    expect(new URL(result.body.logoutUrl).searchParams.get("post_logout_redirect_uri")).toBe(`${config.webOrigin}/quantri`);
    await agent.get("/api/admin/me").expect(401);
    await agent.get("/api/admin/summary").expect(401);
  });

  it.each(["/quantri", "/quantri/", "/quantri?tab=users", "/quantri/users"])(
    "refuses Student authentication into %s before saving a user", async (path) => {
      const client = new FakeMicrosoftAuthClient();
      const repository = new FakeUserRepository();
      const agent = request.agent(createTestApp(client, repository));
      const callback = await login(agent, client, path);
      expect(callback.headers.location).toBe(`${config.webOrigin}/quantri?authError=admin_required`);
      expect(repository.upsertCount).toBe(0);
      await agent.get("/api/admin/me").expect(401);
      expect((await agent.get("/api/auth/me")).body.authenticated).toBe(false);
    }
  );

  it("keeps an existing Student out of admin and permits signing out to the admin login", async () => {
    const client = new FakeMicrosoftAuthClient();
    const agent = request.agent(createTestApp(client));
    await login(agent, client);
    await agent.get("/api/admin/me").expect(403);
    const result = await agent.post("/api/auth/logout?portal=admin").expect(200);
    expect(new URL(result.body.logoutUrl).searchParams.get("post_logout_redirect_uri")).toBe(`${config.webOrigin}/quantri`);
    await agent.get("/api/admin/me").expect(401);
  });

  it.each(["denied", "missing_code", "exchange_failure"])("returns admin callback failure %s to the admin login", async (failure) => {
    const client = new FakeMicrosoftAuthClient();
    const repository = new FakeUserRepository();
    client.nextRoles = ["Admin"];
    repository.shouldFail = failure === "exchange_failure";
    const agent = request.agent(createTestApp(client, repository));
    const start = await agent.get("/api/auth/microsoft/start?returnTo=%2Fquantri").expect(302);
    const state = new URL(start.headers.location).searchParams.get("state");
    const query = failure === "denied" ? { state, error: "access_denied" }
      : failure === "missing_code" ? { state } : { state, code: "code" };
    const callback = await agent.get("/api/auth/microsoft/callback").query(query).expect(302);
    expect(callback.headers.location).toMatch(/\/quantri\?authError=/);
    await agent.get("/api/admin/me").expect(401);
  });

  it("ignores external logout destinations for Student sessions", async () => {
    const client = new FakeMicrosoftAuthClient();
    const agent = request.agent(createTestApp(client));
    await login(agent, client);
    const result = await agent.post("/api/auth/logout?portal=https://evil.example&returnTo=https://evil.example").expect(200);
    expect(new URL(result.body.logoutUrl).searchParams.get("post_logout_redirect_uri")).toBe(`${config.webOrigin}/`);
  });
  it("supports login, repeated login and logout without PostgreSQL", async () => {
    const authClient = new FakeMicrosoftAuthClient();
    const agent = request.agent(createApp({
      config: { ...config, database: { ...config.database, url: undefined } },
      microsoftAuthClient: authClient,
      userRepository: new MemoryUserRepository()
    }));
    await login(agent, authClient);
    const first = await agent.get("/api/auth/me").expect(200);
    expect(first.body.authenticated).toBe(true);
    await agent.get("/api/admin/summary").expect(403);
    await login(agent, authClient);
    const second = await agent.get("/api/auth/me").expect(200);
    expect(second.body.user.userId).toBe(first.body.user.userId);
    await agent.post("/api/auth/logout").expect(200);
    const signedOut = await agent.get("/api/auth/me").expect(200);
    expect(signedOut.body.authenticated).toBe(false);
  });
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
    expect(new URL(logout.body.logoutUrl).searchParams.get("post_logout_redirect_uri")).toBe(`${config.webOrigin}/`);
    expect(new URL(logout.body.logoutUrl).searchParams.get("logout_hint")).toBe("test-login-hint");
    expect(logout.headers["set-cookie"]?.[0]).toContain("edupath.sid=");

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body).toEqual({ authenticated: false });
  });
});
