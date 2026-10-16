// Queue hook of the competency "AI 100%" mode (comp-ai-v1). Same contract and rules as ai/queue.ts (called
// inside the student router's write transactions with the student's row lock; one pending job per student;
// the shared cap of pending jobs), but the job carries runner 'cloud' and the scoring prompt built from the
// raw data, the assessment is marked scoring_mode 'ai', and the API server's own runner (runner.ts) does
// the work, so "worker online" is always true.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { cancelPending, COMPETENCY_AI_QUEUE_LOCK_KEY, type CompetencyAiQueue, MAX_PENDING_AI_JOBS, othersPending, type QueueInput } from "../ai/queue.js";
import { createCompetencyAiExpiry } from "../ai/worker-router.js";
import { buildScoringInput } from "./scoring-prompt.js";

/** After the write transaction has had time to commit, so the runner can see the new job. */
const KICK_DELAY_MS = 1000;

async function insertCloudJob(client: PoolClient, input: QueueInput): Promise<"queued"> {
  if (!input.inputs) throw new Error("cloud_scoring_needs_inputs");
  const aiInput = buildScoringInput(input.inputs, input.result);
  await client.query(
    "INSERT INTO stu_comp_ai_jobs(id,assessment_id,user_id,status,runner,ai_input) VALUES($1,$2,$3,'queued','cloud',$4::jsonb)",
    [randomUUID(), input.assessmentId, input.userId, JSON.stringify(aiInput)]);
  await client.query(
    `UPDATE stu_comp_assessments SET scoring_mode='ai',ai_scoring=NULL,ai_status='queued',ai_error_code=NULL,ai_output=NULL,ai_model=NULL,
      ai_model_digest=NULL,ollama_version=NULL,prompt_version=NULL,ai_completed_at=NULL WHERE id=$1 AND user_id=$2`,
    [input.assessmentId, input.userId]);
  return "queued";
}

export function createCloudCompetencyAiQueue(options: { onQueued?: () => void } = {}): CompetencyAiQueue {
  const expire = createCompetencyAiExpiry();
  const kick = () => { if (options.onQueued) setTimeout(options.onQueued, KICK_DELAY_MS).unref?.(); };
  return {
    enabled: true,
    mode: "cloud",
    async enqueue(client, input) {
      await client.query("SELECT pg_advisory_xact_lock($1)", [COMPETENCY_AI_QUEUE_LOCK_KEY]);
      await cancelPending(client, input.userId);
      await expire(client);
      if (await othersPending(client, input.userId) >= MAX_PENDING_AI_JOBS) {
        await client.query("UPDATE stu_comp_assessments SET scoring_mode='ai',ai_status='deferred',ai_error_code=NULL WHERE id=$1 AND user_id=$2",
          [input.assessmentId, input.userId]);
        return "deferred";
      }
      const outcome = await insertCloudJob(client, input);
      kick();
      return outcome;
    },
    async regenerate(client, input) {
      await client.query("SELECT pg_advisory_xact_lock($1)", [COMPETENCY_AI_QUEUE_LOCK_KEY]);
      await expire(client);
      if (await othersPending(client, input.userId) >= MAX_PENDING_AI_JOBS) return "deferred";
      await cancelPending(client, input.userId);
      const outcome = await insertCloudJob(client, input);
      kick();
      return outcome;
    },
    async cancel(client, input) {
      await client.query("SELECT pg_advisory_xact_lock($1)", [COMPETENCY_AI_QUEUE_LOCK_KEY]);
      return (await cancelPending(client, input.userId, input.assessmentId)) > 0;
    },
    async workerOnline(db) {
      // Called by GET /latest and /latest/status; a failed expiry must not break the read.
      await expire(db).catch(() => false);
      return true;
    },
  };
}
