// Types and pure helpers for the AI proposals of the Năng lực courses ("Tạo liên kết kỹ năng (AI)",
// "Thêm trọng số (AI)" and the whole-program run). The local AI proposes, the admin reviews; only the
// reviewed rows are saved. No DOM here — unit tested.
import { COMPETENCY_API, readCompetencyResponse, WEIGHT_TOLERANCE } from "./competency-types";

/** A failed request with the API error code kept (the message is the competency page's own). */
export class CompetencyAiError extends Error {
  constructor(message: string, readonly code: string | null) { super(message); }
}
export async function aiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, credentials: "include", cache: "no-store" }); }
  catch { throw new CompetencyAiError("Không thể kết nối hệ thống. Hãy kiểm tra kết nối và thử lại.", null); }
  const copy = response.clone();
  try { return await readCompetencyResponse<T>(response); }
  catch (failure) {
    const body = await copy.json().catch(() => ({})) as { error?: unknown };
    throw new CompetencyAiError((failure as Error).message, typeof body.error === "string" ? body.error : null);
  }
}
export const jsonPost = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const COMPETENCY_AI_API = `${COMPETENCY_API}/ai`;
export const POLL_SUGGESTION_MS = 3_000;
export const POLL_BATCH_MS = 5_000;
export const POLL_STATUS_MS = 15_000;
export const SKILL_NAME_MAX = 100;

export type CourseAiMode = "links" | "weights";
export type CourseAiStatusCode = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type CourseAiStatus = { enabled: boolean; worker: { online: boolean; supportsSuggestions: boolean; seenAt: string | null } };
export type CourseAiItem = {
  index: number;
  /** null = a new skill that is not in the catalog yet. */
  skillId: string | null;
  skillName: string;
  groupId: string | null;
  groupName: string | null;
  /** false: a career skill that no course measures yet, or a new skill; saving adds it to the competency catalog. */
  hasProfile: boolean;
  isNewSkill: boolean;
  alreadyLinked: boolean;
  /** weights: whole percent (the items add up to 100); null in links. */
  percent: number | null;
  reason: string;
};
export type CourseAiSuggestion = {
  id: string;
  revisionId: string;
  courseCode: string;
  mode: CourseAiMode | "full";
  batchId: string | null;
  status: CourseAiStatusCode;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  appliedAt: string | null;
  model: string | null;
  promptVersion: string | null;
  items: CourseAiItem[];
  /** weights: the course's links changed since the proposal was made. */
  stale: boolean;
};
export type CourseAiBatch = {
  id: string;
  createdAt: string;
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  applied: number;
  /** Finished, not yet saved, with at least one proposed skill. */
  ready: number;
  items: { id: string; courseCode: string; status: CourseAiStatusCode; errorCode: string | null; applied: boolean; itemCount: number }[];
};
export type BatchApplyResult = { activated: number; drafted: number; empty: number; skipped: { courseCode: string; reason: string }[]; batch: CourseAiBatch };

/** Only these statuses change on their own, so only they are polled. */
export const isPending = (status: CourseAiStatusCode | null | undefined) => status === "queued" || status === "processing";
export const batchPending = (batch: CourseAiBatch | null | undefined) => Boolean(batch && batch.queued + batch.processing > 0);

const FAILURE_MESSAGES: Record<string, string> = {
  ai_timeout: "Máy AI xử lý quá thời gian cho phép.",
  ai_output_truncated: "Kết quả của AI bị cắt giữa chừng nên chưa dùng được.",
  invalid_ai_output: "Kết quả của AI không đúng định dạng hoặc không có kỹ năng hợp lệ nên hệ thống không hiển thị.",
  ollama_unavailable: "Máy AI tạm thời không phản hồi.",
  ai_failed: "Máy AI gặp lỗi khi tạo đề xuất.",
  worker_timeout: "Máy AI chưa xử lý xong trong thời gian cho phép. Có thể máy AI đã tắt giữa chừng.",
};
/** Why a proposal failed, in the admin's words. */
export function failureMessage(code: string | null | undefined): string {
  return FAILURE_MESSAGES[code ?? ""] ?? "Chưa tạo được đề xuất.";
}

