// Pure helpers for the #graduation page: number and date formatting, labels, the verdict
// headline, the condition lists, the deterministic suggestions, the course views and the AI
// advice state. The verdict itself comes from the server (GET /api/student/graduation); nothing
// here recomputes it. No fetch, no DOM — everything here is unit tested.
import { specialtyLabel } from "./competency-assessment-types";
import { searchTerm } from "./student-curriculum-types";
import type {
  AdviceOutput, AdviceStatus, GradCourseState, GradStatus, GraduationAdviceResponse, GraduationAdviceStatusResponse,
  GraduationCourseRow, GraduationEvaluation, GraduationGroupEvaluation, StoredAdvice, StudentGraduationResponse,
  StudentGraduationStandard,
} from "./student-graduation-types";

export const GRADUATION_API = "/api/student/graduation";
export const ADVICE_API = "/api/student/graduation/advice";
/** How often GET /advice/status is asked while an advice is queued or being written. */
export const ADVICE_POLL_MS = 2500;
/** Courses listed inline under a suggestion; the rest sit behind "Xem thêm". */
export const INLINE_COURSES = 8;

/* ------------------------------------------------------------- formatting */

const decimal = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const twoDecimals = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Credits, course counts and scores: vi-VN, at most 2 decimals, whole numbers without decimals. */
export const formatNumber = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : decimal.format(value);

/** A GPA with 2 decimals, rounded half up like the AI prompt (formatNumber in competency-assessment/ai/prompt.ts). */
export const formatGpa = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : twoDecimals.format(Math.round(value * 100) / 100);

/**
 * The GPA to show for a condition: rounded like the AI prompt, except that a failing GPA whose
 * rounding would reach the requirement (1,996 for 2,00) is rounded down instead (1,99).
 */
export function shownGpa(actual: number, required: number | null, status: GradStatus): number {
  const rounded = Math.round(actual * 100) / 100;
  return status === "fail" && required !== null && rounded >= required ? Math.floor(actual * 100 + 1e-9) / 100 : rounded;
}

/** A GPA shortfall rounded UP to 2 decimals, the rule of the AI prompt (a 1e-9 tolerance absorbs float noise). */
export const gpaShortfall = (remaining: number): number => Math.ceil(remaining * 100 - 1e-9) / 100;
export const formatGpaShortfall = (remaining: number): string => twoDecimals.format(gpaShortfall(remaining));

const validDate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};
/** dd/mm/yyyy in Vietnam time. */
export function formatDate(iso: string | null | undefined): string {
  const date = validDate(iso);
  return date ? date.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}
/** hh:mm dd/mm/yyyy in Vietnam time. */
export function formatDateTime(iso: string | null | undefined): string {
  const date = validDate(iso);
  return date ? date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}
