// Synthetic graduation pages for the advice tests. Built from fixtures/synthetic-k29.json only
// (public K29 course codes; invented student records): no real student data.
import {
  syntheticCurriculum, syntheticStandards, syntheticStudentTerms, syntheticTranscript, type TranscriptTerm,
} from "../../competency-assessment/fixtures/synthetic-k29.js";
import { evaluateGraduation } from "../evaluation.js";
import { graduationFingerprint, type StudentGraduation } from "../student-graduation.js";
import type { EvaluatedGraduation } from "./jobs.js";

export const ADVICE_TRANSCRIPT_VERSION = "00000000-0000-4000-8000-0000000000f1";
export const ADVICE_TRANSCRIPT_UPDATED_AT = "2026-10-01T08:00:00.000Z";

/** The synthetic CNPM student's terms with the printed summaries of the last graded term replaced. */
export const termsWithSummaries = (summaries: [string, string][], terms: TranscriptTerm[] = syntheticStudentTerms()) =>
  terms.map((term) => (term.summaries ? { ...term, summaries } : term));

/** Printed GPA 1,85 (below the minimum 2) and a failed, never passed elective: the GPA fails. */
export function gpaFailingTerms(): TranscriptTerm[] {
  const terms = termsWithSummaries([["Tổng số tín chỉ tích lũy", "27"], ["Điểm TB tích lũy (Hệ 4)", "1,85"]]);
  return terms.map((term) => (term.year === "2024-2025" && term.semester === "HK01"
    ? { ...term, rows: [...term.rows, ["71ITSE30903", 3, 3.2, 0, "F"] as TranscriptTerm["rows"][number]] } : term));
}

/** The evaluated graduation page of the synthetic CNPM student (default terms: groups, credits fail; GPA passes). */
export function syntheticGraduation(options: { terms?: TranscriptTerm[] } = {}): EvaluatedGraduation {
  const base = syntheticStandards()[0]!;
  const standard = { ...base, data: { ...base.data, gpaScale: base.data.gpaScale ?? 4 } };
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
