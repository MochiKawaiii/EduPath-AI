import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { AuthenticatedUser } from "../auth/types.js";
import type { DatabasePool } from "../db/pool.js";
import type { CurriculumCourse, CurriculumData } from "../curricula/model.js";
import { access, fold, lockSkillCatalog } from "../careers/shared.js";
import { refreshCareerSkills } from "../careers/requirements.js";
import { CompetencyError, validateWeights, WEIGHT_TOLERANCE } from "./model.js";

type Database = DatabasePool | PoolClient;
type GroupChange = { name: string; description: string; isActive: boolean };
type SkillChange = { name: string; description: string; scope: string; groupId: string; isActive: boolean; existingSkillId?: string | undefined };
type ConfigurationChange = { status: "draft" | "active"; links: { skillId: string; weight: number }[]; note?: string };
type Revision = { curriculumId: string; revisionId: string; cohortCode: string; name: string; version: number; isCurrent: boolean; isActive: boolean; data: CurriculumData };
type Group = { id: string; name: string; description: string; isActive: boolean; version: string; skillCount: number };
type Skill = { id: string; name: string; description: string; scope: string; legacySkillId: string | null; groupId: string; groupName: string; isActive: boolean; groupActive: boolean; version: string; careerCount: number; courseCount: number };
type CourseLink = { skillId: string; skillName: string; groupId: string; groupName: string; isActive: boolean; weight: number };
type CourseConfiguration = { id: string; courseCode: string; status: "draft" | "active" | "archived"; version: string; note: string; skillCount: number; totalWeight: string | number };
type Warning = { code: string; message: string; courseCode?: string };

const groupColumns = `g.id,g.name,g.description,g.is_active AS "isActive",g.version,
 (SELECT count(*)::int FROM ad_comp_skills cs WHERE cs.group_id=g.id AND cs.deleted_at IS NULL) AS "skillCount"`;
const skillColumns = `s.id,s.name,s.description,cs.scope,cs.legacy_skill_id AS "legacySkillId",cs.group_id AS "groupId",g.name AS "groupName",
 cs.is_active AS "isActive",g.is_active AS "groupActive",cs.version,
 (SELECT count(DISTINCT r.career_position_id)::int FROM career_requirements r
  JOIN career_positions p ON p.id=r.career_position_id
  WHERE r.skill_id=s.id AND r.deleted_at IS NULL AND p.deleted_at IS NULL) AS "careerCount",
 (SELECT count(*)::int FROM ad_comp_course_links l JOIN ad_comp_course_configs c ON c.id=l.config_id
  WHERE l.skill_id=s.id AND c.status='active' AND l.weight>0) AS "courseCount"`;
const skillTables = `FROM ad_comp_skills cs JOIN career_skills s ON s.id=cs.skill_id
 JOIN ad_comp_groups g ON g.id=cs.group_id`;

export class CompetencyRepository {
  constructor(readonly pool: DatabasePool) {}

  async access(actor: AuthenticatedUser) {
    await access(this.pool, actor, false);
  }

