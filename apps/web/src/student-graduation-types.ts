// Web mirror of apps/api/src/graduation/evaluation.ts (GraduationEvaluation), of the body of
// GET /api/student/graduation (apps/api/src/graduation/student-router.ts, student-graduation.ts)
// and of the graduation advice API (/api/student/graduation/advice, design §5.7). Hand-maintained:
// keep in sync with the API. The page only reads these shapes; the verdict is computed on the server.

import type { SpecialtyCode } from "./competency-assessment-types";

/* ------------------------------------------------------------- evaluation */

export type GradStatus = "pass" | "fail" | "unknown";
export type GradCourseState = "passed" | "exempt" | "failed" | "in_progress" | "graded_unknown" | "not_taken";

export interface GraduationCourseRow {
  /** courseKey(code) */
  code: string;
  /** Standard course name (as stored; may contain "(*)"). */
  name: string;
  /** Standard → CTĐT → transcript credit of the selected attempt (> 0) → null. */
  credits: number | null;
  conditionOnly: boolean;
  groupId: string;
  state: GradCourseState;
  /** The pass/fail state rests on a letter-grade inference. */
  inferred: boolean;
  /** Transcript attempts for this code (0 when not taken). */
  attempts: number;
  /** Selected attempt (MT: null). */
  score10: number | null;
  score4: number | null;
  /** "MT" for an exemption. */
  letter: string | null;
  /** Selected attempt HKyyS; null for "Điểm bảo lưu" or not taken. */
  term: string | null;
}

export interface GraduationGroupEvaluation {
  id: string;
  name: string;
  /** A repeated name adds its size and first code ("… · 5 học phần, gồm 71ITAI40103"). */
  label: string;
  kind: "mandatory" | "elective";
  /** "TC306" from the name, else null. */
  code: string | null;
  /** CTĐT elective code with the same courses, e.g. "TC406". */
  curriculumElectiveCode: string | null;
  unit: "môn" | "TC";
  required: number | null;
  lower: number | null;
  upper: number | null;
  /** status !== "pass" && required !== null && lower !== null ? max(0, required − lower) : null */
  remaining: number | null;
  status: GradStatus;
  /** Standard group credits (informational). */
  minimumCredits: number | null;
  /** Certain, non-(*) credits. */
  accumulatedCredits: number | null;
  courseCount: number;
  passedCount: number;
  /** Every standard course of the group, in standard order. */
  courses: GraduationCourseRow[];
}

export type GraduationWarningCode =
  | "results_inferred" | "credits_mismatch" | "printed_credits_unreadable" | "ocr_needs_review" | "standard_ambiguous_codes";

export interface GraduationWarning {
  code: GraduationWarningCode;
  count?: number;
  printed?: number;
  computedLower?: number;
  computedUpper?: number;
}

export interface GraduationImprovementCandidate {
  code: string;
  name: string;
  credits: number;
  score: number;
  scale: 4 | 10;
  letter: string | null;
  /** "passed" → học cải thiện; "failed" (never passed) → học lại. */
  state: "passed" | "failed";
}

export interface GraduationEvaluation {
  calcVersion: string;
  status: GradStatus;
  groupStatus: GradStatus;
  /** Groups pass, GPA fails. */
  needsImprovement: boolean;
  asOf: { transcriptVersion: string; transcriptUpdatedAt: string; latestTerm: string | null };
  groups: GraduationGroupEvaluation[];
  /** Null when the standard has no minimum credits. */
  credits: {
    lower: number | null; upper: number | null; required: number; status: GradStatus;
    source: "printed" | "calculated"; remaining: number | null;
  } | null;
  gpa: {
    actual: number | null; required: number | null; scale: 4 | 10; status: GradStatus;
    source: "printed" | "calculated" | null; reason: string; remaining: number | null;
  };
  creditCheck: { status: "match" | "mismatch" | "unavailable"; printed: number | null; computedLower: number; computedUpper: number };
  /** Only when gpa.status === "fail": low-score GPA courses, lowest first (max 8). */
  improvementCandidates: GraduationImprovementCandidate[];
  /** Standard courses in progress (max 20). */
  inProgress: GraduationCourseRow[];
  /** Standard courses graded with an unreadable result (max 20). */
  unknownResults: GraduationCourseRow[];
  warnings: GraduationWarning[];
}

