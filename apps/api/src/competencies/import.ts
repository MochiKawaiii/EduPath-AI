import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";
import type { AuthenticatedUser } from "../auth/types.js";
import { access, lockSkillCatalog } from "../careers/shared.js";
import { CompetencyError, type Issue, type WorkbookData } from "./model.js";

type Source = { revisionId: string; cohortCode: string; filename: string; buffer: Buffer };
type Group = {id:string;name:string;source_key:string|null;is_active:boolean;version:string};
type Canonical = {id:string;name:string;description:string;version:string;deleted_at:Date|null};
type Profile = {skill_id:string;group_id:string;scope:string;is_active:boolean;deleted_at:Date|null;version:string;legacy_skill_id?:string|null};
type Config = {id:string;course_code:string;status:string;version:string;note:string};
type Link = {config_id:string;skill_id:string;weight:string;name:string};
type Course = {code:string;name:string};
type Context = {revision:{id:string;curriculum_id:string;cohort_code:string;version:number;name:string;courses:Course[]};groups:Group[];canonical:Canonical[];profiles:Profile[];aliases:{source_name:string;skill_id:string}[];configs:Config[];links:Link[];courses:Course[];legacySkills?:{id:string;name:string;deleted_at:Date|null}[]};
type SkillPlan = {name:string;group:string;scope:string;skillId:string|null;legacySkillId:string|null;action:"create"|"reuse"|"unchanged"|"update";previousScope?:string;previousGroup?:string};
type CoursePlan = {courseCode:string;courseName:string;rowCount:number;totalWeight:number;action:"create"|"update"|"unchanged"|"error";changes:{skillName:string;beforeWeight:number|null;afterWeight:number|null}[]};
export type ImportPreview = {
 token:string;revisionId:string;cohortCode:string;filename:string;skills:SkillPlan[];courses:CoursePlan[];errors:Issue[];warnings:Issue[];canImport:boolean;requiresOverwrite:boolean;
 counts:{skillRows:number;linkRows:number;courses:number;validRows:number;errorRows:number;groupsToCreate:number;skillsToCreate:number;skillsToReuse:number;skillsToUpdate:number;legacySkillsMapped:number;coursesToCreate:number;coursesToUpdate:number;coursesUnchanged:number;linksToCreate:number;linksToUpdate:number;linksToRemove:number};
};
const nameKey=(value:string)=>value.normalize("NFC").trim().toLowerCase();
const groupFor=(context:Context,name:string)=>context.groups.find(group=>group.source_key===name)??context.groups.find(group=>nameKey(group.name)===nameKey(name));

