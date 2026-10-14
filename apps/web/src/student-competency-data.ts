// Pure helpers for the #competency page: labels, formatting, AI key mapping and
// the polling decision. No fetch, no DOM — everything here is unit tested.
import type {
  AiOutput, AiPriority, AiStatus, AssessmentResult, CareerRequirementResult, Confidence,
  CourseState, Eligibility, LevelCode, SkillResult, StoredAssessment, SupportCourse,
} from "./competency-assessment-types";

export const COMPETENCY_API = "/api/student/competency-assessments";

/* ----------------------------------------------------------------- errors */

/** Errors of POST / that describe a missing precondition: shown as a calm empty state, not as a failure. */
export const PRECONDITION_ERRORS = ["transcript_required", "cohort_unknown", "curriculum_unavailable", "curriculum_ambiguous", "competency_weights_unavailable"] as const;
export type PreconditionError = typeof PRECONDITION_ERRORS[number];

export function isPreconditionError(code: string | null | undefined): code is PreconditionError {
  return (PRECONDITION_ERRORS as readonly string[]).includes(code ?? "");
}

/** Title, explanation and next step for each precondition. */
export const PRECONDITION_COPY: Record<PreconditionError, { title: string; text: string; action: { label: string; href: string } | null }> = {
  transcript_required: { title: "Cần bảng điểm để bắt đầu", text: "EduPath tính năng lực từ kết quả các học phần bạn đã học. Hãy import bảng điểm PDF xuất từ cổng đào tạo, rồi quay lại đây.", action: { label: "Import bảng điểm", href: "#profile" } },
  cohort_unknown: { title: "Hồ sơ chưa có khóa học", text: "Hệ thống cần biết bạn thuộc khóa nào để chọn đúng chương trình đào tạo. Thông tin khóa được đồng bộ từ tài khoản trường; nếu mục Khóa học trong hồ sơ còn trống, hãy liên hệ Khoa để được cập nhật.", action: { label: "Xem hồ sơ", href: "#profile" } },
  curriculum_unavailable: { title: "Chưa có chương trình đào tạo cho khóa của bạn", text: "Khoa chưa công bố chương trình đào tạo đang áp dụng cho khóa này trên EduPath. Bạn có thể quay lại sau khi chương trình được cập nhật.", action: null },
  curriculum_ambiguous: { title: "Khóa của bạn đang có nhiều chương trình đào tạo", text: "Có hơn một chương trình đào tạo đang áp dụng cho khóa này nên hệ thống chưa chọn được bản đúng. Khoa sẽ rà soát lại; bạn chưa cần làm gì thêm.", action: null },
  competency_weights_unavailable: { title: "Khóa của bạn chưa có dữ liệu kỹ năng", text: "Để tính năng lực, mỗi học phần cần được Khoa gắn với các kỹ năng mà học phần đó rèn luyện. Chương trình của khóa bạn chưa có dữ liệu này, nên chưa thể đánh giá. Bảng điểm và hồ sơ của bạn vẫn được giữ nguyên; hãy quay lại khi Khoa cập nhật.", action: null },
};

const ERROR_MESSAGES: Record<string, string> = {
  consent_required: "Hãy đồng ý để EduPath AI dùng bảng điểm cho việc đánh giá năng lực.",
  policy_outdated: "Chính sách bảo mật vừa được cập nhật. Hãy tải lại trang, đọc chính sách mới rồi xác nhận lại.",
  transcript_changed: "Bảng điểm vừa thay đổi trong lúc đánh giá. Hãy bấm đánh giá lại.",
  assessment_too_frequent: "Bạn vừa đánh giá xong. Hãy đợi khoảng một phút rồi thử lại.",
  invalid_origin: "Phiên thao tác không hợp lệ. Vui lòng tải lại trang.",
  authentication_required: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  database_required: "Chưa kết nối được nơi lưu kết quả. Vui lòng thử lại sau.",
  insufficient_role: "Tài khoản hiện không có quyền sinh viên.",
  ai_disabled: "Nhận xét AI hiện chưa được bật.",
  ai_not_regenerable: "Nhận xét đang được tạo hoặc đã có. Hãy đợi kết quả hiện tại.",
  queue_full: "Hàng đợi nhận xét AI đang đầy. Vui lòng thử lại sau ít phút.",
  not_found: "Không tìm thấy kết quả đánh giá này. Hãy tải lại trang.",
  assessment_not_found: "Không tìm thấy kết quả đánh giá này. Hãy tải lại trang.",
  account_unavailable: "Tài khoản của bạn hiện không dùng được tính năng này. Vui lòng liên hệ Khoa nếu cần hỗ trợ.",
  invalid_input: "Yêu cầu chưa hợp lệ. Vui lòng tải lại trang rồi thử lại.",
  ...Object.fromEntries(PRECONDITION_ERRORS.map((code) => [code, PRECONDITION_COPY[code].title])),
};

