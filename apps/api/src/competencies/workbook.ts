import { Worker } from "node:worker_threads";
import { checkArchive } from "../curricula/parser.js";
import { CurriculumError } from "../curricula/model.js";
import { courseCode } from "../curricula/course-codes.js";
import { CompetencyError, WEIGHT_TOLERANCE, type WorkbookData, type Issue } from "./model.js";

const headers = {
  skills: ["Tên kỹ năng chuẩn", "Loại kỹ năng", "Phạm vi năng lực", "Số học phần sử dụng"],
  course_skills: ["Mã học phần", "Tên học phần", "Tên kỹ năng", "Trọng số (0–1)", "Loại kỹ năng"],
};
const key = (text: string) => text.normalize("NFC").trim().toLowerCase();
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) ? value.normalize("NFC").trim() : null;

/** Pure structural/referential validation; never invent names, codes or weights. */
export function validateWorkbookRows(sheets: Record<string, unknown[][]>): WorkbookData {
  const result: WorkbookData = { skills: [], links: [], groups: [], errors: [], warnings: [], counts: { skillRows: 0, linkRows: 0, courses: 0 } };
  const issue = (target: Issue[], sheet: string, row: number | null, code: string, message: string) => target.push({ sheet, row, code, message });
  for (const name of ["skills", "course_skills"] as const) {
    const rows = sheets[name];
    if (!rows) { issue(result.errors, name, null, "missing_sheet", `Thiếu sheet ${name}.`); continue; }
    if (rows[0]?.length !== headers[name].length || headers[name].some((column, index) => rows[0]?.[index] !== column)) {
      issue(result.errors, name, 1, "invalid_headers", `Tên cột phải đúng thứ tự: ${headers[name].join(", ")}.`); continue;
    }
    rows.slice(1).forEach((row, index) => {
      const number = index + 2;
      if (row.every(value => value === null || value === undefined || value === "")) return;
      if (name === "skills") {
        result.counts.skillRows++;
        const skillName = text(row[0], 100), group = text(row[1], 160), scope = text(row[2], 4000), usage = row[3];
        if (row.length > 4 || !skillName || !group || !scope || typeof usage !== "number" || !Number.isInteger(usage) || usage < 0 || usage > 2000) {
          issue(result.errors, name, number, "invalid_skill_row", "Tên, nhóm và phạm vi phải là văn bản; số học phần phải là số nguyên không âm."); return;
        }
        if (result.skills.some(skill => key(skill.name) === key(skillName))) {
          issue(result.errors, name, number, "duplicate_skill", `Kỹ năng ${skillName} xuất hiện nhiều lần.`); return;
        }
        result.skills.push({ row: number, name: skillName, group, scope, declaredCourseCount: usage });
      } else {
        result.counts.linkRows++;
        const codeText = text(row[0], 100), courseName = text(row[1], 500), skillName = text(row[2], 100), group = text(row[4], 160), weight = row[3];
        const parsedCode = courseCode.safeParse(codeText);
        if (row.length > 5 || !parsedCode.success || !courseName || !skillName || !group || typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1) {
          issue(result.errors, name, number, "invalid_link_row", "Mã, tên học phần, kỹ năng, nhóm phải có đủ; trọng số phải là số từ 0 đến 1."); return;
        }
        if (result.links.some(link => link.courseCode === parsedCode.data && key(link.skillName) === key(skillName))) {
          issue(result.errors, name, number, "duplicate_link", `${parsedCode.data} có hai liên kết tới kỹ năng ${skillName}.`); return;
        }
        result.links.push({ row: number, courseCode: parsedCode.data, courseName, skillName, group, weight });
      }
    });
  }
  for (const link of result.links) {
    // Source identity requires the actual name, not an accent-insensitive/fuzzy match.
    const skill = result.skills.find(skill => skill.name === link.skillName);
    if (!skill) issue(result.errors, "course_skills", link.row, "unknown_skill", `Kỹ năng ${link.skillName} không có trong sheet skills.`);
    else if (skill.group !== link.group) issue(result.errors, "course_skills", link.row, "group_mismatch", `Nhóm của ${link.skillName} khác sheet skills.`);
  }
  const codes = [...new Set(result.links.map(link => link.courseCode))];
  for (const code of codes) {
    const links = result.links.filter(link => link.courseCode === code), total = links.reduce((sum, link) => sum + link.weight, 0);
    if (links.length > 200) issue(result.errors, "course_skills", links[0]!.row, "too_many_course_skills", `${code}: tối đa 200 kỹ năng trong một phân bổ.`);
    if (new Set(links.map(link => link.courseName)).size !== 1) issue(result.errors, "course_skills", links[0]!.row, "course_name_ambiguous", `${code} có nhiều tên trong cùng file.`);
    if (Math.abs(total - 1) > WEIGHT_TOLERANCE) issue(result.errors, "course_skills", links[0]!.row, "weight_total_invalid", `${code}: tổng trọng số ${(total * 100).toFixed(4)}%, cần 100%.`);
    if (links.some(link => link.weight === 0)) issue(result.warnings, "course_skills", links[0]!.row, "zero_weight", `${code}: liên kết 0% được giữ để truy vết, không đóng góp vào năng lực.`);
  }
  for (const skill of result.skills) {
    const usage = new Set(result.links.filter(link => link.skillName === skill.name).map(link => link.courseCode)).size;
    if (usage === 0) issue(result.warnings, "skills", skill.row, "unlinked_skill", `${skill.name}: Chưa có học phần liên kết.`);
    if (usage !== skill.declaredCourseCount) issue(result.warnings, "skills", skill.row, "usage_mismatch", `${skill.name}: file khai báo ${skill.declaredCourseCount} học phần, đối chiếu được ${usage}.`);
  }
  if (!result.counts.skillRows || !result.counts.linkRows) issue(result.errors, "", null, "empty_workbook", "File phải có kỹ năng và liên kết học phần.");
  result.groups = [...new Set(result.skills.map(skill => skill.group))];
  result.counts.courses = codes.length;
  return result;
}