async function contextFor(db:DatabasePool|PoolClient,source:Source):Promise<Context> {
  const revision=await db.query(`SELECT r.id,r.curriculum_id,r.version,c.cohort_code,r.data->>'name' AS name,r.data->'courses' AS courses
    FROM curriculum_revisions r JOIN curricula c ON c.id=r.curriculum_id WHERE r.id=$1`,[source.revisionId]);
  if(!revision.rowCount) throw new CompetencyError("curriculum_not_found",404);
  if(revision.rows[0].cohort_code!==source.cohortCode) throw new CompetencyError("cohort_mismatch",422,["Khóa nguồn phải trùng khóa của phiên bản CTĐT đã chọn."]);
  // The supplied workbook has no cohort column. Require an explicit cohort declaration,
  // and reject conflicting cohort markers in the file name instead of guessing.
  const markers=[...source.filename.matchAll(/(?:^|[^a-z0-9])K(\d+)(?=$|[^a-z0-9])/gi)].map(match=>`K${match[1]}`);
  if(markers.some(marker=>marker!==source.cohortCode)) throw new CompetencyError("cohort_mismatch",422,["Khóa trong tên file khác khóa đã chọn."]);
  const groups=(await db.query("SELECT id,name,source_key,is_active,version FROM ad_comp_groups ORDER BY id")).rows;
  const canonical=(await db.query("SELECT id,name,description,version,deleted_at FROM career_skills ORDER BY id")).rows;
  const profiles=(await db.query("SELECT skill_id,legacy_skill_id,group_id,scope,is_active,deleted_at,version FROM ad_comp_skills ORDER BY skill_id")).rows;
  const hasLegacy=(await db.query("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='competency_skills') AS present")).rows[0].present;
  const legacySkills=hasLegacy?(await db.query("SELECT id,name,deleted_at FROM competency_skills ORDER BY id")).rows:[];
  const aliases=(await db.query("SELECT source_name,skill_id FROM ad_comp_import_aliases WHERE cohort_code=$1 ORDER BY source_name",[source.cohortCode])).rows;
  const configs=(await db.query("SELECT id,course_code,status,version,note FROM ad_comp_course_configs WHERE revision_id=$1 ORDER BY course_code",[source.revisionId])).rows;
  const links=(await db.query(`SELECT l.config_id,l.skill_id,l.weight,k.name FROM ad_comp_course_links l
    JOIN ad_comp_course_configs c ON c.id=l.config_id JOIN career_skills k ON k.id=l.skill_id WHERE c.revision_id=$1 ORDER BY l.config_id,l.skill_id`,[source.revisionId])).rows;
  const courses=(await db.query("SELECT code,name FROM curriculum_courses WHERE revision_id=$1 ORDER BY code",[source.revisionId])).rows;
  return {revision:revision.rows[0],groups,canonical,profiles,aliases,configs,links,courses,legacySkills};
}

