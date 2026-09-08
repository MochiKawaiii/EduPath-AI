import { Router } from "express";
import { z } from "zod";
import type { DatabasePool } from "../db/pool.js";
import type { AuthenticatedUser } from "../auth/types.js";
import { requireRole } from "../middleware/authorization.js";

export interface Account {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  role: "admin" | "student";
  isActive: boolean;
  lastLoginAt: string;
}
export interface AccountQuery { q: string; page: number; pageSize: number; role?: "admin" | "student" | undefined; active?: "true" | "false" | undefined }
export interface HistoryQuery { q: string; page: number; pageSize: number; userId?: string | undefined; outcome?: "success" | "denied" | undefined; portal?: "admin" | "student" | undefined; from?: string | undefined; to?: string | undefined }
export interface AccountChange { role?: "admin" | "student" | undefined; isActive?: boolean | undefined }
export interface LoginEvent { id: string; userId: string; name: string; email: string | null; occurredAt: string; outcome: string; reason: string; portal: string }
export interface AccountDetail extends Account { createdAt: string; firstLoginAt: string; updatedAt: string }
export interface AccountPage { items: Account[]; total: number }
export class AccountError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}
export interface AdminAccountRepository {
  isAdmin(actor: AuthenticatedUser): Promise<boolean>;
  list(actor: AuthenticatedUser, query: AccountQuery): Promise<AccountPage>;
  createAdmin(actor: AuthenticatedUser, email: string): Promise<Account>;
  detail(actor: AuthenticatedUser, id: string): Promise<AccountDetail>;
  update(actor: AuthenticatedUser, id: string, change: AccountChange): Promise<Account>;
  history(actor: AuthenticatedUser, query: HistoryQuery): Promise<{ items: LoginEvent[]; total: number }>;
}

const columns = `id, display_name AS name, email, username,
  COALESCE(role_override, role) AS role, is_active AS "isActive", last_login_at AS "lastLoginAt"`;

export class PostgresAdminAccountRepository implements AdminAccountRepository {
  constructor(private readonly pool: DatabasePool) {}

