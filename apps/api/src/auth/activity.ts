import { randomUUID } from "node:crypto";
import type { DatabasePool } from "../db/pool.js";
import type { AuthenticatedUser, MicrosoftIdentity } from "./types.js";

export interface AuthActivity {
  current(user: AuthenticatedUser): Promise<boolean>;
  record(identity: MicrosoftIdentity, outcome: "success" | "denied", reason: string, portal: "admin" | "student"): Promise<void>;
}
export class PostgresAuthActivity implements AuthActivity {
  constructor(private readonly pool: DatabasePool) {}
  async current(user: AuthenticatedUser) {
    const result = await this.pool.query(`SELECT id FROM users WHERE id = $1 AND entra_tenant_id = $2
      AND is_active AND auth_version = $3 AND COALESCE(role_override, role) = $4`,
    [user.userId, user.tenantId, user.authVersion ?? 0, user.role]);
    return result.rows.length === 1;
  }
  async record(identity: MicrosoftIdentity, outcome: "success" | "denied", reason: string, portal: "admin" | "student") {
    // Only identities already verified by Microsoft and allowed by this app.
    await this.pool.query(`INSERT INTO login_events (id, user_id, tenant_id, outcome, reason, portal)
      SELECT $1, id, entra_tenant_id, $4, $5, $6 FROM users WHERE entra_tenant_id = $2 AND entra_object_id = $3`,
    [randomUUID(), identity.tenantId, identity.objectId, outcome, reason, portal]);
  }
}
