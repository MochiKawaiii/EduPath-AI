import { describe, expect, it, vi } from "vitest";
import type { MicrosoftIdentity } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import { PostgresUserRepository } from "./postgres-user-repository.js";

const identity: MicrosoftIdentity = {
  tenantId: "22222222-2222-4222-8222-222222222222",
  objectId: "33333333-3333-4333-8333-333333333333",
  subject: "microsoft-subject",
  name: "Nguyễn Văn Lang",
  email: "student@vlu.edu.vn",
  username: "student@vlu.edu.vn",
  roles: [],
  nonce: "nonce",
  audience: "11111111-1111-4111-8111-111111111111",
  issuer:
    "https://login.microsoftonline.com/22222222-2222-4222-8222-222222222222/v2.0",
  expiresAt: Math.floor(Date.now() / 1000) + 3_600
};

describe("PostgresUserRepository", () => {
  it("uses a parameterized tenant/object upsert and maps the persisted user", async () => {
    const loginAt = new Date("2026-09-03T14:00:00.000Z");
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          tenantId: identity.tenantId,
          objectId: identity.objectId,
          name: identity.name,
          email: identity.email,
          username: identity.username,
          role: "student",
          lastLoginAt: loginAt
        }
      ]
    });
    const repository = new PostgresUserRepository({ query } as unknown as DatabasePool);

    const user = await repository.upsertMicrosoftUser(identity, "student");

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ON CONFLICT (entra_tenant_id, entra_object_id)");
    expect(sql).toContain("WHERE users.is_active = TRUE");
    expect(values[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(values.slice(1, 8)).toEqual([
      identity.tenantId,
      identity.objectId,
      identity.subject,
      identity.name,
      identity.email,
      identity.username,
      "student"
    ]);
    expect(values[8]).toBeInstanceOf(Date);
    expect(user).toEqual({
      userId: "55555555-5555-4555-8555-555555555555",
      identityKey: `${identity.tenantId}:${identity.objectId}`,
      tenantId: identity.tenantId,
      objectId: identity.objectId,
      name: identity.name,
      email: identity.email,
      username: identity.username,
      role: "student",
      signedInAt: loginAt.toISOString()
    });
  });

  it("rejects an inactive account when the guarded upsert returns no row", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const repository = new PostgresUserRepository({ query } as unknown as DatabasePool);

    await expect(
      repository.upsertMicrosoftUser(identity, "student")
    ).rejects.toThrow("account is inactive");
  });
});
