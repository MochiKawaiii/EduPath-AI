import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./student-icons";
import { useLiveData } from "./use-live-data";
import { INFERRED_RESULT_NOTE } from "./transcript-results";
import {
  ADVICE_API, ADVICE_POLL_MS, COURSE_FILTERS, COURSE_STATES, GRADUATION_API, INLINE_COURSES, STATUS_DISPLAY,
  adviceAnnouncement, adviceFocusLabel, adviceStateCopy, adviceView, asOfLine, conditionItems, courseStateText, filterCourses,
  formatDateTime, formatElapsed, formatNumber, groupFacts, groupShortfall, groupViews, loadErrorMessage, methodNotes, modelLabel,
  normalizeAdviceResponse, normalizeAdviceStatus, normalizeAdviceWrite, profileLine, requestErrorMessage, scoreParts,
  shouldPollAdvice, standardMeta, standardThresholds, suggestionItems, toneClass, unresolvedCopy, verdictHeadline, warningNotes,
  type AdviceKind, type AdviceView, type ConditionItem, type CourseFilter, type CourseView, type EnsureState, type GroupView,
  type SuggestionCourse, type SuggestionItem, type Tone,
} from "./student-graduation-data";
import type {
  AdviceOutput, GradStatus, GraduationAdviceResponse, GraduationEvaluation, StoredAdvice, StudentGraduationResponse,
} from "./student-graduation-types";
import "./student-curriculum.css";
import "./student-graduation.css";

// #graduation: the student's own graduation standard (cohort in the account + specialty in the
// profile), the server's verdict with what is missing and what to do, AI advice written
// automatically from the same facts, and the comparison by knowledge group and by course.

type ApiError = Error & { code?: string; status?: number };