  private async write<T>(actor: AuthenticatedUser, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await access(client, actor, true, false, true);
      // The same lock is held by career skill renames/deletions and requirement writes.
      await lockSkillCatalog(client);
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async event(db: Database, kind: "group" | "skill" | "course", key: string, actor: AuthenticatedUser, snapshot: unknown, note: string) {
    await db.query(`INSERT INTO ad_comp_events(kind,entity_key,actor_id,snapshot,note)
 VALUES($1,$2,$3,$4::jsonb,$5)`, [kind, key, actor.userId, JSON.stringify(snapshot), note]);
  }

  private async history(db: Database, kinds: string[], key: string) {
    const result = await db.query(`SELECT e.id,e.note,e.created_at AS "createdAt",
 u.display_name AS "actorName",e.snapshot FROM ad_comp_events e LEFT JOIN users u ON u.id=e.actor_id
 WHERE e.kind=ANY($1::text[]) AND e.entity_key=$2 ORDER BY e.created_at DESC,e.id DESC`, [kinds, key]);
    return result.rows;
  }

  async groups() {
    return (await this.pool.query<Group>(`SELECT ${groupColumns} FROM ad_comp_groups g ORDER BY g.name,g.id`)).rows;
  }

  private async groupRecord(db: Database, id: string) {
    const result = await db.query<Group>(`SELECT ${groupColumns} FROM ad_comp_groups g WHERE g.id=$1`, [id]);
    if (!result.rowCount) throw new CompetencyError("group_not_found", 404);
    return result.rows[0]!;
  }

  private async groupSnapshot(db: Database, id: string) {
    const group = await this.groupRecord(db, id);
    const skills = await db.query<Skill>(`SELECT ${skillColumns} ${skillTables}
 WHERE cs.group_id=$1 AND cs.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.name,s.id`, [id]);
    return { ...group, skills: skills.rows };
  }

  async group(id: string) {
    return { ...await this.groupSnapshot(this.pool, id), history: await this.history(this.pool, ["group"], id) };
  }

  async createGroup(data: GroupChange, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      const result = await client.query<{ id: string }>(`INSERT INTO ad_comp_groups(name,description,is_active)
 VALUES($1,$2,$3) RETURNING id`, [data.name, data.description, data.isActive]);
      const snapshot = await this.groupSnapshot(client, result.rows[0]!.id);
      await this.event(client, "group", snapshot.id, actor, snapshot, "Thêm nhóm năng lực");
      return snapshot;
    });
  }

  async updateGroup(id: string, version: string, data: GroupChange, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      const current = await client.query<{ version: string }>("SELECT version FROM ad_comp_groups WHERE id=$1 FOR UPDATE", [id]);
      if (!current.rowCount) throw new CompetencyError("group_not_found", 404);
      if (current.rows[0]!.version !== version) throw new CompetencyError("group_changed", 409);
      if (!data.isActive) {
        const used = await client.query(`SELECT 1 FROM ad_comp_course_links l
 JOIN ad_comp_course_configs c ON c.id=l.config_id JOIN ad_comp_skills cs ON cs.skill_id=l.skill_id
 WHERE cs.group_id=$1 AND c.status='active' LIMIT 1`, [id]);
        if (used.rowCount) throw new CompetencyError("group_in_use", 409);
      }
      await client.query(`UPDATE ad_comp_groups SET name=$2,description=$3,is_active=$4,version=$5,updated_at=now()
 WHERE id=$1`, [id, data.name, data.description, data.isActive, randomUUID()]);
      const snapshot = await this.groupSnapshot(client, id);
      await this.event(client, "group", id, actor, snapshot, "Cập nhật nhóm năng lực");
      return snapshot;
    });
  }

  async catalog() {
    return (await this.pool.query(`SELECT id,name,description,version FROM career_skills
 WHERE deleted_at IS NULL ORDER BY name,id`)).rows;
  }

  async skills(query: { q: string; groupId: string; active: "" | "true" | "false" }) {
    const result = await this.pool.query<Skill>(`SELECT ${skillColumns} ${skillTables}
 WHERE cs.deleted_at IS NULL AND s.deleted_at IS NULL AND ($1='' OR cs.group_id=NULLIF($1,'')::uuid)
 AND ($2='' OR cs.is_active=($2='true')) ORDER BY s.name,s.id`, [query.groupId, query.active]);
    const term = fold(query.q);
    return result.rows.filter(row => fold(`${row.name} ${row.description} ${row.scope} ${row.groupName}`).includes(term));
  }

  private async skillRecord(db: Database, id: string) {
    const result = await db.query<Skill>(`SELECT ${skillColumns} ${skillTables}
 WHERE s.id=$1 AND cs.deleted_at IS NULL AND s.deleted_at IS NULL`, [id]);
    if (!result.rowCount) throw new CompetencyError("skill_not_found", 404);
    return result.rows[0]!;
  }

  private async contributions(db: Database, id: string) {
    const result = await db.query(`SELECT c.revision_id AS "revisionId",cu.cohort_code AS "cohortCode",
 r.data->>'name' AS "curriculumName",r.version AS "curriculumVersion",cu.current_revision=r.id AS "isCurrent",
 c.course_code AS "courseCode",cc.name AS "courseName",l.weight::float8 AS weight,c.status
 FROM ad_comp_course_links l JOIN ad_comp_course_configs c ON c.id=l.config_id
 JOIN curriculum_revisions r ON r.id=c.revision_id JOIN curricula cu ON cu.id=r.curriculum_id
 JOIN curriculum_courses cc ON cc.revision_id=c.revision_id AND cc.code=c.course_code
 WHERE l.skill_id=$1 ORDER BY cu.cohort_code DESC,r.version DESC,c.course_code`, [id]);
    return result.rows;
  }

  private async skillSnapshot(db: Database, id: string) {
    return { ...await this.skillRecord(db, id), contributions: await this.contributions(db, id) };
  }

  async skill(id: string) {
    return { ...await this.skillSnapshot(this.pool, id), history: await this.history(this.pool, ["skill", "shared_skill"], id) };
  }

  private async groupFor(db: Database, id: string) {
    const result = await db.query<{ is_active: boolean }>("SELECT is_active FROM ad_comp_groups WHERE id=$1 FOR SHARE", [id]);
    if (!result.rowCount) throw new CompetencyError("group_not_found", 404);
    return result.rows[0]!;
  }

  private async activeSkillUsage(db: Database, id: string) {
    const result = await db.query(`SELECT 1 FROM ad_comp_course_links l JOIN ad_comp_course_configs c ON c.id=l.config_id
 WHERE l.skill_id=$1 AND c.status='active' LIMIT 1`, [id]);
    return Boolean(result.rowCount);
  }

  async createSkill(data: SkillChange, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      await this.groupFor(client, data.groupId);
      let id: string;
      let restored = false;
      if (data.existingSkillId) {
        const canonical = await client.query<{ id: string; name: string; description: string }>(`SELECT id,name,description
 FROM career_skills WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [data.existingSkillId]);
        if (!canonical.rowCount) throw new CompetencyError("skill_unavailable", 409);
        const skill = canonical.rows[0]!;
        if (skill.name !== data.name || skill.description !== data.description)
          throw new CompetencyError("canonical_skill_mismatch", 409);
        id = skill.id;
        const profile = await client.query<{ deleted_at: string | null }>("SELECT deleted_at FROM ad_comp_skills WHERE skill_id=$1 FOR UPDATE", [id]);
        if (profile.rowCount) {
          if (!profile.rows[0]!.deleted_at) throw new CompetencyError("skill_profile_exists", 409);
          if (await this.activeSkillUsage(client, id)) throw new CompetencyError("skill_in_use", 409);
          await client.query(`UPDATE ad_comp_skills SET group_id=$2,scope=$3,is_active=$4,deleted_at=NULL,
 version=$5,updated_at=now() WHERE skill_id=$1`, [id, data.groupId, data.scope, data.isActive, randomUUID()]);
          restored = true;
        }
      } else {
        id = randomUUID();
        await client.query("INSERT INTO career_skills(id,name,description) VALUES($1,$2,$3)", [id, data.name, data.description]);
      }
      if (!restored) {
        await client.query("INSERT INTO ad_comp_skills(skill_id,group_id,scope,is_active) VALUES($1,$2,$3,$4)",
          [id, data.groupId, data.scope, data.isActive]);
      }
      const snapshot = await this.skillSnapshot(client, id);
      await this.event(client, "skill", id, actor, snapshot, restored ? "Khôi phục năng lực" : "Thêm năng lực");
      return snapshot;
    });
  }

  async updateSkill(id: string, version: string, data: SkillChange, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      const current = await client.query<{ name: string; description: string; version: string }>(`SELECT s.name,s.description,cs.version
 ${skillTables} WHERE s.id=$1 AND cs.deleted_at IS NULL AND s.deleted_at IS NULL FOR UPDATE OF s,cs`, [id]);
      if (!current.rowCount) throw new CompetencyError("skill_not_found", 404);
      const previous = current.rows[0]!;
      if (previous.version !== version) throw new CompetencyError("skill_changed", 409);
      const group = await this.groupFor(client, data.groupId);
      if ((!data.isActive || !group.is_active) && await this.activeSkillUsage(client, id))
        throw new CompetencyError("skill_in_use", 409);
      if (previous.name !== data.name || previous.description !== data.description) {
        const careers = await client.query<{ id: string }>(`SELECT p.id FROM career_positions p
 WHERE p.deleted_at IS NULL AND EXISTS(SELECT 1 FROM career_requirements r
 WHERE r.career_position_id=p.id AND r.skill_id=$1 AND r.deleted_at IS NULL) ORDER BY p.id FOR UPDATE`, [id]);
        await client.query("UPDATE career_skills SET name=$2,description=$3,version=$4,updated_at=now() WHERE id=$1",
          [id, data.name, data.description, randomUUID()]);
        if (previous.name !== data.name) {
          await client.query(`UPDATE career_requirements SET title=CASE WHEN title=$2 THEN $3 ELSE title END,
 version=$4,updated_at=now() WHERE skill_id=$1 AND deleted_at IS NULL`, [id, previous.name, data.name, randomUUID()]);
          for (const career of careers.rows) await refreshCareerSkills(client, career.id);
        }
      }
      await client.query(`UPDATE ad_comp_skills SET group_id=$2,scope=$3,is_active=$4,version=$5,updated_at=now()
 WHERE skill_id=$1`, [id, data.groupId, data.scope, data.isActive, randomUUID()]);
      const snapshot = await this.skillSnapshot(client, id);
      await this.event(client, "skill", id, actor, snapshot, "Cập nhật năng lực");
      return snapshot;
    });
  }

  async deleteSkill(id: string, version: string, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      const current = await client.query<{ version: string }>("SELECT version FROM ad_comp_skills WHERE skill_id=$1 AND deleted_at IS NULL FOR UPDATE", [id]);
      if (!current.rowCount) throw new CompetencyError("skill_not_found", 404);
      if (current.rows[0]!.version !== version) throw new CompetencyError("skill_changed", 409);
      if (await this.activeSkillUsage(client, id)) throw new CompetencyError("skill_in_use", 409);
      const previous = await this.skillSnapshot(client, id);
      const nextVersion = randomUUID();
      const removed = await client.query<{ deletedAt: string }>(`UPDATE ad_comp_skills SET deleted_at=now(),is_active=false,
 version=$2,updated_at=now() WHERE skill_id=$1 RETURNING deleted_at AS "deletedAt"`, [id, nextVersion]);
      await this.event(client, "skill", id, actor,
        { ...previous, isActive: false, version: nextVersion, deletedAt: removed.rows[0]!.deletedAt }, "Xóa năng lực khỏi danh mục đánh giá");
      return { deleted: true };
    });
  }

  async curricula() {
    const result = await this.pool.query(`SELECT c.id AS "curriculumId",r.id AS "revisionId",c.cohort_code AS "cohortCode",
 r.data->>'name' AS name,r.version,c.current_revision=r.id AS "isCurrent",c.is_active AS "isActive",
 (SELECT count(DISTINCT x->>'code')::int FROM jsonb_array_elements(r.data->'courses') x) AS "courseCount",
 (SELECT count(*)::int FROM ad_comp_course_configs cc WHERE cc.revision_id=r.id) AS "configuredCount",
 (SELECT count(*)::int FROM ad_comp_course_configs cc WHERE cc.revision_id=r.id AND cc.status='active') AS "activeCount",
 (SELECT count(*)::int FROM ad_comp_course_configs cc WHERE cc.revision_id=r.id AND cc.status='draft') AS "draftCount"
 FROM curricula c JOIN curriculum_revisions r ON r.curriculum_id=c.id
 ORDER BY c.cohort_code DESC,r.version DESC,c.id`);
    return result.rows;
  }

  private async revision(db: Database, id: string): Promise<Revision> {
    const result = await db.query<Revision>(`SELECT c.id AS "curriculumId",r.id AS "revisionId",c.cohort_code AS "cohortCode",
 r.data->>'name' AS name,r.version,c.current_revision=r.id AS "isCurrent",c.is_active AS "isActive",r.data
 FROM curriculum_revisions r JOIN curricula c ON c.id=r.curriculum_id WHERE r.id=$1`, [id]);
    if (!result.rowCount) throw new CompetencyError("curriculum_revision_not_found", 404);
    return result.rows[0]!;
  }

  private courseOccurrences(revision: Revision) {
    const rows = new Map<string, { course: CurriculumCourse; occurrenceCount: number }>();
    for (const course of revision.data.courses) {
      const previous = rows.get(course.code);
      if (previous) previous.occurrenceCount++;
      else rows.set(course.code, { course, occurrenceCount: 1 });
    }
    return rows;
  }

  private async configurations(db: Database, revisionId: string) {
    const result = await db.query<CourseConfiguration>(`SELECT c.id,c.course_code AS "courseCode",c.status,c.version,c.note,
 count(l.skill_id)::int AS "skillCount",COALESCE(sum(l.weight),0) AS "totalWeight"
 FROM ad_comp_course_configs c LEFT JOIN ad_comp_course_links l ON l.config_id=c.id
 WHERE c.revision_id=$1 GROUP BY c.id ORDER BY c.course_code`, [revisionId]);
    return new Map(result.rows.map(row => [row.courseCode, row]));
  }

  async courses(revisionId: string, query: { q: string; status: "" | "missing" | "draft" | "active" | "archived" }) {
    const revision = await this.revision(this.pool, revisionId);
    const configurations = await this.configurations(this.pool, revisionId);
    const term = fold(query.q);
    return [...this.courseOccurrences(revision).values()].map(({ course, occurrenceCount }) => {
      const config = configurations.get(course.code);
      return { code: course.code, name: course.name, credits: course.credits, type: course.type, block: course.block,
        specialty: course.specialty, occurrenceCount, status: config?.status ?? "missing", configId: config?.id ?? null,
        version: config?.version ?? null, skillCount: config?.skillCount ?? 0, totalWeight: Number(config?.totalWeight ?? 0) };
    }).filter(row => (!query.status || row.status === query.status) &&
      fold(`${row.code} ${row.name} ${row.block} ${row.specialty}`).includes(term));
  }

  private async courseSnapshot(db: Database, revisionId: string, code: string) {
    const revision = await this.revision(db, revisionId);
    const occurrence = this.courseOccurrences(revision).get(code);
    if (!occurrence) throw new CompetencyError("course_not_found", 404);
    const configuration = await db.query<CourseConfiguration>(`SELECT id,course_code AS "courseCode",status,version,note
 FROM ad_comp_course_configs WHERE revision_id=$1 AND course_code=$2`, [revisionId, code]);
    const config = configuration.rows[0];
    const result = config ? await db.query<CourseLink>(`SELECT l.skill_id AS "skillId",s.name AS "skillName",
 cs.group_id AS "groupId",g.name AS "groupName",
 (cs.is_active AND cs.deleted_at IS NULL AND g.is_active AND s.deleted_at IS NULL) AS "isActive",l.weight::float8 AS weight
 FROM ad_comp_course_links l JOIN ad_comp_skills cs ON cs.skill_id=l.skill_id
 JOIN career_skills s ON s.id=cs.skill_id JOIN ad_comp_groups g ON g.id=cs.group_id
 WHERE l.config_id=$1 ORDER BY g.name,s.name,s.id`, [config.id]) : null;
    return { revisionId, courseCode: code, courseName: occurrence.course.name, occurrenceCount: occurrence.occurrenceCount,
      configId: config?.id ?? null, status: config?.status ?? "missing", version: config?.version ?? null,
      note: config?.note ?? "", links: result?.rows ?? [] };
  }

  async course(revisionId: string, code: string) {
    return { ...await this.courseSnapshot(this.pool, revisionId, code),
      history: await this.history(this.pool, ["course"], `${revisionId}:${code}`) };
  }

  private async validateCourseLinks(db: Database, links: ConfigurationChange["links"], status: ConfigurationChange["status"]) {
    validateWeights(links, status);
    if (!links.length) return;
    const result = await db.query<{ id: string; isActive: boolean; groupActive: boolean; name: string }>(`SELECT s.id,s.name,
 cs.is_active AS "isActive",g.is_active AS "groupActive" ${skillTables}
 WHERE s.id=ANY($1::uuid[]) AND cs.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.id FOR SHARE OF cs,s,g`,
      [links.map(link => link.skillId).sort()]);
    if (result.rowCount !== links.length) throw new CompetencyError("skill_unavailable", 409);
    if (status === "active") {
      const inactive = result.rows.filter(row => !row.isActive || !row.groupActive);
      if (inactive.length) throw new CompetencyError(inactive.some(row => !row.groupActive) ? "group_unavailable" : "skill_unavailable",
        409, inactive.map(row => row.name));
    }
  }

  async saveCourse(revisionId: string, code: string, version: string, data: ConfigurationChange, actor: AuthenticatedUser) {
    // Reject malformed weights before connecting, including duplicate skill IDs.
    validateWeights(data.links, data.status);
    return this.write(actor, async client => {
      const revision = await this.revision(client, revisionId);
      const occurrence = this.courseOccurrences(revision).get(code);
      if (!occurrence) throw new CompetencyError("course_not_found", 404);
      if (occurrence.occurrenceCount !== 1) throw new CompetencyError("duplicate_curriculum_course", 409, [code]);
      const existing = await client.query<{ id: string; version: string }>(`SELECT id,version FROM ad_comp_course_configs
 WHERE revision_id=$1 AND course_code=$2 FOR UPDATE`, [revisionId, code]);
      const config = existing.rows[0];
      if ((config && config.version !== version) || (!config && version !== "new"))
        throw new CompetencyError("configuration_changed", 409);
      await this.validateCourseLinks(client, data.links, data.status);
      const id = config?.id ?? randomUUID();
      if (config) {
        await client.query(`UPDATE ad_comp_course_configs SET status=$2,note=$3,version=$4,updated_at=now() WHERE id=$1`,
          [id, data.status, data.note ?? "", randomUUID()]);
        await client.query("DELETE FROM ad_comp_course_links WHERE config_id=$1", [id]);
      } else {
        await client.query(`INSERT INTO ad_comp_course_configs(id,revision_id,course_code,status,note)
 VALUES($1,$2,$3,$4,$5)`, [id, revisionId, code, data.status, data.note ?? ""]);
      }
      for (const link of [...data.links].sort((a, b) => a.skillId.localeCompare(b.skillId))) {
        await client.query("INSERT INTO ad_comp_course_links(config_id,skill_id,weight) VALUES($1,$2,$3)",
          [id, link.skillId, link.weight]);
      }
      const snapshot = await this.courseSnapshot(client, revisionId, code);
      await this.event(client, "course", `${revisionId}:${code}`, actor, snapshot,
        data.note?.trim() || (config ? "Cập nhật phân bổ năng lực học phần" : "Thêm phân bổ năng lực học phần"));
      return snapshot;
    });
  }

  async archiveCourse(revisionId: string, code: string, version: string, actor: AuthenticatedUser) {
    return this.write(actor, async client => {
      const current = await client.query<{ id: string; version: string }>(`SELECT id,version FROM ad_comp_course_configs
 WHERE revision_id=$1 AND course_code=$2 FOR UPDATE`, [revisionId, code]);
      if (!current.rowCount) throw new CompetencyError("course_not_found", 404);
      if (current.rows[0]!.version !== version) throw new CompetencyError("configuration_changed", 409);
      await client.query("UPDATE ad_comp_course_configs SET status='archived',version=$2,updated_at=now() WHERE id=$1",
        [current.rows[0]!.id, randomUUID()]);
      const snapshot = await this.courseSnapshot(client, revisionId, code);
      await this.event(client, "course", `${revisionId}:${code}`, actor, snapshot, "Ngừng áp dụng phân bổ năng lực học phần");
      return snapshot;
    });
  }

  async summary(revisionId: string) {
    const revision = await this.revision(this.pool, revisionId);
    const occurrences = this.courseOccurrences(revision);
    const configurations = await this.configurations(this.pool, revisionId);
    const links = await this.pool.query<{ courseCode: string; skillId: string; skillName: string; weight: number; isActive: boolean }>(`SELECT c.course_code AS "courseCode",
 l.skill_id AS "skillId",s.name AS "skillName",l.weight::float8 AS weight,
 (cs.is_active AND cs.deleted_at IS NULL AND g.is_active AND s.deleted_at IS NULL) AS "isActive"
 FROM ad_comp_course_configs c JOIN ad_comp_course_links l ON l.config_id=c.id
 JOIN ad_comp_skills cs ON cs.skill_id=l.skill_id JOIN career_skills s ON s.id=cs.skill_id
 JOIN ad_comp_groups g ON g.id=cs.group_id WHERE c.revision_id=$1 ORDER BY c.course_code,s.name,s.id`, [revisionId]);
    const eligible = await this.pool.query<{ id: string }>(`SELECT s.id ${skillTables}
 WHERE cs.deleted_at IS NULL AND cs.is_active AND s.deleted_at IS NULL AND g.is_active`);
    const linksByCourse = new Map<string, typeof links.rows>();
    for (const link of links.rows) {
      const bucket = linksByCourse.get(link.courseCode) ?? [];
      bucket.push(link);
      linksByCourse.set(link.courseCode, bucket);
    }
    const linked = new Set(links.rows.filter(link => link.weight > 0 && link.isActive && configurations.get(link.courseCode)?.status === "active")
      .map(link => link.skillId));
    const warnings: Warning[] = [];
    let activeCount = 0, draftCount = 0, archivedCount = 0, missingCount = 0;
    for (const [code, occurrence] of occurrences) {
      const config = configurations.get(code);
      if (occurrence.occurrenceCount > 1) warnings.push({ code: "duplicate_curriculum_course", courseCode: code,
        message: `${code} xuất hiện ${occurrence.occurrenceCount} dòng trong phiên bản CTĐT; cần rà soát trước khi lưu phân bổ.` });
      if (!config) {
        missingCount++;
        warnings.push({ code: "missing_configuration", courseCode: code, message: `${code} chưa có phân bổ năng lực.` });
        continue;
      }
      if (config.status === "active") activeCount++;
      else if (config.status === "draft") draftCount++;
      else archivedCount++;
      const courseLinks = linksByCourse.get(code) ?? [];
      if (config.status === "draft" && (!courseLinks.length || Math.abs(Number(config.totalWeight) - 1) > WEIGHT_TOLERANCE || courseLinks.some(link => !link.isActive)))
        warnings.push({ code: "incomplete_draft", courseCode: code,
          message: `${code} là bản nháp chưa đủ phân bổ 100% hoặc có năng lực chưa khả dụng.` });
      if (config.status !== "archived") for (const link of courseLinks.filter(link => link.weight === 0))
        warnings.push({ code: "zero_contribution", courseCode: code, message: `${link.skillName} có trọng số 0% trong ${code}; liên kết này không đóng góp vào năng lực.` });
    }
    if (!configurations.size) warnings.unshift({ code: "no_configurations", message: "Phiên bản CTĐT này chưa có cấu hình năng lực học phần." });
    const unlinkedSkillCount = eligible.rows.filter(skill => !linked.has(skill.id)).length;
    if (unlinkedSkillCount) warnings.push({ code: "unlinked_skills", message: `${unlinkedSkillCount} năng lực khả dụng chưa có học phần đóng góp trong phiên bản này.` });
    return { revisionId, cohortCode: revision.cohortCode, curriculumName: revision.name, curriculumVersion: revision.version,
      isCurrent: revision.isCurrent, courseCount: occurrences.size, activeCount, draftCount, archivedCount, missingCount,
      skillCount: eligible.rows.length, unlinkedSkillCount, warnings };
  }
}