export async function readCompetencyWorkbook(buffer: Buffer): Promise<WorkbookData> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  if (workbook.worksheets.length > 10) throw new CompetencyError("workbook_too_large", 413);
  const sheets: Record<string, unknown[][]> = {};
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > 2000 || sheet.columnCount > 20) throw new CompetencyError("workbook_too_large", 413);
    const rows: unknown[][] = [];
    for (let number = 1; number <= sheet.rowCount; number++) {
      const row: unknown[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const value = sheet.getCell(number, column).value;
        // Formulas, errors, hyperlinks, dates and embedded objects are never accepted as input.
        if (value !== null && value !== undefined && typeof value !== "string" && typeof value !== "number") throw new CompetencyError("unsafe_workbook_cell", 422, [`${sheet.name}!${sheet.getCell(number, column).address}`]);
        row.push(value ?? null);
      }
      while (row.length && row.at(-1) === null) row.pop();
      rows.push(row);
    }
    if (sheet.name in headers) sheets[sheet.name] = rows;
  }
  return validateWorkbookRows(sheets);
}

let busy = false;
export async function parseCompetencyWorkbook(buffer: Buffer): Promise<WorkbookData> {
  try { checkArchive(buffer); } catch (error) {
    if (error instanceof CurriculumError) throw new CompetencyError(error.code, error.status, error.details);
    throw error;
  }
  if (busy) throw new CompetencyError("import_busy", 429);
  busy = true;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL("../../workers/competency.mjs", import.meta.url), { workerData: { buffer, moduleUrl: import.meta.url }, resourceLimits: { maxOldGenerationSizeMb: 192 }, execArgv: [] });
      let settled = false;
      const finish = (error: unknown, data?: WorkbookData) => {
        if (settled) return; settled = true; clearTimeout(timer); void worker.terminate();
        if (error) reject(error); else resolve(data!);
      };
      const timer = setTimeout(() => finish(new CompetencyError("import_timeout", 422)), 25000);
      worker.once("message", message => finish(message.error ? new CompetencyError(message.error, message.status ?? 422, message.details) : null, message.data));
      worker.once("error", () => finish(new CompetencyError("invalid_workbook", 422)));
      worker.once("exit", () => { if (!settled) finish(new CompetencyError("invalid_workbook", 422)); });
    });
  } finally { busy = false; }
}