export function errorMessage(code: string | null | undefined, fallback = "Thao tác chưa thành công. Vui lòng thử lại."): string {
  return ERROR_MESSAGES[code ?? ""] ?? fallback;
}

/** Why the AI comment failed, in the student's words. */
const AI_ERROR_MESSAGES: Record<string, string> = {
  ai_timeout: "Máy AI xử lý quá thời gian cho phép.",
  ai_output_truncated: "Nhận xét bị cắt giữa chừng nên chưa dùng được.",
  invalid_ai_output: "Nhận xét chưa khớp với số liệu đã tính nên hệ thống không hiển thị.",
  ollama_unavailable: "Máy AI tạm thời không phản hồi.",
  worker_timeout: "Máy AI chưa xử lý xong trong thời gian cho phép.",
  ai_failed: "Máy AI gặp lỗi khi tạo nhận xét.",
};
export function aiErrorMessage(code: string | null | undefined): string {
  return AI_ERROR_MESSAGES[code ?? ""] ?? "Chưa tạo được nhận xét.";
}

/* ------------------------------------------------------------- formatting */

const integer = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
/**
 * Scores are classified unrounded by the engine and shown as whole numbers rounded DOWN,
 * so a shown score never crosses a level or threshold it has not reached (84,6 shows 84, not 85).
 */
export const formatScore = (value: number | null | undefined) => value === null || value === undefined ? "—" : integer.format(Math.floor(value + 1e-9));
export const formatNumber = (value: number | null | undefined) => value === null || value === undefined ? "—" : decimal.format(value);
export const formatPercent = (share: number | null | undefined) => share === null || share === undefined ? "—" : `${integer.format(share * 100)}%`;
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}
/** "HK253" → "HK3 · 2025–2026". Unknown shapes are shown as they are. */
export function termLabel(term: string | null | undefined): string {
  if (!term) return "Chưa xếp lịch";
  const match = /^HK(\d{2})(\d)$/.exec(term);
  if (!match) return term;
  const start = 2000 + Number(match[1]);
  return `HK${match[2]} · ${start}–${start + 1}`;
}

/* ----------------------------------------------------------------- levels */

/** Blue ramp steps (1 = Cơ bản dưới … 4 = Thành thạo); 0 = no fill (no evidence / exempt). */
export function levelStep(level: LevelCode | null | undefined): 0 | 1 | 2 | 3 | 4 {
  switch (level) {
    case "proficient": return 4;
    case "good": return 3;
    case "basic": return 2;
    case "needs_work": return 1;
    default: return 0;
  }
}

export const LEVEL_SCALE: readonly { code: LevelCode; label: string; range: string; text: string }[] = [
  { code: "proficient", label: "Thành thạo", range: "từ 85", text: "Kết quả các học phần liên quan rất tốt và ổn định." },
  { code: "good", label: "Khá", range: "70 đến dưới 85", text: "Nắm chắc phần lớn nội dung; có thể nâng lên bằng dự án thực tế." },
  { code: "basic", label: "Cơ bản", range: "50 đến dưới 70", text: "Đã có nền tảng, nên củng cố thêm để dùng tự tin hơn." },
  { code: "needs_work", label: "Cần củng cố", range: "dưới 50", text: "Kết quả các học phần liên quan còn thấp; nên ôn lại hoặc học cải thiện." },
  { code: "no_evidence", label: "Chưa có minh chứng", range: "chưa học", text: "Bạn chưa học học phần nào đo kỹ năng này — không phải điểm yếu." },
  { code: "exempt", label: "Miễn/công nhận", range: "MT", text: "Học phần được miễn hoặc công nhận nên không có điểm để tính." },
];

