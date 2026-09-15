import { Worker } from "node:worker_threads";
import {
  CurriculumError,
  courseSchema,
  rebuild,
  type CurriculumData,
  type CurriculumCourse,
} from "./model.js";
const clean = (s: string) =>
  s
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .trim();
const fold = (s: string) =>
  clean(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase();

export function checkArchive(pdf: Buffer) {
  if (
    pdf.length > 5 * 1024 * 1024 ||
    pdf.length < 22 ||
    pdf.readUInt32LE(0) !== 0x04034b50
  )
    throw new CurriculumError("invalid_workbook");
  let end = -1;
  for (let i = pdf.length - 22; i >= Math.max(0, pdf.length - 65557); i--)
    if (pdf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new CurriculumError("invalid_workbook");
  const entries = pdf.readUInt16LE(end + 10);
  let offset = pdf.readUInt32LE(end + 16),
    total = 0;
  if (entries > 3000) throw new CurriculumError("workbook_too_large");
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > pdf.length || pdf.readUInt32LE(offset) !== 0x02014b50)
      throw new CurriculumError("invalid_workbook");
    total += pdf.readUInt32LE(offset + 24);
    if (total > 30 * 1024 * 1024)
      throw new CurriculumError("workbook_too_large");
    offset +=
      46 +
      pdf.readUInt16LE(offset + 28) +
      pdf.readUInt16LE(offset + 30) +
      pdf.readUInt16LE(offset + 32);
  }
}
export async function readWorkbook(buffer: Buffer): Promise<CurriculumData> {
  checkArchive(buffer);
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const value = (cell: import("exceljs").Cell): string => {
    const v = cell.value;
    if (v === null || v === undefined) return "";
    if (typeof v === "object") {
      if ("error" in v) return String(v.error);
      if ("formula" in v || "sharedFormula" in v) {
        const result = v.result;
        return typeof result === "object" && result && "error" in result
          ? String(result.error)
          : result === undefined
            ? "#NO_CACHE!"
            : String(result);
      }
      if ("richText" in v) return v.richText.map((x) => x.text).join("");
      if ("text" in v) return String(v.text);
    }
    return String(v);
  };
  if (workbook.worksheets.length > 20)
    throw new CurriculumError("workbook_too_large");
  const candidates: { sheet: import("exceljs").Worksheet; header: number }[] =
    [];
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > 2000 || sheet.columnCount > 150)
      throw new CurriculumError("workbook_too_large");
    for (let n = 1; n <= Math.min(40, sheet.rowCount); n++)
      if (
        fold(value(sheet.getCell(n, 2))) === "ma hoc phan" &&
        fold(value(sheet.getCell(n, 3))).includes("ten hoc phan")
      )
        candidates.push({ sheet, header: n });
  }
  if (candidates.length !== 1)
    throw new CurriculumError("unsupported_curriculum_template");
  const { sheet, header } = candidates[0]!;
  const title =
    Array.from({ length: header - 1 }, (_, n) =>
      value(sheet.getCell(n + 1, 1)),
    ).find((x) => /KHÓA\s*\d+/i.test(x)) ?? "";
  const cohort = title.match(/KHÓA\s*(\d+)/i),
    major = title.match(/NGÀNH\s+(.+?)\s+KHÓA/i)?.[1];
  const totalText = Array.from({ length: header - 1 }, (_, n) =>
    value(sheet.getCell(n + 1, 1)),
  ).find((x) => /Tổng tín chỉ/i.test(x));
  const total = totalText?.match(/:\s*(\d+)/)?.[1];
  if (
    !cohort ||
    !major ||
    !total ||
    Number(cohort[1]) < 27 ||
    Number(cohort[1]) > 99
  )
    throw new CurriculumError("missing_curriculum_metadata");
  const data: CurriculumData = {
    schemaVersion: 1,
    name: clean(title),
    major: clean(major),
    cohortCode: `K${cohort[1]}`,
    admissionYear: 1994 + Number(cohort[1]),
    totalCredits: Number(total),
    notes: "",
    courses: [],
    groups: [],
    electives: [],
    relations: [],
    warnings: [],
    sourceWarnings: [],
  };
  let groupId = "";
  for (let row = header + 1; row <= sheet.rowCount; row++) {
    const cells: Record<string, string> = {};
    for (let col = 1; col <= 19; col++)
      cells[String.fromCharCode(64 + col)] = clean(
        value(sheet.getCell(row, col)),
      );
    for (const [col, v] of Object.entries(cells))
      if (v.startsWith("#"))
        data.sourceWarnings.push({
          row,
          message: `Ô ${col}${row} có lỗi ${v}; giá trị không được sử dụng.`,
        });
    const code = cells.B!,
      name = cells.C!;
    if (!code) {
      if (cells.A && !/^\d+$/.test(cells.A)) {
        groupId = `row-${row}`;
        data.groups.push({
          id: groupId,
          label: cells.A,
          credits: /^\d+(\.\d+)?$/.test(cells.E!) ? Number(cells.E) : null,
          sourceRow: row,
        });
      }
      continue;
    }
    if (!/^\d{2}[A-Z]{2,12}\d{4,10}$/.test(code) || !name)
      throw new CurriculumError("invalid_course_row", 422, [
        `${sheet.name}!${row}: ${code}`,
      ]);
    if (!/^\d+(\.\d+)?$/.test(cells.E!) || Number(cells.E) > 30)
      throw new CurriculumError("invalid_course_credits", 422, [code]);
    const term = (v: string, max: number) =>
      /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= max ? Number(v) : null;
    const hours = (v: string) => (/^\d+(\.\d+)?$/.test(v) ? Number(v) : null);
    if (!/^(BB(?:KTL)?|TC\d*(?:\s*\(.*\))?)$/.test(cells.J!))
      throw new CurriculumError("invalid_course_type", 422, [code]);
    const shifted = !!cells.R && !/^\d+$/.test(cells.R);
    if (shifted)
      data.sourceWarnings.push({
        row,
        message: `${code}: dữ liệu lệch cột (cột Học kỳ chứa văn bản). Giữ nguyên nguồn; cần sửa khối, chuyên ngành, bộ môn và lịch học.`,
      });
    const c: CurriculumCourse = {
      position: data.courses.length + 1,
      code,
      name,
      englishName: cells.D!,
      credits: Number(cells.E),
      type: cells.J!,
      block: shifted ? "" : cells.M!,
      specialty: shifted ? "" : cells.N!,
      prerequisite: cells.K!,
      prior: cells.L!,
      notes: cells.O!,
      department: shifted ? "" : cells.Q!,
      departmentCode: shifted ? "" : cells.P!,
      semester: term(cells.R!, 3),
      studyYear: term(cells.S!, 10),
      hours: {
        lecture: hours(cells.F!),
        practice: hours(cells.G!),
        project: hours(cells.H!),
        internship: hours(cells.I!),
      },
      groupId,
      sourceRow: row,
      sourceSheet: sheet.name,
      sourceCells: cells,
    };
    if (!courseSchema.safeParse(c).success)
      throw new CurriculumError("invalid_course_row", 422, [
        `${sheet.name}!${row}: ${code}`,
      ]);
    data.courses.push(c);
  }
  if (!data.courses.length) throw new CurriculumError("no_courses");
  return rebuild(data);
}
let busy = false;
export async function parseCurriculum(buffer: Buffer): Promise<CurriculumData> {
  checkArchive(buffer);
  if (busy) throw new CurriculumError("import_busy", 429);
  busy = true;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("../../workers/curriculum.mjs", import.meta.url),
        {
          workerData: { buffer, moduleUrl: import.meta.url },
          resourceLimits: { maxOldGenerationSizeMb: 192 },
          execArgv: [],
        },
      );
      let settled = false;
      const finish = (error: unknown, data?: CurriculumData) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if (error) reject(error);
        else resolve(data!);
      };
      const timer = setTimeout(
        () => finish(new CurriculumError("import_timeout")),
        25000,
      );
      worker.once("message", (m) =>
        finish(
          m.error ? new CurriculumError(m.error, 422, m.details) : null,
          m.data,
        ),
      );
      worker.once("error", () =>
        finish(new CurriculumError("invalid_workbook")),
      );
      worker.once("exit", () => {
        if (!settled) finish(new CurriculumError("invalid_workbook"));
      });
    });
  } finally {
    busy = false;
  }
}