export function makeImportPlan(data:WorkbookData,context:Context,source:Source):ImportPreview {
  const errors=[...data.errors],warnings=[...data.warnings];
  const add=(list:Issue[],sheet:string,row:number|null,code:string,message:string)=>list.push({sheet,row,code,message});
  let requiresOverwrite=false;
  const skills:SkillPlan[]=data.skills.map(skill=>{
    const group=groupFor(context,skill.group);
    if(group&&!group.is_active) add(errors,"skills",skill.row,"group_inactive",`Nhóm ${group.name} đang vô hiệu hóa. Cần cấu hình nhóm trước khi nhập.`);
    const alias=context.aliases.find(alias=>alias.source_name===skill.name);
    if(!alias&&context.canonical.filter(item=>item.deleted_at===null&&nameKey(item.name)===nameKey(skill.name)).length>1)
      add(errors,"skills",skill.row,"ambiguous_canonical_skill",`${skill.name}: có nhiều ID khớp chính xác sau chuẩn hóa Unicode. Cần xác minh ID trước khi nhập.`);
    const canonical=alias?context.canonical.find(item=>item.id===alias.skill_id):context.canonical.find(item=>item.deleted_at===null&&nameKey(item.name)===nameKey(skill.name));
    if(alias&&(!canonical||canonical.deleted_at!==null)) add(errors,"skills",skill.row,"skill_unavailable",`${skill.name}: ID đã ánh xạ không còn sử dụng. Không tự tạo ID thay thế.`);
    if(canonical&&!alias&&canonical.description!==skill.scope) add(warnings,"skills",skill.row,"canonical_description_preserved",`${skill.name}: dùng chung ID nghề nghiệp, giữ mô tả đang có; phạm vi đánh giá lưu riêng.`);
    const profile=context.profiles.find(profile=>profile.skill_id===canonical?.id);
    const legacyMatches=(context.legacySkills??[]).filter(item=>item.deleted_at===null&&nameKey(item.name)===nameKey(skill.name));
    if(legacyMatches.length>1) add(errors,"skills",skill.row,"ambiguous_legacy_skill",`${skill.name}: có nhiều định danh trong dữ liệu đánh giá cũ. Không tự chọn hoặc gộp.`);
    const legacySkillId=profile?.legacy_skill_id??legacyMatches[0]?.id??null;
    if(legacySkillId&&context.profiles.some(item=>item.legacy_skill_id===legacySkillId&&item.skill_id!==canonical?.id))
      add(errors,"skills",skill.row,"legacy_mapping_conflict",`${skill.name}: định danh cũ đã nối tới một kỹ năng dùng chung khác.`);
    const unchanged=profile&&profile.deleted_at===null&&profile.is_active&&profile.scope===skill.scope&&profile.group_id===group?.id&&(profile.legacy_skill_id??null)===legacySkillId;
    const action:SkillPlan["action"]=!canonical?"create":!profile?"reuse":unchanged?"unchanged":"update";
    if(action==="update") requiresOverwrite=true;
    const previousGroup=profile?context.groups.find(group=>group.id===profile.group_id)?.name:undefined;
    return {name:skill.name,group:skill.group,scope:skill.scope,skillId:canonical?.id??null,legacySkillId,action,...(profile?{previousScope:profile.scope}: {}),...(previousGroup?{previousGroup}: {})};
  });
  const knownIds=skills.filter(skill=>skill.skillId).map(skill=>skill.skillId);
  if(context.legacySkills?.length) add(warnings,"skills",null,"legacy_data_preserved",`Có ${context.legacySkills.length} kỹ năng trong cấu trúc đánh giá cũ. Giữ nguyên dữ liệu và kết quả cũ; nối ID khớp chính xác, không tự chuyển trọng số cũ sang các khóa/phiên bản mới.`);
  if(new Set(knownIds).size!==knownIds.length) add(errors,"skills",null,"duplicate_skill_mapping","Nhiều kỹ năng nguồn ánh xạ tới cùng một ID. Cần kiểm tra lại ánh xạ.");
  let linksToCreate=0,linksToUpdate=0,linksToRemove=0;
  const courses:CoursePlan[]=[...new Set(data.links.map(link=>link.courseCode))].map(code=>{
    const rows=data.links.filter(link=>link.courseCode===code),totalWeight=rows.reduce((total,link)=>total+link.weight,0);
    const course=context.courses.find(course=>course.code===code),config=context.configs.find(config=>config.course_code===code);
    const existing=config?context.links.filter(link=>link.config_id===config.id):[];
    const changes:CoursePlan["changes"]=rows.map(link=>{
      const id=skills.find(skill=>skill.name===link.skillName)?.skillId;
      const before=existing.find(item=>item.skill_id===id);
      if(!before) linksToCreate++; else if(Math.abs(Number(before.weight)-link.weight)>1e-10) linksToUpdate++;
      return {skillName:link.skillName,beforeWeight:before?Number(before.weight):null,afterWeight:link.weight};
    });
    for(const old of existing){
      if(!rows.some(link=>skills.find(skill=>skill.name===link.skillName)?.skillId===old.skill_id)) {linksToRemove++;changes.push({skillName:old.name,beforeWeight:Number(old.weight),afterWeight:null});}
    }
    let action:CoursePlan["action"]=!config?"create":config.status==="active"&&changes.every(change=>change.beforeWeight!==null&&change.afterWeight!==null&&Math.abs(change.beforeWeight-change.afterWeight)<=1e-10)?"unchanged":"update";
    if(!course){add(errors,"course_skills",rows[0]!.row,"course_not_found",`${code}: không có trong phiên bản CTĐT đã chọn. Không tạo học phần mới.`);action="error";}
    else if(context.revision.courses.filter(course=>course.code===code).length!==1){add(errors,"course_skills",rows[0]!.row,"ambiguous_course",`${code}: CTĐT có nhiều dòng cùng mã. Cần rà soát trước khi phân bổ.`);action="error";}
    else if(course.name!==rows[0]!.courseName) add(warnings,"course_skills",rows[0]!.row,"course_name_difference",`${code}: tên nguồn “${rows[0]!.courseName}” khác tên CTĐT “${course.name}”. Liên kết bằng đúng mã trong phiên bản đã chọn.`);
    if(action==="update") requiresOverwrite=true;
    return {courseCode:code,courseName:course?.name??rows[0]!.courseName,rowCount:rows.length,totalWeight,action,changes};
  });
  for(const course of context.courses) if(!data.links.some(link=>link.courseCode===course.code)) add(warnings,"course_skills",null,"unmapped_curriculum_course",`${course.code} — ${course.name}: chưa có phân bổ trong file; cấu hình đang có được giữ nguyên.`);
  const errorRows=new Set(errors.filter(issue=>issue.row!==null).map(issue=>`${issue.sheet}:${issue.row}`)).size;
  const counts={...data.counts,validRows:Math.max(0,data.counts.skillRows+data.counts.linkRows-errorRows),errorRows,
    groupsToCreate:data.groups.filter(name=>!groupFor(context,name)).length,
    skillsToCreate:skills.filter(skill=>skill.action==="create").length,skillsToReuse:skills.filter(skill=>skill.action==="reuse").length,skillsToUpdate:skills.filter(skill=>skill.action==="update").length,legacySkillsMapped:skills.filter(skill=>skill.legacySkillId!==null).length,
    coursesToCreate:courses.filter(course=>course.action==="create").length,coursesToUpdate:courses.filter(course=>course.action==="update").length,coursesUnchanged:courses.filter(course=>course.action==="unchanged").length,
    linksToCreate,linksToUpdate,linksToRemove};
  // Freshly recomputed on confirmation; includes every relevant version and the uploaded bytes.
  const token=createHash("sha256").update(JSON.stringify({sha:createHash("sha256").update(source.buffer).digest("hex"),revisionId:source.revisionId,cohortCode:source.cohortCode,filename:source.filename,context})).digest("hex");
  return {token,revisionId:source.revisionId,cohortCode:source.cohortCode,filename:source.filename,skills,courses,counts,errors,warnings,canImport:errors.length===0,requiresOverwrite};
}

