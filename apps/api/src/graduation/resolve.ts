import type { PoolClient } from "pg";
import { isSpecialtyCode, resolveGraduationStandard } from "../competency-assessment/specialty.js";
import type { GraduationResolution, GraduationStandardInput, SpecialtyCode } from "../competency-assessment/types.js";
import type { GraduationData } from "./model.js";

// D3: the one way to pick a student's graduation standard. Used by the competency inputs
// (competency-assessment/inputs.ts), the student graduation page (student-graduation.ts) and the
// graduation advice. A student only ever sees the standard of the cohort in the account and the
// specialty declared in the profile.

type Db = Pick<PoolClient, "query">;

/** The resolution of the graduation page: the competency resolutions plus a profile without a cohort. */
export type StudentGraduationResolution = GraduationResolution | "cohort_unknown";

/** student_profiles.cohort_code as standards store it (trimmed, upper-case); null when missing or blank. */
export const normalizeCohortCode = (value: string | null | undefined): string | null => value?.trim().toUpperCase() || null;

/** student_profiles.specialty when it is a known code, else null ("Chưa xác định"). */
export const profileSpecialty = (value: unknown): SpecialtyCode | null => (isSpecialtyCode(value) ? value : null);

/** The full identity used to match a standard to a specialty (program code in specialty, classBlock or standardCode). */
export const standardIdentity = (data: Pick<GraduationData, "specialty" | "classBlock" | "standardCode">) => ({
  specialty: data.specialty ?? "", classBlock: data.classBlock ?? "", standardCode: data.standardCode ?? "",
});

/** Active standards of a cohort (normalized code), current revision, in a deterministic order. */
export async function readCohortStandards(db: Db, cohortCode: string): Promise<GraduationStandardInput[]> {
  const standards = await db.query<{ id: string; revision_id: string; version: number; data: GraduationData }>(
    `SELECT g.id,g.current_revision AS revision_id,r.version,r.data FROM graduation_standards g
     JOIN graduation_revisions r ON r.id=g.current_revision WHERE g.is_active AND g.cohort_code=$1 ORDER BY g.id`, [cohortCode]);
  return standards.rows.map((row) => ({ id: row.id, revisionId: row.revision_id, version: row.version, data: row.data }));
}

/**
 * The standard of a cohort for a specialty (resolveGraduationStandard with the full identity).
 * The picked standard's missing gpaScale reads 4, as everywhere else.
 */
export async function resolveCohortStandard(db: Db, cohortCode: string, specialty: SpecialtyCode | null): Promise<{
  resolution: GraduationResolution; standard: GraduationStandardInput | null;
}> {
  const resolved = resolveGraduationStandard(await readCohortStandards(db, cohortCode), specialty, (candidate) => standardIdentity(candidate.data));
  const standard = resolved.standard
    ? { ...resolved.standard, data: { ...resolved.standard.data, gpaScale: resolved.standard.data.gpaScale ?? 4 } }
    : null;
  return { resolution: resolved.resolution, standard };
}

/** The standard of a profile; a profile without a cohort is "cohort_unknown" and reads no standard. */
export async function resolveStudentStandard(db: Db, profile: { cohortCode: string | null; specialty: SpecialtyCode | null }): Promise<{
  resolution: StudentGraduationResolution; standard: GraduationStandardInput | null;
}> {
  const cohortCode = normalizeCohortCode(profile.cohortCode);
  if (!cohortCode) return { resolution: "cohort_unknown", standard: null };
  return resolveCohortStandard(db, cohortCode, profile.specialty);
}
