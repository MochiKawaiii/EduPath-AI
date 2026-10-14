// Synthetic graduation pages for the advice tests. Built from fixtures/synthetic-k29.json only
// (public K29 course codes; invented student records): no real student data.
import {
  syntheticCurriculum, syntheticStandards, syntheticStudentTerms, syntheticTranscript, type TranscriptRow, type TranscriptTerm,
} from "../../competency-assessment/fixtures/synthetic-k29.js";
import { evaluateGraduation } from "../evaluation.js";
import type { GraduationData } from "../model.js";
import { graduationFingerprint, type StudentGraduation } from "../student-graduation.js";
import type { EvaluatedGraduation } from "./jobs.js";

export const ADVICE_TRANSCRIPT_VERSION = "00000000-0000-4000-8000-0000000000f1";
export const ADVICE_TRANSCRIPT_UPDATED_AT = "2026-10-01T08:00:00.000Z";

/** The synthetic CNPM student's terms with the printed summaries of the last graded term replaced. */
export const termsWithSummaries = (summaries: [string, string][], terms: TranscriptTerm[] = syntheticStudentTerms()) =>
  terms.map((term) => (term.summaries ? { ...term, summaries } : term));

/**
 * The synthetic terms with rows added, keyed "2024-2025 HK03" (the last graded term) or
 * "2025-2026 HK01" (registered only: rows without grades are in progress).
 */
export const termsWithRows = (rows: Record<string, TranscriptRow[]>, terms: TranscriptTerm[] = syntheticStudentTerms()) =>
  terms.map((term) => {
    const added = rows[`${term.year} ${term.semester}`];
    return added ? { ...term, rows: [...term.rows, ...added] } : term;
  });

/** Printed GPA 1,85 (below the minimum 2) and a failed, never passed elective: the GPA fails. */
export function gpaFailingTerms(): TranscriptTerm[] {
  const terms = termsWithSummaries([["Tổng số tín chỉ tích lũy", "27"], ["Điểm TB tích lũy (Hệ 4)", "1,85"]]);
  return termsWithRows({ "2024-2025 HK01": [["71ITSE30903", 3, 3.2, 0, "F"]] }, terms);
}

/** The synthetic graduation elective group, "Nhóm tự chọn TC306" (6 TC; CTĐT TC406). */
export const THESIS_GROUP_ID = "row-92";

/** [code, name, credits] of a standard course. */
export type StandardCourseSpec = [string, string, number | null];

/** K29 "Nhóm tự chọn TC306" of the three K29 standards: Đồ án Tốt nghiệp (6 TC) or 3-TC replacement courses. */
export const K29_THESIS_COURSES: StandardCourseSpec[] = [
  ["71ITGR40206", "Đồ án Tốt nghiệp", 6],
  ["71ITGR40203", "Chuyên đề Tốt nghiệp 1", 3],
  ["71ITGR40303", "Chuyên đề Tốt nghiệp 2", 3],
  ["71ITIS30403", "Quản lý và phát triển các hệ thống thông tin", 3],
  ["71ITIS30603", "Chuyên đề Tối ưu hóa máy tìm kiếm", 3],
];

/** A standard edit: the courses (and, when given, the name) of the graduation elective group replaced. */
export const withThesisGroup = (courses: readonly StandardCourseSpec[], name?: string) => (data: GraduationData): GraduationData => ({
  ...data,
  groups: data.groups.map((group) => (group.id === THESIS_GROUP_ID && name ? { ...group, name } : group)),
  courses: [
    ...data.courses.filter((course) => course.groupId !== THESIS_GROUP_ID),
    ...courses.map(([code, courseName, credits], index) => ({
      id: `c-${THESIS_GROUP_ID}-${code}`, groupId: THESIS_GROUP_ID, code, name: courseName, credits, conditionOnly: false, sourceRow: 300 + index,
    })),
  ],
});

export type SyntheticGraduationOptions = {
  terms?: TranscriptTerm[];
  /** Edits the CNPM standard's data (gpaScale already defaulted to 4). */
  standard?: (data: GraduationData) => GraduationData;
};

/** The evaluated graduation page of the synthetic CNPM student (default terms: groups, credits fail; GPA passes). */
export function syntheticGraduation(options: SyntheticGraduationOptions = {}): EvaluatedGraduation {
  const base = syntheticStandards()[0]!;
  const data = { ...base.data, gpaScale: base.data.gpaScale ?? 4 };
  const standard = { ...base, data: options.standard ? options.standard(data) : data };
  const transcript = {
    version: ADVICE_TRANSCRIPT_VERSION, updatedAt: ADVICE_TRANSCRIPT_UPDATED_AT,
    data: syntheticTranscript(options.terms ?? syntheticStudentTerms()),
  };
  const evaluation = evaluateGraduation({ standard, transcript, curriculumCourses: syntheticCurriculum().courses });
  const profile: StudentGraduation["profile"] = { cohortCode: "K29", specialty: "CNPM" };
  return {
    profile, resolution: "specialty", standard, transcript: { version: transcript.version, updatedAt: transcript.updatedAt },
    evaluation, fingerprint: graduationFingerprint({ profile, standard, evaluation }), specialtySuggestion: null,
  };
}

/** A graduation page without an evaluation (no transcript). */
export function unevaluatedGraduation(): StudentGraduation {
  const graduation = syntheticGraduation();
  return { ...graduation, transcript: null, evaluation: null, fingerprint: null };
}