export async function previewCompetencyImport(pool:DatabasePool,data:WorkbookData,source:Source):Promise<ImportPreview> {
  const client=await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result=makeImportPlan(data,await contextFor(client,source),source);
    await client.query("COMMIT");return result;
  } catch(error){await client.query("ROLLBACK");throw error;} finally {client.release();}
}
async function event(client:PoolClient,kind:string,entityKey:string,snapshot:unknown,actor:AuthenticatedUser,note:string){
  await client.query("INSERT INTO ad_comp_events(kind,entity_key,snapshot,actor_id,note) VALUES($1,$2,$3,$4,$5)",[kind,entityKey,JSON.stringify(snapshot),actor.userId,note]);
}
export async function applyCompetencyImport(pool:DatabasePool,data:WorkbookData,source:Source&{token:string;confirmWarnings:boolean;confirmOverwrite:boolean},actor:AuthenticatedUser) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");await access(client,actor,true,false,true);await lockSkillCatalog(client);
    const context=await contextFor(client,source),preview=makeImportPlan(data,context,source);
    if(preview.token!==source.token) throw new CompetencyError("import_preview_changed",409);
    if(!preview.canImport) throw new CompetencyError("import_has_errors",422,preview.errors.map(issue=>issue.message));
    if(preview.warnings.length&&!source.confirmWarnings) throw new CompetencyError("review_warnings",422);
    if(preview.requiresOverwrite&&!source.confirmOverwrite) throw new CompetencyError("confirm_overwrite",409);
    const note=`Nhập dữ liệu ${source.filename}`;
    let changed=preview.counts.groupsToCreate+preview.counts.skillsToCreate+preview.counts.skillsToReuse+preview.counts.skillsToUpdate+preview.counts.coursesToCreate+preview.counts.coursesToUpdate>0;
    for(const name of data.groups){
      if(!groupFor(context,name)) {
        const group=(await client.query("INSERT INTO ad_comp_groups(name,source_key) VALUES($1,$1) RETURNING id,name,source_key,is_active,version",[name])).rows[0];
        context.groups.push(group);await event(client,"group",group.id,{id:group.id,name:group.name,description:"",isActive:true,version:group.version},actor,note);
      }
    }
    const identities=new Map<string,string>();
    for(const plan of preview.skills) {
      const group=groupFor(context,plan.group)!;let id=plan.skillId;
      if(plan.action==="create") {
        id=plan.legacySkillId&&!context.canonical.some(skill=>skill.id===plan.legacySkillId)?plan.legacySkillId:randomUUID();
        await client.query("INSERT INTO career_skills(id,name,description) VALUES($1,$2,$3)",[id,plan.name,plan.scope.length<=2000?plan.scope:""]);
      }
      if(plan.action==="create"||plan.action==="reuse") await client.query("INSERT INTO ad_comp_skills(skill_id,group_id,scope,legacy_skill_id) VALUES($1,$2,$3,$4)",[id,group.id,plan.scope,plan.legacySkillId]);
      else if(plan.action==="update") await client.query("UPDATE ad_comp_skills SET group_id=$2,scope=$3,is_active=true,deleted_at=NULL,version=$4,legacy_skill_id=$5,updated_at=now() WHERE skill_id=$1",[id,group.id,plan.scope,randomUUID(),plan.legacySkillId]);
      identities.set(plan.name,id!);
      if(!context.aliases.some(alias=>alias.source_name===plan.name)) {
        await client.query("INSERT INTO ad_comp_import_aliases(cohort_code,source_name,skill_id) VALUES($1,$2,$3)",[source.cohortCode,plan.name,id]);changed=true;
      }
      if(plan.action!=="unchanged") await event(client,"skill",id!,{skillId:id,legacySkillId:plan.legacySkillId,name:context.canonical.find(skill=>skill.id===id)?.name??plan.name,groupId:group.id,groupName:group.name,scope:plan.scope,isActive:true},actor,note);
    }
    for(const plan of preview.courses) {
      if(plan.action==="unchanged") continue;
      let config=context.configs.find(config=>config.course_code===plan.courseCode);
      if(!config) config=(await client.query("INSERT INTO ad_comp_course_configs(revision_id,course_code,status) VALUES($1,$2,'active') RETURNING id,course_code,status,version,note",[source.revisionId,plan.courseCode])).rows[0];
      else {
        config.version=randomUUID();
        await client.query("UPDATE ad_comp_course_configs SET status='active',version=$2,updated_at=now() WHERE id=$1",[config.id,config.version]);
      }
      await client.query("DELETE FROM ad_comp_course_links WHERE config_id=$1",[config!.id]);
      const snapshotLinks=data.links.filter(link=>link.courseCode===plan.courseCode).map(link=>{
        const group=groupFor(context,link.group)!;
        return {skillId:identities.get(link.skillName)!,skillName:context.canonical.find(skill=>skill.id===identities.get(link.skillName))?.name??link.skillName,groupId:group.id,groupName:group.name,isActive:true,weight:link.weight};
      });
      for(const link of snapshotLinks) await client.query("INSERT INTO ad_comp_course_links(config_id,skill_id,weight) VALUES($1,$2,$3)",[config!.id,link.skillId,link.weight]);
      await event(client,"course",`${source.revisionId}:${plan.courseCode}`,{revisionId:source.revisionId,courseCode:plan.courseCode,courseName:plan.courseName,status:"active",version:config!.version,note:config!.note,links:snapshotLinks},actor,note);
    }
    let importId:string|null=null;
    if(changed){
      importId=(await client.query("INSERT INTO ad_comp_imports(revision_id,filename,sha256,actor_id,summary) VALUES($1,$2,$3,$4,$5) RETURNING id",[source.revisionId,source.filename,createHash("sha256").update(source.buffer).digest("hex"),actor.userId,JSON.stringify(preview.counts)])).rows[0].id;
      await event(client,"import",source.revisionId,{importId,filename:source.filename,summary:preview.counts},actor,note);
    }
    await client.query("COMMIT");
    return {imported:true,summary:preview.counts,importId,unchanged:!changed,warnings:preview.warnings};
  } catch(error){await client.query("ROLLBACK");throw error;} finally {client.release();}
}
