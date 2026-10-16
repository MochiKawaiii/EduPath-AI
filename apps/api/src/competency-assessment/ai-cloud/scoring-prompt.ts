// "AI 100%" scoring prompt (comp-ai-v1): the model computes every competency number itself from the raw
// data and the faculty's formula. The data block holds only what the formula needs: CTĐT courses, every
// transcript attempt, the skill weights and the target career's requirements; no name, student code,
// email, class or PDF. Every DB/OCR string is sanitized like the commentary prompt (Gemma/Claude special
// tokens, control characters). A reference calculator reading only this block reproduces the engine
// exactly (see scoring-prompt.test.ts), so a wrong number is the model's.
import { CAREER_THRESHOLDS } from "../constants.js";
import { conditionOnlyCodes, courseKey, isConditionOnly, uniqueCurriculumCourses } from "../course-state.js";
import type { AssessmentInputs, AssessmentResult } from "../types.js";
import { sanitizeText } from "../ai/prompt.js";
import type { JsonSchema } from "../ai/schema.js";

export const SCORING_PROMPT_VERSION = "comp-ai-v1";

export const SCORING_LEVELS = ["Thành thạo", "Khá", "Cơ bản", "Cần củng cố", "Chưa có điểm"] as const;
export const SCORING_STATUSES = ["dat", "duoi_nguong", "chua_co_diem"] as const;
export const SCORING_FITS = ["phu_hop", "kha_phu_hop", "can_bo_sung_nhieu", "chua_du_du_lieu"] as const;

export type ScoringBlock = {
  /** CTĐT courses by course key, in CTĐT order. */
  courses: Map<string, { name: string; credits: number; condition: boolean }>;
  attempts: { term: string; code: string; score10: number | null; letter: string | null }[];
  groups: { key: string; name: string }[];
  skills: { key: string; name: string; groupKey: string; links: { code: string; weight: number }[] }[];
  /** One row per career requirement with a skill key, keyed Y1, Y2 … in result order (a skill may repeat). */
  career: { key: string; skillKey: string; name: string; required: boolean; measured: boolean }[];
};

/** The keys one job's answer must cover exactly once; career rows also carry what the consistency check needs. */
export type ScoringKeys = {
  skillKeys: string[];
  groupKeys: string[];
  career: { key: string; skillKey: string; threshold: number }[];
};

/** Stored in stu_comp_ai_jobs.ai_input for a runner 'cloud' job (cleared when the job ends). */
export type ScoringAiInput = {
  kind: "cloud_scoring";
  promptVersion: typeof SCORING_PROMPT_VERSION;
  system: string;
  user: string;
  schema: JsonSchema;
  keys: ScoringKeys;
};

const NAME_MAX = 120;

export function buildScoringBlock(inputs: AssessmentInputs, result: AssessmentResult): ScoringBlock {
  const curriculum = uniqueCurriculumCourses(inputs.curriculum.courses);
  const conditionCodes = conditionOnlyCodes(inputs.graduation.standard?.data ?? null, curriculum);
  const courses = new Map(curriculum.map((course) => [courseKey(course.code), {
    name: sanitizeText(course.name, NAME_MAX),
    credits: Number.isFinite(course.credits) && course.credits > 0 ? course.credits : 0,
    condition: isConditionOnly(course.code, conditionCodes),
  }]));
  const attempts: ScoringBlock["attempts"] = [];
  for (const section of inputs.transcript.data.sections) {
    const term = section.academicYear ? sanitizeText(`${section.semester ?? ""} ${section.academicYear}`, 40) : "Điểm bảo lưu";
    for (const row of section.courses) {
      const code = courseKey(row.code ?? "");
      if (!code) continue;
      attempts.push({ term, code, score10: typeof row.score10 === "number" && Number.isFinite(row.score10) ? row.score10 : null,
        letter: row.letter?.trim() ? sanitizeText(row.letter.trim().toUpperCase(), 8) : null });
    }
  }
  const keyById = new Map(result.skills.map((skill) => [skill.skillId, skill.key]));
  const skills = result.skills.map((skill) => {
    const seen = new Set<string>();
    const links = inputs.weights.links
      .filter((link) => link.skillId === skill.skillId && Number.isFinite(link.weight) && link.weight > 0 && courses.has(courseKey(link.courseCode)))
      .map((link) => ({ code: courseKey(link.courseCode), weight: link.weight }))
      .filter((link) => (seen.has(link.code) ? false : (seen.add(link.code), true)));
    return { key: skill.key, name: sanitizeText(skill.name, NAME_MAX), groupKey: skill.groupKey, links };
  }).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const groups = result.groups.map((group) => ({ key: group.key, name: sanitizeText(group.name, NAME_MAX) }));
  const career = (result.career?.requirements ?? []).filter((req) => req.skillKey !== null).map((req, index) => ({
    key: requirementKey(index),
    skillKey: req.skillKey!,
    name: sanitizeText(req.skillName ?? req.title, NAME_MAX),
    required: req.isRequired,
    measured: req.skillId !== null && keyById.has(req.skillId),
  }));
  return { courses, attempts, skills, groups, career };
}

