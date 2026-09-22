import { z } from "zod";
export { CurriculumError as GraduationError } from "../curricula/model.js";
const text = z.string().trim().max(12000);
const short = z.string().trim().max(500);
const credits = z.number().min(0).max(500).nullable();
export const graduationSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: short.min(1),
    standardCode: short.min(1),
    cohortCode: short.regex(/^K\d{2}$/),
    classBlock: short.min(1),
    major: short.min(1),
    specialty: short,
    educationSystem: short,
    faculty: short,
    minimumCredits: credits,
    mandatoryCredits: credits,
    electiveCredits: credits,
    freeElectiveCredits: credits,
    minimumGpa: z.number().min(0).max(10).nullable(),
    notes: text,
    groups: z
      .array(
        z
          .object({
            id: short.min(1),
            name: short.min(1),
            kind: z.enum(["mandatory", "elective"]),
            minimumCredits: credits,
            sourceRow: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    courses: z
      .array(
        z
          .object({
            id: short.min(1),
            groupId: short.min(1),
            code: short.min(1),
            name: short.min(1),
            credits: z.number().min(0).max(50).nullable(),
            conditionOnly: z.boolean(),
            sourceRow: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(3000),
    sourceWorkbook: short,
    sourceSheet: short,
    sourceNotes: z.array(text).max(100),
  })
  .strict();
export type GraduationData = z.infer<typeof graduationSchema>;
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export const identity = (data: GraduationData) =>
  fold(`${data.standardCode}|${data.classBlock}`);
export function validateData(input: unknown) {
  const data = graduationSchema.parse(input);
  const groups = new Set(data.groups.map((g) => g.id));
  if (
    groups.size !== data.groups.length ||
    new Set(data.courses.map((c) => c.id)).size !== data.courses.length ||
    data.courses.some((c) => !groups.has(c.groupId))
  )
    throw new Error("invalid_graduation_structure");
  return data;
}
export function warnings(data: GraduationData): string[] {
  const result = [...data.sourceNotes];
  if (data.minimumCredits === null || data.minimumGpa === null)
    result.push("Chưa có đủ ngưỡng tín chỉ hoặc điểm trung bình tích lũy.");
  if (
    data.minimumCredits !== null &&
    [
      data.mandatoryCredits,
      data.electiveCredits,
      data.freeElectiveCredits,
    ].every((v) => v !== null) &&
    data.minimumCredits !==
      data.mandatoryCredits! + data.electiveCredits! + data.freeElectiveCredits!
  )
    result.push(
      "Tổng tín chỉ các loại không khớp ngưỡng tích lũy; cần rà soát biểu mẫu.",
    );
  for (const group of data.groups) {
    const courses = data.courses.filter((c) => c.groupId === group.id);
    if (!courses.length) result.push(`${group.name}: chưa có môn học.`);
    if (group.minimumCredits === null)
      result.push(`${group.name}: chưa xác định tín chỉ yêu cầu.`);
    if (courses.some((c) => c.credits === null && !c.conditionOnly))
      result.push(`${group.name}: có môn chưa rõ tín chỉ.`);
    if (new Set(courses.map((c) => c.code)).size !== courses.length)
      result.push(`${group.name}: có mã học phần trùng trong nhóm.`);
  }
  return [...new Set(result)];
}
