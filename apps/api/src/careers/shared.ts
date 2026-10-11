import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { adminRoles, type AuthenticatedUser } from "../auth/types.js";

export const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
export class CareerError extends Error {
  /** details are added to the JSON error body (e.g. the skills of a requirement_exists conflict). */
  constructor(readonly code: string, readonly status = 400, readonly details?: Record<string, unknown>) { super(code); }
}
/** Serialize skill renames/deletions with link writes before taking career row locks. */
export async function lockSkillCatalog(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(1946032027)");
}
export async function access(client: DatabasePool | PoolClient, actor: AuthenticatedUser, _write: boolean, student = false, lock = false) {
  const row = await client.query(
    `SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active
 ${student ? "" : "AND COALESCE(role_override,role)=ANY($3::text[])"}${lock ? " FOR SHARE" : ""}`,
    student ? [actor.userId, actor.tenantId] : [actor.userId, actor.tenantId, adminRoles],
  );
  if (!row.rowCount) throw new CareerError("insufficient_role", 403);
}
