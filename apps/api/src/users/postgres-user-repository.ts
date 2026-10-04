import { randomUUID } from "node:crypto";
import type { AppRole, MicrosoftIdentity } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import type { UserRepository } from "./user-repository.js";

interface UserRow {
  authVersion: number;
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

  public async getRoleOverride(identity: MicrosoftIdentity): Promise<AppRole | null> {
    const result = await this.pool.query<{ roleOverride: AppRole | null; isActive: boolean }>(
      `SELECT role_override AS "roleOverride", is_active AS "isActive"
       FROM users
       WHERE entra_tenant_id = $1 AND entra_object_id = $2`,
      [identity.tenantId, identity.objectId]
    );
    let user = result.rows[0];
    // Once bound, only tenant/object identity is authoritative. A pending grant
    // may match the verified Microsoft sign-in username in the same tenant.
    if (!user && identity.username) {
      const pending = await this.pool.query<{ roleOverride: AppRole | null; isActive: boolean }>(
        `SELECT role_override AS "roleOverride", is_active AS "isActive"
         FROM users WHERE entra_tenant_id = $1 AND entra_object_id IS NULL
           AND entra_subject IS NULL AND lower(btrim(username)) = $2`,
        [identity.tenantId, identity.username.trim().toLowerCase()]
      );
      if (pending.rows.length > 1) throw new Error("Ambiguous pending Microsoft account");
      user = pending.rows[0];
    }
    if (user && !user.isActive) throw new Error("The EduPath user account is inactive");
    return user?.roleOverride ?? null;
  }

  public async upsertMicrosoftUser(
    identity: MicrosoftIdentity,
    role: AppRole,
    options?: { requireRoleOverride: boolean }
  ) {
    const client = await this.pool.connect();
    let user: UserRow | undefined;
    try {
      await client.query("BEGIN");
      // Use the administrative mutation lock so creation, role/status changes
      // and first-login binding cannot create a duplicate account concurrently.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["edupath:admin-account-management"]);
      const loginAt = new Date();
      const existing = await client.query<{ id: string; isActive: boolean; roleOverride: AppRole | null }>(
        `SELECT id, is_active AS "isActive", role_override AS "roleOverride" FROM users
         WHERE entra_tenant_id = $1 AND entra_object_id = $2 FOR UPDATE`,
        [identity.tenantId, identity.objectId]
      );
      let account = existing.rows[0];
      if (!account && identity.username) {
        const pending = await client.query<{ id: string; isActive: boolean; roleOverride: AppRole | null }>(
          `SELECT id, is_active AS "isActive", role_override AS "roleOverride" FROM users
           WHERE entra_tenant_id = $1 AND entra_object_id IS NULL AND entra_subject IS NULL
             AND lower(btrim(username)) = $2
           FOR UPDATE`,
          [identity.tenantId, identity.username.trim().toLowerCase()]
        );
        if (pending.rows.length > 1) throw new Error("Ambiguous pending Microsoft account");
        account = pending.rows[0];
        if (account) {
          if (!account.isActive) throw new Error("The EduPath user account is inactive");
          await client.query(
            `UPDATE users SET entra_object_id = $2, entra_subject = $3,
               first_login_at = $4, last_login_at = $4
             WHERE id = $1 AND entra_object_id IS NULL AND entra_subject IS NULL`,
            [account.id, identity.objectId, identity.subject, loginAt]
          );
        }
      }
      if (account && !account.isActive) throw new Error("The EduPath user account is inactive");
      // A grant may have been revoked or consumed by a concurrent first login
      // after the portal check. Never turn that stale grant into a new admin.
      if (options?.requireRoleOverride && !account?.roleOverride) {
        throw new Error("The EduPath role assignment changed during sign-in");
      }
      role = account?.roleOverride ?? role;
      const result = await client.query<UserRow>(
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
            is_student,
            first_login_at,
            last_login_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8::varchar = 'student', $9, $9)
          ON CONFLICT (entra_tenant_id, entra_object_id)
          DO UPDATE SET
            entra_subject = EXCLUDED.entra_subject,
            display_name = EXCLUDED.display_name,
            email = COALESCE(EXCLUDED.email, users.email),
            username = COALESCE(EXCLUDED.username, users.username),
            role = COALESCE(users.role_override, EXCLUDED.role),
            is_student = users.is_student OR EXCLUDED.is_student,
            first_login_at = COALESCE(users.first_login_at, EXCLUDED.first_login_at),
            last_login_at = EXCLUDED.last_login_at,
            updated_at = EXCLUDED.last_login_at
          WHERE users.is_active = TRUE
          RETURNING
            id, auth_version AS "authVersion",
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

      user = result.rows[0];
      if (!user) throw new Error("The EduPath user account is inactive");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return {
      authVersion: user.authVersion,
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