/** Y1, Y2 … : the n-th career requirement that has a skill key, in AssessmentResult.career.requirements order. */
export const requirementKey = (index: number) => `Y${index + 1}`;

export function scoringKeys(block: ScoringBlock): ScoringKeys {
  return {
    skillKeys: block.skills.map((skill) => skill.key),
    groupKeys: block.groups.map((group) => group.key),
    career: block.career.map((req) => ({
      key: req.key, skillKey: req.skillKey, threshold: req.required ? CAREER_THRESHOLDS.required : CAREER_THRESHOLDS.preferred,
    })),
  };
}

export function renderScoringBlock(block: ScoringBlock): string {
  const lines = ["[1] Học phần trong chương trình đào tạo (mã | tên | tín chỉ | môn điều kiện GDTC/GDQP)"];
  for (const [code, course] of block.courses) lines.push(`${code} | ${course.name} | ${course.credits} | ${course.condition ? "có" : "không"}`);
  lines.push("", "[2] Bảng điểm, mọi lần học (học kỳ | mã | điểm hệ 10 | điểm chữ); ô trống = chưa có");
  for (const row of block.attempts) lines.push(`${row.term} | ${row.code} | ${row.score10 ?? ""} | ${row.letter ?? ""}`);
  lines.push("", "[3] Nhóm kỹ năng (khóa | tên)");
  for (const group of block.groups) lines.push(`${group.key} | ${group.name}`);
  lines.push("", "[4] Kỹ năng (khóa | tên | nhóm | học phần liên kết: mã (trọng số))");
  for (const skill of block.skills) lines.push(`${skill.key} | ${skill.name} | ${skill.groupKey} | ${skill.links.map((link) => `${link.code} (${link.weight})`).join(", ")}`);
  lines.push("", "[5] Yêu cầu của nghề mục tiêu (khóa yêu cầu | khóa kỹ năng | tên | tính chất)");
  if (!block.career.length) lines.push("(không có yêu cầu nào)");
  for (const req of block.career) {
    lines.push(`${req.key} | ${req.skillKey} | ${req.name} | ${req.required ? "Bắt buộc" : "Ưu tiên"}${req.measured ? "" : " | kỹ năng này không có học phần nào liên kết"}`);
  }
  return lines.join("\n");
}

