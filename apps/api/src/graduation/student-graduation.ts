import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { courseKey, isPassedState, transcriptCourses, uniqueCurriculumCourses } from "../competency-assessment/course-state.js";
import { classifyCurriculumSpecialty, specialtyCounts, suggestSpecialty } from "../competency-assessment/specialty.js";
import type { CurriculumCourseInput, GraduationStandardInput, SpecialtyCode } from "../competency-assessment/types.js";
import type { DatabasePool } from "../db/pool.js";
import type { TranscriptData } from "../student/transcript-parser.js";
import { evaluateGraduation, type GraduationEvaluation } from "./evaluation.js";
import { normalizeCohortCode, profileSpecialty, resolveStudentStandard, type StudentGraduationResolution } from "./resolve.js";

// The student graduation page's data (design §4), shared by the read-only graduation router and
// the graduation advice router: one snapshot of profile, resolved standard, transcript and CTĐT,
// the server-side evaluation and a fingerprint of the facts an AI advice is written from.

type Db = Pick<PoolClient, "query">;

export type StudentGraduationProfile = {
  /** student_profiles.cohort_code, trimmed and upper-case; null when unset. */
  cohortCode: string | null;
  /** student_profiles.specialty (student-declared); null = "Chưa xác định". */
  specialty: SpecialtyCode | null;
};

export type StudentGraduationSpecialtySuggestion = { code: SpecialtyCode; label: string; count: number };

export type StudentGraduation = {
  profile: StudentGraduationProfile;
  resolution: StudentGraduationResolution;
  /** Only the resolved standard (with its data); never another cohort's or specialty's. */
  standard: GraduationStandardInput | null;
  transcript: { version: string; updatedAt: string } | null;
  /** Null without a resolved standard or a transcript. */
  evaluation: GraduationEvaluation | null;
  /** graduationFingerprint of the evaluation; null without one. */
  fingerprint: string | null;
  /** Only for "specialty_unset": the one specialty whose mandatory courses the student passed. */
  specialtySuggestion: StudentGraduationSpecialtySuggestion | null;
};

/** Courses of the cohort's single active CTĐT (current revision); [] when there is none or several. */
export async function readCohortCurriculumCourses(db: Db, cohortCode: string): Promise<CurriculumCourseInput[]> {
  const curricula = await db.query<{ revision_id: string }>(
    `SELECT c.current_revision AS revision_id FROM curricula c JOIN curriculum_revisions r ON r.id=c.current_revision
     WHERE c.is_active AND c.cohort_code=$1 ORDER BY c.id`, [cohortCode]);
  if (curricula.rows.length !== 1) return [];
  const courses = await db.query<{ code: string; name: string; credits: string | number; type: string; block: string; specialty: string; semester: number | null; study_year: number | null }>(
    `SELECT code,name,credits,course_type AS type,block,specialty,semester,study_year FROM curriculum_courses
     WHERE revision_id=$1 ORDER BY position,code`, [curricula.rows[0]!.revision_id]);
  return courses.rows.map((row) => ({
    code: row.code, name: row.name, credits: Number(row.credits), type: row.type, block: row.block,
    specialty: row.specialty, semester: row.semester, studyYear: row.study_year,
  }));
}

/** Same rule as the competency assessment: suggested only when the passed mandatory specialty courses point to one specialty. */
function specialtySuggestionFor(courses: readonly CurriculumCourseInput[], transcript: TranscriptData): StudentGraduationSpecialtySuggestion | null {
  if (!courses.length) return null;
  const records = transcriptCourses(transcript);
  const suggestion = suggestSpecialty(specialtyCounts(uniqueCurriculumCourses(courses).map((course) => ({
    type: course.type, specialty: classifyCurriculumSpecialty(course.specialty),
    passed: isPassedState(records.get(courseKey(course.code))?.state ?? "not_taken"),
  }))));
  return suggestion && { code: suggestion.code, label: suggestion.label, count: suggestion.passedCount };
}

/**
 * Reads and evaluates the graduation page of one student with plain SELECTs, every list in a
 * deterministic order. The caller runs it in one REPEATABLE READ READ ONLY transaction
 * (loadStudentGraduation); no row locks are taken.
 */