/** Why a course was not saved by a whole-program apply. */
const SKIP_REASONS: Record<string, string> = {
  course_already_linked: "đã có liên kết kỹ năng",
  duplicate_curriculum_course: "mã học phần lặp trong CTĐT",
  course_not_found: "không còn trong CTĐT",
  skill_unavailable: "kỹ năng đã ngừng sử dụng",
  group_unavailable: "nhóm đã ngừng sử dụng",
  weight_total_invalid: "tổng trọng số chưa đủ 100%",
  course_has_no_links: "chưa có liên kết kỹ năng",
  invalid_competency_reference: "dữ liệu vừa thay đổi",
};
export const skipReason = (code: string) => SKIP_REASONS[code] ?? "không lưu được";

/* ------------------------------------------------------------ link review */

export type LinkRow = {
  key: string;
  index: number;
  checked: boolean;
  skillId: string | null;
  skillName: string;
  groupId: string;
  hasProfile: boolean;
  isNewSkill: boolean;
  alreadyLinked: boolean;
  reason: string;
};
/** Skills start ticked unless already linked; new skills start unticked (the admin opts in). */
export function linkRows(items: CourseAiItem[]): LinkRow[] {
  return items.map((item) => ({
    key: `row-${item.index}`,
    index: item.index,
    checked: !item.alreadyLinked && !item.isNewSkill,
    skillId: item.skillId,
    skillName: item.skillName,
    groupId: item.groupId ?? "",
    hasProfile: item.hasProfile,
    isNewSkill: item.isNewSkill,
    alreadyLinked: item.alreadyLinked,
    reason: item.reason,
  }));
}
export const foldName = (value: string) => value.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ");

/** Per-row messages and whether the selection can be saved (mirrors the server checks). */
export function validateLinkRows(rows: LinkRow[]): { valid: boolean; selected: number; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  const seen = new Set<string>();
  let selected = 0;
  for (const row of rows) {
    if (!row.checked || row.alreadyLinked) continue;
    selected += 1;
    const messages: string[] = [];
    const name = row.skillName.replace(/\s+/g, " ").trim();
    if (row.isNewSkill && !name) messages.push("Nhập tên kỹ năng mới.");
    if (row.isNewSkill && name.length > SKILL_NAME_MAX) messages.push(`Tên kỹ năng tối đa ${SKILL_NAME_MAX} ký tự.`);
    if (!row.hasProfile && !row.groupId) messages.push("Chọn nhóm năng lực.");
    const key = row.skillId ?? `new:${foldName(name)}`;
    if (name && seen.has(key)) messages.push("Kỹ năng này đã có ở dòng khác.");
    seen.add(key);
    if (messages.length) errors[row.key] = messages;
  }
  return { valid: selected > 0 && !Object.keys(errors).length, selected, errors };
}
export function applyLinkItems(rows: LinkRow[]) {
  return rows.filter((row) => row.checked && !row.alreadyLinked).map((row) => ({
    skillId: row.skillId,
    skillName: row.skillId ? "" : row.skillName.replace(/\s+/g, " ").trim(),
    groupId: row.hasProfile ? null : row.groupId || null,
  }));
}

/* ---------------------------------------------------------- weight review */

export type WeightRow = { key: string; skillId: string; skillName: string; percent: string; proposed: number; reason: string };
export function weightRows(items: CourseAiItem[]): WeightRow[] {
  return items.filter((item) => item.skillId).map((item) => ({
    key: `row-${item.index}`,
    skillId: item.skillId!,
    skillName: item.skillName,
    percent: String(item.percent ?? 0),
    proposed: item.percent ?? 0,
    reason: item.reason,
  }));
}
/** The reviewed weights: total in percent, whether each value is valid and the body of a save. */
export function assessWeightRows(rows: WeightRow[]) {
  const errors: Record<string, string> = {};
  let total = 0;
  const weights = rows.map((row) => {
    const value = Number(row.percent);
    if (!row.percent.trim() || !Number.isFinite(value) || value < 0 || value > 100) errors[row.key] = "Nhập số từ 0 đến 100.";
    else total += value;
    return { skillId: row.skillId, percent: value };
  });
  const valid = rows.length > 0 && !Object.keys(errors).length;
  return { weights, total, errors, valid, canActivate: valid && Math.abs(total / 100 - 1) <= WEIGHT_TOLERANCE, edited: rows.filter((row) => Number(row.percent) !== row.proposed).length };
}

/* ------------------------------------------------------------- whole run */

/** Done = finished in any way; the bar counts done out of total. */
export function batchProgress(batch: CourseAiBatch) {
  const done = batch.completed + batch.failed + batch.cancelled;
  return { done, percent: batch.total ? Math.round((done / batch.total) * 100) : 0 };
}
