// Types, requests and pure helpers for "AI đề xuất kỹ năng" in career requirements:
// the local AI suggests skills for a career position, the admin keeps, edits or
// drops each row, and only the kept rows are saved. No DOM here — unit tested.
import { careerFailures, type CareerSkill } from "./career-types";

export const CAREER_AI_API = "/api/admin/careers/requirements/ai-suggestions";

export type CareerAiSuggestionStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type CareerAiSuggestionItem = {
  /** Position in the stored result; ApplyItem.sourceIndex refers to it. */
  index: number;
  /** null = a new skill that is not in the catalog yet. */
  skillId: string | null;
  skillName: string;
  isNewSkill: boolean;
  alreadyLinked: boolean;
  isRequired: boolean;
  title: string;
  description: string;
  /** Shown to the admin only, never saved. */
  reason: string;
};
export type CareerAiSuggestion = {
  id: string;
  careerPositionId: string;
  status: CareerAiSuggestionStatus;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  appliedAt: string | null;
  model: string | null;
  promptVersion: string | null;
  items: CareerAiSuggestionItem[];
};
export type CareerAiStatus = { enabled: boolean; worker: { online: boolean; supportsSuggestions: boolean; seenAt: string | null } };
export type ApplyItem = { skillId: string | null; skillName: string; title: string; description: string; isRequired: boolean; sourceIndex: number | null };
/** A skill already linked to the career (from the requirement list with kind=skill). */
export type LinkedSkill = { skillId: string | null; skillName: string | null };

/** One editable row of the review list. `key` stays stable while rows are removed. */
export type SuggestionRow = {
  key: string;
  index: number;
  checked: boolean;
  isNewSkill: boolean;
  alreadyLinked: boolean;
  skillId: string | null;
  skillName: string;
  title: string;
  description: string;
  isRequired: boolean;
  reason: string;
};

export const TITLE_MAX = 160;
export const DESCRIPTION_MAX = 4000;
export const SKILL_NAME_MAX = 100;
export const POLL_SUGGESTION_MS = 3_000;
export const POLL_STATUS_MS = 15_000;

/** Only these statuses change on their own, so only they are polled. */
export const isPending = (status: CareerAiSuggestionStatus | null | undefined) => status === "queued" || status === "processing";

/* ----------------------------------------------------------------- errors */

const REQUEST_ERRORS: Record<string, string> = {
  ...careerFailures,
  ai_disabled: "Máy chủ chưa bật tính năng AI.",
  ai_queue_full: "Hàng đợi AI đang đầy. Vui lòng thử lại sau ít phút.",
  suggestion_not_found: "Không tìm thấy đề xuất này. Hãy tạo đề xuất mới.",
  suggestion_not_active: "Đề xuất đã xử lý xong hoặc đã được hủy.",
  suggestion_not_completed: "Đề xuất chưa hoàn tất nên chưa lưu được.",
  suggestion_already_applied: "Đề xuất này đã được lưu trước đó. Đóng hộp thoại để xem danh sách liên kết.",
  requirement_exists: "Có kỹ năng đã được liên kết với nghề này. Hãy kiểm tra lại danh sách.",
  // Body errors under /requirements/ai-suggestions come back as invalid_ai_suggestion.
  invalid_ai_suggestion: "Thông tin chưa hợp lệ. Kiểm tra kỹ năng, nội dung yêu cầu và mô tả của các dòng đã chọn.",
  invalid_origin: "Phiên thao tác không hợp lệ. Vui lòng tải lại trang.",
  database_required: "Chưa kết nối được cơ sở dữ liệu. Vui lòng thử lại sau.",
};
export function requestErrorMessage(code: string | null | undefined, skills: string[] = []): string {
  if (code === "requirement_exists" && skills.length) return `Các kỹ năng sau đã được liên kết với nghề này: ${skills.join(", ")}.`;
  return REQUEST_ERRORS[code ?? ""] ?? "Không thể thực hiện thao tác. Vui lòng thử lại.";
}

/** Why a suggestion job failed, in the admin's words. */
const FAILURE_MESSAGES: Record<string, string> = {
  ai_timeout: "Máy AI xử lý quá thời gian cho phép.",
  ai_output_truncated: "Kết quả của AI bị cắt giữa chừng nên chưa dùng được.",
  invalid_ai_output: "Kết quả của AI không đúng định dạng hoặc không có kỹ năng hợp lệ nên hệ thống không hiển thị.",
  ollama_unavailable: "Máy AI tạm thời không phản hồi.",
  ai_failed: "Máy AI gặp lỗi khi tạo đề xuất.",
  worker_timeout: "Máy AI chưa xử lý xong trong thời gian cho phép. Có thể máy AI đã tắt giữa chừng.",
};
export function failureMessage(code: string | null | undefined): string {
  return FAILURE_MESSAGES[code ?? ""] ?? "Chưa tạo được đề xuất.";
}

export class CareerAiError extends Error {
  constructor(readonly code: string | null, readonly skills: string[] = []) { super(requestErrorMessage(code, skills)); }
}
/** fetch + JSON with the admin session; failures become a CareerAiError carrying the API code. */
export async function careerAiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as { error?: string; skills?: unknown };
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    throw new CareerAiError(body.error ?? null, Array.isArray(body.skills) ? body.skills.filter((name): name is string => typeof name === "string") : []);
  }
  return body as T;
}
export const jsonPost = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/* ------------------------------------------------------------- formatting */