  async isAdmin(actor: AuthenticatedUser): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT id FROM users WHERE id = $1 AND entra_tenant_id = $2
       AND is_active AND COALESCE(role_override, role) = 'admin'`,
      [actor.userId, actor.tenantId]
    );
    return result.rows.length === 1;
  }

  async list(actor: AuthenticatedUser, query: AccountQuery): Promise<AccountPage> {
    const result = await this.pool.query<AccountPage>(
      `WITH filtered AS (
        SELECT ${columns} FROM users
        WHERE entra_tenant_id = $1
          AND ($2 = '' OR strpos(lower(concat_ws(' ', display_name, email, username)), lower($2)) > 0)
          AND ($5::text IS NULL OR COALESCE(role_override, role) = $5)
          AND ($6::boolean IS NULL OR is_active = $6)
      ), paged AS (
        SELECT * FROM filtered ORDER BY name, id LIMIT $3 OFFSET $4
      )
      SELECT COALESCE((SELECT json_agg(paged ORDER BY name, id) FROM paged), '[]'::json) AS items,
        (SELECT count(*)::int FROM filtered) AS total`,
      [actor.tenantId, query.q, query.pageSize, (query.page - 1) * query.pageSize, query.role ?? null, query.active ?? null]
    );
    return result.rows[0] ?? { items: [], total: 0 };
  }

  async createAdmin(actor: AuthenticatedUser, email: string): Promise<Account> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [actor.tenantId]);
      // Serialize tenant grants with role/status changes, then recheck actor.
      const activeActor = await client.query(
        `SELECT id FROM users WHERE id = $1 AND entra_tenant_id = $2
         AND is_active AND COALESCE(role_override, role) = 'admin' FOR SHARE`,
        [actor.userId, actor.tenantId]
      );
      if (!activeActor.rows.length) throw new AccountError("insufficient_role", 403);
      const matches = await client.query<Account>(
        `SELECT ${columns} FROM users
         WHERE entra_tenant_id = $1 AND (lower(email) = $2 OR lower(username) = $2)
         ORDER BY id LIMIT 2 FOR UPDATE`,
        [actor.tenantId, email]
      );
      if (!matches.rows.length) throw new AccountError("account_not_registered", 404);
      if (matches.rows.length !== 1) throw new AccountError("ambiguous_account", 409);
      const target = matches.rows[0]!;
      if (!target.isActive) throw new AccountError("account_locked", 409);
      if (target.role === "admin") throw new AccountError("already_admin", 409);
      const result = await client.query<Account>(
        `UPDATE users SET role = 'admin', role_override = 'admin', auth_version = auth_version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND entra_tenant_id = $2 RETURNING ${columns}`,
        [target.id, actor.tenantId]
      );
      await client.query("DELETE FROM user_sessions WHERE sess->'user'->>'userId' = $1", [target.id]);
      await client.query("COMMIT");
      return result.rows[0]!;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async detail(actor: AuthenticatedUser, id: string): Promise<AccountDetail> {
    const result = await this.pool.query<AccountDetail>(`SELECT ${columns}, created_at AS "createdAt",
      first_login_at AS "firstLoginAt", updated_at AS "updatedAt" FROM users WHERE id = $1 AND entra_tenant_id = $2`, [id, actor.tenantId]);
    if (!result.rows[0]) throw new AccountError("account_not_found", 404);
    return result.rows[0];
  }

  async update(actor: AuthenticatedUser, id: string, change: AccountChange): Promise<Account> {
    if (id === actor.userId) throw new AccountError("self_change_forbidden", 409);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [actor.tenantId]);
      const activeActor = await client.query(`SELECT id FROM users WHERE id = $1 AND entra_tenant_id = $2
        AND is_active AND COALESCE(role_override, role) = 'admin' FOR SHARE`, [actor.userId, actor.tenantId]);
      if (!activeActor.rows.length) throw new AccountError("insufficient_role", 403);
      const result = await client.query<Account>(`UPDATE users SET
        role = COALESCE($3, role), role_override = COALESCE($3, role_override),
        is_active = COALESCE($4, is_active), auth_version = auth_version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND entra_tenant_id = $2 RETURNING ${columns}`, [id, actor.tenantId, change.role ?? null, change.isActive ?? null]);
      if (!result.rows[0]) throw new AccountError("account_not_found", 404);
      await client.query("DELETE FROM user_sessions WHERE sess->'user'->>'userId' = $1", [id]);
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async history(actor: AuthenticatedUser, query: HistoryQuery) {
    if (query.userId) await this.detail(actor, query.userId);
    const result = await this.pool.query<{ items: LoginEvent[]; total: number }>(`WITH filtered AS (
      SELECT e.id, e.user_id AS "userId", u.display_name AS name, u.email,
        e.occurred_at AS "occurredAt", e.outcome, e.reason, e.portal
      FROM login_events e JOIN users u ON u.id = e.user_id AND u.entra_tenant_id = e.tenant_id
      WHERE e.tenant_id = $1 AND ($2::uuid IS NULL OR e.user_id = $2)
        AND ($3 = '' OR strpos(lower(concat_ws(' ', u.display_name, u.email, u.username, e.reason)), lower($3)) > 0)
        AND ($4::text IS NULL OR e.outcome = $4) AND ($5::text IS NULL OR e.portal = $5)
        AND ($6::timestamptz IS NULL OR e.occurred_at >= $6) AND ($7::timestamptz IS NULL OR e.occurred_at < $7)
      ), paged AS (SELECT * FROM filtered ORDER BY "occurredAt" DESC, id DESC LIMIT $8 OFFSET $9)
      SELECT COALESCE((SELECT json_agg(paged ORDER BY "occurredAt" DESC, id DESC) FROM paged), '[]'::json) AS items,
        (SELECT count(*)::int FROM filtered) AS total`,
    [actor.tenantId, query.userId ?? null, query.q, query.outcome ?? null, query.portal ?? null, query.from ?? null, query.to ?? null, query.pageSize, (query.page - 1) * query.pageSize]);
    return result.rows[0] ?? { items: [], total: 0 };
  }
}

export function createAdminAccountsRouter(repository: AdminAccountRepository | undefined, webOrigin: string) {
  const router = Router();
  router.use(requireRole("admin"));
  router.use(async (request, response, next) => {
    if (!repository) { response.status(503).json({ error: "database_required" }); return; }
    if (!await repository.isAdmin(request.session.user!)) {
      response.status(403).json({ error: "insufficient_role" }); return;
    }
    next();
  });
  router.get("/", async (request, response) => {
    const input = z.object({
      q: z.string().trim().max(120).default(""),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(10),
      role: z.enum(["admin", "student"]).optional(), active: z.enum(["true", "false"]).optional()
    }).strict().safeParse(request.query);
    if (!input.success) { response.status(400).json({ error: "invalid_query" }); return; }
    response.json({ ...await repository!.list(request.session.user!, input.data), page: input.data.page, pageSize: input.data.pageSize });
  });
  router.get("/history", async (request, response) => {
    const input = z.object({ q: z.string().trim().max(120).default(""),
      page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10),
      userId: z.uuid().optional(), outcome: z.enum(["success", "denied"]).optional(), portal: z.enum(["admin", "student"]).optional(),
      from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional()
    }).strict().refine((value) => !value.from || !value.to || Date.parse(value.from) < Date.parse(value.to)).safeParse(request.query);
    if (!input.success) { response.status(400).json({ error: "invalid_query" }); return; }
    response.json({ ...await repository!.history(request.session.user!, input.data), page: input.data.page, pageSize: input.data.pageSize });
  });
  router.get("/:id", async (request, response) => {
    const id = z.uuid().safeParse(request.params.id);
    if (!id.success) { response.status(400).json({ error: "invalid_input" }); return; }
    response.json({ user: await repository!.detail(request.session.user!, id.data) });
  });
  router.patch("/:id", async (request, response) => {
    if (request.get("origin") !== webOrigin) { response.status(403).json({ error: "invalid_origin" }); return; }
    const id = z.uuid().safeParse(request.params.id);
    const change = z.object({ role: z.enum(["admin", "student"]).optional(), isActive: z.boolean().optional(), confirmed: z.literal(true) })
      .strict().refine((value) => (value.role !== undefined) !== (value.isActive !== undefined)).safeParse(request.body);
    if (!id.success || !change.success) { response.status(400).json({ error: "invalid_input" }); return; }
    response.json({ user: await repository!.update(request.session.user!, id.data, change.data) });
  });
  router.post("/", async (request, response) => {
    // Browser mutations require an exact Origin; missing Origin is not accepted.
    if (request.get("origin") !== webOrigin) { response.status(403).json({ error: "invalid_origin" }); return; }
    const input = z.object({ email: z.email().max(320).transform((value) => value.toLowerCase()), confirmAdmin: z.literal(true) }).strict().safeParse(request.body);
    if (!input.success) { response.status(400).json({ error: "invalid_input" }); return; }
    try {
      const user = await repository!.createAdmin(request.session.user!, input.data.email);
      response.status(201).json({ user });
    } catch (error) {
      if (!(error instanceof AccountError)) throw error;
      response.status(error.status).json({ error: error.code });
    }
  });
  router.use((error: unknown, _request: import("express").Request, response: import("express").Response, next: import("express").NextFunction) => {
    if (error instanceof AccountError) { response.status(error.status).json({ error: error.code }); return; }
    next(error);
  });
  return router;
}