/** One sentence that explains what the overall level means. */
export function levelSentence(level: LevelCode | null | undefined): string {
  return LEVEL_SCALE.find((item) => item.code === level)?.text ?? "Chưa đủ dữ liệu để xếp mức.";
}

export const CONFIDENCE_LABELS: Record<Confidence, string> = { low: "Độ tin cậy thấp", medium: "Độ tin cậy trung bình", high: "Độ tin cậy cao" };

/* --------------------------------------------------------- career and gaps */

export type StatusTone = "pass" | "fail" | "unknown" | "neutral";
/** Deficits are unrounded; shown as whole points rounded UP (matches the rounded-down score), never "thiếu 0 điểm". */
export function deficitPoints(deficit: number): number {
  return Math.max(1, Math.ceil(deficit - 1e-9));
}
export function deficitText(deficit: number | null): string {
  if (deficit === null) return "Dưới ngưỡng";
  return `Dưới ngưỡng · thiếu ${formatScore(deficitPoints(deficit))} điểm`;
}
/** "Chênh lệch" column: consistent with formatScore and deficitText; null when there is nothing to compare. */
export function scoreDifference(req: Pick<CareerRequirementResult, "score" | "status" | "deficit" | "threshold">): number | null {
  if (req.score === null || req.status === "upcoming" || req.status === "no_data") return null;
  if (req.status === "below" && req.deficit !== null) return -deficitPoints(req.deficit);
  return Math.floor(req.score + 1e-9) - req.threshold;
}
/** Glyph + text + colour of a career requirement. Green/red/amber only for met and gaps; never red for missing data. */
export function gapStatusDisplay(req: Pick<CareerRequirementResult, "status" | "deficit" | "upcomingTerm" | "exemptOnly">): { tone: StatusTone; glyph: string; text: string } {
  switch (req.status) {
    case "met": return { tone: "pass", glyph: "✓", text: req.exemptOnly ? "Đạt ngưỡng · miễn/công nhận" : "Đạt ngưỡng" };
    case "below": return { tone: "fail", glyph: "✗", text: deficitText(req.deficit) };
    case "not_studied": return { tone: "unknown", glyph: "!", text: "Chưa học" };
    case "upcoming": return { tone: "neutral", glyph: "○", text: req.upcomingTerm ? `Sắp học · ${req.upcomingTerm}` : "Sắp học" };
    default: return { tone: "neutral", glyph: "?", text: "Chưa đủ dữ liệu" };
  }
}

const STATUS_ORDER: Record<CareerRequirementResult["status"], number> = { below: 0, not_studied: 1, upcoming: 2, no_data: 3, met: 4 };
/** Bắt buộc first, then the largest shortfall first (spec §11.4). */
export function sortRequirements(list: readonly CareerRequirementResult[]): CareerRequirementResult[] {
  return [...list].sort((a, b) => Number(b.isRequired) - Number(a.isRequired)
    || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || (b.deficit ?? 0) - (a.deficit ?? 0)
    || a.title.localeCompare(b.title, "vi"));
}
export const isGap = (req: Pick<CareerRequirementResult, "status">) => req.status !== "met";

export function eligibilityDisplay(eligibility: Eligibility, missing: { code: string; name: string | null }[]): { tone: StatusTone; glyph: string; text: string } {
  if (eligibility === "eligible") return { tone: "pass", glyph: "✓", text: "Đủ điều kiện đăng ký" };
  if (eligibility === "not_eligible") return { tone: "unknown", glyph: "⚠", text: missing.length ? `Cần học trước ${missing.map((m) => m.name ? `${m.name} (${m.code})` : m.code).join(", ")}` : "Chưa đủ điều kiện" };
  return { tone: "neutral", glyph: "?", text: "Cần xác nhận điều kiện với Khoa" };
}