export type WorkerTone = "ok" | "warn" | "off";
/** The worker line under the intro and the waiting state, and whether creating is allowed. */
export function workerLine(status: CareerAiStatus | null | undefined): { text: string; tone: WorkerTone; canCreate: boolean } {
  if (!status) return { text: "Đang kiểm tra máy AI…", tone: "off", canCreate: false };
  if (!status.enabled) return { text: "Máy chủ chưa bật tính năng AI.", tone: "off", canCreate: false };
  if (status.worker.online && status.worker.supportsSuggestions) return { text: "Máy AI đang hoạt động", tone: "ok", canCreate: true };
  if (status.worker.online) return { text: "Máy AI đang chạy phiên bản cũ. Khởi động lại worker AI để dùng tính năng này.", tone: "warn", canCreate: true };
  return { text: "Máy AI đang tắt. Đề xuất sẽ được xử lý khi máy AI bật lại.", tone: "warn", canCreate: true };
}

/** mm:ss since `since`; never negative when the clocks of server and browser differ. */
export function formatElapsed(since: string, now: number): string {
  const start = new Date(since).getTime();
  const seconds = Number.isNaN(start) ? 0 : Math.max(0, Math.floor((now - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Same folding as the API (fold() in careers/shared.ts), so duplicates are judged alike. */
export const foldName = (value: string) => value.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ");

/* ------------------------------------------------------------ review rows */

/** Catalog rows start ticked unless already linked; new skills start unticked. */
export function rowsFromSuggestion(items: CareerAiSuggestionItem[]): SuggestionRow[] {
  return items.map((item) => ({
    key: `row-${item.index}`,
    index: item.index,
    checked: !item.isNewSkill && !item.alreadyLinked,
    isNewSkill: item.isNewSkill,
    alreadyLinked: item.alreadyLinked,
    skillId: item.isNewSkill ? null : item.skillId,
    skillName: item.skillName,
    title: item.title.slice(0, TITLE_MAX),
    description: item.description.slice(0, DESCRIPTION_MAX),
    isRequired: item.isRequired,
    reason: item.reason,
  }));
}

/** The name a row stands for: the catalog name for catalog rows, the typed name for new ones. */
export function rowSkillName(row: SuggestionRow, catalog: CareerSkill[]): string {
  if (row.isNewSkill) return row.skillName.trim();
  return catalog.find((skill) => skill.id === row.skillId)?.name ?? row.skillName;
}

export type RowValidation = { errors: Record<string, string[]>; valid: boolean; selected: number; selectable: number; required: number };
/**
 * Checks the ticked rows the way the API will: a title, a new-skill name, no skill
 * ticked twice and no skill already linked to the career. A new name matching a
 * catalog skill counts as that skill, as on the server.
 */
export function validateRows(rows: SuggestionRow[], linked: LinkedSkill[], catalog: CareerSkill[]): RowValidation {
  const identity = (row: SuggestionRow) => {
    if (!row.isNewSkill) return row.skillId ? `id:${row.skillId}` : "";
    const name = foldName(row.skillName);
    if (!name) return "";
    const match = catalog.find((skill) => foldName(skill.name) === name);
    return match ? `id:${match.id}` : `name:${name}`;
  };
  const linkedKeys = new Set(linked.flatMap((item) => [
    ...(item.skillId ? [`id:${item.skillId}`] : []),
    ...(item.skillName ? [`name:${foldName(item.skillName)}`] : []),
  ]));
  const ticked = rows.filter((row) => row.checked && !row.alreadyLinked);
  const counts = new Map<string, number>();
  for (const row of ticked) { const key = identity(row); if (key) counts.set(key, (counts.get(key) ?? 0) + 1); }
  const errors: Record<string, string[]> = {};
  for (const row of ticked) {
    const list: string[] = [];
    const key = identity(row);
    if (row.isNewSkill && !row.skillName.trim()) list.push("Nhập tên kỹ năng mới.");
    if (!row.isNewSkill && !row.skillId) list.push("Chọn kỹ năng.");
    if (key && linkedKeys.has(key)) list.push("Kỹ năng này đã được liên kết với nghề này.");
    else if (key && (counts.get(key) ?? 0) > 1) list.push("Kỹ năng này được chọn ở nhiều dòng.");
    if (!row.title.trim()) list.push("Nhập nội dung yêu cầu.");
    if (list.length) errors[row.key] = list;
  }
  return {
    errors,
    valid: Object.keys(errors).length === 0,
    selected: ticked.length,
    selectable: rows.filter((row) => !row.alreadyLinked).length,
    required: ticked.filter((row) => row.isRequired).length,
  };
}

/** The body of POST /:id/apply: only ticked rows, trimmed. */
export function applyItems(rows: SuggestionRow[]): ApplyItem[] {
  return rows.filter((row) => row.checked && !row.alreadyLinked).map((row) => ({
    skillId: row.isNewSkill ? null : row.skillId,
    skillName: row.isNewSkill ? row.skillName.trim() : "",
    title: row.title.trim(),
    description: row.description.trim(),
    isRequired: row.isRequired,
    sourceIndex: row.index,
  }));
}

/** True once the admin changed anything, so regenerating asks first. */
export function hasEdits(rows: SuggestionRow[], items: CareerAiSuggestionItem[]): boolean {
  const initial = rowsFromSuggestion(items);
  if (rows.length !== initial.length) return true;
  return rows.some((row, at) => JSON.stringify(row) !== JSON.stringify(initial[at]));
}
