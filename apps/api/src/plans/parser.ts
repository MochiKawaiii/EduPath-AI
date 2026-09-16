import { Worker } from "node:worker_threads";
import { checkArchive } from "../curricula/parser.js";
import { PlanError, fold, reviewPlan, type PlanData } from "./model.js";

export async function readWorkbook(buffer: Buffer): Promise<PlanData> {
  checkArchive(buffer);
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const value = (cell: import("exceljs").Cell): string => {
    const v = cell.value;
    if (v == null) return "";
    if (typeof v === "object") {
      if ("error" in v) return String(v.error);
      if ("formula" in v || "sharedFormula" in v)
        return v.result == null
          ? ""
          : typeof v.result === "object" && "error" in v.result
            ? String(v.result.error)
            : String(v.result);
      if ("richText" in v) return v.richText.map((x) => x.text).join("");
      if ("text" in v) return v.text;
    }
    return String(v);
  };
  if (workbook.worksheets.length > 20)
    throw new PlanError("workbook_too_large");
  const candidates: { sheet: import("exceljs").Worksheet; header: number }[] =
    [];
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > 2000 || sheet.columnCount > 150)
      throw new PlanError("workbook_too_large");
    for (let r = 1; r <= Math.min(40, sheet.rowCount); r++) {
      if (
        fold(value(sheet.getCell(r, 4))) === "ma hoc phan" &&
        fold(value(sheet.getCell(r, 5))).includes("ten hoc phan")
      ) {
        if (!candidates.some((c) => c.sheet === sheet))
          candidates.push({ sheet, header: r });
      }
    }
  }
  if (candidates.length !== 1) throw new PlanError("unsupported_plan_template");
  const { sheet, header } = candidates[0]!;
  const title =
    Array.from({ length: header - 1 }, (_, r) =>
      value(sheet.getCell(r + 1, 1)),
    ).find((t) => /KẾ HOẠCH.*KHÓA\s*\d+/i.test(t)) ?? "";
  const match = title.match(/KẾ HOẠCH.*?NGÀNH\s+(.+?)\s*[-–]?\s*KHÓA\s*(\d+)/i);
  if (!match || Number(match[2]) < 27 || Number(match[2]) > 99)
    throw new PlanError("missing_plan_metadata");
  const data: PlanData = {
    schemaVersion: 1,
    name: title.trim(),
    major: match[1]!.replace(/[-–]\s*$/, "").trim(),
    cohortCode: `K${match[2]}`,
    admissionYear: Number(match[2]) + 1994,
    totalCredits: null,
    notes: "",
    items: [],
    terms: [],
    sections: [],
    sourceWarnings: [],
    warnings: [],
    curriculum: null,
  };
  const warn = (row: number | null, message: string) =>
    data.sourceWarnings.push({ row, message });
  const number = (v: string, row: number, label: string): number | null => {
    if (!v) return null;
    if (!/^\d+(?:[.,]\d+)?$/.test(v)) {
      warn(row, `${label}: giá trị chưa xác định (${v}).`);
      return null;
    }
    return Number(v.replace(",", "."));
  };
  const titleRow = Array.from({ length: header - 1 }, (_, r) => r + 1).find(
    (r) => value(sheet.getCell(r, 1)) === title,
  )!;
  data.totalCredits = number(
    value(sheet.getCell(titleRow, 14)),
    titleRow,
    "Tổng tín chỉ",
  );
  if (data.totalCredits !== null && data.totalCredits > 400)
    throw new PlanError("invalid_plan_row");
  let termCode = "",
    sectionId = "";
  let external = false;
  for (let r = header + 1; r <= sheet.rowCount; r++) {
    const cells = Object.fromEntries(
      Array.from({ length: 15 }, (_, c) => [
        String.fromCharCode(65 + c),
        value(sheet.getCell(r, c + 1))
          .replace(/\u00a0/g, " ")
          .trim(),
      ]),
    );
    const joined = Object.values(cells).join(" ");
    if (/TP\.\s*Hồ Chí Minh|TRƯỞNG KHOA/i.test(joined)) {
      if (cells.D)
        warn(r, "Bỏ qua mã ghi ngoài vùng kế hoạch tại phần ký tên.");
      break;
    }
    if (fold(cells.D!) === "ma hoc phan") continue;
    for (let c = 5; c <= 13; c++) {
      const v = sheet.getCell(r, c).value;
      if (
        v &&
        typeof v === "object" &&
        "formula" in v &&
        /\[\d+\]/.test(v.formula)
      )
        external = true;
    }
    if (/HK\d/i.test(cells.A!) && !/^HK\d{2}[123](?:\s|$)/i.test(cells.A!))
      throw new PlanError("invalid_plan_row", 422, [
        `${sheet.name}!${r}: mã học kỳ không hợp lệ.`,
      ]);
    if (
      (cells.D || cells.E) &&
      ((cells.B && !/^[123]$/.test(cells.B)) ||
        (cells.C && (!/^\d{1,2}$/.test(cells.C) || Number(cells.C) < 1)))
    )
      throw new PlanError("invalid_plan_row", 422, [
        `${sheet.name}!${r}: học kỳ chỉ nhận 1–3, năm học phải là số.`,
      ]);
    const explicit = cells.A!.match(/HK\d{2}[123]/i)?.[0]?.toUpperCase();
    const b = /^[123]$/.test(cells.B!) ? Number(cells.B) : null;
    const y = /^\d{1,2}$/.test(cells.C!) ? Number(cells.C) : null;
    // A small number of source rows have an unmerged/blank term label. B/C
    // explicitly identify their year and semester, so retain that provenance.
    const derived =
      !explicit && b && y
        ? `HK${String((data.admissionYear + y - 1) % 100).padStart(2, "0")}${b}`
        : null;
    const next = explicit ?? derived ?? termCode;
    if (next !== termCode) {
      termCode = next;
      sectionId = "";
    }
    if (!termCode) {
      if (cells.D || cells.E)
        throw new PlanError("invalid_plan_row", 422, [
          `${sheet.name}!${r}: chưa xác định được học kỳ của môn.`,
        ]);
      continue;
    }
    const semester = Number(termCode.at(-1)),
      studyYear = 2000 + Number(termCode.slice(2, 4)) - data.admissionYear + 1;
    if (studyYear < 1 || studyYear > 10)
      throw new PlanError("invalid_plan_row", 422, [
        `${sheet.name}!${r}: học kỳ không thuộc khóa.`,
      ]);
    if ((b && b !== semester) || (y && y !== studyYear))
      throw new PlanError("invalid_plan_row", 422, [
        `${sheet.name}!${r}: năm/học kỳ mâu thuẫn với ${termCode}.`,
      ]);
    let term = data.terms.find((t) => t.code === termCode);
    if (!term) {
      term = { code: termCode, semester, studyYear, sourceCredits: null };
      data.terms.push(term);
    }
    if (cells.N && !sheet.getCell(r, 14).isMerged) {
      const credits = number(cells.N, r, "Tín chỉ học kỳ");
      if (credits !== null) term.sourceCredits = credits;
    } else if (
      cells.N &&
      sheet.getCell(r, 14).master.address === sheet.getCell(r, 14).address
    )
      term.sourceCredits = number(cells.N, r, "Tín chỉ học kỳ");
    if (cells.C && !/^\d+$/.test(cells.C) && !cells.D && !cells.E) {
      sectionId = `section-${r}`;
      data.sections.push({
        id: sectionId,
        termCode,
        label: cells.C,
        kind: /chuyen nganh/.test(fold(cells.C))
          ? "specialty"
          : /chon/.test(fold(cells.C))
            ? "choice"
            : "note",
        sourceRow: r,
      });
      continue;
    }
    if (!cells.D && !cells.E) continue;
    if (!cells.E || /^#/.test(cells.E))
      throw new PlanError("invalid_plan_row", 422, [
        `${sheet.name}!${r}: thiếu tên môn hoặc công thức chưa tính.`,
      ]);
    if (!explicit || !b || !y)
      warn(
        r,
        `${cells.E}: xác định năm ${studyYear}, học kỳ ${semester} từ vùng ${termCode}; có ô phân bổ gốc để trống.`,
      );
    const item = {
      id: `row-${r}`,
      position: data.items.length + 1,
      code: cells.D!,
      name: cells.E!,
      credits: number(cells.F!, r, "Tín chỉ"),
      type: cells.K!,
      termCode,
      semester,
      studyYear,
      sectionId,
      prerequisite: cells.L!,
      prior: cells.M!,
      notes: cells.O!,
      hours: {
        lecture: number(cells.G!, r, "LT"),
        practice: number(cells.H!, r, "TH"),
        project: number(cells.I!, r, "ĐA"),
        internship: number(cells.J!, r, "TT"),
      },
      sourceRow: r,
      sourceSheet: sheet.name,
      sourceCells: cells,
    };
    data.items.push(item);
  }
  if (!data.items.length) throw new PlanError("no_courses");
  if (external)
    warn(
      null,
      "File có công thức tham chiếu workbook ngoài. Dùng kết quả đã lưu trong Excel; không tự tải hoặc tính lại nguồn ngoài. Ô trống giữ là chưa xác định.",
    );
  // Preserve rule text; do not silently interpret inconsistent choice counts.
  for (const s of data.sections) {
    const count = s.label.match(/trong\s*(\d+)/i)?.[1];
    const actual = data.items.filter((i) => i.sectionId === s.id).length;
    if (count && actual !== Number(count))
      warn(
        s.sourceRow,
        `Nhóm “${s.label}” có ${actual} dòng môn, khác số ${count} ghi trong tiêu đề.`,
      );
  }
  return reviewPlan(data);
}
let busy = false;
export async function parsePlan(buffer: Buffer): Promise<PlanData> {
  checkArchive(buffer);
  if (busy) throw new PlanError("import_busy", 429);
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
      let done = false;
      const finish = (error: unknown, data?: PlanData) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void worker.terminate();
        if (error) reject(error);
        else resolve(data!);
      };
      const timer = setTimeout(
        () => finish(new PlanError("import_timeout")),
        25000,
      );
      worker.once("message", (m) =>
        finish(m.error ? new PlanError(m.error, 422, m.details) : null, m.data),
      );
      worker.once("error", () => finish(new PlanError("invalid_workbook")));
      worker.once("exit", () => {
        if (!done) finish(new PlanError("invalid_workbook"));
      });
    });
  } finally {
    busy = false;
  }
}