export const COURSE_STATE_LABELS: Record<CourseState, string> = {
  passed: "Đạt", failed: "Không đạt", exempt: "Miễn/công nhận", graded_unknown: "Có điểm, chưa rõ kết quả",
  in_progress: "Đang học", not_taken: "Chưa học", not_in_curriculum: "Ngoài CTĐT",
};

/**
 * Where the student stands with a suggested course, in words: whether it was taken, its score and
 * what that means ("Đã học, đạt · điểm 6,5 (C+)", "Đã học, chưa đạt · điểm 3 (F) — cần học lại", "Chưa học").
 */
export function courseStanding(course: Pick<SupportCourse, "state" | "score10" | "letter">): { tone: StatusTone; text: string } {
  const score = course.score10 !== null ? ` · điểm ${formatNumber(course.score10)}${course.letter ? ` (${course.letter})` : ""}` : course.letter ? ` · ${course.letter}` : "";
  switch (course.state) {
    case "passed": return { tone: "pass", text: `Đã học, đạt${score}` };
    case "failed": return { tone: "fail", text: `Đã học, chưa đạt${score} — cần học lại` };
    case "exempt": return { tone: "pass", text: "Miễn/công nhận" };
    case "in_progress": return { tone: "neutral", text: "Đang học" };
    case "graded_unknown": return { tone: "unknown", text: `Có điểm${score}, chưa rõ kết quả` };
    default: return { tone: "neutral", text: "Chưa học" };
  }
}

/* ---------------------------------------------------- proficiency summary */

/** The level columns of the proficiency table, best first; "Chưa có minh chứng" last (not a weakness). */
export const LEVEL_COLUMNS = ["proficient", "good", "basic", "needs_work", "no_evidence"] as const satisfies readonly LevelCode[];
export type LevelRow = {
  key: string; name: string; score: number | null; level: LevelCode; levelLabel: string;
  /** Skills of the group counted like the group line: condition-only and not-applicable skills left out. */
  total: number;
  counts: Record<(typeof LEVEL_COLUMNS)[number], number>;
};
/** One row per skill group: how many of its skills sit at each proficiency level. */
export function levelSummary(result: Pick<AssessmentResult, "groups" | "skills">): LevelRow[] {
  return result.groups.map((group) => {
    const skills = result.skills.filter((skill) => skill.groupKey === group.key && !skill.conditionOnly && skill.status !== "not_applicable");
    const counts = Object.fromEntries(LEVEL_COLUMNS.map((level) => [level, skills.filter((skill) => skill.level === level).length])) as LevelRow["counts"];
    return { key: group.key, name: group.name, score: group.score, level: group.level, levelLabel: group.levelLabel, total: skills.length, counts };
  });
}

/** AI priority tags; worded apart from the career property "Ưu tiên" (preferred). The stored enum stays high/medium/low. */
export const PRIORITY_LABELS: Record<AiPriority, string> = { high: "Cần làm sớm", medium: "Nên làm", low: "Có thể để sau" };

/* ----------------------------------------------------------------- skills */

export type SkillFilters = { group: string; level: string; confidence: string; careerOnly: boolean; needsWork: boolean; search: string };
export const EMPTY_SKILL_FILTERS: SkillFilters = { group: "", level: "", confidence: "", careerOnly: false, needsWork: false, search: "" };

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();

/** "Cần cải thiện" = scored below Khá. */
export const skillNeedsWork = (skill: Pick<SkillResult, "level">) => skill.level === "basic" || skill.level === "needs_work";

export function filterSkills(skills: readonly SkillResult[], filters: SkillFilters): SkillResult[] {
  const query = fold(filters.search);
  return skills.filter((skill) => (!filters.group || skill.groupKey === filters.group)
    && (!filters.level || skill.level === filters.level)
    && (!filters.confidence || skill.confidence === filters.confidence)
    && (!filters.careerOnly || skill.careerSkill)
    && (!filters.needsWork || skillNeedsWork(skill))
    && (!query || fold(`${skill.name} ${skill.scope} ${skill.evidenceCourses.map((row) => row.code).join(" ")}`).includes(query)));
}

