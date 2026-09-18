import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import type { AuthenticatedUser } from "../auth/types.js";
import { PlanError, reviewPlan, identity, type PlanData } from "./model.js";
import type { CurriculumData } from "../curricula/model.js";
const columns = `c.id,c.is_active AS "isActive",c.lock_version AS token,c.updated_at AS "updatedAt",r.id AS "revisionId",r.version,r.data,r.source_filename AS "sourceFilename"`;
export class PlanRepository {
  constructor(readonly pool: DatabasePool) { }
  async access(actor: AuthenticatedUser, write = false, client?: PoolClient) {
    const result = await (client ?? this.pool).query(
      `SELECT id FROM users WHERE id=$1 AND entra_tenant_id=$2 AND is_active
      AND COALESCE(role_override,role)=ANY($3::text[]) ${client ? "FOR SHARE" : ""}`,
      [
        actor.userId,
        actor.tenantId,
        write
          ? ["admin"]
          : ["admin", "faculty_board", "department_head", "lecturer"],
      ],
    );
    if (!result.rowCount) throw new PlanError("insufficient_role", 403);
  }
  async link(data: PlanData) {
    const result = await this.pool.query(
      `SELECT c.id,r.id AS "revisionId",r.version,r.data FROM curricula c JOIN curriculum_revisions r ON r.id=c.current_revision WHERE c.identity_key=$1`,
      [identity(data)],
    );
    const row = result.rows[0];
    data.curriculum = row
      ? {
        id: row.id,
        revisionId: row.revisionId,
        version: row.version,
        name: row.data.name,
      }
      : null;
    return reviewPlan(data, row?.data);
  }
  async list(q: string, cohort: string, active: string, page: number) {
    const result = await this.pool.query(
      `WITH filtered AS (
      SELECT c.id,c.cohort_code AS "cohortCode",c.is_active AS "isActive",c.updated_at AS "updatedAt",r.version,
      r.data->>'name' AS name,r.data->>'major' AS major,(r.data->>'totalCredits')::numeric AS "totalCredits",
      jsonb_array_length(r.data->'items') AS "itemCount",jsonb_array_length(r.data->'warnings') AS "warningCount"
      FROM training_plans c JOIN training_plan_revisions r ON r.id=c.current_revision
      WHERE ($1='' OR strpos(lower(concat_ws(' ',r.data->>'name',r.data->>'major',c.cohort_code,
        r.data->'sections')),lower($1))>0)
      AND ($2='' OR c.cohort_code=$2) AND ($3='' OR c.is_active=($3='true'))
    ), paged AS (SELECT * FROM filtered ORDER BY "cohortCode" DESC,id LIMIT 10 OFFSET $4)
    SELECT COALESCE((SELECT json_agg(paged) FROM paged),'[]') AS items,(SELECT count(*)::int FROM filtered) AS total`,
      [q, cohort, active, (page - 1) * 10],
    );
    const options = await this.pool.query(
      "SELECT DISTINCT cohort_code FROM training_plans ORDER BY cohort_code DESC",
    );
    return {
      ...result.rows[0],
      cohorts: options.rows.map((r) => r.cohort_code),
    };
  }
  async detail(id: string, revision?: string) {
    const result = await this.pool.query(
      `SELECT ${columns} FROM training_plans c JOIN training_plan_revisions r ON r.plan_id=c.id AND r.id=COALESCE($2::uuid,c.current_revision) WHERE c.id=$1`,
      [id, revision ?? null],
    );
    if (!result.rowCount) throw new PlanError("not_found", 404);
    const history = await this.pool.query(
      `SELECT id,version,change_note AS note,created_at AS "createdAt" FROM training_plan_revisions WHERE plan_id=$1 ORDER BY version DESC`,
      [id],
    );
    const events = await this.pool.query(
      `SELECT action,created_at AS "createdAt" FROM training_plan_events WHERE plan_id=$1 ORDER BY id DESC LIMIT 50`,
      [id],
    );
    return { ...result.rows[0], history: history.rows, events: events.rows };
  }
  async source(id: string, revision: string) {
    const result = await this.pool.query(
      "SELECT source_data FROM training_plan_revisions WHERE plan_id=$1 AND id=$2",
      [id, revision],
    );
    if (!result.rowCount) throw new PlanError("not_found", 404);
    return result.rows[0]!.source_data as Buffer;
  }
  private async revision(
    client: PoolClient,
    id: string,
    data: PlanData,
    file: Buffer,
    filename: string,
    note: string,
    actorId?: string,
  ) {
    const linked = data.curriculum
      ? await client.query<{ data: CurriculumData }>(
        "SELECT data FROM curriculum_revisions WHERE id=$1 AND curriculum_id=$2",
        [data.curriculum.revisionId, data.curriculum.id],
      )
      : null;
    reviewPlan(data, linked?.rows[0]?.data);
    const revisionId = randomUUID();
    await client.query(
      `INSERT INTO training_plan_revisions(id,plan_id,version,data,source_filename,source_data,source_sha256,actor_id,change_note,curriculum_revision_id)
      VALUES($1,$2,(SELECT COALESCE(max(version),0)+1 FROM training_plan_revisions WHERE plan_id=$2),$3,$4,$5,$6,$7,$8,$9)`,
      [
        revisionId,
        id,
        JSON.stringify(data),
        filename,
        file,
        createHash("sha256").update(file).digest("hex"),
        actorId ?? null,
        note,
        data.curriculum?.revisionId ?? null,
      ],
    );
    await client.query(
      `INSERT INTO training_plan_items(revision_id,item_id,position,code,name,credits,term_code,semester,study_year,section_id,data)
       SELECT $1,x->>'id',(x->>'position')::int,x->>'code',x->>'name',(x->>'credits')::numeric,x->>'termCode',(x->>'semester')::int,(x->>'studyYear')::int,x->>'sectionId',x FROM jsonb_array_elements($2::jsonb) x`,
      [revisionId, JSON.stringify(data.items)],
    );
    await client.query(
      "UPDATE training_plans SET current_revision=$2,lock_version=$3,updated_at=now() WHERE id=$1",
      [id, revisionId, randomUUID()],
    );
  }
  async create(
    data: PlanData,
    file: Buffer,
    filename: string,
    actor?: AuthenticatedUser,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (actor) await this.access(actor, true, client);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `training-plan:${identity(data)}`,
      ]);
      const existing = await client.query(
        "SELECT id FROM training_plans WHERE identity_key=$1",
        [identity(data)],
      );
      if (existing.rowCount) {
        if (actor) throw new PlanError("plan_exists", 409);
        await client.query("COMMIT");
        return existing.rows[0]!.id as string;
      }
      const id = randomUUID();
      await client.query(
        "INSERT INTO training_plans(id,identity_key,cohort_code,lock_version) VALUES($1,$2,$3,$4)",
        [id, identity(data), data.cohortCode, randomUUID()],
      );
      await this.revision(
        client,
        id,
        data,
        file,
        filename,
        actor ? "Import kế hoạch đào tạo" : "Đồng bộ kế hoạch đào tạo gốc",
        actor?.userId,
      );
      await client.query("COMMIT");
      return id;
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
    change: (data: PlanData) => PlanData,
    note: string,
    replacement?: { file: Buffer; filename: string },
    active?: boolean,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.access(actor, true, client);
      const result = await client.query(
        `SELECT c.lock_version,c.identity_key,r.data,r.source_data,r.source_filename FROM training_plans c JOIN training_plan_revisions r ON r.id=c.current_revision WHERE c.id=$1 FOR UPDATE OF c`,
        [id],
      );
      if (!result.rowCount) throw new PlanError("not_found", 404);
      const row = result.rows[0]!;
      if (row.lock_version !== token) throw new PlanError("plan_changed", 409);
      if (active !== undefined) {
        await client.query(
          "UPDATE training_plans SET is_active=$2,lock_version=$3,updated_at=now() WHERE id=$1",
          [id, active, randomUUID()],
        );
        await client.query(
          "INSERT INTO training_plan_events(plan_id,actor_id,action) VALUES($1,$2,$3)",
          [
            id,
            actor.userId,
            active ? "Mở kế hoạch đào tạo" : "Khóa kế hoạch đào tạo",
          ],
        );
      } else {
        const data = change(row.data);
        if (identity(data) !== row.identity_key)
          throw new PlanError("plan_identity_mismatch");
        await this.revision(
          client,
          id,
          data,
          replacement?.file ?? row.source_data,
          replacement?.filename ?? row.source_filename,
          note,
          actor.userId,
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
