// Every threshold and band used by the competency calculation lives here.
// Changing a value changes stored results, so bump CALC_VERSION with it.

/** Stored in meta.calcVersion of every assessment. */
/** v2: a below skill with a Học cải thiện course is no longer listed as "no course left". */
/** v3: a group's skillCount leaves out not-applicable skills, like overall.basis.applicableSkills. */
export const CALC_VERSION = "comp-calc-v3";

/** Skill, group and overall levels (0–100 scale), classified on unrounded values. */
export const LEVEL_THRESHOLDS = { proficient: 85, good: 70, basic: 50 } as const;

/** Confidence = min(coverage band, evidence band). */
export const COVERAGE_BANDS = { medium: 0.3, high: 0.7 } as const;
/** Evidence amount is Σ(credits × weight) of the studied courses (MT included). */
export const EVIDENCE_BANDS = { medium: 1, high: 2.5 } as const;

/** Career requirement thresholds: "Ưu tiên" needs level Khá, "Bắt buộc" needs Thành thạo. */
export const CAREER_THRESHOLDS = { required: 85, preferred: 70 } as const;
export const CAREER_COEFFICIENTS = { required: 2, preferred: 1 } as const;

/** A 'below' requirement earns at most this much, scaled from FIT_BELOW_FLOOR up to the threshold. */
export const FIT_BELOW_MAX_CREDIT = 0.5;
export const FIT_BELOW_FLOOR = 40;
export const FIT_LABEL_THRESHOLDS = { fit: 0.8, fairlyFit: 0.5 } as const;
/** Below this share of coefficients with data the fit label is "Chưa đủ dữ liệu". */
export const FIT_MIN_DATA_SHARE = 0.5;

/** Deficit bands for 'below': ≤ near → gần ngưỡng, ≤ moderate → thiếu vừa, otherwise thiếu nhiều. */
export const DEFICIT_BANDS = { near: 5, moderate: 15 } as const;

/** At most this many course candidates (and improvement candidates) per skill. */
export const MAX_SUPPORT_COURSES = 5;
/** Warn when fewer curriculum courses than this share have skill weights. */
export const MIN_WEIGHTED_COURSE_SHARE = 0.8;
/** Skill scope text kept in results and prompts. */
export const SCOPE_MAX_LENGTH = 200;
/** Size of the strongest/weakest skill lists. */
export const HIGHLIGHT_COUNT = 5;
/** Related measured skills listed as context for one self-study item. */
export const MAX_RELATED_SKILLS = 3;

/** Same pass letters as the OCR pipeline (services/ocr/test_ocr.py PASS_LETTERS). */
export const PASS_LETTERS: readonly string[] = ["A+", "A", "B+", "B", "C+", "C", "D+", "D"];
export const FAIL_LETTERS: readonly string[] = ["F"];
/** Exemption/recognition letter. Counts as passed; never inferred. */
export const EXEMPT_LETTER = "MT";

/** Condition-only courses (GDTC/GDQP) when no graduation standard says otherwise. */
export const CONDITION_ONLY_CODE_PATTERN = /^71(?:NAD|PE)/;
/** Folded CTĐT block name of the condition-only courses. */
export const CONDITION_ONLY_BLOCK = "giao duc the chat va giao duc quoc phong";
