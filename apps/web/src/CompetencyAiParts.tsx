import { useEffect, useState } from "react";
import { formatDateTime, formatElapsed, type workerLine } from "./career-ai-suggestions";
import type { CourseAiSuggestion } from "./competency-ai";

/** Small pieces shared by the Năng lực AI dialogs. */
export function WorkerLine({ line, loading }: { line: ReturnType<typeof workerLine>; loading: boolean }) {
  return <p className={`cai-worker cai-worker-${line.tone}`}><span aria-hidden="true" />{loading ? "Đang kiểm tra máy AI…" : line.text}</p>;
}

export function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <span className="cai-elapsed" aria-label={`Đã chạy ${formatElapsed(since, now)}`}>{formatElapsed(since, now)}</span>;
}

export function ReviewHead({ suggestion, heading, text }: { suggestion: CourseAiSuggestion; heading: string; text: string }) {
  return <div className="cai-review-head">
    <h3>{heading}</h3>
    <p className="cai-muted">{text}</p>
    <p className="cai-meta">Gợi ý bởi {suggestion.model ?? "mô hình AI"} chạy cục bộ · {formatDateTime(suggestion.completedAt)}</p>
  </div>;
}
