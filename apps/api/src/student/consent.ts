import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

// Date of the privacy policy a student agrees to before importing a transcript.
// Must equal `policyVersion` in apps/web/src/public-information.ts (checked by consent.test.ts).
export const TRANSCRIPT_POLICY_VERSION = "2026-10-04";

// Caller holds the user's row lock. Consent to a newer policy supersedes the active one;
// repeating consent to the same version keeps the original record.
export async function recordTranscriptConsent(client: PoolClient, userId: string) {
  await client.query(`UPDATE data_consents SET ended_at=now(),end_reason='superseded'
    WHERE user_id=$1 AND purpose='transcript_processing' AND ended_at IS NULL AND policy_version<>$2`, [userId, TRANSCRIPT_POLICY_VERSION]);
  await client.query(`INSERT INTO data_consents(id,user_id,purpose,policy_version) VALUES($1,$2,'transcript_processing',$3)
    ON CONFLICT(user_id,purpose) WHERE ended_at IS NULL DO NOTHING`, [randomUUID(), userId, TRANSCRIPT_POLICY_VERSION]);
}

export async function withdrawTranscriptConsent(client: PoolClient, userId: string) {
  await client.query(`UPDATE data_consents SET ended_at=now(),end_reason='withdrawn'
    WHERE user_id=$1 AND purpose='transcript_processing' AND ended_at IS NULL`, [userId]);
}