export async function readStudentGraduation(db: Db, userId: string): Promise<StudentGraduation> {
  const profileRow = (await db.query<{ cohort_code: string | null; specialty: string | null }>(
    "SELECT cohort_code,specialty FROM student_profiles WHERE user_id=$1", [userId])).rows[0];
  const profile: StudentGraduationProfile = {
    cohortCode: normalizeCohortCode(profileRow?.cohort_code), specialty: profileSpecialty(profileRow?.specialty),
  };
  const { resolution, standard } = await resolveStudentStandard(db, profile);
  const transcriptRow = (await db.query<{ version: string; data: TranscriptData; updated_at: Date | string }>(
    "SELECT version,parsed_data AS data,updated_at FROM student_transcripts WHERE user_id=$1", [userId])).rows[0];
  const transcript = transcriptRow
    ? { version: transcriptRow.version, updatedAt: new Date(transcriptRow.updated_at).toISOString(), data: transcriptRow.data }
    : null;
  // The CTĐT only refines credits and elective codes, or suggests a specialty; missing or ambiguous → none.
  const curriculumCourses = transcript && profile.cohortCode && (standard || resolution === "specialty_unset")
    ? await readCohortCurriculumCourses(db, profile.cohortCode) : [];
  const evaluation = standard && transcript ? evaluateGraduation({ standard, transcript, curriculumCourses }) : null;
  return {
    profile,
    resolution,
    standard,
    transcript: transcript && { version: transcript.version, updatedAt: transcript.updatedAt },
    evaluation,
    fingerprint: standard && evaluation ? graduationFingerprint({ profile, standard, evaluation }) : null,
    specialtySuggestion: resolution === "specialty_unset" && transcript ? specialtySuggestionFor(curriculumCourses, transcript.data) : null,
  };
}

/** readStudentGraduation in its own REPEATABLE READ READ ONLY snapshot. */
export async function loadStudentGraduation(pool: DatabasePool, userId: string): Promise<StudentGraduation> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await readStudentGraduation(client, userId);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** JSON with object keys sorted at every level, so equal facts always give the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export type GraduationFingerprintInput = {
  profile: StudentGraduationProfile;
  standard: Pick<GraduationStandardInput, "revisionId">;
  evaluation: GraduationEvaluation;
};

/**
 * The facts an AI advice is written from: profile (cohort, specialty), standard revision,
 * transcript version and latest term, calcVersion, every status, the bounds/requirement/remaining
 * of each group, credits and GPA, the not-passed courses (code, state, credits, attempts) of the
 * groups that are not passed, the in-progress courses (code, credits), the unknown-result course
 * codes, the improvement candidates (code, state, credits) and the data warnings with their numbers.
 * What is read from the transcript or the standard alone is covered by their versions; the explicit
 * facts also catch a changed CTĐT (credits, elective codes) or profile.
 */
export function graduationFingerprintFacts({ profile, standard, evaluation }: GraduationFingerprintInput) {
  const credits = evaluation.credits;
  const gpa = evaluation.gpa;
  return {
    v: 1,
    cohortCode: profile.cohortCode,
    specialty: profile.specialty,
    standardRevisionId: standard.revisionId,
    transcriptVersion: evaluation.asOf.transcriptVersion,
    latestTerm: evaluation.asOf.latestTerm,
    calcVersion: evaluation.calcVersion,
    status: evaluation.status,
    groupStatus: evaluation.groupStatus,
    needsImprovement: evaluation.needsImprovement,
    groups: evaluation.groups.map((group) => ({
      id: group.id, label: group.label, code: group.code, curriculumElectiveCode: group.curriculumElectiveCode, unit: group.unit,
      status: group.status, lower: group.lower, upper: group.upper, required: group.required, remaining: group.remaining,
      missing: group.status === "pass" ? [] : group.courses.filter((course) => !isPassedState(course.state))
        .map((course) => [course.code, course.state, course.credits, course.attempts]),
    })),
    credits: credits && {
      lower: credits.lower, upper: credits.upper, required: credits.required, status: credits.status, source: credits.source, remaining: credits.remaining,
    },
    gpa: { actual: gpa.actual, required: gpa.required, scale: gpa.scale, status: gpa.status, source: gpa.source, remaining: gpa.remaining },
    inProgress: evaluation.inProgress.map((course) => [course.code, course.credits]),
    unknownResults: evaluation.unknownResults.map((course) => course.code),
    improvement: evaluation.improvementCandidates.map((course) => [course.code, course.state, course.credits]),
    // A credits_mismatch warning's computed bounds follow the CTĐT credits.
    warnings: evaluation.warnings.map(({ code, count, printed, computedLower, computedUpper }) => ({ code, count, printed, computedLower, computedUpper })),
  };
}

/** sha256 hex of the canonical JSON of graduationFingerprintFacts (advice dedupe and "stale"). */
export const graduationFingerprint = (input: GraduationFingerprintInput): string =>
  createHash("sha256").update(canonicalJson(graduationFingerprintFacts(input))).digest("hex");