async function readGraduation(response: Response): Promise<StudentGraduationResponse> {
  const data = await response.json().catch(() => null) as (StudentGraduationResponse & { error?: string }) | null;
  // A body without a profile/resolution is not this API's answer (e.g. an older server): say so instead of breaking.
  if (!response.ok || !data?.profile || !data.resolution) throw new Error(loadErrorMessage(response.status, data?.error));
  return data;
}
async function readAdvice(response: Response): Promise<GraduationAdviceResponse> {
  const data = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(requestErrorMessage(data?.error));
  return normalizeAdviceResponse(data);
}
async function readAdviceStatus(response: Response) {
  if (!response.ok) throw new Error(`advice status ${response.status}`);
  return normalizeAdviceStatus(await response.json());
}
const getJson = (url: string, signal: AbortSignal) => fetch(url, { credentials: "include", cache: "no-store", signal });
async function postAdvice(action: "ensure" | "retry") {
  const response = await fetch(`${ADVICE_API}/${action}`, {
    method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    const error: ApiError = new Error(requestErrorMessage(data.error));
    error.code = data.error; error.status = response.status;
    throw error;
  }
  return normalizeAdviceWrite(data);
}

/* -------------------------------------------------------------- AI advice */

type AdviceState = { view: AdviceView; retry: () => void; retrying: boolean; retryError: string; announcement: string };

/**
 * The AI advice of the current facts, generated automatically: POST /ensure once per fingerprint
 * per page session when GET /advice says it is needed, poll /status while it is queued or being
 * written, re-read GET /advice when the job changes. No consent dialog, no create/cancel button.
 */
function useGraduationAdvice(): AdviceState {
  const live = useLiveData(ADVICE_API, 0, readAdvice);
  const [current, setCurrent] = useState<GraduationAdviceResponse | null>(null);
  useEffect(() => { if (live.data) setCurrent(live.data); }, [live.data]);
  const response = current ?? live.data;
  /**
   * Applies a stored advice for the current facts (from /ensure or /retry). Both answer after the
   * first response was copied into `current`, so `value` is set; a newer fingerprint wins.
   */
  const apply = (advice: StoredAdvice | null, fingerprint: string | null) => setCurrent((value) => {
    if (!value || (fingerprint !== null && value.fingerprint !== fingerprint)) return value;
    return advice ? { ...value, advice, stale: false, needsAdvice: false } : { ...value, needsAdvice: false };
  });

  const row = response?.advice ?? null;
  const [remembered, setRemembered] = useState<StoredAdvice | null>(null);
  useEffect(() => { if (row?.status === "completed" && row.output) setRemembered(row); }, [row]);

  const [ensure, setEnsure] = useState<EnsureState>(null);
  const ensured = useRef(new Set<string>());
  const fingerprint = response?.fingerprint ?? null;
  const wanted = Boolean(response?.aiEnabled && response.needsAdvice && fingerprint);
  useEffect(() => {
    if (!wanted || !fingerprint || ensured.current.has(fingerprint)) return;
    ensured.current.add(fingerprint);
    setEnsure({ fingerprint, state: "sending" });
    postAdvice("ensure").then((result) => {
      setEnsure({ fingerprint, state: result.deferred ? "deferred" : "sent" });
      if (!result.deferred) apply(result.advice, fingerprint);
    }, () => setEnsure({ fingerprint, state: "error" }));
  }, [wanted, fingerprint]);

  // Poll the small status payload only while a stored advice can still change on its own
  // (never for "deferred": nothing was stored and its id is null).
  const adviceId = row?.id ?? null, status = row?.status ?? null;
  useEffect(() => {
    if (!adviceId || !shouldPollAdvice(status)) return;
    const pending = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const now = await readAdviceStatus(await getJson(`${ADVICE_API}/status`, pending.signal));
        if (pending.signal.aborted) return;
        if (now.id !== adviceId || now.status !== status) {
          const fresh = await readAdvice(await getJson(ADVICE_API, pending.signal));
          if (pending.signal.aborted) return;
          setCurrent(fresh);
          if (fresh.advice?.id !== adviceId || fresh.advice?.status !== status) return;
        } else {
          setCurrent((value) => value && (value.worker.online !== now.worker.online || value.worker.supportsAdvice !== now.worker.supportsAdvice)
            ? { ...value, worker: now.worker } : value);
        }
      } catch { /* a failed poll keeps the last state; the next one tries again */ }
      if (!pending.signal.aborted) timer = setTimeout(() => void poll(), ADVICE_POLL_MS);
    };
    timer = setTimeout(() => void poll(), ADVICE_POLL_MS);
    return () => { pending.abort(); clearTimeout(timer); };
  }, [adviceId, status]);

  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const retry = () => {
    setRetrying(true); setRetryError("");
    postAdvice("retry").then((result) => {
      if (result.deferred) setRetryError(requestErrorMessage("queue_full"));
      else apply(result.advice, null);
    }, (error: Error) => setRetryError(error.message)).finally(() => setRetrying(false));
  };

  const view = adviceView({ response, loading: live.loading, failed: Boolean(live.error), ensure, remembered });
  const [announcement, setAnnouncement] = useState("");
  const shown = useRef<AdviceKind | null>(null);
  useEffect(() => {
    const before = shown.current;
    shown.current = view.kind;
    if (before && before !== view.kind && before !== "loading" && before !== "hidden" && before !== "unavailable") setAnnouncement(adviceAnnouncement(view.kind));
  }, [view.kind]);
  return { view, retry, retrying, retryError, announcement };
}

