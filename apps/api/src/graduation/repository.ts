import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import type { AuthenticatedUser } from "../auth/types.js";
import {
  GraduationError,
  identity,
  validateData,
  warnings,
  type GraduationData,
} from "./model.js";
export class GraduationRepository {
  constructor(readonly pool: DatabasePool) {}
  async access(
    actor: AuthenticatedUser,
    write: boolean,
    client: DatabasePool | PoolClient = this.pool,
  ) {
    const found = await client.query(
      `SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active AND COALESCE(role_override,role)=ANY($3::text[])${client !== this.pool ? " FOR SHARE" : ""}`,
      [
        actor.userId,
        actor.tenantId,
        write
          ? ["admin"]
          : ["admin", "faculty_board", "department_head", "lecturer"],
      ],
    );
    if (!found.rowCount) throw new GraduationError("insufficient_role", 403);
  }
  async list(q: string, cohort: string, active: string) {
    const result = await this.pool.query(
      `SELECT c.id,c.cohort_code AS "cohortCode",c.is_active AS "isActive",r.version,r.data->>'name' AS name,r.data->>'major' AS major,r.data->>'specialty' AS specialty,r.data->>'classBlock' AS "classBlock",(r.data->>'minimumCredits')::numeric AS "minimumCredits" FROM graduation_standards c JOIN graduation_revisions r ON r.id=c.current_revision WHERE ($1='' OR strpos(lower(concat_ws(' ',r.data->>'name',r.data->>'major',r.data->>'specialty',c.cohort_code)),lower($1))>0) AND ($2='' OR c.cohort_code=$2) AND ($3='' OR c.is_active=($3='true')) ORDER BY c.cohort_code DESC,r.data->>'name',c.id`,
      [q, cohort, active],
    );
    return { items: result.rows };
  }
  async detail(id: string, revision?: string) {
    const r = await this.pool.query(
      `SELECT c.id,c.is_active AS "isActive",c.lock_version AS token,r.id AS "revisionId",r.version,r.data,r.source_filename AS "sourceFilename" FROM graduation_standards c JOIN graduation_revisions r ON r.standard_id=c.id AND r.id=COALESCE($2::uuid,c.current_revision) WHERE c.id=$1`,
      [id, revision ?? null],
    );
    if (!r.rowCount) throw new GraduationError("not_found", 404);
    const history = await this.pool.query(
      'SELECT id,version,change_note AS note,created_at AS "createdAt" FROM graduation_revisions WHERE standard_id=$1 ORDER BY version DESC',
      [id],
    );
    const events = await this.pool.query(
      'SELECT action,created_at AS "createdAt" FROM graduation_events WHERE standard_id=$1 ORDER BY id DESC LIMIT 50',
      [id],
    );
    return {
      ...r.rows[0],
      warnings: warnings(r.rows[0]!.data),
      history: history.rows,
      events: events.rows,
    };
  }
  async source(id: string, revision: string) {
    const r = await this.pool.query(
      "SELECT source_data,source_filename FROM graduation_revisions WHERE standard_id=$1 AND id=$2",
      [id, revision],
    );
    if (!r.rowCount) throw new GraduationError("not_found", 404);
    return r.rows[0]!;
  }
  private async revision(
    client: PoolClient,
    id: string,
    data: GraduationData,
    file: Buffer,
    filename: string,
    actor: AuthenticatedUser,
    note: string,
  ) {
    const rid = randomUUID();
    await client.query(
      "INSERT INTO graduation_revisions(id,standard_id,version,data,source_filename,source_data,actor_id,change_note) VALUES($1,$2,(SELECT COALESCE(max(version),0)+1 FROM graduation_revisions WHERE standard_id=$2),$3,$4,$5,$6,$7)",
      [rid, id, JSON.stringify(data), filename, file, actor.userId, note],
    );
    await client.query(
      `INSERT INTO graduation_courses(revision_id,item_id,group_id,code,credits,condition_only,data) SELECT $1,x->>'id',x->>'groupId',x->>'code',(x->>'credits')::numeric,(x->>'conditionOnly')::boolean,x FROM jsonb_array_elements($2::jsonb) x`,
      [rid, JSON.stringify(data.courses)],
    );
    await client.query(
      "UPDATE graduation_standards SET current_revision=$2,lock_version=$3,updated_at=now() WHERE id=$1",
      [id, rid, randomUUID()],
    );
    await client.query(
      "INSERT INTO graduation_events(standard_id,actor_id,action) VALUES($1,$2,$3)",
      [id, actor.userId, note],
    );
  }
  async createBatch(
    data: GraduationData[],
    file: Buffer,
    filename: string,
    actor: AuthenticatedUser,
  ) {
    const keys = data.map(identity);
    if (new Set(keys).size !== keys.length)
      throw new GraduationError("duplicate_selection", 409);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.access(actor, true, client);
      for (const key of [...keys].sort())
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `graduation:${key}`,
        ]);
      const existing = await client.query(
        "SELECT id FROM graduation_standards WHERE identity_key=ANY($1::text[])",
        [keys],
      );
      if (existing.rowCount) throw new GraduationError("standard_exists", 409);
      const ids = [];
      for (const d of data) {
        const id = randomUUID();
        ids.push(id);
        await client.query(
          "INSERT INTO graduation_standards(id,identity_key,cohort_code,lock_version) VALUES($1,$2,$3,$4)",
          [id, identity(d), d.cohortCode, randomUUID()],
        );
        await this.revision(
          client,
          id,
          d,
          file,
          filename,
          actor,
          "Import tiêu chuẩn xét tốt nghiệp",
        );
      }
      await client.query("COMMIT");
      return ids;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async update(
    id: string,
    token: string,
    actor: AuthenticatedUser,
    change: {
      data?: GraduationData;
      isActive?: boolean;
      replacement?: { file: Buffer; filename: string };
    },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.access(actor, true, client);
      const r = await client.query(
        "SELECT c.lock_version,c.identity_key,r.data,r.source_data,r.source_filename FROM graduation_standards c JOIN graduation_revisions r ON r.id=c.current_revision WHERE c.id=$1 FOR UPDATE OF c",
        [id],
      );
      const current = r.rows[0];
      if (!current) throw new GraduationError("not_found", 404);
      if (current.lock_version !== token)
        throw new GraduationError("standard_changed", 409);
      if (change.isActive !== undefined) {
        await client.query(
          "UPDATE graduation_standards SET is_active=$2,lock_version=$3,updated_at=now() WHERE id=$1",
          [id, change.isActive, randomUUID()],
        );
        await client.query(
          "INSERT INTO graduation_events(standard_id,actor_id,action) VALUES($1,$2,$3)",
          [
            id,
            actor.userId,
            change.isActive ? "Mở tiêu chuẩn" : "Khóa tiêu chuẩn",
          ],
        );
      } else {
        const d = validateData(change.data);
        if (
          identity(d) !== current.identity_key ||
          d.cohortCode !== current.data.cohortCode
        )
          throw new GraduationError("identity_mismatch", 422);
        if (!change.replacement) {
          d.sourceWorkbook = current.data.sourceWorkbook;
          d.sourceSheet = current.data.sourceSheet;
          d.sourceNotes = current.data.sourceNotes;
        }
        await this.revision(
          client,
          id,
          d,
          change.replacement?.file ?? current.source_data,
          change.replacement?.filename ?? current.source_filename,
          actor,
          change.replacement
            ? "Cập nhật từ Excel"
            : "Cập nhật điều kiện xét tốt nghiệp",
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    return this.detail(id);
  }
}
