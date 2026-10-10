import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseCompetencyWorkbook, readCompetencyWorkbook, validateWorkbookRows } from "./workbook.js";
import { validateWeights } from "./model.js";
import { makeImportPlan } from "./import.js";

const skillHeaders = ["Tên kỹ năng chuẩn", "Loại kỹ năng", "Phạm vi năng lực", "Số học phần sử dụng"];
const linkHeaders = ["Mã học phần", "Tên học phần", "Tên kỹ năng", "Trọng số (0–1)", "Loại kỹ năng"];
const skillId = "11111111-1111-4111-8111-111111111111";
const groupId = "22222222-2222-4222-8222-222222222222";
const revisionId = "33333333-3333-4333-8333-333333333333";
const configId = "44444444-4444-4444-8444-444444444444";
const sheets = () => ({skills:[[...skillHeaders],["Lập trình", "Chuyên môn", "Xây dựng chương trình", 1]],course_skills:[[...linkHeaders],["CS-101", "Lập trình cơ bản", "Lập trình", 1, "Chuyên môn"]]});
async function bufferFor(rows = sheets()) {
  const workbook = new ExcelJS.Workbook();
  for (const [name, values] of Object.entries(rows)) workbook.addWorksheet(name).addRows(values);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
const context = (): Parameters<typeof makeImportPlan>[1] => ({
  revision:{id:revisionId,curriculum_id:revisionId,cohort_code:"K29",version:1,name:"K29",courses:[{code:"CS-101",name:"Lập trình cơ bản"}]},
  groups:[{id:groupId,name:"Chuyên môn",source_key:"Chuyên môn",is_active:true,version:groupId}],
  canonical:[{id:skillId,name:"Lập trình",description:"Mô tả nghề nghiệp",deleted_at:null,version:skillId}],
  profiles:[],aliases:[],configs:[],links:[],courses:[{code:"CS-101",name:"Lập trình cơ bản"}],
});
const source={revisionId,cohortCode:"K29",filename:"EduPath_course_K29.xlsx",buffer:Buffer.from("fixture")};

describe("AD-COMP workbook and allocation rules", () => {
  it("reads the actual two-sheet structure through the protected worker", async () => {
    const data = await parseCompetencyWorkbook(await bufferFor());
    expect(data.errors).toEqual([]);
    expect(data.counts).toEqual({skillRows:1,linkRows:1,courses:1});
    expect(data.links[0]?.courseCode).toBe("CS-101");
  }, 30_000);
  it("preserves all academic groups instead of forcing two", () => {
    const rows=sheets();
    rows.skills.push(["Tư duy", "Kiến thức nền tảng", "Phân tích", 0], ["Giao tiếp", "Kỹ năng mềm", "Trình bày", 0]);
    expect(validateWorkbookRows(rows).groups).toEqual(["Chuyên môn","Kiến thức nền tảng","Kỹ năng mềm"]);
  });
  it("blocks missing sheets, changed columns, duplicate skills and duplicate links", () => {
    expect(validateWorkbookRows({}).errors.map(issue=>issue.code)).toContain("missing_sheet");
    const rows=sheets(); rows.skills[0]![0]="Tên khác";
    expect(validateWorkbookRows(rows).errors.map(issue=>issue.code)).toContain("invalid_headers");
    const duplicates=sheets(); duplicates.skills.push([...duplicates.skills[1]!]);duplicates.course_skills.push([...duplicates.course_skills[1]!]);
    expect(validateWorkbookRows(duplicates).errors.map(issue=>issue.code)).toEqual(expect.arrayContaining(["duplicate_skill","duplicate_link"]));
  });
  it("does not fuzzy match unknown skills or inconsistent source groups", () => {
    const rows=sheets();rows.course_skills[1]![2]="Lap trinh";
    expect(validateWorkbookRows(rows).errors.map(issue=>issue.code)).toContain("unknown_skill");
    rows.course_skills[1]![2]="Lập trình";rows.course_skills[1]![4]="Kỹ năng mềm";
    expect(validateWorkbookRows(rows).errors.map(issue=>issue.code)).toContain("group_mismatch");
  });
  it.each(["0.5",-0.1,1.1,NaN])("rejects invalid numeric weight %s", weight => {
    const rows=sheets();rows.course_skills[1]![3]=weight;
    expect(validateWorkbookRows(rows).errors.map(issue=>issue.code)).toContain("invalid_link_row");
  });
  it.each([0.9,1.1])("rejects a non-100%% source total %s", weight => {
    const rows=sheets();rows.course_skills[1]![3]=weight;
    expect(validateWorkbookRows(rows).errors.length).toBeGreaterThan(0);
  });
  it("keeps zero-weight links and reports their non-contribution", () => {
    const rows=sheets();rows.skills.push(["Giao tiếp","Kỹ năng mềm","Trình bày",1]);rows.course_skills.push(["CS-101","Lập trình cơ bản","Giao tiếp",0,"Kỹ năng mềm"]);
    const data=validateWorkbookRows(rows);
    expect(data.errors).toEqual([]);expect(data.links[1]?.weight).toBe(0);expect(data.warnings.map(issue=>issue.code)).toContain("zero_weight");
  });
  it("accepts only a complete active total, with floating-point tolerance; drafts may be incomplete", () => {
    expect(validateWeights([{skillId,weight:0.1},{skillId:groupId,weight:0.2},{skillId:revisionId,weight:0.7}],"active")).toBeCloseTo(1);
    expect(validateWeights([{skillId,weight:0.4}],"draft")).toBe(0.4);
    for(const weight of [0.9,1.1]) expect(()=>validateWeights([{skillId,weight}],"active")).toThrow();
    expect(()=>validateWeights([],"active")).toThrow("weight_total_invalid");
    expect(()=>validateWeights([{skillId,weight:0.5},{skillId,weight:0.5}],"active")).toThrow("duplicate_skill_link");
  });
  it("rejects formulas, hyperlinks and error cells even on unused sheets", async () => {
    for(const value of [{formula:"1+1",result:2},{text:"click",hyperlink:"https://example.com"},{error:"#VALUE!"}]) {
      const workbook=new ExcelJS.Workbook();for(const[name,rows]of Object.entries(sheets()))workbook.addWorksheet(name).addRows(rows);
      workbook.addWorksheet("extra").getCell("A1").value=value as ExcelJS.CellValue;
      await expect(readCompetencyWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()))).rejects.toMatchObject({code:"unsafe_workbook_cell"});
    }
  });
  it("rejects non-XLSX content before parsing", async () => {
    await expect(parseCompetencyWorkbook(Buffer.from("not a workbook"))).rejects.toThrow();
  });
});

