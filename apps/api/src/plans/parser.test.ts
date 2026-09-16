import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  parsePlan,
  readWorkbook,
} from "./parser.js";
import { itemSchema, reviewPlan, type PlanData } from "./model.js";

let k29: PlanData;
let k30: PlanData;
let k31: PlanData;

beforeAll(async () => {
  [k29, k30, k31] = await Promise.all(
    [29, 30, 31].map(async (cohort) =>
      readWorkbook(
        await readFile(
          new URL(`../../data/plans/K${cohort}.xlsx`, import.meta.url),
        ),
      ),
    ),
  );
}, 30000);

describe("official training-plan workbooks", () => {
  it("preserves source counts, metadata, terms, and row provenance", () => {
    for (const [data, itemCount, totalCredits, admissionYear] of [
      [k29, 73, 126, 2023],
      [k30, 70, 126, 2024],
      [k31, 74, 132, 2025],
    ] as const) {
      expect(data.items).toHaveLength(itemCount);
      expect(data.totalCredits).toBe(totalCredits);
      expect(data.admissionYear).toBe(admissionYear);
      expect(data.major).toBe("CÔNG NGHỆ THÔNG TIN");
      expect(data.cohortCode).toBe(`K${admissionYear - 1994}`);
      expect(data.terms).toHaveLength(10);
      expect(new Set(data.items.map((item) => item.id)).size).toBe(itemCount);
      expect(data.items.map((item) => item.position)).toEqual(
        Array.from({ length: itemCount }, (_, index) => index + 1),
      );
      for (const item of data.items)
        expect(itemSchema.safeParse(item).success, item.id).toBe(true);
      expect(data.items[0]).toMatchObject({
        id: "row-9",
        sourceRow: 9,
        sourceSheet: "Ke hoach giảng dạy CNTT",
        code: "71ENG110013",
        termCode: data.terms[0]!.code,
      });
    }
  });

  it("keeps the supplied GDTC rows, including missing K31 codes, as unresolved data", () => {
    expect(k29.items.filter((item) => /GDTC/i.test(item.name))).toMatchObject([
      { code: "DGT0010", credits: null, type: "", termCode: "HK232" },
      { code: "DGT0020", credits: null, type: "", termCode: "HK233" },
    ]);
    expect(k31.items.filter((item) => /GDTC/i.test(item.name))).toMatchObject([
      { code: "", credits: null, type: "", termCode: "HK261" },
      { code: "", credits: null, type: "", termCode: "HK271" },
    ]);
    expect(k31.items.filter((item) => /GDTC/i.test(item.name)).every((item) =>
      item.sourceCells.D === "",
    )).toBe(true);
    expect(k31.warnings.filter((warning) =>
      /GDTC/i.test(warning.message) && warning.message.includes("chưa có mã"),
    )).toHaveLength(2);
  });

  it("retains repeated allocations instead of merging them by course code", () => {
    const repeated = k29.items.filter((item) => item.code === "71ITSE30603");
    expect(repeated).toHaveLength(2);
    expect(new Set(repeated.map((item) => item.id)).size).toBe(2);
    expect(k29.warnings.some((warning) =>
      warning.row !== null && warning.message.includes("71ITSE30603") &&
      warning.message.includes("nhiều lần"),
    )).toBe(true);
  });

  it("uses cached values for external formulas and records the limitation", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Plan");
    sheet.getCell("A1").value =
      "KẾ HOẠCH ĐÀO TẠO NGÀNH CÔNG NGHỆ THÔNG TIN - KHÓA 29";
    sheet.getCell("N1").value = 3;
    sheet.getCell("D2").value = "Mã học phần";
    sheet.getCell("E2").value = "Tên học phần (Tiếng Việt)";
    sheet.getCell("A3").value = "HK231";
    sheet.getCell("B3").value = 1;
    sheet.getCell("C3").value = 1;
    sheet.getCell("D3").value = "71TEST10003";
    sheet.getCell("E3").value = {
      formula: "VLOOKUP(D3,'[1]source.xlsx'!$A$1:$B$2,2,0)",
      result: "Tên đã lưu trong Excel",
    };
    sheet.getCell("F3").value = 3;
    sheet.getCell("K3").value = "BB";
    const parsed = await readWorkbook(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );
    expect(parsed.items[0]!.name).toBe("Tên đã lưu trong Excel");
    expect(parsed.warnings.some((warning) =>
      warning.message.includes("công thức tham chiếu workbook ngoài"),
    )).toBe(true);
  });

  it("runs the bounded worker on a supplied workbook", async () => {
    const data = await parsePlan(
      await readFile(new URL("../../data/plans/K30.xlsx", import.meta.url)),
    );
    expect(data.cohortCode).toBe("K30");
    expect(data.items).toHaveLength(70);
  }, 30000);

  it("reports the K31 source total against a linked CTĐT total without changing it", () => {
    const data = structuredClone(k31);
    data.curriculum = {
      id: "curriculum-id",
      revisionId: "revision-id",
      version: 1,
      name: "CTĐT K31",
    };
    const linked = {
      ...data,
      totalCredits: 126,
      courses: [],
      groups: [],
      electives: [],
      relations: [],
      sourceWarnings: [],
    } as never;
    reviewPlan(data, linked);
    expect(data.totalCredits).toBe(132);
    expect(data.warnings.some((warning) =>
      warning.message.includes("132 tín chỉ") && warning.message.includes("126 tín chỉ"),
    )).toBe(true);
  });
});
