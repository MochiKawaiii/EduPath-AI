import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import { adminRoles, type AuthenticatedUser } from "../auth/types.js";

export const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
export class CareerError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export async function access(client: DatabasePool | PoolClient, actor: AuthenticatedUser, _write: boolean, student = false, lock = false) {
  const row = await client.query(
    `SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active
 ${student ? "" : "AND COALESCE(role_override,role)=ANY($3::text[])"}${lock ? " FOR SHARE" : ""}`,
    student ? [actor.userId, actor.tenantId] : [actor.userId, actor.tenantId, adminRoles],
  );
  if (!row.rowCount) throw new CareerError("insufficient_role", 403);
}