export const SCORING_SYSTEM_PROMPT = `Bạn là bộ tính điểm năng lực của EduPath AI. Hãy tự tính CHÍNH XÁC theo đúng các bước dưới đây, chỉ dùng dữ liệu được cung cấp. Không làm tròn ở các bước trung gian. Tính cẩn thận và kiểm tra lại từng tổng trước khi trả lời.

Bước 1. Chọn lần học của mỗi học phần (bảng điểm [2] có thể có nhiều lần học cùng một mã):
- Có lần học điểm chữ MT (miễn): học phần đã đạt nhưng KHÔNG có điểm, không tính vào trung bình.
- Nếu không, có lần đạt (điểm chữ A+, A, B+, B, C+, C, D+, D): lấy lần đạt có điểm hệ 10 cao nhất.
- Nếu chưa từng đạt (chỉ có F): lấy lần F có điểm hệ 10 cao nhất; điểm này VẪN được tính vào trung bình.
- Lần học chưa có điểm (đang học) không có điểm.
- Chỉ học phần có trong [1] mới được tính; tín chỉ luôn lấy theo [1].

Bước 2. Điểm kỹ năng (thang 100) = 10 × Σ(điểm hệ 10 × tín chỉ × trọng số) / Σ(tín chỉ × trọng số), tính trên các học phần liên kết với kỹ năng đó ở [4] mà có điểm theo bước 1 (kể cả môn điều kiện). Học phần không có điểm thì không đưa vào cả tử số lẫn mẫu số. Không có học phần nào có điểm: score = null, level = "Chưa có điểm". Làm tròn xuống 2 chữ số thập phân.

Bước 3. Mức theo điểm: từ 85 "Thành thạo"; từ 70 "Khá"; từ 50 "Cơ bản"; dưới 50 "Cần củng cố".

Bước 4. Điểm nhóm = 10 × Σ(điểm hệ 10 × tín chỉ × trọng số) / Σ(tín chỉ × trọng số), cộng gộp mọi liên kết (học phần, trọng số) có điểm của mọi kỹ năng thuộc nhóm, nhưng BỎ các học phần là môn điều kiện GDTC/GDQP. Một học phần liên kết với hai kỹ năng cùng nhóm được cộng hai lần (mỗi liên kết một lần). Cách làm gọn: với mỗi kỹ năng của nhóm lấy tử số và mẫu số như bước 2 nhưng bỏ môn điều kiện, rồi cộng tất cả tử số và tất cả mẫu số của nhóm. Nhóm không có liên kết nào có điểm: null. Làm tròn xuống 2 chữ số thập phân; mức theo bước 3.

Bước 5. Điểm tổng = trung bình cộng điểm của các nhóm có điểm (dùng điểm nhóm chưa làm tròn). Làm tròn xuống 2 chữ số thập phân; mức theo bước 3.

Bước 6. Nghề mục tiêu [5]: ngưỡng Bắt buộc = 85, Ưu tiên = 70. Với mỗi yêu cầu (khóa Y…), dùng điểm của kỹ năng ghi ở yêu cầu đó: có điểm từ ngưỡng trở lên: status "dat", deficit null; có điểm dưới ngưỡng: status "duoi_nguong", deficit = ngưỡng − điểm kỹ năng (2 chữ số thập phân); không có điểm: status "chua_co_diem", deficit null.

Bước 7. Mức phù hợp với nghề (careerFit): hệ số Bắt buộc = 2, Ưu tiên = 1. Điểm của mỗi yêu cầu: đạt = 1; dưới ngưỡng = 0,5 × min(1, max(0, (điểm − 40) / (ngưỡng − 40))); chưa có điểm = 0; bỏ qua yêu cầu ghi "kỹ năng này không có học phần nào liên kết". Mức phù hợp = Σ(hệ số × điểm yêu cầu) / Σ(hệ số của các yêu cầu được tính). Từ 0,8: "phu_hop"; từ 0,5: "kha_phu_hop"; còn lại "can_bo_sung_nhieu". Nếu tổng hệ số được tính nhỏ hơn 50% tổng hệ số của mọi yêu cầu, hoặc không có yêu cầu nào: "chua_du_du_lieu".

Chỉ trả về một đối tượng JSON đúng cấu trúc, liệt kê đủ mọi kỹ năng ở [4], mọi nhóm ở [3] và mọi yêu cầu ở [5] (mỗi khóa đúng một lần):
{"skills":[{"skillKey":"S01","score":72.35,"level":"Khá"}],"groups":[{"groupKey":"G1","score":70.1,"level":"Khá"}],"overall":{"score":70.1,"level":"Khá"},"career":[{"requirementKey":"Y1","status":"duoi_nguong","deficit":12.5}],"careerFit":"kha_phu_hop"}
score là số hoặc null; level là một trong "Thành thạo", "Khá", "Cơ bản", "Cần củng cố", "Chưa có điểm"; status là một trong "dat", "duoi_nguong", "chua_co_diem"; deficit là số hoặc null; careerFit là một trong "phu_hop", "kha_phu_hop", "can_bo_sung_nhieu", "chua_du_du_lieu".`;

const nullableNumber: JsonSchema = { anyOf: [{ type: "number" }, { type: "null" }] };
const closed = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
/** An enum of this job's keys; a string when there is none (the answer must then be an empty list). */
const keyEnum = (keys: readonly string[]): JsonSchema => (keys.length ? { type: "string", enum: [...keys] } : { type: "string" });

/** The answer's JSON schema (structured outputs); counts and ranges are checked by scoring-validate.ts. */
export function buildScoringSchema(keys: ScoringKeys): JsonSchema {
  const level: JsonSchema = { type: "string", enum: [...SCORING_LEVELS] };
  return closed({
    skills: { type: "array", items: closed({ skillKey: keyEnum(keys.skillKeys), score: nullableNumber, level }) },
    groups: { type: "array", items: closed({ groupKey: keyEnum(keys.groupKeys), score: nullableNumber, level }) },
    overall: closed({ score: nullableNumber, level }),
    career: { type: "array", items: closed({ requirementKey: keyEnum(keys.career.map((req) => req.key)), status: { type: "string", enum: [...SCORING_STATUSES] }, deficit: nullableNumber }) },
    careerFit: { type: "string", enum: [...SCORING_FITS] },
  });
}

/** Everything a cloud scoring job needs. */
export function buildScoringInput(inputs: AssessmentInputs, result: AssessmentResult): ScoringAiInput {
  const block = buildScoringBlock(inputs, result);
  const keys = scoringKeys(block);
  return { kind: "cloud_scoring", promptVersion: SCORING_PROMPT_VERSION, system: SCORING_SYSTEM_PROMPT, user: renderScoringBlock(block), schema: buildScoringSchema(keys), keys };
}
