import { z } from "zod";
import type { CurriculumData } from "../curricula/model.js";
import { CurriculumError } from "../curricula/model.js";
export { CurriculumError as PlanError } from "../curricula/model.js";
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const text = z.string().trim().max(12000);
const short = z.string().trim().max(500);
export const itemSchema = z.object({
  id: z.string().regex(/^row-\d+$/),
  position: z.number().int().positive(),
  code: z.string().trim().max(100),
  name: short.min(1),
  credits: z.number().min(0).max(30).nullable(),
  type: short,
  termCode: z.string().regex(/^HK\d{2}[123]$/),
  semester: z.number().int().min(1).max(3),
  studyYear: z.number().int().min(1).max(10),
  sectionId: z.string(),
  prerequisite: text,
  prior: text,
  notes: text,
  hours: z.object({
    lecture: z.number().min(0).max(1000).nullable(),
    practice: z.number().min(0).max(1000).nullable(),
    project: z.number().min(0).max(1000).nullable(),
    internship: z.number().min(0).max(1000).nullable(),
  }),
  sourceRow: z.number().int(),
  sourceSheet: z.string(),
  sourceCells: z.record(z.string(), z.string()),
});
export type PlanItem = z.infer<typeof itemSchema>;
export type PlanData = {
  schemaVersion: 1;
  name: string;
  major: string;
  cohortCode: string;
  admissionYear: number;
  totalCredits: number | null;
  notes: string;
  items: PlanItem[];
  terms: {
    code: string;
    semester: number;
    studyYear: number;
    sourceCredits: number | null;
  }[];
  sections: {
    id: string;
    termCode: string;
    label: string;
    kind: "choice" | "specialty" | "note";
    sourceRow: number;
  }[];
  sourceWarnings: { row: number | null; message: string }[];
  warnings: { row: number | null; message: string }[];
  curriculum: {
    id: string;
    revisionId: string;
    version: number;
    name: string;
  } | null;
};
export const identity = (d: Pick<PlanData, "major" | "cohortCode">) =>
  `${fold(d.major)}:${d.cohortCode}`;
export function reviewPlan(data: PlanData, curriculum?: CurriculumData) {
  data.warnings = [...data.sourceWarnings];
  const warn = (row: number | null, message: string) =>
    data.warnings.push({ row, message });
  const ids = new Set<string>();
  for (const item of data.items) {
    itemSchema.parse(item);
    if (ids.has(item.id))
      throw new CurriculumError("invalid_plan_input", 400, [
        "Trùng định danh dòng phân bổ.",
      ]);
    ids.add(item.id);
    if (!item.code) warn(item.sourceRow, `${item.name}: chưa có mã học phần.`);
    if (item.credits === null)
      warn(item.sourceRow, `${item.name}: chưa có tín chỉ, không coi là 0.`);
    if (!item.type)
      warn(item.sourceRow, `${item.name}: chưa xác định loại môn.`);
    if (
      !data.terms.some(
        (t) =>
          t.code === item.termCode &&
          t.semester === item.semester &&
          t.studyYear === item.studyYear,
      )
    )
      throw new CurriculumError("invalid_plan_input", 400, [
        "Năm/học kỳ phải thuộc một kỳ trong kế hoạch.",
      ]);
    if (
      item.sectionId &&
      !data.sections.some(
        (s) => s.id === item.sectionId && s.termCode === item.termCode,
      )
    )
      throw new CurriculumError("invalid_plan_input", 400, [
        "Nhóm môn phải thuộc học kỳ đã chọn.",
      ]);
    if (curriculum && item.code) {
      const course = curriculum.courses.find((c) => c.code === item.code);
      if (!course)
        warn(
          item.sourceRow,
          `${item.code}: chưa khớp mã trong CTĐT liên kết; giữ nguyên, chưa tự quy đổi.`,
        );
      else {
        const fields = (
          ["name", "credits", "type", "prerequisite", "prior"] as const
        ).filter(
          (k) => fold(String(item[k] ?? "")) !== fold(String(course[k] ?? "")),
        );
        if (fields.length)
          warn(
            item.sourceRow,
            `${item.code}: khác CTĐT ở ${fields.map((k) => ({ name: "tên môn", credits: "tín chỉ", type: "loại môn", prerequisite: "tiên quyết", prior: "học trước" })[k]).join(", ")}; giữ giá trị của kế hoạch.`,
          );
      }
    }
  }
  if (
    curriculum &&
    data.totalCredits !== null &&
    data.totalCredits !== curriculum.totalCredits
  )
    warn(
      null,
      `Tổng ghi trong kế hoạch: ${data.totalCredits} tín chỉ; CTĐT liên kết: ${curriculum.totalCredits} tín chỉ. Cần rà soát trước khi dùng tính lộ trình.`,
    );
  if (!data.curriculum)
    warn(
      null,
      "Chưa có CTĐT cùng ngành và khóa để liên kết. Có thể cập nhật liên kết sau khi bổ sung khung.",
    );
  const codes = new Set<string>();
  for (const item of data.items)
    if (item.code) {
      if (codes.has(item.code))
        warn(
          item.sourceRow,
          `${item.code}: xuất hiện nhiều lần; giữ riêng từng lượt phân bổ, không cộng thành tín chỉ tích lũy.`,
        );
      codes.add(item.code);
    }
  return data;
}