/**
 * "x/y kỹ năng có minh chứng" of one group, with the same rule as overall.basis: condition-only
 * and not-applicable skills are left out. Derived from the skills so results stored before
 * comp-calc-v3 (whose group skillCount still included not-applicable skills) read the same.
 */
export function groupEvidenceCounts(skills: readonly Pick<SkillResult, "groupKey" | "conditionOnly" | "status">[], groupKey: string): { withEvidence: number; total: number } {
  const counted = skills.filter((skill) => skill.groupKey === groupKey && !skill.conditionOnly && skill.status !== "not_applicable");
  return { withEvidence: counted.filter((skill) => skill.status === "scored" || skill.status === "exempt_only").length, total: counted.length };
}

export type SkillBucket = { id: string; title: string; note: string | null; skills: SkillResult[] };
/**
 * Groups for the skill list: one per engine group (scored or exempt skills),
 * then condition-only skills, skills outside the student's choices and, last,
 * "Chưa có minh chứng" — never presented as weaknesses.
 */
export function bucketSkills(result: Pick<AssessmentResult, "groups">, skills: readonly SkillResult[]): SkillBucket[] {
  const buckets: SkillBucket[] = result.groups.map((group) => ({ id: group.key, title: group.name, note: null, skills: [] }));
  const condition: SkillBucket = { id: "condition", title: "Môn điều kiện (GDTC/GDQP)", note: "Không tính vào điểm nhóm và điểm tổng.", skills: [] };
  const notApplicable: SkillBucket = { id: "not-applicable", title: "Ngoài lựa chọn học phần của bạn", note: "Chỉ có trong học phần của chuyên ngành khác hoặc nhóm tự chọn bạn không chọn.", skills: [] };
  const noEvidence: SkillBucket = { id: "no-evidence", title: "Chưa có minh chứng", note: "Không phải điểm yếu — bạn chưa học học phần nào đo kỹ năng này.", skills: [] };
  for (const skill of skills) {
    if (skill.status === "not_applicable") notApplicable.skills.push(skill);
    else if (skill.status === "no_evidence") noEvidence.skills.push(skill);
    else if (skill.conditionOnly) condition.skills.push(skill);
    else (buckets.find((bucket) => bucket.id === skill.groupKey) ?? noEvidence).skills.push(skill);
  }
  return [...buckets, condition, notApplicable, noEvidence].filter((bucket) => bucket.skills.length > 0);
}

/* --------------------------------------------------------------------- AI */

/** Only these statuses change on their own, so only they are polled. */
export const shouldPoll = (status: AiStatus | null | undefined) => status === "queued" || status === "processing";

/** POST /:id/ai is offered for these states (disabled only once AI is switched on). */
export function canRegenerate(status: AiStatus, aiEnabled: boolean): boolean {
  return status === "failed" || status === "cancelled" || status === "deferred" || (status === "disabled" && aiEnabled);
}

export function aiStateCopy(status: AiStatus, workerOnline: boolean, aiEnabled: boolean): { title: string; text: string } {
  switch (status) {
    case "disabled": return aiEnabled
      ? { title: "Chưa có nhận xét cho lần đánh giá này", text: "Nhận xét AI vừa được bật. Bạn có thể tạo nhận xét cho kết quả hiện tại." }
      : { title: "Nhận xét AI chưa được bật", text: "Kết quả bên dưới do hệ thống tính và đã đầy đủ. Khi máy AI của nhóm phát triển hoạt động, bạn có thể nhận thêm lời nhận xét." };
    case "deferred": return { title: "Hàng đợi AI đang đầy", text: "Kết quả tính toán đã sẵn sàng. Bấm tạo nhận xét sau ít phút để xếp hàng lại." };
    case "queued": return workerOnline
      ? { title: "Đang xếp hàng tạo nhận xét", text: "Nhận xét thường mất vài phút. Bạn có thể xem kết quả bên dưới trong lúc chờ." }
      : { title: "Đang chờ máy AI kết nối", text: "Yêu cầu đã được giữ trong hàng đợi và sẽ được xử lý khi máy AI kết nối lại." };
    case "processing": return { title: "EduPath AI đang phân tích kết quả", text: "Mô hình đang đọc kết quả đã tính và viết nhận xét cho bạn. Bạn có thể rời trang và quay lại sau." };
    case "failed": return { title: "Chưa tạo được nhận xét", text: "Kết quả tính toán không bị ảnh hưởng." };
    case "cancelled": return { title: "Đã hủy tạo nhận xét", text: "Bạn có thể tạo lại nhận xét bất cứ lúc nào." };
    default: return { title: "Nhận xét từ EduPath AI", text: "" };
  }
}

