import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabasePool } from "../db/pool.js";

// Date of the privacy policy a student agrees to before importing a transcript or running a
// competency assessment.
// Must equal `policyVersion` in apps/web/src/public-information.ts (checked by consent.test.ts).
export const TRANSCRIPT_POLICY_VERSION = "2026-10-16";

/** data_consents.purpose values allowed by migrations 018 and 030. */
export type ConsentPurpose = "transcript_processing" | "competency_assessment";

// Caller holds the user's row lock. Consent to a newer policy supersedes the active one;
// repeating consent to the same version keeps the original record.
export async function recordConsent(client: PoolClient, userId: string, purpose: ConsentPurpose) {
  await client.query(`UPDATE data_consents SET ended_at=now(),end_reason='superseded'
    WHERE user_id=$1 AND purpose=$3 AND ended_at IS NULL AND policy_version<>$2`, [userId, TRANSCRIPT_POLICY_VERSION, purpose]);
  await client.query(`INSERT INTO data_consents(id,user_id,purpose,policy_version) VALUES($1,$2,$4,$3)
    ON CONFLICT(user_id,purpose) WHERE ended_at IS NULL DO NOTHING`, [randomUUID(), userId, TRANSCRIPT_POLICY_VERSION, purpose]);
}

export async function withdrawConsent(client: PoolClient, userId: string, purpose: ConsentPurpose) {
  await client.query(`UPDATE data_consents SET ended_at=now(),end_reason='withdrawn'
    WHERE user_id=$1 AND purpose=$2 AND ended_at IS NULL`, [userId, purpose]);
}

export const recordTranscriptConsent = (client: PoolClient, userId: string) => recordConsent(client, userId, "transcript_processing");
export const withdrawTranscriptConsent = (client: PoolClient, userId: string) => withdrawConsent(client, userId, "transcript_processing");

/** Policy version of the student's active consent for a purpose, or null when none is active. */
export async function activeConsentVersion(db: Pick<DatabasePool, "query"> | PoolClient, userId: string, purpose: ConsentPurpose): Promise<string | null> {
  const result = await db.query<{ policy_version: string }>(
    "SELECT policy_version FROM data_consents WHERE user_id=$1 AND purpose=$2 AND ended_at IS NULL", [userId, purpose]);
  return result.rows[0]?.policy_version ?? null;
}
