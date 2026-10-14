// Every threshold and band used by the competency calculation lives here.
// Changing a value changes stored results, so bump CALC_VERSION with it.

/** Stored in meta.calcVersion of every assessment. */
/** v2: a below skill with a Học cải thiện course is no longer listed as "no course left". */
/** v3: a group's skillCount leaves out not-applicable skills, like overall.basis.applicableSkills. */
/**
 * v4: computed scores lose their float noise before they are classified (all 8.5 grades gave
 * 84.99999999999999, i.e. Khá and below Bắt buộc 85), and 0–100 scores are stored rounded down to
 * 2 decimals, so the whole number the page shows never reaches a level the score has not reached.
 */
/**
 * v5: graduation.ts is the one engine of the competency assessment and the graduation page:
 * repeated group names are labelled with their size and first code; a met lower bound passes even
 * without an upper bound; course credits fall back standard → CTĐT → transcript; the credit estimate
 * accumulates the program (standard ∪ CTĐT), so cohorts without a CTĐT no longer estimate 0; the
 * printed total also reads "Số tín chỉ tích lũy" and an unreadable one falls back to the estimate.
 */
/** v6: skillPlans gives every scored skill below Khá outside the career gaps its courses to take, retake or improve. */
/** v7: with a career, plans only deepen its met skills below Thành thạo; thesis replacement courses are never suggested off that path. */
/** v8: history gives the overall and group competency as the transcript stood at the end of each graded term (STU-COMP-07). */
export const CALC_VERSION = "comp-calc-v8";

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
/** At most this many skills get a course plan (skillPlans), weakest first. */
export const MAX_SKILL_PLANS = 8;
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