describe("AD-COMP preview identity and overwrite rules", () => {
  it("reuses only an exact canonical ID and preserves its career description", () => {
    const plan=makeImportPlan(validateWorkbookRows(sheets()),context(),source);
    expect(plan.skills[0]).toMatchObject({skillId,action:"reuse"});
    expect(plan.warnings.map(issue=>issue.code)).toContain("canonical_description_preserved");
    expect(plan.requiresOverwrite).toBe(false);expect(plan.canImport).toBe(true);
  });
  it("does not create a course when the exact code is absent", () => {
    const c=context();c.courses=[];
    const plan=makeImportPlan(validateWorkbookRows(sheets()),c,source);
    expect(plan.canImport).toBe(false);expect(plan.errors.map(issue=>issue.code)).toContain("course_not_found");
  });
  it("rejects multiple curriculum occurrences of the same code", () => {
    const c=context();c.revision.courses.push({...c.revision.courses[0]!});
    expect(makeImportPlan(validateWorkbookRows(sheets()),c,source).errors.map(issue=>issue.code)).toContain("ambiguous_course");
  });
  it("requires confirmation before replacing administrator allocations and scope", () => {
    const c=context();c.profiles=[{skill_id:skillId,group_id:groupId,scope:"Admin changed",is_active:true,deleted_at:null,version:skillId}];
    c.configs=[{id:configId,course_code:"CS-101",status:"draft",version:configId,note:""}];c.links=[{config_id:configId,skill_id:skillId,weight:"0.5",name:"Lập trình"}];
    const plan=makeImportPlan(validateWorkbookRows(sheets()),c,source);
    expect(plan.requiresOverwrite).toBe(true);expect(plan.skills[0]?.previousScope).toBe("Admin changed");
    expect(plan.courses[0]?.changes[0]).toEqual({skillName:"Lập trình",beforeWeight:0.5,afterWeight:1});
  });
  it("recognizes an unchanged import and retains a renamed canonical ID via source alias", () => {
    const c=context();c.canonical[0]!.name="Tên quản trị đã đổi";c.aliases=[{source_name:"Lập trình",skill_id:skillId}];
    c.profiles=[{skill_id:skillId,group_id:groupId,scope:"Xây dựng chương trình",is_active:true,deleted_at:null,version:skillId}];
    c.configs=[{id:configId,course_code:"CS-101",status:"active",version:configId,note:""}];c.links=[{config_id:configId,skill_id:skillId,weight:"1",name:"Tên quản trị đã đổi"}];
    const plan=makeImportPlan(validateWorkbookRows(sheets()),c,source);
    expect(plan.skills[0]).toMatchObject({skillId,action:"unchanged"});expect(plan.courses[0]?.action).toBe("unchanged");expect(plan.requiresOverwrite).toBe(false);
  });
  it("invalidates the preview token when relevant data changes", () => {
    const data=validateWorkbookRows(sheets()),c=context(),before=makeImportPlan(data,c,source);
    c.canonical[0]!.version=configId;
    expect(makeImportPlan(data,c,source).token).not.toBe(before.token);
  });
});
