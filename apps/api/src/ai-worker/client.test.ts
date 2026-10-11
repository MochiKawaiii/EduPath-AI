import { describe, expect, it } from "vitest";
import { WorkerApiError, createWorkerClient } from "./client.js";
import type { FetchLike } from "./ollama.js";

const key = "w".repeat(48);
const claimed = {
  id: "11111111-1111-4111-8111-111111111111",
  leaseToken: "22222222-2222-4222-8222-222222222222",
  promptVersion: "comp-v1",
  system: "s",
  user: "u",
  schema: { type: "object" },
  options: { num_ctx: 16384, num_predict: 4096 }
};

function recorder(response: () => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return response();
  };
  return { calls, fetch };
}

describe("createWorkerClient", () => {
  it("posts with the bearer key, refuses redirects and parses a claimed job", async () => {
    const { calls, fetch } = recorder(() => Response.json({ job: claimed }));
    const client = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch });
    // A server released before career suggestions sends no kind: the job is a competency assessment.
    expect(await client.claim()).toEqual({ ...claimed, kind: "competency_assessment" });
    expect(calls[0]?.url).toBe("http://localhost:4000/api/worker/competency-assessments/claim");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${key}`);
  });

  it("returns null when no job is queued and sends complete/extend to the job path", async () => {
    const { calls, fetch } = recorder(() => Response.json({ job: null, leaseUntil: "2026-10-11T10:00:00Z", ok: true }));
    const client = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch });
    expect(await client.claim()).toBeNull();
    expect(await client.extend(claimed.id, claimed.leaseToken)).toEqual({ leaseUntil: "2026-10-11T10:00:00Z" });
    await client.complete(claimed.id, { leaseToken: claimed.leaseToken, error: "ai_timeout" });
    expect(calls[1]?.url).toContain(`/${claimed.id}/extend`);
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ leaseToken: claimed.leaseToken, error: "ai_timeout" });
  });

  it("rejects redirects, oversized responses, malformed jobs and surfaces API error codes", async () => {
    const redirect = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch: recorder(() => new Response(null, { status: 302, headers: { location: "https://evil.example" } })).fetch });
    await expect(redirect.heartbeat()).rejects.toMatchObject({ code: "redirect_refused" });

    const big = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, maxResponseBytes: 100, fetch: recorder(() => new Response("x".repeat(500))).fetch });
    await expect(big.claim()).rejects.toMatchObject({ code: "response_too_large" });

    const malformed = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch: recorder(() => Response.json({ job: { ...claimed, id: "../admin" } })).fetch });
    await expect(malformed.claim()).rejects.toMatchObject({ code: "invalid_claim_response" });

    const expired = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch: recorder(() => Response.json({ error: "job_expired" }, { status: 409 })).fetch });
    const error = await expired.extend(claimed.id, "x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkerApiError);
    expect(error).toMatchObject({ status: 409, code: "job_expired" });
  });
});

describe("job kinds", () => {
  it("advertises every supported kind on heartbeat and claim and reads the job kind", async () => {
    const { calls, fetch } = recorder(() => Response.json({ job: { ...claimed, kind: "career_skill_suggestion" } }));
    const client = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch });
    await client.heartbeat();
    expect((await client.claim())?.kind).toBe("career_skill_suggestion");
    for (const call of calls) expect(JSON.parse(String(call.init?.body))).toEqual({ kinds: ["competency_assessment", "career_skill_suggestion"] });
  });

  it("can advertise fewer kinds and rejects a kind it does not know", async () => {
    const { calls, fetch } = recorder(() => Response.json({ job: { ...claimed, kind: "something_new" } }));
    const client = createWorkerClient({ apiUrl: "http://localhost:4000", workerKey: key, fetch, kinds: ["competency_assessment"] });
    await expect(client.claim()).rejects.toMatchObject({ code: "invalid_claim_response" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ kinds: ["competency_assessment"] });
  });
});
