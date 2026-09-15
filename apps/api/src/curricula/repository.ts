import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import type { AuthenticatedUser } from "../auth/types.js";
import { CurriculumError, rebuild, type CurriculumData } from "./model.js";

export const identity = (data: CurriculumData) =>
  `${data.major
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()}:${data.cohortCode}`;
const columns = `c.id,c.is_active AS "isActive",c.lock_version AS token,c.updated_at AS "updatedAt",r.id AS "revisionId",r.version,r.data,r.source_filename AS "sourceFilename"`;
export class CurriculumRepository {
  constructor(readonly pool: DatabasePool) {}
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
    if (!result.rowCount) throw new CurriculumError("insufficient_role", 403);
  }
  async list(q: string, cohort: string, active: string, page: number) {
    const result = await this.pool.query(
      `WITH filtered AS (
      SELECT c.id,c.cohort_code AS "cohortCode",c.is_active AS "isActive",c.updated_at AS "updatedAt",r.version,
      r.data->>'name' AS name,r.data->>'major' AS major,(r.data->>'totalCredits')::int AS "totalCredits",
      jsonb_array_length(r.data->'courses') AS "courseCount",jsonb_array_length(r.data->'warnings') AS "warningCount"
      FROM curricula c JOIN curriculum_revisions r ON r.id=c.current_revision
      WHERE ($1='' OR strpos(lower(concat_ws(' ',r.data->>'name',r.data->>'major',c.cohort_code,
        (SELECT string_agg(cc.specialty,' ') FROM curriculum_courses cc WHERE cc.revision_id=r.id))),lower($1))>0)
      AND ($2='' OR c.cohort_code=$2) AND ($3='' OR c.is_active=($3='true'))
    ), paged AS (SELECT * FROM filtered ORDER BY "cohortCode" DESC,id LIMIT 10 OFFSET $4)
    SELECT COALESCE((SELECT json_agg(paged) FROM paged),'[]') AS items,(SELECT count(*)::int FROM filtered) AS total`,
      [q, cohort, active, (page - 1) * 10],
    );
    const options = await this.pool.query(
      "SELECT DISTINCT cohort_code FROM curricula ORDER BY cohort_code DESC",
    );
    return {
      ...result.rows[0],
      cohorts: options.rows.map((r) => r.cohort_code),
    };
  }
  async detail(id: string, revision?: string) {
    const result = await this.pool.query(
      `SELECT ${columns} FROM curricula c JOIN curriculum_revisions r ON r.curriculum_id=c.id AND r.id=COALESCE($2::uuid,c.current_revision) WHERE c.id=$1`,
      [id, revision ?? null],
    );
    if (!result.rowCount) throw new CurriculumError("not_found", 404);
    const history = await this.pool.query(
      `SELECT id,version,change_note AS note,created_at AS "createdAt" FROM curriculum_revisions WHERE curriculum_id=$1 ORDER BY version DESC`,
      [id],
    );
    const events = await this.pool.query(
      `SELECT action,created_at AS "createdAt" FROM curriculum_events WHERE curriculum_id=$1 ORDER BY id DESC LIMIT 50`,
      [id],
    );
    return { ...result.rows[0], history: history.rows, events: events.rows };
  }
  async source(id: string, revision: string) {
    const result = await this.pool.query(
      "SELECT source_data FROM curriculum_revisions WHERE curriculum_id=$1 AND id=$2",
      [id, revision],
    );
    if (!result.rowCount) throw new CurriculumError("not_found", 404);
    return result.rows[0]!.source_data as Buffer;
  }
  private async revision(
    client: PoolClient,
    id: string,
    data: CurriculumData,
    file: Buffer,
    filename: string,
    note: string,
    actorId?: string,
  ) {
    rebuild(data);
    const revisionId = randomUUID();
    await client.query(
      `INSERT INTO curriculum_revisions(id,curriculum_id,version,data,source_filename,source_data,source_sha256,actor_id,change_note)
      VALUES($1,$2,(SELECT COALESCE(max(version),0)+1 FROM curriculum_revisions WHERE curriculum_id=$2),$3,$4,$5,$6,$7,$8)`,
      [
        revisionId,
        id,
        JSON.stringify(data),
        filename,
        file,
        createHash("sha256").update(file).digest("hex"),
        actorId ?? null,
        note,
      ],
    );
    const courses = JSON.stringify(data.courses);
    await client.query(
      `INSERT INTO course_catalog(code,name) SELECT x->>'code',x->>'name' FROM jsonb_array_elements($1::jsonb) x ORDER BY x->>'code' ON CONFLICT(code) DO NOTHING`,
      [courses],
    );
    await client.query(
      `INSERT INTO curriculum_courses(revision_id,code,position,name,credits,course_type,semester,study_year,block,specialty,data)
      SELECT $1,x->>'code',(x->>'position')::int,x->>'name',(x->>'credits')::numeric,x->>'type',(x->>'semester')::int,(x->>'studyYear')::int,x->>'block',x->>'specialty',x
      FROM jsonb_array_elements($2::jsonb) x`,
      [revisionId, courses],
    );
    await client.query(
      `INSERT INTO curriculum_relations SELECT $1,x->>'courseCode',x->>'kind',x->>'raw',
      ARRAY(SELECT jsonb_array_elements_text(x->'targetCodes')),ARRAY(SELECT jsonb_array_elements_text(x->'unresolvedCodes')),(x->>'reviewRequired')::boolean
      FROM jsonb_array_elements($2::jsonb) x`,
      [revisionId, JSON.stringify(data.relations)],
    );
    await client.query(
      "UPDATE curricula SET current_revision=$2,lock_version=$3,updated_at=now() WHERE id=$1",
      [id, revisionId, randomUUID()],
    );
  }
  async create(
    data: CurriculumData,
    file: Buffer,
    filename: string,
    actor?: AuthenticatedUser,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (actor) await this.access(actor, true, client);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `curriculum:${identity(data)}`,
      ]);
      const existing = await client.query(
        "SELECT id FROM curricula WHERE identity_key=$1",
        [identity(data)],
      );
      if (existing.rowCount) {
        if (actor) throw new CurriculumError("curriculum_exists", 409);
        await client.query("COMMIT");
        return existing.rows[0]!.id as string;
      }
      const id = randomUUID();
      await client.query(
        "INSERT INTO curricula(id,identity_key,cohort_code,lock_version) VALUES($1,$2,$3,$4)",
        [id, identity(data), data.cohortCode, randomUUID()],
      );
      await this.revision(
        client,
        id,
        data,
        file,
        filename,
        actor ? "Import khung CTĐT" : "Đồng bộ khung CTĐT gốc",
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
    change: (data: CurriculumData) => CurriculumData,
    note: string,
    replacement?: { file: Buffer; filename: string },
    active?: boolean,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.access(actor, true, client);
      const result = await client.query(
        `SELECT c.lock_version,c.identity_key,r.data,r.source_data,r.source_filename FROM curricula c JOIN curriculum_revisions r ON r.id=c.current_revision WHERE c.id=$1 FOR UPDATE OF c`,
        [id],
      );
      if (!result.rowCount) throw new CurriculumError("not_found", 404);
      const row = result.rows[0]!;
      if (row.lock_version !== token)
        throw new CurriculumError("curriculum_changed", 409);
      if (active !== undefined) {
        await client.query(
          "UPDATE curricula SET is_active=$2,lock_version=$3,updated_at=now() WHERE id=$1",
          [id, active, randomUUID()],
        );
        await client.query(
          "INSERT INTO curriculum_events(curriculum_id,actor_id,action) VALUES($1,$2,$3)",
          [id, actor.userId, active ? "Mở khung CTĐT" : "Khóa khung CTĐT"],
        );
      } else {
        const data = change(row.data);
        if (identity(data) !== row.identity_key)
          throw new CurriculumError("curriculum_identity_mismatch");
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
