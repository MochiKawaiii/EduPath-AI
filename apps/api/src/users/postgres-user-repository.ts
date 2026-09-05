import { randomUUID } from "node:crypto";
import type { AppRole, MicrosoftIdentity } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import type { UserRepository } from "./user-repository.js";

interface UserRow {
  id: string;
  tenantId: string;
  objectId: string;
  name: string;
  email: string | null;
  username: string | null;
  role: AppRole;
  lastLoginAt: Date | string;
}

export class PostgresUserRepository implements UserRepository {
  public constructor(private readonly pool: DatabasePool) {}

  public async upsertMicrosoftUser(
    identity: MicrosoftIdentity,
    role: AppRole
  ) {
    const loginAt = new Date();
    const result = await this.pool.query<UserRow>(
      `
        INSERT INTO users (
          id,
          entra_tenant_id,
          entra_object_id,
          entra_subject,
          display_name,
          email,
          username,
          role,
          first_login_at,
          last_login_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        ON CONFLICT (entra_tenant_id, entra_object_id)
        DO UPDATE SET
          entra_subject = EXCLUDED.entra_subject,
          display_name = EXCLUDED.display_name,
          email = COALESCE(EXCLUDED.email, users.email),
          username = COALESCE(EXCLUDED.username, users.username),
          role = EXCLUDED.role,
          last_login_at = EXCLUDED.last_login_at,
          updated_at = EXCLUDED.last_login_at
        WHERE users.is_active = TRUE
        RETURNING
          id,
          entra_tenant_id AS "tenantId",
          entra_object_id AS "objectId",
          display_name AS "name",
          email,
          username,
          role,
          last_login_at AS "lastLoginAt"
      `,
      [
        randomUUID(),
        identity.tenantId,
        identity.objectId,
        identity.subject,
        identity.name,
        identity.email,
        identity.username,
        role,
        loginAt
      ]
    );

    const user = result.rows[0];
    if (!user) {
      throw new Error("The EduPath user account is inactive");
    }

    return {
      userId: user.id,
      identityKey: `${user.tenantId}:${user.objectId}`,
      tenantId: user.tenantId,
      objectId: user.objectId,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      signedInAt: new Date(user.lastLoginAt).toISOString()
    };
  }
}