/** "gemma4:e4b" → "Gemma 4 E4B". */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return "Gemma 4 E4B";
  const match = /^gemma(\d+):e(\d+)b/i.exec(model);
  return match ? `Gemma ${match[1]} E${match[2]}B` : model;
}

export type MappedAiOutput = {
  summary: string;
  groupInsights: { key: string; name: string; comment: string }[];
  strengths: { key: string; name: string; comment: string }[];
  improvements: { key: string; name: string; priority: AiPriority; comment: string }[];
  careerFit: string;
  gaps: { key: string; name: string; priority: AiPriority; explanation: string; courses: { code: string; name: string; reason: string }[]; selfStudy: string[] }[];
  progress: string;
  nextSteps: string[];
};

const plain = (value: unknown) => typeof value === "string" ? value.trim() : "";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEY_PATTERN = /(?<![\p{L}\p{N}])[SG]\d{1,3}(?![\p{L}\p{N}])/gu;
const KEY_SEP = "(?:\\s*[-–—:,/]\\s*|\\s+)";
const KEY_OPEN = "[(\\[]";
const KEY_CLOSE = "[)\\]]";
/**
 * Removes internal keys (S01…, G1…) from AI prose. Same rules as the server cleanup
 * (apps/api/src/competency-assessment/ai/key-cleanup.ts), kept here as a safety net for
 * outputs stored before comp-v3: a key next to its own name is dropped with its separator
 * ("API (S12)" → "API", "(API - S12)" → "(API)", "S12 - API" → "API"), a bracketed key
 * elsewhere is dropped and a bare key elsewhere becomes the name.
 */
export function cleanKeyText(text: string, names: ReadonlyMap<string, string>): string {
  let out = text;
  const keys = [...new Set(out.match(KEY_PATTERN) ?? [])].filter((key) => names.has(key));
  if (!keys.length) return text;
  for (const key of keys) {
    const name = names.get(key)!.trim();
    const k = `(?<![\\p{L}\\p{N}])${key}(?![\\p{L}\\p{N}])`;
    if (name) {
      const n = `((?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}]))`;
      const rules = [
        `${n}\\s*${KEY_OPEN}\\s*${k}\\s*${KEY_CLOSE}`,
        `${n}${KEY_SEP}${k}`,
        `${KEY_OPEN}\\s*${k}\\s*${KEY_CLOSE}\\s*${n}`,
        `${k}\\s*${KEY_OPEN}\\s*${n}\\s*${KEY_CLOSE}`,
        `${k}${KEY_SEP}${n}`,
      ];
      for (const rule of rules) out = out.replace(new RegExp(rule, "giu"), "$1");
    }
    out = out.replace(new RegExp(`\\s*${KEY_OPEN}\\s*${k}\\s*${KEY_CLOSE}`, "gu"), "");
    if (name) out = out.replace(new RegExp(k, "gu"), name);
  }
  return out.replace(/ {2,}/g, " ").replace(/\s+([.,;:!?)])/g, "$1").trim();
}
const list = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const priority = (value: unknown): AiPriority => value === "high" || value === "low" ? value : "medium";

/**
 * Maps the model's keys to real names and drops whatever cannot be mapped:
 * unknown skill or group keys, and courses that are not candidates of the
 * engine (the server validates too; this keeps the page safe on its own).
 */
