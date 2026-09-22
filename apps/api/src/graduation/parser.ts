import { Worker } from "node:worker_threads";
import {
  GraduationError,
  fold,
  validateData,
  type GraduationData,
} from "./model.js";
type Sheet = { workbook: string; sheet: string; rows: unknown[][] };
const clean = (v: unknown) =>
  String(v ?? "")
    .normalize("NFC")
    .trim();
function number(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(clean(v).replace(",", "."));
  if (!Number.isFinite(n))
    throw new GraduationError("invalid_numeric_value", 422, [clean(v)]);
  return n;
}
export function parseSheet(sheet: Sheet): GraduationData | null {
  const rows = sheet.rows.map((r) => r.map(clean));
  if (
    !rows
      .slice(0, 8)
      .some((r) => r.some((c) => /tieu chuan\s+xet tot nghiep/.test(fold(c))))
  )
    return null;
  const value = (label: string) => {
    const row = rows.find((r) => fold(r[1] ?? "").replace(/:$/, "") === label);
    return row?.[4] ?? "";
  };
  const threshold = (label: string) => {
    const row = rows.find((r) => fold(r[1] ?? "").startsWith(label));
    return number(row?.[8]);
  };
  const name = value("tieu chuan"),
    classBlock = value("khoi lop"),
    field = value("nganh dao tao");
  const cohortCode = classBlock.match(/K\d{2}/i)?.[0].toUpperCase();
  if (!name || !cohortCode || !field)
    throw new GraduationError("invalid_graduation_metadata", 422, [
      sheet.workbook,
      sheet.sheet,
    ]);
  const header = rows.findIndex(
    (r) => fold(r[2] ?? "") === "ma mh" && fold(r[4] ?? "").includes("ten mon"),
  );
  if (header < 0)
    throw new GraduationError("invalid_graduation_columns", 422, [sheet.sheet]);
  const data: GraduationData = {
    schemaVersion: 1,
    name,
    standardCode: name.split(/\s+-\s+/)[0]!,
    cohortCode,
    classBlock,
    major: field.split(/\s+-\s+Chuyên ngành:/i)[0]!,
    specialty: field.split(/Chuyên ngành:\s*/i)[1] ?? "",
    educationSystem: value("he dao tao"),
    faculty: value("khoa dao tao"),
    minimumCredits: threshold("so tin chi tich luy toi thieu"),
    mandatoryCredits: threshold("tong tin chi bat buoc"),
    electiveCredits: threshold("tong tin chi toi thieu nhom bat buoc tu chon"),
    freeElectiveCredits: threshold("tong so tin chi tu chon tu do"),
    minimumGpa: threshold("diem trung binh tich luy toi thieu"),
    notes: rows
      .slice(0, header)
      .flat()
      .filter((c) => fold(c).startsWith("ghi chu:"))
      .join("\n"),
    groups: [],
    courses: [],
    sourceWorkbook: sheet.workbook,
    sourceSheet: sheet.sheet,
    sourceNotes: [],
  };
  let groupId = "";
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i]!,
      label = r
        .slice(0, 2)
        .find((c) => /^nhom (bat buoc|tu chon)/.test(fold(c)));
    if (label) {
      groupId = `row-${i + 1}`;
      data.groups.push({
        id: groupId,
        name: label,
        kind: fold(label).startsWith("nhom bat buoc")
          ? "mandatory"
          : "elective",
        minimumCredits: number(r[10]),
        sourceRow: i + 1,
      });
    } else if (r[2] && r[4]) {
      if (!groupId)
        throw new GraduationError("course_without_group", 422, [
          sheet.sheet,
          `${i + 1}`,
        ]);
      data.courses.push({
        id: `row-${i + 1}`,
        groupId,
        code: r[2],
        name: r[4],
        credits: number(r[10]),
        conditionOnly: /\(\s*\*\s*\)/.test(r[4]),
        sourceRow: i + 1,
      });
    } else if (r[2] || (/^\d+$/.test(r[0] ?? "") && r[4]))
      throw new GraduationError("invalid_graduation_row", 422, [
        sheet.sheet,
        `${i + 1}`,
      ]);
  }
  if (rows.some((r) => r.slice(11).some((c) => c)))
    data.sourceNotes.push(
      "Các cột đánh dấu đã đạt và kết quả cá nhân không được dùng làm tiêu chuẩn xét tốt nghiệp.",
    );
  if (!data.courses.length) throw new GraduationError("no_courses");
  return validateData(data);
}
let busy = false;
export async function parseGraduation(
  buffer: Buffer,
  filename: string,
): Promise<GraduationData[]> {
  if (buffer.length > 5 * 1024 * 1024 || buffer.length < 8)
    throw new GraduationError("invalid_workbook");
  if (busy) throw new GraduationError("import_busy", 429);
  busy = true;
  try {
    const sheets = await new Promise<Sheet[]>((resolve, reject) => {
      const worker = new Worker(
        new URL("../../workers/graduation.mjs", import.meta.url),
        {
          workerData: { buffer, filename },
          execArgv: [],
          resourceLimits: { maxOldGenerationSizeMb: 192 },
        },
      );
      let settled = false;
      const finish = (error: unknown, data?: Sheet[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if (error) reject(error);
        else resolve(data!);
      };
      const timer = setTimeout(
        () => finish(new GraduationError("import_timeout")),
        25000,
      );
      worker.once("message", (m) =>
        finish(m.error ? new GraduationError(m.error) : null, m.sheets),
      );
      worker.once("error", () =>
        finish(new GraduationError("invalid_workbook")),
      );
      worker.once("exit", () => {
        if (!settled) finish(new GraduationError("invalid_workbook"));
      });
    });
    const result = sheets
      .map(parseSheet)
      .filter((d): d is GraduationData => d !== null);
    if (!result.length || result.length > 50)
      throw new GraduationError("invalid_workbook");
    return result;
  } finally {
    busy = false;
  }
}