function Elapsed({ since }: { since: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <span className="sg-ai-elapsed"><span className="sr-only">Đã chạy </span>{formatElapsed(since, now)}</span>;
}

function AdviceContent({ advice, note }: { advice: StoredAdvice & { output: AdviceOutput }; note?: string }) {
  const { output } = advice;
  return <div className={`sg-ai-body${note ? " sg-ai-dimmed" : ""}`}>
    {note && <p className="sg-ai-old">{note}</p>}
    {output.summary && <p className="sg-ai-summary">{output.summary}</p>}
    {output.advice.length > 0 && <div className="sg-ai-block">
      <h4>Lời khuyên</h4>
      <ul className="sg-ai-items">{output.advice.map((item, index) => <li key={index}>
        <span className="sg-ai-focus">{adviceFocusLabel(item)}</span>
        <p>{item.text}</p>
      </li>)}</ul>
    </div>}
    {output.nextSteps.length > 0 && <div className="sg-ai-block">
      <h4>Bước tiếp theo</h4>
      <ol className="sg-ai-steps">{output.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
    </div>}
    <p className="sg-ai-footer">{modelLabel(advice.model)}, chạy cục bộ · tạo lúc {formatDateTime(advice.completedAt ?? advice.createdAt)}. Lời khuyên do AI viết dựa trên kết quả đã tính, có thể chưa chính xác — hãy đối chiếu số liệu và trao đổi với cố vấn học tập.</p>
  </div>;
}

function AdvicePanel({ advice }: { advice: AdviceState }) {
  const { view } = advice;
  if (view.kind === "hidden") return null;
  if (view.kind === "disabled") return <p className="sg-ai-off">Lời khuyên từ EduPath AI hiện chưa được bật. Các đề xuất ở trên do hệ thống tính và đã đầy đủ.</p>;
  const copy = adviceStateCopy(view);
  // The spinner only turns while something is moving; an offline or outdated AI machine just waits.
  const pending = view.kind === "preparing" || view.kind === "processing" || (view.kind === "queued" && view.worker === "ready");
  const problem = view.kind === "failed" || view.kind === "request_failed" || view.kind === "unavailable";
  const previous = "previous" in view ? view.previous : null;
  return <section className="sg-ai" aria-labelledby="sg-ai-title">
    <div className="sg-ai-heading">
      <span className="sg-ai-icon" aria-hidden="true"><Icon name="spark" /></span>
      <h3 id="sg-ai-title">Lời khuyên từ EduPath AI</h3>
      <span className="sg-ai-tag">AI</span>
    </div>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{advice.announcement}</p>
    {view.kind === "completed"
      ? <AdviceContent advice={view.advice} note={view.stale ? "Bảng điểm hoặc tiêu chuẩn đã thay đổi sau khi lời khuyên này được viết; hãy đối chiếu với kết quả ở trên." : undefined} />
      : <>
        <div className={`sg-ai-state${pending ? " sg-ai-pending" : ""}${problem ? " sg-ai-problem" : ""}`}>
          {pending && <span className="sg-ai-spinner" aria-hidden="true" />}
          <strong>{copy?.title}</strong>
          {view.kind === "processing" ? <p><Elapsed since={view.since} /> · {copy?.text}</p> : copy?.text ? <p>{copy.text}</p> : null}
          {view.kind === "failed" && <div className="sg-ai-actions">
            <button type="button" className="sw-outline" disabled={advice.retrying} onClick={advice.retry}><Icon name="refresh" />{advice.retrying ? "Đang gửi…" : "Thử lại"}</button>
          </div>}
          {advice.retryError && <p className="sg-ai-error" role="alert">{advice.retryError}</p>}
        </div>
        {previous && <AdviceContent advice={previous} note="Lời khuyên trước, viết cho dữ liệu cũ — có thể không còn đúng. Lời khuyên mới sẽ thay thế khi sẵn sàng." />}
      </>}
  </section>;
}

/* ---------------------------------------------------------------- results */

function StatusText({ status }: { status: GradStatus }) {
  const display = STATUS_DISPLAY[status];
  return <span className={`sg-state ${toneClass(display.tone)}`}><span aria-hidden="true">{display.glyph}</span> {display.label}</span>;
}

/** One coloured list of conditions; an empty list stays neutral so a passing page shows no red box. */
function ConditionList({ tone, glyph, title, items, empty }: { tone: Tone; glyph: string; title: string; items: ConditionItem[]; empty?: string }) {
  return <div className={`sg-box ${items.length ? `sg-box-${tone}` : "sg-box-none"}`}>
    <h3><span aria-hidden="true">{glyph}</span> {title}{items.length > 0 && <span className="sg-count">{items.length}</span>}</h3>
    {items.length ? <ul className="sg-conditions">{items.map((item) => <li key={item.key}>
      <strong>{item.title}</strong>: {item.progress}
      {item.shortfall && <> — <span className="sg-shortfall">{item.shortfall}</span></>}
      {item.note && <> — {item.note}</>}
    </li>)}</ul> : <p className="sg-box-empty">{empty}</p>}
  </div>;
}

function CourseBullets({ courses }: { courses: SuggestionCourse[] }) {
  const item = (course: SuggestionCourse) => <li key={course.key}>
    <span className="sg-code">{course.code}</span>
    <span className="sg-course-name">{course.name}</span>
    {(course.credits !== null || course.detail) && <span className="sg-course-meta">{[course.credits !== null ? `${formatNumber(course.credits)} TC` : null, course.detail].filter(Boolean).join(" · ")}</span>}
    <span className={`sg-state ${toneClass(course.tone)}`}><span aria-hidden="true">{course.glyph}</span> {course.state}</span>
  </li>;
  const rest = courses.slice(INLINE_COURSES);
  return <>
    <ul className="sg-course-bullets">{courses.slice(0, INLINE_COURSES).map(item)}</ul>
    {rest.length > 0 && <details className="sg-more">
      <summary>Xem thêm {formatNumber(rest.length)} học phần</summary>
      <ul className="sg-course-bullets">{rest.map(item)}</ul>
    </details>}
  </>;
}

function Suggestions({ items }: { items: SuggestionItem[] }) {
  return <div className="sg-box sg-box-todo">
    <h3><span aria-hidden="true">→</span> Đề xuất điều cần làm</h3>
    <ol className="sg-todo">{items.map((item) => <li key={item.key}>
      <p className="sg-todo-text">{item.text}</p>
      {item.coursesLabel && <p className="sg-todo-label">{item.coursesLabel}</p>}
      {item.courses.length > 0 && <CourseBullets courses={item.courses} />}
      {item.note && <p className="sg-todo-note">{item.note}</p>}
    </li>)}</ol>
  </div>;
}

function EvaluationResult({ evaluation, advice }: { evaluation: GraduationEvaluation; advice: AdviceState }) {
  const verdict = verdictHeadline(evaluation);
  const items = conditionItems(evaluation);
  const unknown = items.filter((item) => item.status === "unknown");
  const warnings = warningNotes(evaluation);
  return <>
    <p className={`sg-banner sg-banner-${verdict.tone}`} role="status"><span className="sg-glyph" aria-hidden="true">{verdict.glyph}</span><span>{verdict.text}</span></p>
    <div className="sg-checklists">
      <ConditionList tone="pass" glyph="✓" title="Đã đạt" items={items.filter((item) => item.status === "pass")} empty="Chưa có điều kiện nào đạt." />
      <ConditionList tone="fail" glyph="✗" title="Chưa đạt" items={items.filter((item) => item.status === "fail")} empty="Không có điều kiện nào chưa đạt." />
    </div>
    {unknown.length > 0 && <ConditionList tone="unknown" glyph="?" title="Chưa xác định" items={unknown} />}
    <Suggestions items={suggestionItems(evaluation)} />
    {warnings.length > 0 && <ul className="sg-warnings" aria-label="Lưu ý về dữ liệu">{warnings.map((warning) => <li key={warning.code}>
      <span aria-hidden="true">!</span><span>{warning.text}</span>
    </li>)}</ul>}
    <details className="sg-method">
      <summary>Cách đối chiếu</summary>
      <ul>{methodNotes(evaluation).map((note) => <li key={note}>{note}</li>)}</ul>
    </details>
    <AdvicePanel advice={advice} />
  </>;
}

function ResultSection({ data, advice }: { data: StudentGraduationResponse; advice: AdviceState }) {
  const evaluation = data.evaluation;
  return <section className="sw-panel sg-section sg-result" aria-labelledby="sg-result-title">
    <div>
      <h2 id="sg-result-title" className="sg-title">Kết quả xét tốt nghiệp tính đến thời điểm hiện tại</h2>
      {evaluation && <p className="sg-meta">{asOfLine(evaluation)}</p>}
    </div>
    {evaluation ? <EvaluationResult evaluation={evaluation} advice={advice} /> : <div className="sg-empty-state">
      <span className="sg-empty-icon" aria-hidden="true"><Icon name="document" /></span>
      <h3>Chưa có bảng điểm để đối chiếu</h3>
      <p>Hãy import bảng điểm PDF xuất từ cổng đào tạo tại mục Hồ sơ và bảng điểm. Kết quả xét tốt nghiệp sẽ được tính ngay sau khi import.</p>
      <a className="sw-outline" href="#profile">Import bảng điểm</a>
    </div>}
    <p className="sg-disclaimer">Kết quả xét tốt nghiệp chính thức do nhà trường công bố.</p>
  </section>;
}

/* --------------------------------------------------------------- standard */

function StandardSection({ data }: { data: StudentGraduationResponse }) {
  const standard = data.standard;
  if (!standard) {
    const copy = unresolvedCopy(data);
    return <section className="sw-panel sg-section sg-standard" aria-labelledby="sg-standard-title">
      <div className="sg-heading">
        <p className="sc-eyebrow">Tiêu chuẩn xét tốt nghiệp của bạn</p>
        <h2 id="sg-standard-title" className="sg-title">{copy.title}</h2>
        <p className="sg-meta">{profileLine(data.profile)}</p>
      </div>
      <div className="sg-unresolved">
        <p>{copy.text}</p>
        {copy.suggestion && <p className="sg-suggestion">{copy.suggestion}</p>}
        {copy.action && <a className="sw-outline" href={copy.action.href}>{copy.action.label}</a>}
      </div>
      <p className="sg-disclaimer">Kết quả xét tốt nghiệp chính thức do nhà trường công bố.</p>
    </section>;
  }
  return <section className="sw-panel sg-section sg-standard" aria-labelledby="sg-standard-title">
    <div className="sg-heading">
      <p className="sc-eyebrow">Tiêu chuẩn xét tốt nghiệp của bạn</p>
      <h2 id="sg-standard-title" className="sg-title">{standard.name}</h2>
      <p className="sg-meta">{standardMeta(data)}</p>
    </div>
    <dl className="sg-stats">{standardThresholds(standard).map((item) => <div key={item.key}>
      <dt>{item.label}</dt>
      <dd className={item.known ? undefined : "sg-unknown"}>{item.value}</dd>
    </div>)}</dl>
    {standard.notes.trim() && <div className="sc-condition sg-notes">
      <h3>Ghi chú</h3>
      <p className="sc-prewrap">{standard.notes}</p>
    </div>}
    <p className="sg-auto-note">
      <Icon name="info" />
      <span>Tiêu chuẩn được chọn tự động theo khóa trong tài khoản và chuyên ngành trong hồ sơ của bạn. <a className="sg-link" href="#profile">Cập nhật chuyên ngành</a></span>
    </p>
  </section>;
}

/* ------------------------------------------------------------- comparison */

type TableOptions = { scale: 4 | 10; showGroup: boolean; hasResults: boolean };

function CourseRow({ course, options }: { course: CourseView; options: TableOptions }) {
  const row = course.row;
  const score = row ? scoreParts(row, options.scale) : null;
  const state = row ? COURSE_STATES[row.state] : null;
  return <tr>
    <td className="sg-code-cell">{course.code}</td>
    <td className="sg-name-cell">{course.name}{course.conditionOnly && <small>Môn điều kiện (*): cần đạt nhưng không tính tín chỉ tích lũy, điểm trung bình</small>}</td>
    {options.showGroup && <td className="sg-group-cell">{course.groupTitle}</td>}
    <td className="sg-num" data-label="TC">{formatNumber(course.credits)}</td>
    {options.hasResults && <>
      <td className="sg-score-cell" data-label="Điểm">{score ? <><strong>{score.main}</strong>{score.detail && <small>{score.detail}</small>}</> : "—"}</td>
      <td className="sg-state-cell" data-label="Trạng thái">
        {row && state ? <span className={`sg-state ${toneClass(state.tone)}`}><span aria-hidden="true">{state.glyph}</span> {courseStateText(row)}</span> : <span className="sg-tone-neutral">—</span>}
        {row?.inferred && <small>{INFERRED_RESULT_NOTE}</small>}
        {course.improvement && <small className="sg-tone-info">{course.improvement === "failed" ? "Nên học lại để nâng điểm trung bình" : "Có thể học cải thiện để nâng điểm trung bình"}</small>}
      </td>
    </>}
  </tr>;
}

/** Course table of a group or of the whole list; the score and state columns only once there are results. */
function CourseTable({ courses, options, caption }: { courses: CourseView[]; options: TableOptions; caption: string }) {
  return <div className="sg-table-wrap" tabIndex={0} role="region" aria-label={caption}>
    <table className={`sg-table sg-course-table${options.showGroup ? " sg-course-table-wide" : ""}`}>
      <caption className="sr-only">{caption}</caption>
      <thead><tr>
        <th scope="col" className="sg-col-code">Mã</th><th scope="col">Tên học phần</th>{options.showGroup && <th scope="col" className="sg-col-group">Nhóm</th>}
        <th scope="col" className="sg-col-credits sg-num">TC</th>
        {options.hasResults && <><th scope="col" className="sg-col-score">Điểm</th><th scope="col" className="sg-col-state">Trạng thái</th></>}
      </tr></thead>
      <tbody>{courses.map((course) => <CourseRow key={course.key} course={course} options={options} />)}</tbody>
    </table>
  </div>;
}

function GroupTable({ groups, scale, hasResults }: { groups: GroupView[]; scale: 4 | 10; hasResults: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const allOpen = groups.length > 0 && groups.every((group) => open[group.id]);
  return <div className="sg-view-body">
    <div className="sg-toolbar">
      <p className="sg-muted">{formatNumber(groups.length)} nhóm kiến thức theo tiêu chuẩn. Chọn tên nhóm để xem các học phần.</p>
      {groups.length > 1 && <button type="button" className="sg-text-button" onClick={() => setOpen(Object.fromEntries(groups.map((group) => [group.id, !allOpen])))}>
        {allOpen ? "Thu gọn tất cả" : "Mở rộng tất cả"}
      </button>}
    </div>
    <div className="sg-table-wrap sg-group-wrap">
      <table className="sg-table sg-group-table">
        <caption className="sr-only">Đối chiếu theo nhóm kiến thức</caption>
        <thead><tr><th scope="col">Nhóm</th><th scope="col">Đã có</th><th scope="col">Yêu cầu</th><th scope="col">Còn thiếu</th><th scope="col">Kết quả</th></tr></thead>
        {groups.map((group, index) => {
          const isOpen = Boolean(open[group.id]);
          const id = `sg-group-${index}`;
          const result = group.result;
          const undecided = result && result.lower !== null && result.upper !== null && result.upper > result.lower ? result.upper - result.lower : 0;
          return <tbody key={group.id}>
            <tr className="sg-group-row">
              <th scope="row">
                <button type="button" className="sg-group-toggle" aria-expanded={isOpen} aria-controls={id} onClick={() => setOpen((value) => ({ ...value, [group.id]: !isOpen }))}>
                  <span className="sg-chevron" aria-hidden="true" /><span>{group.title}</span>
                </button>
                <small>{group.kind === "mandatory" ? "Bắt buộc" : "Tự chọn"} · {formatNumber(group.courses.length)} học phần</small>
              </th>
              <td data-label="Đã có">{group.achieved}
                {result && undecided > 0 && <small>+{formatNumber(undecided)} {result.unit} chưa rõ kết quả</small>}
                {result?.kind === "mandatory" && result.accumulatedCredits !== null && <small>{formatNumber(result.accumulatedCredits)} TC tích lũy</small>}
              </td>
              <td data-label="Yêu cầu">{group.required}</td>
              <td data-label="Còn thiếu">{groupShortfall(result)}</td>
              <td data-label="Kết quả">{result ? <StatusText status={result.status} /> : <span className="sg-tone-neutral">Chưa có bảng điểm</span>}</td>
            </tr>
            <tr id={id} className="sg-group-detail" hidden={!isOpen}>
              <td colSpan={5}>
                <p className="sg-group-facts">{groupFacts(group)}</p>
                <CourseTable courses={group.courses} options={{ scale, showGroup: false, hasResults }} caption={`Học phần của ${group.title}`} />
              </td>
            </tr>
          </tbody>;
        })}
      </table>
    </div>
  </div>;
}

function CourseList({ groups, scale, hasResults }: { groups: GroupView[]; scale: 4 | 10; hasResults: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CourseFilter>("");
  const all = useMemo(() => groups.flatMap((group) => group.courses), [groups]);
  const shown = filterCourses(all, query, filter);
  return <div className="sg-view-body">
    <div className="sg-filters">
      <label className="sg-field sg-field-search">Tìm học phần
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mã hoặc tên học phần…" />
      </label>
      <label className="sg-field">Trạng thái
        <select value={filter} disabled={!hasResults} onChange={(event) => setFilter(event.target.value as CourseFilter)}>
          {COURSE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    </div>
    <p className="sg-muted" aria-live="polite">{shown.length === all.length ? `${formatNumber(all.length)} học phần` : `${formatNumber(shown.length)} / ${formatNumber(all.length)} học phần`}</p>
    {shown.length
      ? <CourseTable courses={shown} options={{ scale, showGroup: true, hasResults }} caption="Đối chiếu theo danh sách học phần" />
      : <p className="sg-empty">Không có học phần phù hợp với bộ lọc.</p>}
  </div>;
}

function CompareSection({ data }: { data: StudentGraduationResponse }) {
  const [tab, setTab] = useState<"groups" | "courses">("groups");
  const groups = useMemo(() => groupViews(data), [data]);
  const scale = data.evaluation?.gpa.scale ?? data.standard?.gpaScale ?? 4;
  const hasResults = data.evaluation !== null;
  return <section className="sw-panel sg-section sg-compare" aria-labelledby="sg-compare-title">
    <div>
      <h2 id="sg-compare-title" className="sg-title">Đối chiếu chi tiết với tiêu chuẩn</h2>
      <p className="sg-lead">{hasResults ? "Xem kết quả theo từng nhóm kiến thức của tiêu chuẩn hoặc theo từng học phần." : "Các nhóm kiến thức và học phần của tiêu chuẩn. Kết quả sẽ hiện sau khi bạn import bảng điểm."}</p>
    </div>
    <div className="sg-tabs" role="group" aria-label="Cách đối chiếu">
      <button type="button" className="sg-tab" aria-pressed={tab === "groups"} aria-controls="sg-view-groups" onClick={() => setTab("groups")}>Đối chiếu theo nhóm kiến thức</button>
      <button type="button" className="sg-tab" aria-pressed={tab === "courses"} aria-controls="sg-view-courses" onClick={() => setTab("courses")}>Đối chiếu theo danh sách học phần</button>
    </div>
    <div id="sg-view-groups" className="sg-view" hidden={tab !== "groups"}><GroupTable groups={groups} scale={scale} hasResults={hasResults} /></div>
    <div id="sg-view-courses" className="sg-view" hidden={tab !== "courses"}><CourseList groups={groups} scale={scale} hasResults={hasResults} /></div>
  </section>;
}

/* ------------------------------------------------------------------- page */

export default function StudentGraduation() {
  const [revision, setRevision] = useState(0);
  const live = useLiveData(GRADUATION_API, revision, readGraduation);
  const advice = useGraduationAdvice();
  const data = live.data;
  return <div className="sg-page">
    {!data && live.loading && <section className="sw-panel sg-section" aria-busy="true"><p role="status" className="sg-muted">Đang tải điều kiện xét tốt nghiệp…</p></section>}
    {!data && !live.loading && <section className="sw-panel sg-section">
      <div className="sw-error sg-load-error" role="alert">
        <span>{live.error ?? "Không thể tải điều kiện xét tốt nghiệp. Vui lòng thử lại."}</span>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>Thử lại</button>
      </div>
    </section>}
    {data && <>
      <StandardSection data={data} />
      {data.standard && <ResultSection data={data} advice={advice} />}
      {data.standard && <CompareSection data={data} />}
    </>}
  </div>;
}