/* ------------------------------------------------- GET /api/student/graduation */

/** The competency resolutions plus a profile without a cohort. */
export type StudentGraduationResolution = "specialty" | "general" | "specialty_unset" | "not_found" | "ambiguous" | "cohort_unknown";

export type StudentGraduationProfile = {
  /** Cohort in the account (trimmed, upper-case); null when unset. */
  cohortCode: string | null;
  /** Specialty declared in the profile; null = "Chưa xác định". */
  specialty: SpecialtyCode | null;
};

/** The resolved standard: only the conditions a student needs (no source workbook or review notes). */
export type StudentGraduationStandard = {
  id: string;
  revisionId: string;
  version: number;
  name: string;
  cohortCode: string;
  classBlock: string;
  major: string;
  specialty: string;
  educationSystem: string;
  faculty: string;
  minimumCredits: number | null;
  mandatoryCredits: number | null;
  electiveCredits: number | null;
  freeElectiveCredits: number | null;
  minimumGpa: number | null;
  gpaScale: 4 | 10;
  notes: string;
  groups: { id: string; name: string; kind: "mandatory" | "elective"; minimumCredits: number | null }[];
  courses: { id: string; groupId: string; code: string; name: string; credits: number | null; conditionOnly: boolean }[];
};

export type StudentGraduationSpecialtySuggestion = { code: SpecialtyCode; label: string; count: number };

export type StudentGraduationResponse = {
  profile: StudentGraduationProfile;
  resolution: StudentGraduationResolution;
  /** Only the resolved standard; never another cohort's or specialty's. */
  standard: StudentGraduationStandard | null;
  transcript: { version: string; updatedAt: string } | null;
  /** Null without a resolved standard or a transcript. */
  evaluation: GraduationEvaluation | null;
  /** Only for "specialty_unset": the one specialty whose mandatory courses the student passed. */
  specialtySuggestion: StudentGraduationSpecialtySuggestion | null;
};

/* ------------------------------------------- /api/student/graduation/advice */

export type AdviceStatus = "queued" | "processing" | "completed" | "failed" | "cancelled" | "deferred";

export type AdviceOutput = {
  summary: string;
  /** focus = condition key; label = its name for the student ("Nhóm tự chọn TC306", "Điểm trung bình tích lũy", …). */
  advice: { focus: string; label: string; text: string }[];
  nextSteps: string[];
};

/** One advice as the page sees it (StoredGraduationAdvice in apps/api/src/graduation/advice/router.ts). */
export type StoredAdvice = {
  /** Null only for "deferred" (queue full), which is never stored. */
  id: string | null;
  status: AdviceStatus;
  errorCode: string | null;
  /** Null only for "deferred". */
  createdAt: string | null;
  completedAt: string | null;
  /** Ollama model tag, e.g. "gemma4:e4b". */
  model: string | null;
  standardVersion: number;
  /** Only for a completed advice. */
  output: AdviceOutput | null;
};

export type AdviceWorker = { online: boolean; supportsAdvice: boolean };

/** GET /api/student/graduation/advice */
export type GraduationAdviceResponse = {
  /** The newest advice for the current facts, else the student's newest advice (then stale). */
  advice: StoredAdvice | null;
  /** The newest advice was written for other facts than the current evaluation. */
  stale: boolean;
  /** AI on, an evaluation exists and no advice exists for the current facts: the page calls POST /ensure. */
  needsAdvice: boolean;
  aiEnabled: boolean;
  worker: AdviceWorker;
  /** Fingerprint of the current evaluation; null without one. */
  fingerprint: string | null;
};

/** GET /api/student/graduation/advice/status (cheap, polled every 2.5 s). */
export type GraduationAdviceStatusResponse = {
  id: string | null;
  status: AdviceStatus | null;
  errorCode: string | null;
  worker: AdviceWorker;
};

/**
 * POST /api/student/graduation/advice/ensure (200) and /retry (201). A full queue answers ensure
 * with an advice of status "deferred" (id and createdAt null, nothing stored); advice is null when
 * AI is off or there is nothing to advise on.
 */
export type GraduationAdviceWriteResponse = { advice: StoredAdvice | null };
