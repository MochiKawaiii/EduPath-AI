import { z } from "zod";

export class CompetencyError extends Error {
  constructor(public readonly code: string, public readonly status = 422, public readonly details: string[] = []) { super(code); }
}
export const WEIGHT_TOLERANCE = 0.000001;
export const groupInput = z.object({ name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000), isActive: z.boolean() }).strict();
export const skillInput = z.object({
  name: z.string().trim().min(1).max(100), description: z.string().trim().max(2000), scope: z.string().trim().max(4000),
  groupId: z.uuid(), isActive: z.boolean(), existingSkillId: z.uuid().optional(),
}).strict();
export const allocationSchema = z.object({ skillId: z.uuid(), weight: z.number().min(0).max(1) }).strict();
export const configurationInput = z.object({ status: z.enum(["draft", "active"]), links: z.array(allocationSchema).max(200), note: z.string().trim().max(500).default("") }).strict();
export type SkillInput = z.infer<typeof skillInput>;
export type GroupInput = z.infer<typeof groupInput>;
export type ConfigurationInput = z.infer<typeof configurationInput>;
export function validateWeights(links: {skillId: string; weight: number}[], status: string): number {
  if (new Set(links.map(link => link.skillId)).size !== links.length) throw new CompetencyError("duplicate_skill_link", 409);
  if (links.some(link => !Number.isFinite(link.weight) || link.weight < 0 || link.weight > 1)) throw new CompetencyError("invalid_weight", 400);
  const total = links.reduce((sum, link) => sum + link.weight, 0);
  if (status === "active" && (!links.length || Math.abs(total - 1) > WEIGHT_TOLERANCE)) throw new CompetencyError("weight_total_invalid", 422, [`Tổng trọng số hiện tại ${(total * 100).toFixed(4)}%; cần 100%.`]);
  return total;
}
export type Issue = { sheet: string; row: number | null; code: string; message: string };
export type WorkbookData = {
  skills: { row: number; name: string; group: string; scope: string; declaredCourseCount: number }[];
  links: { row: number; courseCode: string; courseName: string; skillName: string; group: string; weight: number }[];
  groups: string[]; errors: Issue[]; warnings: Issue[];
  counts: { skillRows: number; linkRows: number; courses: number };
};