/** mm:ss since `since`; never negative when the clocks of server and browser differ. */
export function formatElapsed(since: string | null | undefined, now: number): string {
  const start = validDate(since)?.getTime();
  const seconds = start === undefined ? 0 : Math.max(0, Math.floor((now - start) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
/** "HK253" → "học kỳ 3 năm học 2025–2026"; other shapes are shown as they are. */
export function termText(term: string | null | undefined): string | null {
  if (!term) return null;
  const match = /^HK(\d{2})([1-3])$/.exec(term.trim());
  if (!match) return term;
  const start = 2000 + Number(match[1]);
  return `học kỳ ${match[2]} năm học ${start}–${start + 1}`;
}
/** "gemma4:e4b" → "Gemma 4 E4B". */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return "Gemma 4 E4B";
  const match = /^gemma(\d+):e(\d+)b/i.exec(model);
  return match ? `Gemma ${match[1]} E${match[2]}B` : model;
}
/** "A", "A và B", "A, B và C". */
export function joinVi(parts: readonly string[]): string {
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} và ${parts[parts.length - 1]}`;
}

/* ----------------------------------------------------------------- labels */

export type Tone = "pass" | "fail" | "unknown" | "info" | "neutral";
/** Class of a tone: the shared sg-status-* colours for pass/fail/unknown, page tones otherwise. */
export const toneClass = (tone: Tone): string => tone === "info" ? "sg-tone-info" : tone === "neutral" ? "sg-tone-neutral" : `sg-status-${tone}`;

export const STATUS_DISPLAY: Record<GradStatus, { glyph: string; label: string; tone: Tone }> = {
  pass: { glyph: "✓", label: "Đạt", tone: "pass" },
  fail: { glyph: "✗", label: "Chưa đạt", tone: "fail" },
  unknown: { glyph: "?", label: "Chưa xác định", tone: "unknown" },
};

export const COURSE_STATES: Record<GradCourseState, { glyph: string; label: string; tone: Tone }> = {
  passed: { glyph: "✓", label: "Đã đạt", tone: "pass" },
  exempt: { glyph: "✓", label: "Miễn thi (MT)", tone: "pass" },
  failed: { glyph: "✗", label: "Chưa đạt", tone: "fail" },
  in_progress: { glyph: "◐", label: "Đang học", tone: "info" },
  graded_unknown: { glyph: "?", label: "Chưa rõ kết quả", tone: "unknown" },
  not_taken: { glyph: "○", label: "Chưa học", tone: "neutral" },
};

export const isPassedState = (state: GradCourseState) => state === "passed" || state === "exempt";

/** "Chưa đạt (đã học 2 lần)" for repeated failures, otherwise the state label. */
export function courseStateText(row: Pick<GraduationCourseRow, "state" | "attempts">): string {
  const label = COURSE_STATES[row.state].label;
  return row.state === "failed" && row.attempts > 1 ? `${label} (đã học ${row.attempts} lần)` : label;
}

/** "Nhóm tự chọn TC306 (CTĐT: TC406)": the label plus the CTĐT elective code when it is not the group's own code. */
export function groupTitle(group: Pick<GraduationGroupEvaluation, "label" | "code" | "curriculumElectiveCode">): string {
  const curriculum = group.curriculumElectiveCode?.trim();
  return curriculum && curriculum.toUpperCase() !== group.code?.toUpperCase() ? `${group.label} (CTĐT: ${curriculum})` : group.label;
}

/** Text continued after a colon or inside a sentence: the first letter in lower case, unless it starts with an acronym ("PDF …", "TC306 …"). */
export function lowerFirst(text: string): string {
  const value = text.normalize("NFC").trim();
  const first = value.split(/\s/, 1)[0] ?? "";
  return first.length > 1 && first === first.toUpperCase() ? value : value.charAt(0).toLowerCase() + value.slice(1);
}

/** A group name inside a sentence: "Nhóm bắt buộc" → "nhóm bắt buộc", "Học phần bắt buộc" → "nhóm học phần bắt buộc". */
export function groupInSentence(title: string): string {
  const text = title.normalize("NFC").trim();
  return /^nhóm\s/i.test(text) ? `nhóm${text.slice(4)}` : `nhóm ${lowerFirst(text)}`;
}

const unitWord = (unit: "môn" | "TC") => unit === "TC" ? "tín chỉ" : "môn";

/**
 * Display label per group of a standard without an evaluation: the server's rule (E1) — a
 * repeated name adds its course count and first course code in standard order.
 */
export function standardGroupLabels(standard: Pick<StudentGraduationStandard, "groups" | "courses">): Map<string, string> {
  const names = new Map<string, number>();
  for (const group of standard.groups) names.set(group.name.trim(), (names.get(group.name.trim()) ?? 0) + 1);
  return new Map(standard.groups.map((group) => {
    if ((names.get(group.name.trim()) ?? 0) < 2) return [group.id, group.name];
    const codes = standard.courses.filter((course) => course.groupId === group.id).map((course) => course.code.trim().toUpperCase());
    return [group.id, `${group.name} · ${codes.length} học phần${codes[0] ? `, gồm ${codes[0]}` : ""}`];
  }));
}

/* ------------------------------------------------------- standard section */

export type Threshold = { key: string; label: string; value: string; known: boolean };
/** The five thresholds of the standard, in the order of the official form. */
export function standardThresholds(standard: StudentGraduationStandard): Threshold[] {
  const credits = (key: "minimumCredits" | "mandatoryCredits" | "electiveCredits" | "freeElectiveCredits", label: string): Threshold => ({
    key, label, value: standard[key] === null ? "Chưa xác định" : formatNumber(standard[key]), known: standard[key] !== null,
  });
  return [
    credits("minimumCredits", "Tín chỉ tích lũy tối thiểu"),
    credits("mandatoryCredits", "Tín chỉ bắt buộc"),
    credits("electiveCredits", "Tín chỉ nhóm tự chọn"),
    credits("freeElectiveCredits", "Tín chỉ tự chọn tự do"),
    {
      key: "minimumGpa", label: "Điểm TB tích lũy tối thiểu", known: standard.minimumGpa !== null,
      value: standard.minimumGpa === null ? "Chưa xác định" : `${formatGpa(standard.minimumGpa)} / ${standard.gpaScale}`,
    },
  ];
}

/** "Khóa K29 · Chuyên ngành Công nghệ phần mềm". */
/** One tag under the standard's title: a muted label and the value in bold ("Khóa" + "K29"). */
export type MetaPart = { label: string | null; value: string };
const metaText = (parts: MetaPart[]) => parts.map((part) => (part.label ? `${part.label} ${part.value}` : part.value)).join(" · ");

/** Khóa K29 · Chuyên ngành Công nghệ phần mềm, as tags. The standard's version is not shown to students. */
export function standardMetaParts(data: Pick<StudentGraduationResponse, "profile" | "resolution" | "standard">): MetaPart[] {
  const standard = data.standard;
  if (!standard) return [];
  return [
    { label: "Khóa", value: data.profile.cohortCode ?? standard.cohortCode },
    data.resolution === "general" || !data.profile.specialty
      ? { label: null, value: "Tiêu chuẩn chung của khóa" }
      : { label: "Chuyên ngành", value: specialtyLabel(data.profile.specialty) },
  ];
}
export function standardMeta(data: Pick<StudentGraduationResponse, "profile" | "resolution" | "standard">): string {
  return metaText(standardMetaParts(data));
}

/** The student's own identity used to pick the standard: "Khóa trong tài khoản: K29 · Chuyên ngành trong hồ sơ: Chưa xác định". */
export function profileLineParts(profile: StudentGraduationResponse["profile"]): MetaPart[] {
  return [
    { label: "Khóa trong tài khoản:", value: profile.cohortCode ?? "chưa có" },
    { label: "Chuyên ngành trong hồ sơ:", value: specialtyLabel(profile.specialty) },
  ];
}
export function profileLine(profile: StudentGraduationResponse["profile"]): string {
  return metaText(profileLineParts(profile));
}

export type UnresolvedCopy = { title: string; text: string; suggestion: string | null; action: { label: string; href: string } | null };
/** What to say when no standard could be picked for the student (no other cohort is ever shown). */
export function unresolvedCopy(data: Pick<StudentGraduationResponse, "profile" | "resolution" | "specialtySuggestion">): UnresolvedCopy {
  const cohort = data.profile.cohortCode;
  const specialty = data.profile.specialty ? specialtyLabel(data.profile.specialty) : null;
  switch (data.resolution) {
    case "cohort_unknown":
      return {
        title: "Hồ sơ chưa có khóa học",
        text: "Tiêu chuẩn xét tốt nghiệp được chọn theo khóa trong tài khoản của bạn. Thông tin khóa được đồng bộ từ tài khoản trường; nếu mục Khóa học trong hồ sơ còn trống, hãy liên hệ Khoa để được cập nhật.",
        suggestion: null, action: { label: "Xem hồ sơ", href: "#profile" },
      };
    case "specialty_unset": {
      const hint = data.specialtySuggestion;
      return {
        title: "Hãy chọn chuyên ngành trong hồ sơ",
        text: `Khóa ${cohort ?? "của bạn"} có tiêu chuẩn xét tốt nghiệp riêng cho từng chuyên ngành. Hãy cập nhật chuyên ngành trong hồ sơ để xem đúng tiêu chuẩn của bạn.`,
        suggestion: hint ? `Gợi ý: ${hint.label} — bạn đã đạt ${formatNumber(hint.count)} học phần bắt buộc của chuyên ngành này.` : null,
        action: { label: "Cập nhật chuyên ngành", href: "#profile" },
      };
    }
    case "ambiguous":
      return {
        title: "Có nhiều tiêu chuẩn cùng phù hợp với bạn",
        text: `Khóa ${cohort ?? "của bạn"}${specialty ? `, chuyên ngành ${specialty},` : ""} đang có hơn một tiêu chuẩn xét tốt nghiệp phù hợp nên hệ thống chưa chọn được bản đúng. Khoa sẽ rà soát lại; bạn chưa cần làm gì thêm.`,
        suggestion: null, action: null,
      };
    default:
      return specialty
        ? {
          title: `Chưa có tiêu chuẩn xét tốt nghiệp cho khóa ${cohort ?? "của bạn"}`,
          text: `Khoa chưa công bố tiêu chuẩn xét tốt nghiệp đang áp dụng cho khóa ${cohort ?? "của bạn"}, chuyên ngành ${specialty}. Hãy quay lại sau, hoặc kiểm tra lại chuyên ngành trong hồ sơ nếu chưa đúng.`,
          suggestion: null, action: { label: "Kiểm tra chuyên ngành", href: "#profile" },
        }
        : {
          title: `Chưa có tiêu chuẩn xét tốt nghiệp cho khóa ${cohort ?? "của bạn"}`,
          text: `Khoa chưa công bố tiêu chuẩn xét tốt nghiệp đang áp dụng cho khóa ${cohort ?? "của bạn"}. Bạn có thể quay lại sau khi tiêu chuẩn được cập nhật.`,
          suggestion: null, action: null,
        };
  }
}

/* --------------------------------------------------------- result section */

/** "Bảng điểm cập nhật ngày 01/10/2026 · học kỳ có kết quả gần nhất: học kỳ 3 năm học 2025–2026". */
export function asOfLine(evaluation: Pick<GraduationEvaluation, "asOf">): string {
  const term = termText(evaluation.asOf.latestTerm);
  return `Bảng điểm cập nhật ngày ${formatDate(evaluation.asOf.transcriptUpdatedAt)} · ${term ? `học kỳ có kết quả gần nhất: ${term}` : "chưa có học kỳ nào có kết quả"}`;
}

export type ConditionItem = {
  key: string;
  kind: "group" | "credits" | "gpa";
  status: GradStatus;
  title: string;
  /** "đã đạt 38/40 môn", "đã tích lũy 126/138 TC", "hiện 1,87, yêu cầu tối thiểu 2,00". */
  progress: string;
  /** Failing only: "còn thiếu 2 môn". */
  shortfall: string | null;
  /** Unknown only: why the condition cannot be decided yet. */
  note: string | null;
  /** Failing only: the part of the headline, "2 môn thuộc nhóm bắt buộc". */
  deficit: string | null;
  /** Unknown only: the part of the unknown headline, "kết quả nhóm bắt buộc". */
  undecided: string | null;
};

function groupCondition(group: GraduationGroupEvaluation): ConditionItem {
  const title = groupTitle(group);
  const { lower, upper, required, unit, remaining, status } = group;
  const progress = lower === null ? `chưa tính được số ${unitWord(unit)} đã đạt`
    : required === null ? `đã đạt ${formatNumber(lower)} ${unit}; tiêu chuẩn chưa ghi số ${unitWord(unit)} yêu cầu`
      : `đã đạt ${formatNumber(lower)}/${formatNumber(required)} ${unit}`;
  const missing = status === "fail" && remaining !== null && remaining > 0 ? remaining : null;
  const note = status !== "unknown" ? null
    : required === null ? "tiêu chuẩn chưa ghi số tín chỉ yêu cầu của nhóm"
      : lower === null ? "có học phần chưa rõ số tín chỉ"
        : group.courseCount === 0 ? "nhóm chưa có học phần trong tiêu chuẩn"
          : upper !== null && upper > lower ? `${formatNumber(upper - lower)} ${unit} có điểm nhưng chưa rõ kết quả`
            : "tiêu chuẩn có mã học phần trùng hoặc thiếu nên chưa đối chiếu được";
  return {
    key: group.id, kind: "group", status, title, progress, note,
    shortfall: missing === null ? null : `còn thiếu ${formatNumber(missing)} ${unit}`,
    deficit: status !== "fail" ? null
      : `${missing === null ? "" : `${formatNumber(missing)} `}${unitWord(unit)} thuộc ${groupInSentence(title)}`,
    undecided: status === "unknown" ? `kết quả ${groupInSentence(title)}` : null,
  };
}

function creditsCondition(credits: NonNullable<GraduationEvaluation["credits"]>): ConditionItem {
  const { lower, upper, required, status, remaining } = credits;
  const extra = lower !== null && upper !== null && upper > lower ? `, thêm ${formatNumber(upper - lower)} TC chưa rõ kết quả` : "";
  const progress = lower === null ? "chưa tính được số tín chỉ đã tích lũy"
    : `đã tích lũy ${formatNumber(lower)}/${formatNumber(required)} TC${credits.source === "calculated" ? " (ước tính)" : ""}${extra}`;
  const missing = status === "fail" && remaining !== null && remaining > 0 ? remaining : null;
  return {
    key: "credits", kind: "credits", status, title: "Tổng số tín chỉ tích lũy", progress,
    shortfall: missing === null ? null : `còn thiếu ${formatNumber(missing)} TC`,
    note: status === "unknown" ? (extra ? "một số học phần có điểm nhưng chưa rõ kết quả" : "chưa xác định được tổng số tín chỉ tích lũy") : null,
    deficit: status === "fail" ? `${missing === null ? "" : `${formatNumber(missing)} `}tín chỉ tích lũy` : null,
    undecided: status === "unknown" ? "tổng số tín chỉ tích lũy" : null,
  };
}

function gpaCondition(gpa: GraduationEvaluation["gpa"]): ConditionItem {
  const { actual, required, status, remaining, scale } = gpa;
  // The server's reason is a sentence; it reads as the continuation of "Điểm trung bình tích lũy: …".
  const reason = gpa.reason.trim() ? lowerFirst(gpa.reason) : "";
  const progress = actual === null ? (status === "unknown" && reason ? reason : "chưa có điểm trung bình tích lũy")
    : `hiện ${formatGpa(shownGpa(actual, required, status))}${required === null ? "" : `, yêu cầu tối thiểu ${formatGpa(required)}`}${gpa.source === "calculated" ? " (tính tham khảo)" : ""}`;
  const missing = status === "fail" && remaining !== null && remaining > 0 ? remaining : null;
  return {
    key: "gpa", kind: "gpa", status, title: `Điểm trung bình tích lũy (hệ ${scale})`, progress,
    shortfall: missing === null ? null : `còn thiếu ${formatGpaShortfall(missing)} điểm`,
    note: status === "unknown" && actual !== null ? reason || "chưa xác định được điểm trung bình tích lũy" : null,
    deficit: status === "fail" ? `${missing === null ? "" : `${formatGpaShortfall(missing)} `}điểm trung bình tích lũy` : null,
    undecided: status === "unknown" ? "điểm trung bình tích lũy" : null,
  };
}

/**
 * Every graduation condition in a fixed order, the same on the graduation page and on the
 * competency page: the standard's groups, the GPA, then the total credits last.
 */
export function conditionItems(evaluation: Pick<GraduationEvaluation, "groups" | "credits" | "gpa">): ConditionItem[] {
  return [
    ...evaluation.groups.map(groupCondition),
    gpaCondition(evaluation.gpa),
    ...(evaluation.credits ? [creditsCondition(evaluation.credits)] : []),
  ];
}

/**
 * Credits the failing groups still need, counted toward the accumulated total: an elective group its
 * missing credits (0 for a group of condition-only (*) courses), a mandatory group the credits of its
 * courses not passed yet. Null when a group's share cannot be told (unknown credits, mixed (*) group).
 */
export function failingGroupCredits(evaluation: Pick<GraduationEvaluation, "groups">): number | null {
  let total = 0;
  for (const group of evaluation.groups) {
    if (group.status !== "fail") continue;
    if (group.kind === "elective") {
      const condition = group.courses.filter((course) => course.conditionOnly).length;
      if (condition && condition === group.courses.length) continue;
      if (condition || group.remaining === null) return null;
      total += group.remaining;
    } else {
      for (const course of group.courses) {
        if (isPassedState(course.state) || course.conditionOnly) continue;
        if (course.credits === null) return null;
        total += course.credits;
      }
    }
  }
  return total;
}

/** The total-credit shortfall is fully explained by the failing groups: finishing them also completes the total. */
function creditsCoveredByGroups(evaluation: Pick<GraduationEvaluation, "groups" | "credits">): boolean {
  const credits = evaluation.credits;
  if (credits?.status !== "fail" || credits.remaining === null || credits.remaining <= 0) return false;
  const groups = failingGroupCredits(evaluation);
  return groups !== null && groups > 0 && groups + 1e-9 >= credits.remaining;
}

export type Verdict = { tone: Tone; glyph: string; text: string };
/**
 * The banner, the same sentence on the graduation page and on the competency page: pass, every
 * failing part with its shortfall (a total-credit shortfall the failing groups already explain is
 * said once, after them), or what is still undecided.
 */
export function verdictHeadline(evaluation: Pick<GraduationEvaluation, "status" | "groups" | "credits" | "gpa">): Verdict {
  const items = conditionItems(evaluation);
  if (evaluation.status === "pass") {
    return { tone: "pass", glyph: "✓", text: "Bạn đã đủ các điều kiện xét tốt nghiệp theo tiêu chuẩn của khóa (tham khảo)." };
  }
  if (evaluation.status === "fail") {
    const covered = creditsCoveredByGroups(evaluation);
    const parts = items.filter((item) => item.status === "fail" && item.deficit && !(covered && item.kind === "credits")).map((item) => item.deficit!);
    const credits = evaluation.credits;
    const failingGroups = evaluation.groups.filter((group) => group.status === "fail");
    const total = covered && credits
      ? ` Tổng số tín chỉ tích lũy (${formatNumber(credits.lower)}/${formatNumber(credits.required)}) cũng sẽ đủ khi bạn hoàn thành ${failingGroups.length === 1 ? groupInSentence(groupTitle(failingGroups[0]!)) : "các nhóm trên"}.`
      : "";
    return {
      tone: "fail", glyph: "✗",
      text: parts.length ? `Hiện tại bạn chưa đủ điều kiện xét tốt nghiệp vì còn thiếu ${joinVi(parts)}.${total}` : "Hiện tại bạn chưa đủ điều kiện xét tốt nghiệp theo bảng điểm hiện tại.",
    };
  }
  const parts = items.filter((item) => item.status === "unknown" && item.undecided).map((item) => item.undecided!);
  return {
    tone: "unknown", glyph: "?",
    text: parts.length ? `Chưa đủ dữ liệu để kết luận vì chưa xác định được ${joinVi(parts)}.` : "Chưa đủ dữ liệu để kết luận điều kiện xét tốt nghiệp.",
  };
}

export type CriteriaRow = { key: string; title: string; actual: string; required: string; status: GradStatus; note: string | null };
const range = (lower: number | null, upper: number | null) =>
  lower === null ? "—" : upper !== null && upper > lower ? `${formatNumber(lower)}–${formatNumber(upper)}` : formatNumber(lower);
/** The criteria table of the competency page: the same conditions, order and numbers as conditionItems. */
export function criteriaRows(evaluation: Pick<GraduationEvaluation, "groups" | "credits" | "gpa">): CriteriaRow[] {
  const { gpa, credits } = evaluation;
  return [
    ...evaluation.groups.map((group) => ({
      key: group.id, title: groupTitle(group), status: group.status, note: null,
      actual: group.lower === null ? "—" : `${range(group.lower, group.upper)} ${group.unit}`,
      required: group.required === null ? "—" : `${formatNumber(group.required)} ${group.unit}`,
    })),
    {
      key: "gpa", title: `Điểm trung bình tích lũy (hệ ${gpa.scale})`, status: gpa.status,
      actual: gpa.actual === null ? "—" : formatGpa(shownGpa(gpa.actual, gpa.required, gpa.status)),
      required: gpa.required === null ? "—" : formatGpa(gpa.required),
      note: gpa.source === "calculated" ? "tính tham khảo từ điểm các học phần" : null,
    },
    ...(credits ? [{
      key: "credits", title: "Tổng số tín chỉ tích lũy", status: credits.status,
      actual: `${range(credits.lower, credits.upper)} TC`, required: `${formatNumber(credits.required)} TC`,
      note: credits.source === "calculated" ? "ước tính, không tính môn điều kiện" : null,
    }] : []),
  ];
}

/**
 * The graduation standard written out in full, as the document the student is checked against:
 * "Tiêu chuẩn xét tốt nghiệp <tên> — khóa K29, ngành Công nghệ thông tin, chuyên ngành …". The version is
 * not shown to students.
 */
export function standardDocumentName(standard: Pick<StudentGraduationStandard, "name" | "cohortCode" | "major" | "specialty">): string {
  const facts = [
    `khóa ${standard.cohortCode}`,
    standard.major.trim() ? `ngành ${standard.major.trim()}` : null,
    standard.specialty.trim() ? `chuyên ngành ${standard.specialty.trim()}` : null,
  ].filter(Boolean);
  const name = standard.name.trim();
  return `${/^tieu chuan xet tot nghiep\b/.test(foldName(name)) ? name : `Tiêu chuẩn xét tốt nghiệp ${name}`} — ${facts.join(", ")}`;
}

export type SuggestionCourse = { key: string; code: string; name: string; credits: number | null; glyph: string; state: string; tone: Tone; detail: string | null };
export type SuggestionItem = {
  key: string;
  text: string;
  /** Lead of the course list when the text does not end with one ("Các học phần chưa đạt trong nhóm:"). */
  coursesLabel: string | null;
  courses: SuggestionCourse[];
  note: string | null;
  /** A second, fallback path with its own course list (the thesis group's replacement courses). */
  alternative?: { label: string; courses: SuggestionCourse[] } | null;
};

const suggestionCourse = (row: GraduationCourseRow, index: number): SuggestionCourse => ({
  key: `${row.code}:${index}`, code: row.code, name: row.name, credits: row.credits,
  glyph: COURSE_STATES[row.state].glyph, state: courseStateText(row), tone: COURSE_STATES[row.state].tone, detail: null,
});

/* ------------------------------------------------------------ thesis group */

/** Course names compared without accents, case or extra spaces ("Đồ án Tốt nghiệp" → "do an tot nghiep"). */
const foldName = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
  .toLowerCase().replace(/\s+/g, " ").trim();
const THESIS_NAME = /\b(do an|khoa luan) tot nghiep\b/;

export type ThesisOption = {
  /** The graduation thesis (Đồ án / Khóa luận tốt nghiệp) whose credits alone complete the group. */
  thesis: GraduationCourseRow;
  /** The group's other courses: the replacement path ("học phần thay thế KL/ĐA TN"). */
  replacements: GraduationCourseRow[];
  /** not_started: nothing taken yet; replacement: a replacement course is passed, in progress or graded; thesis_in_progress. */
  path: "not_started" | "replacement" | "thesis_in_progress";
};

/**
 * The thesis rule, identical to the server's graduation advice prompt (apps/api/src/graduation/thesis.ts):
 * in a failing elective group, a course named "Đồ án/Khóa luận tốt nghiệp" whose credits reach the
 * group's requirement is the main path; the other courses are the fallback. Null for other groups.
 */
export function thesisOption(group: GraduationGroupEvaluation): ThesisOption | null {
  if (group.kind !== "elective" || group.status === "pass" || group.required === null) return null;
  const required = group.required;
  const thesis = group.courses.find((course) => THESIS_NAME.test(foldName(course.name)) && course.credits !== null && course.credits >= required);
  if (!thesis) return null;
  const replacements = group.courses.filter((course) => course !== thesis);
  const started = replacements.some((course) => startsReplacementPath(course.state));
  return { thesis, replacements, path: thesis.state === "in_progress" ? "thesis_in_progress" : started ? "replacement" : "not_started" };
}

/** A replacement course in this state puts the student on the replacement path; a failed attempt does not. */
const startsReplacementPath = (state: GradCourseState) => isPassedState(state) || state === "in_progress" || state === "graded_unknown";

/** "đồ án tốt nghiệp" or "khóa luận tốt nghiệp", as the course is named. */
const thesisKind = (thesis: Pick<GraduationCourseRow, "name">) => /khoa luan/.test(foldName(thesis.name)) ? "khóa luận tốt nghiệp" : "đồ án tốt nghiệp";

function thesisSuggestion(group: GraduationGroupEvaluation, option: ThesisOption): SuggestionItem {
  const title = groupInSentence(groupTitle(group));
  const { thesis, replacements, path } = option;
  const credits = thesis.credits === null ? "" : ` (${formatNumber(thesis.credits)} TC)`;
  const key = `group:${group.id}`;
  if (path === "thesis_in_progress") {
    return { key, text: `Hoàn thành ${thesis.name}${credits} bạn đang học: học phần này đủ số tín chỉ của ${title}.`, coursesLabel: null, courses: [suggestionCourse(thesis, 0)], note: null };
  }
  if (path === "replacement") {
    // Same arithmetic as the advice prompt: courses in progress or without a result count once they pass.
    const started = replacements.filter((course) => startsReplacementPath(course.state));
    const pending = started.filter((course) => !isPassedState(course.state));
    const pendingCredits = pending.every((course) => course.credits !== null) ? pending.reduce((sum, course) => sum + course.credits!, 0) : null;
    const need = !pending.length ? group.remaining : group.remaining === null || pendingCredits === null ? null : Math.max(0, group.remaining - pendingCredits);
    const rest = need !== null && need <= 0 ? [] : replacements.filter((course) => !startsReplacementPath(course.state));
    return {
      key,
      text: need !== null && need <= 0 && pending.length
        ? `Hoàn thành ${joinVi(pending.map((course) => course.name))} đang học là đủ số tín chỉ của ${title} theo phương án học phần thay thế ${thesisKind(thesis)}.`
        : need !== null && need > 0
          ? `Học thêm ít nhất ${formatNumber(need)} tín chỉ trong ${title} theo phương án học phần thay thế ${thesisKind(thesis)} mà bạn đã bắt đầu${pending.length ? ` (ngoài ${pending.length > 1 ? "các học phần" : "học phần"} đang học)` : ""}.`
          : `Hoàn thành ${title} theo phương án học phần thay thế ${thesisKind(thesis)} mà bạn đã bắt đầu.`,
      coursesLabel: rest.length ? "Học phần thay thế còn lại:" : null,
      courses: rest.map(suggestionCourse),
      note: `Bạn đã học theo phương án này: ${joinVi(started.map((course) => `${course.name} (${courseStateText(course).toLowerCase()})`))}.`,
    };
  }
  const open = replacements.filter((course) => !isPassedState(course.state));
  return {
    key,
    text: `Đăng ký ${thesis.name}${credits} để hoàn thành ${title}. Đây là phương án chính của chương trình: một học phần đủ ${formatNumber(group.required)} tín chỉ của nhóm.`,
    coursesLabel: null,
    courses: [suggestionCourse(thesis, 0)],
    note: `Chỉ chọn học phần thay thế khi bạn không làm ${thesisKind(thesis)} theo quy định của Khoa; hãy xác nhận điều kiện đăng ký với cố vấn học tập.`,
    alternative: open.length ? { label: `Phương án thay thế: chọn đủ ${formatNumber(group.remaining ?? group.required)} tín chỉ trong các học phần sau`, courses: open.map(suggestionCourse) } : null,
  };
}

/**
 * The deterministic "Đề xuất điều cần làm" (always shown, AI or not): per failing mandatory group
 * its missing courses, per failing elective group the credits to choose and its not-passed courses
 * (the thesis first when the group has one), the credit and GPA shortfalls (with retake candidates),
 * courses in progress and unread results.
 */
export function suggestionItems(evaluation: GraduationEvaluation): SuggestionItem[] {
  const items: SuggestionItem[] = [];
  for (const group of evaluation.groups) {
    if (group.status !== "fail") continue;
    const title = groupInSentence(groupTitle(group));
    const open = group.courses.filter((course) => !isPassedState(course.state)).map(suggestionCourse);
    const thesis = thesisOption(group);
    if (group.kind === "mandatory") {
      const count = group.remaining ?? open.length;
      items.push({ key: `group:${group.id}`, text: `Hoàn thành ${formatNumber(count)} môn còn thiếu trong ${title}:`, coursesLabel: null, courses: open, note: null });
    } else if (thesis) {
      items.push(thesisSuggestion(group, thesis));
    } else {
      items.push({
        key: `group:${group.id}`,
        text: group.remaining !== null && group.remaining > 0
          ? `Chọn học thêm ít nhất ${formatNumber(group.remaining)} tín chỉ trong ${title}.`
          : `Chọn học thêm học phần trong ${title} cho đủ số tín chỉ yêu cầu.`,
        coursesLabel: open.length ? "Các học phần bạn chưa đạt trong nhóm:" : null,
        courses: open,
        note: open.length ? "Chỉ cần đủ số tín chỉ của nhóm, không phải học hết các học phần." : "Nhóm không còn học phần nào khác trong tiêu chuẩn; hãy trao đổi với cố vấn học tập.",
      });
    }
  }
  const gpa = evaluation.gpa;
  if (gpa.status === "fail") {
    const target = gpa.required === null ? "" : ` để đạt ${formatGpa(gpa.required)}`;
    items.push({
      key: "gpa",
      text: gpa.remaining !== null && gpa.remaining > 0
        ? `Nâng điểm trung bình tích lũy (hệ ${gpa.scale}) thêm ít nhất ${formatGpaShortfall(gpa.remaining)} điểm${target}.`
        : `Nâng điểm trung bình tích lũy (hệ ${gpa.scale})${target}.`,
      coursesLabel: evaluation.improvementCandidates.length ? "Có thể đăng ký học cải thiện hoặc học lại các học phần điểm thấp:" : null,
      courses: evaluation.improvementCandidates.map((course, index) => ({
        key: `${course.code}:${index}`, code: course.code, name: course.name, credits: course.credits,
        glyph: course.state === "failed" ? "↻" : "↑",
        state: course.state === "failed" ? "Học lại" : "Học cải thiện", tone: course.state === "failed" ? "fail" : "info",
        detail: `điểm ${formatNumber(course.score)}/${course.scale}${course.letter ? ` (${course.letter})` : ""}`,
      })),
      note: evaluation.improvementCandidates.length
        ? "Ưu tiên học phần điểm thấp và nhiều tín chỉ; môn điều kiện (*) và MT không tính vào điểm trung bình."
        : "Hãy trao đổi với cố vấn học tập để chọn học phần học cải thiện.",
    });
  }
  const credits = evaluation.credits;
  if (credits?.status === "fail") {
    const groupCredits = failingGroupCredits(evaluation);
    const remaining = credits.remaining !== null && credits.remaining > 0 ? credits.remaining : null;
    items.push({
      key: "credits", coursesLabel: null, courses: [], note: null,
      text: remaining === null ? `Tích lũy đủ ${formatNumber(credits.required)} tín chỉ theo tiêu chuẩn.`
        : creditsCoveredByGroups(evaluation)
          ? `Tổng số tín chỉ tích lũy (hiện ${formatNumber(credits.lower)}/${formatNumber(credits.required)}) sẽ đủ khi bạn hoàn thành các việc ở trên; không cần học thêm học phần khác.`
          : groupCredits !== null && groupCredits > 0
            ? `Ngoài các nhóm ở trên, tích lũy thêm ít nhất ${formatNumber(remaining - groupCredits)} tín chỉ để đạt ${formatNumber(credits.required)} tín chỉ tích lũy.`
            : `Tích lũy thêm ít nhất ${formatNumber(remaining)} tín chỉ để đạt ${formatNumber(credits.required)} tín chỉ tích lũy.`,
    });
  }
  if (evaluation.inProgress.length) {
    items.push({
      key: "in-progress", text: `Hoàn thành ${formatNumber(evaluation.inProgress.length)} học phần đang học:`, coursesLabel: null,
      courses: evaluation.inProgress.map(suggestionCourse), note: null,
    });
  }
  if (evaluation.unknownResults.length) {
    items.push({
      key: "unknown-results", text: `Kiểm tra kết quả ${formatNumber(evaluation.unknownResults.length)} học phần có điểm nhưng chưa rõ Đạt/Chưa đạt:`,
      coursesLabel: null, courses: evaluation.unknownResults.map(suggestionCourse), note: "Đối chiếu với bảng điểm PDF gốc hoặc hỏi Phòng Đào tạo.",
    });
  }
  if (!items.length) {
    items.push({
      key: evaluation.status === "pass" ? "official" : "check", coursesLabel: null, courses: [], note: null,
      text: evaluation.status === "pass" ? "Theo dõi thông báo xét tốt nghiệp chính thức của nhà trường."
        : "Kiểm tra lại bảng điểm đã import và trao đổi với cố vấn học tập nếu cần.",
    });
  }
  return items;
}

/** Data warnings of the evaluation, as notes for the student. */
export function warningNotes(evaluation: Pick<GraduationEvaluation, "warnings">): { code: string; text: string }[] {
  return evaluation.warnings.map((warning) => {
    switch (warning.code) {
      case "results_inferred":
        return { code: warning.code, text: `${formatNumber(warning.count ?? 0)} học phần trong tiêu chuẩn có ô Kết quả trống trong PDF (chỉ có biểu tượng), nên Đạt/Chưa đạt được suy ra từ điểm chữ chính thức: A+ đến D là Đạt, F là Chưa đạt.` };
      case "credits_mismatch": {
        const lower = warning.computedLower ?? null, upper = warning.computedUpper ?? null;
        const range = lower === null ? "—" : upper !== null && upper !== lower ? `${formatNumber(lower)}–${formatNumber(upper)}` : formatNumber(lower);
        return { code: warning.code, text: `Tổng số tín chỉ tích lũy in trên bảng điểm là ${formatNumber(warning.printed ?? null)} TC, nhưng các học phần Đạt trong chương trình cộng lại được ${range} TC. Kết quả từng học phần có thể chưa chính xác; hãy đối chiếu với PDF gốc.` };
      }
      case "printed_credits_unreadable":
        return { code: warning.code, text: "Không đọc được dòng Tổng số tín chỉ tích lũy trong bảng điểm, nên số tín chỉ tích lũy là ước tính từ các học phần Đạt." };
      case "ocr_needs_review":
        return { code: warning.code, text: "Bảng điểm được đọc bằng nhận dạng ảnh (OCR) và còn chỗ cần kiểm tra. Hãy đối chiếu kết quả với PDF gốc." };
      case "standard_ambiguous_codes":
        return { code: warning.code, text: "Tiêu chuẩn có mã học phần trùng hoặc thiếu nên một số nhóm chưa đối chiếu được. Khoa sẽ rà soát lại tiêu chuẩn." };
      default:
        return { code: String(warning.code), text: "Dữ liệu bảng điểm có điểm cần kiểm tra lại." };
    }
  });
}

/** How the credits and the GPA were read, plus the group rules (the "Cách đối chiếu" note). */
export function methodNotes(evaluation: Pick<GraduationEvaluation, "credits" | "gpa">): string[] {
  const notes = [
    "Nhóm bắt buộc phải đạt tất cả học phần, kể cả môn điều kiện (*). Nhóm tự chọn chỉ cần đủ số tín chỉ yêu cầu, không phải học hết các học phần. Môn (*) giúp hoàn thành nhóm nhưng không cộng tín chỉ tích lũy. Học phần miễn thi (MT) được tính là đạt.",
  ];
  if (evaluation.credits?.source === "printed") notes.push("Số tín chỉ tích lũy lấy từ dòng Tổng số tín chỉ tích lũy của học kỳ có kết quả gần nhất trong bảng điểm.");
  if (evaluation.credits?.source === "calculated") notes.push("Số tín chỉ tích lũy là ước tính: cộng tín chỉ các học phần Đạt trong chương trình, mỗi mã học phần một lần, không tính môn điều kiện (*).");
  if (evaluation.gpa.source === "printed") notes.push(`Điểm trung bình lấy từ dòng điểm trung bình tích lũy hệ ${evaluation.gpa.scale} của học kỳ có kết quả gần nhất.`);
  if (evaluation.gpa.source === "calculated") notes.push(`Bảng điểm chưa có điểm trung bình tích lũy hệ ${evaluation.gpa.scale}. Điểm được tính tham khảo theo tín chỉ, lấy điểm cao nhất của mỗi mã học phần và bỏ môn (*)/MT; không quy đổi giữa hệ 4 và hệ 10.`);
  return notes;
}

/* ----------------------------------------------------------- course views */

export type CourseView = {
  key: string;
  code: string;
  name: string;
  credits: number | null;
  conditionOnly: boolean;
  groupId: string;
  groupTitle: string;
  /** Null without an evaluation (no transcript yet). */
  row: GraduationCourseRow | null;
  /** A GPA retake candidate: "passed" = học cải thiện, "failed" = học lại. */
  improvement: "passed" | "failed" | null;
};

export type GroupView = {
  id: string;
  title: string;
  kind: "mandatory" | "elective";
  /** "40 môn", "6 TC" or "—". */
  required: string;
  /** "38 môn", "4 TC" or "—" (no transcript). */
  achieved: string;
  result: GraduationGroupEvaluation | null;
  courses: CourseView[];
};

/** The standard's groups with their courses, from the evaluation when there is one, else from the standard alone. */
export function groupViews(data: Pick<StudentGraduationResponse, "standard" | "evaluation">): GroupView[] {
  const evaluation = data.evaluation;
  if (evaluation) {
    const retakes = new Map(evaluation.improvementCandidates.map((course) => [course.code, course.state]));
    return evaluation.groups.map((group) => {
      const title = groupTitle(group);
      return {
        id: group.id, title, kind: group.kind, result: group,
        required: group.required === null ? "—" : `${formatNumber(group.required)} ${group.unit}`,
        achieved: group.lower === null ? "—" : `${formatNumber(group.lower)} ${group.unit}`,
        courses: group.courses.map((row, index) => ({
          key: `${group.id}:${index}`, code: row.code, name: row.name, credits: row.credits, conditionOnly: row.conditionOnly,
          groupId: group.id, groupTitle: title, row, improvement: retakes.get(row.code) ?? null,
        })),
      };
    });
  }
  const standard = data.standard;
  if (!standard) return [];
  const labels = standardGroupLabels(standard);
  return standard.groups.map((group) => {
    const title = labels.get(group.id) ?? group.name;
    const courses = standard.courses.filter((course) => course.groupId === group.id);
    return {
      id: group.id, title, kind: group.kind, result: null, achieved: "—",
      required: group.kind === "mandatory" ? `${formatNumber(courses.length)} môn` : group.minimumCredits === null ? "—" : `${formatNumber(group.minimumCredits)} TC`,
      courses: courses.map((course, index) => ({
        key: `${group.id}:${index}`, code: course.code.trim().toUpperCase(), name: course.name, credits: course.credits,
        conditionOnly: course.conditionOnly, groupId: group.id, groupTitle: title, row: null, improvement: null,
      })),
    };
  });
}

/** The line above a group's course list: "Tự chọn · Đã đạt: 2 TC · Yêu cầu: 6 TC — chỉ cần đủ số tín chỉ, …". */
export function groupFacts(group: Pick<GroupView, "kind" | "achieved" | "required" | "result">): string {
  const facts = [group.kind === "mandatory" ? "Bắt buộc" : "Tự chọn", ...(group.result ? [`Đã đạt: ${group.achieved}`] : []), `Yêu cầu: ${group.required}`];
  const rule = group.kind === "mandatory" ? "phải đạt tất cả học phần, kể cả môn điều kiện (*)" : "chỉ cần đủ số tín chỉ, không phải học hết các học phần";
  return `${facts.join(" · ")} — ${rule}.`;
}

/** "Còn thiếu" of a group: the shortfall of a failing group, at most the shortfall of an undecided one. */
export function groupShortfall(result: GraduationGroupEvaluation | null): string {
  if (!result || result.status === "pass" || result.remaining === null || result.remaining <= 0) return "—";
  return `${result.status === "unknown" ? "tối đa " : ""}${formatNumber(result.remaining)} ${result.unit}`;
}

/** "" = every course, "open" = not passed yet (anything but Đã đạt / MT), else one state. */
export type CourseFilter = "" | "open" | GradCourseState;
export const COURSE_FILTERS: readonly { value: CourseFilter; label: string }[] = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "open", label: "Chưa hoàn thành" },
  ...(Object.keys(COURSE_STATES) as GradCourseState[]).map((state) => ({ value: state, label: COURSE_STATES[state].label })),
];

export function filterCourses(courses: readonly CourseView[], query: string, filter: CourseFilter): CourseView[] {
  const needle = searchTerm(query);
  return courses.filter((course) => (!needle || searchTerm(`${course.code} ${course.name}`).includes(needle))
    && (!filter || (course.row !== null && (filter === "open" ? !isPassedState(course.row.state) : course.row.state === filter))));
}

/** The score of a course on the GPA scale first, then the other scale and the letter. */
export function scoreParts(row: Pick<GraduationCourseRow, "state" | "score10" | "score4" | "letter">, scale: 4 | 10): { main: string; detail: string | null } | null {
  if (row.state === "exempt" || row.letter?.trim().toUpperCase() === "MT") return { main: "MT", detail: "Miễn thi" };
  const four = row.score4 === null ? null : `${formatNumber(row.score4)} / 4`;
  const ten = row.score10 === null ? null : `${formatNumber(row.score10)} / 10`;
  const [first, second] = scale === 4 ? [four, ten] : [ten, four];
  const main = first ?? second ?? row.letter;
  if (!main) return null;
  const detail = [first ? second : null, row.letter && main !== row.letter ? row.letter : null].filter(Boolean).join(" · ");
  return { main, detail: detail || null };
}

/* --------------------------------------------------------------- loading */

const LOAD_ERRORS: Record<string, string> = {
  account_unavailable: "Tài khoản của bạn hiện không dùng được tính năng này. Vui lòng liên hệ Khoa nếu cần hỗ trợ.",
  database_required: "Chưa kết nối được cơ sở dữ liệu. Vui lòng thử lại sau.",
};
/** The message for a failed GET /api/student/graduation. */
export function loadErrorMessage(status: number, code: string | null | undefined): string {
  if (status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  return LOAD_ERRORS[code ?? ""] ?? "Không thể tải điều kiện xét tốt nghiệp. Vui lòng thử lại.";
}

/* --------------------------------------------------------------------- AI */

const ADVICE_STATUSES: readonly AdviceStatus[] = ["queued", "processing", "completed", "failed", "cancelled", "deferred"];
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const plain = (value: unknown) => typeof value === "string" ? value.trim() : "";
const stringOrNull = (value: unknown) => typeof value === "string" && value ? value : null;
const adviceStatus = (value: unknown): AdviceStatus | null => ADVICE_STATUSES.find((status) => status === value) ?? null;

/** The model's output, keeping only items with text; null when nothing readable is left. */
export function normalizeAdviceOutput(value: unknown): AdviceOutput | null {
  if (!value || typeof value !== "object") return null;
  const output = record(value);
  const advice = (Array.isArray(output.advice) ? output.advice : [])
    .map((item) => { const entry = record(item); return { focus: plain(entry.focus), label: plain(entry.label), text: plain(entry.text) }; })
    .filter((item) => item.text);
  const nextSteps = (Array.isArray(output.nextSteps) ? output.nextSteps : []).map(plain).filter(Boolean);
  const summary = plain(output.summary);
  return summary || advice.length || nextSteps.length ? { summary, advice, nextSteps } : null;
}

export function normalizeStoredAdvice(value: unknown): StoredAdvice | null {
  const item = record(value);
  const status = adviceStatus(item.status);
  if (!status) return null;
  return {
    id: stringOrNull(item.id),
    status,
    errorCode: stringOrNull(item.errorCode),
    createdAt: stringOrNull(item.createdAt),
    completedAt: stringOrNull(item.completedAt),
    model: stringOrNull(item.model),
    standardVersion: typeof item.standardVersion === "number" ? item.standardVersion : 0,
    output: normalizeAdviceOutput(item.output),
  };
}

const worker = (value: unknown) => { const item = record(value); return { online: item.online === true, supportsAdvice: item.supportsAdvice === true }; };

/** GET /advice, read defensively: a malformed field reads as "nothing" instead of breaking the page. */
export function normalizeAdviceResponse(value: unknown): GraduationAdviceResponse {
  const data = record(value);
  return {
    advice: normalizeStoredAdvice(data.advice),
    stale: data.stale === true,
    needsAdvice: data.needsAdvice === true,
    aiEnabled: data.aiEnabled === true,
    worker: worker(data.worker),
    fingerprint: stringOrNull(data.fingerprint),
  };
}

export function normalizeAdviceStatus(value: unknown): GraduationAdviceStatusResponse {
  const data = record(value);
  return { id: stringOrNull(data.id), status: adviceStatus(data.status), errorCode: stringOrNull(data.errorCode), worker: worker(data.worker) };
}

/** POST /ensure and /retry: the stored advice, or `deferred` when the queue was full and nothing was stored. */
export function normalizeAdviceWrite(value: unknown): { advice: StoredAdvice | null; deferred: boolean } {
  const data = record(value);
  const advice = normalizeStoredAdvice(data.advice);
  const deferred = advice?.status === "deferred" || data.status === "deferred";
  return { advice: deferred ? null : advice, deferred };
}

/** Only these statuses change on their own, so only they are polled. */
export const shouldPollAdvice = (status: AdviceStatus | null | undefined) => status === "queued" || status === "processing";

const hasOutput = (advice: StoredAdvice | null | undefined): advice is StoredAdvice & { output: AdviceOutput } =>
  advice?.status === "completed" && advice.output !== null;

/** The page's own POST /ensure for one fingerprint. */
export type EnsureState = { fingerprint: string; state: "sending" | "sent" | "deferred" | "error" } | null;

/** An older completed advice shown dimmed while the advice for the current facts is prepared. */
type Previous = { previous: (StoredAdvice & { output: AdviceOutput }) | null };
export type AdviceView =
  | { kind: "hidden" | "disabled" | "loading" | "unavailable" }
  | ({ kind: "preparing" | "deferred" | "request_failed" | "cancelled" } & Previous)
  | ({ kind: "queued"; worker: "ready" | "outdated" | "offline" } & Previous)
  | ({ kind: "processing"; since: string | null } & Previous)
  | ({ kind: "failed"; errorCode: string | null } & Previous)
  | { kind: "completed"; advice: StoredAdvice & { output: AdviceOutput }; stale: boolean };
export type AdviceKind = AdviceView["kind"];

/**
 * What the AI panel shows. Advice is generated automatically: while the current facts have no
 * advice the page asks for it once (POST /ensure) and shows "preparing"; an older completed advice
 * stays visible, dimmed, until the new one is ready. `remembered` = the last completed advice
 * shown in this page session.
 */
export function adviceView(input: {
  response: GraduationAdviceResponse | null;
  loading: boolean;
  failed: boolean;
  ensure: EnsureState;
  remembered: StoredAdvice | null;
}): AdviceView {
  const { response } = input;
  if (!response) return { kind: input.loading ? "loading" : input.failed ? "unavailable" : "hidden" };
  if (!response.aiEnabled) return { kind: "disabled" };
  const row = response.advice;
  if (!response.fingerprint && !row) return { kind: "hidden" };
  const previous = response.stale && hasOutput(row) ? row
    : hasOutput(input.remembered) && input.remembered.id !== row?.id ? input.remembered : null;
  const ensure = input.ensure?.fingerprint === response.fingerprint ? input.ensure.state : null;
  // A full queue first: nothing was stored, so there is nothing to poll or retry until the page opens again.
  if (row?.status === "deferred" || (response.needsAdvice && ensure === "deferred")) return { kind: "deferred", previous };
  if (response.needsAdvice) return { kind: ensure === "error" ? "request_failed" : "preparing", previous };
  if (!row) return { kind: "hidden" };
  switch (row.status) {
    case "completed": return hasOutput(row) ? { kind: "completed", advice: row, stale: response.stale } : { kind: "failed", errorCode: row.errorCode ?? "invalid_ai_output", previous };
    case "queued": return { kind: "queued", worker: !response.worker.online ? "offline" : response.worker.supportsAdvice ? "ready" : "outdated", previous };
    case "processing": return { kind: "processing", since: row.createdAt, previous };
    case "failed": return { kind: "failed", errorCode: row.errorCode, previous };
    default: return { kind: "cancelled", previous };
  }
}

const AI_ERRORS: Record<string, string> = {
  ai_timeout: "Máy AI xử lý quá thời gian cho phép.",
  ai_output_truncated: "Lời khuyên bị cắt giữa chừng nên chưa dùng được.",
  invalid_ai_output: "Lời khuyên chưa khớp với số liệu đã tính nên hệ thống không hiển thị.",
  ollama_unavailable: "Máy AI tạm thời không phản hồi.",
  worker_timeout: "Máy AI chưa xử lý xong trong thời gian cho phép.",
  ai_failed: "Máy AI gặp lỗi khi viết lời khuyên.",
};
/** Why an advice failed, in the student's words. */
export const adviceErrorMessage = (code: string | null | undefined): string => AI_ERRORS[code ?? ""] ?? "Máy AI chưa viết được lời khuyên.";

const REQUEST_ERRORS: Record<string, string> = {
  ai_disabled: "Lời khuyên từ EduPath AI hiện chưa được bật.",
  invalid_input: "Yêu cầu chưa hợp lệ. Vui lòng tải lại trang rồi thử lại.",
  advice_not_retryable: "Lời khuyên đang được tạo hoặc đã có. Hãy đợi kết quả hiện tại.",
  advice_too_frequent: "Bạn vừa thử lại. Hãy đợi khoảng 30 giây rồi thử lại.",
  queue_full: "Hàng đợi AI đang đầy. Vui lòng thử lại sau ít phút.",
  invalid_origin: "Phiên thao tác không hợp lệ. Vui lòng tải lại trang.",
  authentication_required: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  account_unavailable: "Tài khoản của bạn hiện không dùng được tính năng này. Vui lòng liên hệ Khoa nếu cần hỗ trợ.",
  database_required: "Chưa kết nối được cơ sở dữ liệu. Vui lòng thử lại sau.",
};
/** The message for a failed POST /ensure or /retry. */
export const requestErrorMessage = (code: string | null | undefined): string => REQUEST_ERRORS[code ?? ""] ?? "Thao tác chưa thành công. Vui lòng thử lại.";

/** Title and explanation of every waiting or error state of the AI panel (completed has none). */
export function adviceStateCopy(view: AdviceView): { title: string; text: string } | null {
  switch (view.kind) {
    case "loading": return { title: "Đang tải lời khuyên…", text: "" };
    case "unavailable": return { title: "Chưa tải được lời khuyên từ EduPath AI", text: "Trang sẽ tự thử lại. Các đề xuất ở trên vẫn đầy đủ." };
    case "preparing": return { title: "Đang chuẩn bị lời khuyên…", text: "EduPath AI sẽ viết lời khuyên từ kết quả ở trên. Các đề xuất ở trên đã đủ để bạn bắt đầu." };
    case "queued":
      return view.worker === "ready" ? { title: "Đang chuẩn bị lời khuyên…", text: "Yêu cầu đang chờ đến lượt; lời khuyên thường có sau khoảng một phút." }
        : view.worker === "outdated" ? { title: "Máy AI đang chạy phiên bản cũ…", text: "Lời khuyên sẽ được viết khi máy AI được cập nhật. Các đề xuất ở trên vẫn đầy đủ." }
          : { title: "Lời khuyên sẽ có khi máy AI hoạt động trở lại", text: "Yêu cầu đã được giữ trong hàng đợi; bạn không cần làm gì thêm." };
    case "processing": return { title: "EduPath AI đang viết lời khuyên…", text: "Thường mất khoảng 20–60 giây." };
    case "deferred": return { title: "Hàng đợi AI đang đầy", text: "Lời khuyên sẽ được tạo tự động khi bạn mở lại trang này sau ít phút." };
    case "request_failed": return { title: "Chưa gửi được yêu cầu tạo lời khuyên", text: "Hãy tải lại trang sau ít phút. Các đề xuất ở trên không bị ảnh hưởng." };
    case "failed": return { title: "Chưa tạo được lời khuyên", text: `${adviceErrorMessage(view.errorCode)} Các đề xuất ở trên không bị ảnh hưởng.` };
    case "cancelled": return { title: "Yêu cầu tạo lời khuyên đã dừng", text: "Lời khuyên mới sẽ được tạo tự động khi bạn mở lại trang." };
    default: return null;
  }
}

/** What the live region says when the AI state changes on screen (nothing for the first load). */
export function adviceAnnouncement(kind: AdviceKind): string {
  switch (kind) {
    case "completed": return "Đã có lời khuyên từ EduPath AI.";
    case "failed": return "Chưa tạo được lời khuyên từ EduPath AI.";
    case "processing": return "EduPath AI đang viết lời khuyên.";
    case "queued":
    case "preparing": return "Đang chuẩn bị lời khuyên từ EduPath AI.";
    case "deferred": return "Hàng đợi AI đang đầy; lời khuyên sẽ được tạo khi bạn mở lại trang.";
    case "request_failed": return "Chưa gửi được yêu cầu tạo lời khuyên.";
    default: return "";
  }
}

/**
 * The condition an advice item is about, as the student reads it: the server's label; internal keys
 * (G1, GENERAL, CREDITS, GPA) never show, they fall back to the server's own names.
 */
export function adviceFocusLabel(item: { focus: string; label: string }): string {
  const label = item.label.trim();
  if (label && !/^(G\d+|GENERAL|CREDITS|GPA)$/i.test(label)) return label;
  const focus = (item.focus || label).trim().toUpperCase();
  return focus === "CREDITS" ? "Tổng số tín chỉ tích lũy" : focus === "GPA" ? "Điểm trung bình tích lũy"
    : /^G\d+$/.test(focus) ? "Điều kiện xét tốt nghiệp" : "Lời khuyên chung";
}
