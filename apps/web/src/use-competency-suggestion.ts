import { useEffect, useState } from "react";
import { workerLine } from "./career-ai-suggestions";
import { useCompetencyData } from "./competency-types";
import {
  COMPETENCY_AI_API, CompetencyAiError, POLL_STATUS_MS, POLL_SUGGESTION_MS,
  aiRequest, isPending, jsonPost, type CourseAiStatus, type CourseAiSuggestion,
} from "./competency-ai";

export type SuggestionBusy = "create" | "cancel" | "apply" | null;
export type SuggestionView = "loading" | "intro" | "waiting" | "failed" | "completed";

/**
 * One AI proposal shown in a dialog: the latest one (latestUrl), polled while it is queued or
 * processing, the worker state (polled until there is a result), and creating or cancelling it.
 */
export function useCompetencySuggestion(latestUrl: string, createUrl: string, createBody: unknown) {
  const liveStatus = useCompetencyData<CourseAiStatus>(`${COMPETENCY_AI_API}/status`);
  const latest = useCompetencyData<{ suggestion: CourseAiSuggestion | null }>(latestUrl);
  const [polledStatus, setPolledStatus] = useState<CourseAiStatus | null>(null);
  const [current, setCurrent] = useState<CourseAiSuggestion | null | undefined>(undefined);
  const [busy, setBusy] = useState<SuggestionBusy>(null);
  const [error, setError] = useState("");
  const status = polledStatus ?? liveStatus.data;
  const suggestion = current !== undefined ? current : latest.data?.suggestion ?? null;
  const pending = isPending(suggestion?.status);
  const suggestionId = suggestion?.id ?? null;
  const suggestionStatus = suggestion?.status ?? null;
  const view: SuggestionView = latest.loading && current === undefined ? "loading"
    : !suggestion || suggestion.status === "cancelled" ? "intro"
      : pending ? "waiting" : suggestion.status === "failed" ? "failed" : "completed";

  useEffect(() => {
    if (!suggestionId || !isPending(suggestionStatus)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await aiRequest<{ suggestion: CourseAiSuggestion }>(`${COMPETENCY_AI_API}/${encodeURIComponent(suggestionId)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (next.suggestion.status !== suggestionStatus) { setCurrent(next.suggestion); return; }
      } catch (failure) {
        if (!controller.signal.aborted && failure instanceof CompetencyAiError && failure.code === "suggestion_not_found") { setCurrent(null); return; }
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), POLL_SUGGESTION_MS);
    };
    timer = setTimeout(() => void poll(), POLL_SUGGESTION_MS);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [suggestionId, suggestionStatus]);

  useEffect(() => {
    if (view === "completed") return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      aiRequest<CourseAiStatus>(`${COMPETENCY_AI_API}/status`, { signal: controller.signal })
        .then((next) => { if (!controller.signal.aborted) setPolledStatus(next); })
        .catch(() => { /* keep the last known worker state */ });
    }, POLL_STATUS_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [view]);

  const create = async () => {
    setBusy("create"); setError("");
    try {
      const response = await aiRequest<{ suggestion: CourseAiSuggestion }>(createUrl, jsonPost(createBody));
      setCurrent(response.suggestion);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };
  const cancel = async () => {
    if (!suggestion) return;
    setBusy("cancel"); setError("");
    try {
      const response = await aiRequest<{ suggestion: CourseAiSuggestion }>(`${COMPETENCY_AI_API}/${encodeURIComponent(suggestion.id)}/cancel`, jsonPost({}));
      setCurrent(response.suggestion);
    } catch (failure) {
      setError((failure as Error).message);
      if (failure instanceof CompetencyAiError && failure.code === "suggestion_not_active") {
        aiRequest<{ suggestion: CourseAiSuggestion }>(`${COMPETENCY_AI_API}/${encodeURIComponent(suggestion.id)}`).then((next) => setCurrent(next.suggestion)).catch(() => {});
      }
    } finally { setBusy(null); }
  };

  return {
    latest,
    /** The first load of the latest proposal failed and nothing was created since. */
    latestFailed: Boolean(latest.error) && current === undefined,
    statusLoading: liveStatus.loading && !status,
    worker: workerLine(status),
    suggestion, view, busy, setBusy, error, create, cancel,
  };
}
