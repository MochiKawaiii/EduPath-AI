import { WEIGHT_TOLERANCE } from "./competency-types";

export type AllocationInput = { skillId: string; percent: string };
export function assessAllocations(rows: AllocationInput[]) {
  const seen = new Set<string>();
  let total = 0;
  const errors: string[] = [];
  if (rows.length > 200) errors.push("Mỗi học phần hỗ trợ tối đa 200 liên kết kỹ năng.");
  const links = rows.map((row, index) => {
    const amount = Number(row.percent);
    if (!row.skillId) errors.push(`Dòng ${index + 1}: chưa chọn kỹ năng.`);
    else if (seen.has(row.skillId)) errors.push(`Dòng ${index + 1}: kỹ năng đã có trong cấu hình.`);
    seen.add(row.skillId);
    if (!row.percent.trim() || !Number.isFinite(amount) || amount < 0 || amount > 100) errors.push(`Dòng ${index + 1}: trọng số phải là số từ 0 đến 100%.`);
    else total += amount / 100;
    return { skillId: row.skillId, weight: amount / 100 };
  });
  return { links, total, errors, canActivate: rows.length > 0 && errors.length === 0 && Math.abs(total - 1) <= WEIGHT_TOLERANCE };
}