export function mapAiOutput(output: AiOutput | null | undefined, result: AssessmentResult): MappedAiOutput | null {
  if (!output || typeof output !== "object") return null;
  const skills = new Map(result.skillDirectory.map((skill) => [skill.key, skill.name]));
  const groups = new Map(result.groups.map((group) => [group.key, group.name]));
  // The model sometimes writes internal keys in prose ("Kiểm thử (S03)", "(API - S12)", "kỹ năng S03").
  const names = new Map<string, string>([...skills, ...groups]);
  const text = (value: unknown) => cleanKeyText(plain(value), names);
  // A skill below a career threshold (or not studied) is never shown as a strength.
  const careerGap = new Set((result.career?.requirements ?? []).filter((req) => req.skillKey && (req.status === "below" || req.status === "not_studied")).map((req) => req.skillKey!));
  const weak = new Set([...list<{ skillKey?: unknown }>(output.improvements), ...list<{ skillKey?: unknown }>(output.gaps)].map((item) => item?.skillKey));
  const courses = new Map(result.courses.map((course) => [course.code, course.name]));
  for (const course of result.courseSuggestions) courses.set(course.code, course.name);
  const mapped: MappedAiOutput = {
    summary: text(output.summary),
    groupInsights: list<AiOutput["groupInsights"][number]>(output.groupInsights)
      .filter((item) => groups.has(item?.groupKey) && text(item.comment))
      .map((item) => ({ key: item.groupKey, name: groups.get(item.groupKey)!, comment: text(item.comment) })),
    strengths: list<AiOutput["strengths"][number]>(output.strengths)
      .filter((item) => skills.has(item?.skillKey) && text(item.comment) && !weak.has(item.skillKey) && !careerGap.has(item.skillKey))
      .map((item) => ({ key: item.skillKey, name: skills.get(item.skillKey)!, comment: text(item.comment) })),
    improvements: list<AiOutput["improvements"][number]>(output.improvements)
      .filter((item) => skills.has(item?.skillKey) && text(item.comment))
      .map((item) => ({ key: item.skillKey, name: skills.get(item.skillKey)!, priority: priority(item.priority), comment: text(item.comment) })),
    careerFit: text(output.careerFit?.comment),
    gaps: list<AiOutput["gaps"][number]>(output.gaps)
      .filter((item) => skills.has(item?.skillKey))
      .map((item) => ({
        key: item.skillKey, name: skills.get(item.skillKey)!, priority: priority(item.priority), explanation: text(item.explanation),
        courses: list<{ courseCode: string; reason: string }>(item.courses).filter((course) => courses.has(course?.courseCode))
          .map((course) => ({ code: course.courseCode, name: courses.get(course.courseCode)!, reason: text(course.reason) })),
        selfStudy: list<unknown>(item.selfStudy).map(text).filter(Boolean),
      }))
      .filter((item) => item.explanation || item.courses.length || item.selfStudy.length),
    progress: text(output.progress),
    nextSteps: list<unknown>(output.nextSteps).map(text).filter(Boolean),
  };
  return mapped;
}

/* ---------------------------------------------------------------- helpers */

export function skillName(result: Pick<AssessmentResult, "skillDirectory">, key: string): string | null {
  return result.skillDirectory.find((skill) => skill.key === key)?.name ?? null;
}

/** "Cập nhật lúc … · dữ liệu đã dùng …" for the page header. */
export function dataUsedLine(assessment: Pick<StoredAssessment, "createdAt" | "result">): string {
  const { meta, transcript } = assessment.result;
  const parts = [
    `Cập nhật lúc ${formatDateTime(assessment.createdAt)}`,
    `khóa ${meta.cohortCode}`,
    `CTĐT phiên bản ${meta.curriculum.version}`,
    `trọng số kỹ năng phiên bản ${meta.weights.version}`,
    `bảng điểm ${transcript.courseCount.toLocaleString("vi-VN")} học phần${transcript.latestTerm ? ` đến ${transcript.latestTerm}` : ""}`,
  ];
  return parts.join(" · ");
}
