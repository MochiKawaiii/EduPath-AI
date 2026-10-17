import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { Icon } from "./student-icons";
import { useLiveData } from "./use-live-data";
import { competencyPolicyHref, policyVersion } from "./public-information";
import type { StudentProfile } from "./StudentOverview";
import { specialtyLabel, type AiStatus, type AssessmentResult, type AssessmentStatusResponse, type CareerRequirementResult, type CourseSuggestion, type LatestAssessmentResponse, type LevelCode, type SkillPlan, type SkillResult, type StoredAssessment, type SupportCourse } from "./competency-assessment-types";
import {
  COMPETENCY_API, CONFIDENCE_LABELS, COURSE_STATE_LABELS, EMPTY_SKILL_FILTERS, LEVEL_COLUMNS, LEVEL_SCALE, PRECONDITION_COPY, PRIORITY_LABELS,
  aiErrorMessage, aiStateCopy, bucketSkills, canRegenerate, careerSkillKeys, courseStanding, dataUsedLine, eligibilityDisplay, errorMessage, filterSkills, formatDateTime,
  formatNumber, formatPercent, formatScore, gapStatusDisplay, groupEvidenceCounts, historySentence, historyYears, isGap, isPreconditionError, levelSentence, levelStep, levelSummary, mapAiOutput, modelLabel,
  plansFor, scoreDifference, shouldPoll, skillName, sortRequirements, type MappedAiOutput, type PreconditionError, type SkillFilters, type StatusTone,
} from "./student-competency-data";
import { readGraduation } from "./student-graduation-api";
import { GRADUATION_API, unresolvedCopy, verdictHeadline } from "./student-graduation-data";
import type { GraduationEvaluation } from "./student-graduation-types";
import "./student-curriculum.css";
import "./student-graduation.css";
import "./student-records.css";
import "./student-competency.css";

// Two student pages share this module and one stored assessment:
// - #competency ("Đánh giá năng lực", STU-COMP): overall and group scores, the proficiency table,
//   progress versus the training plan and the graduation check of the graduation page;
// - #skill-gap ("Khoảng trống kỹ năng", STU-GAP): career fit, missing skills and their shortfall,
//   the courses that close them and the skills to study alone.
export type CompetencyView = "competency" | "gap";

type Profile = Pick<StudentProfile, "careerPositionId" | "careerPosition"> & { specialty?: string | null };
type ApiError = Error & { code?: string; status?: number };

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", cache: "no-store", ...init });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    const error: ApiError = new Error(errorMessage(data.error ?? (response.status === 404 ? "not_found" : null)));
    error.code = data.error; error.status = response.status;
    throw error;
  }
  return data;
}
async function readLatest(response: Response): Promise<LatestAssessmentResponse> {
  const data = await response.json().catch(() => ({})) as LatestAssessmentResponse & { error?: string };
  if (!response.ok) throw new Error(errorMessage(data.error, "Chưa tải được kết quả đánh giá năng lực."));
  return { assessment: data.assessment ?? null, aiEnabled: Boolean(data.aiEnabled), workerOnline: Boolean(data.workerOnline), consentVersion: typeof data.consentVersion === "string" ? data.consentVersion : null };
}
async function readTranscriptPresence(response: Response): Promise<boolean> {
  if (!response.ok) throw new Error("Chưa kiểm tra được bảng điểm.");
  const data = await response.json().catch(() => ({})) as { transcript?: unknown };
  return Boolean(data.transcript);
}
const jsonWrite = (method: string, body: unknown = {}): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const scrollToSection = (id: string) => {
  const target = document.getElementById(id);
  if (!target) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  target.focus({ preventScroll: true });
};

/* ------------------------------------------------------------ small parts */

function LevelBadge({ level, label }: { level: LevelCode | null; label: string | null }) {
  const step = levelStep(level);
  const none = level === "no_evidence" || level === null;
  return <span className={`scomp-level scomp-level-${step}${none ? " scomp-level-none" : ""}`}>
    <span className="scomp-pips" aria-hidden="true">{[1, 2, 3, 4].map((pip) => <i key={pip} className={pip <= step ? "is-on" : undefined} />)}</span>
    {label ?? "Chưa có minh chứng"}
  </span>;
}
/** Score bar on the shared 0–100 scale; decorative, the number is printed beside it. */
function ScoreBar({ score, level, ticks = [], threshold }: { score: number | null; level: LevelCode | null; ticks?: number[]; threshold?: number }) {
  const width = score === null ? 0 : Math.max(0, Math.min(100, score));
  return <span className={`scomp-bar${score === null ? " scomp-bar-empty" : ""}`} aria-hidden="true">
    {ticks.map((tick) => <i key={tick} className="scomp-bar-tick" style={{ left: `${tick}%` }} />)}
    {score !== null && <span className={`scomp-bar-fill scomp-fill-${levelStep(level)}`} style={{ width: `${width}%` }} />}
    {threshold !== undefined && <i className="scomp-bar-threshold" style={{ left: `${threshold}%` }} />}
  </span>;
}
function StatusText({ tone, glyph, text }: { tone: StatusTone; glyph: string; text: string }) {
  return <span className={`scomp-status ${tone === "neutral" ? "scomp-status-neutral" : `sg-status-${tone}`}`}><span aria-hidden="true">{glyph}</span> {text}</span>;
}
function Section({ id, title, children, className = "", description, aside }: { id: string; title: string; children: ReactNode; className?: string; description?: ReactNode; aside?: ReactNode }) {
  return <section id={id} tabIndex={-1} className={`sw-panel scomp-section ${className}`} aria-labelledby={`${id}-title`}>
    <div className="scomp-section-heading"><div><h2 id={`${id}-title`}>{title}</h2>{description && <p className="scomp-lead">{description}</p>}</div>{aside}</div>
    {children}
  </section>;
}

function useModal(onCancel: () => void, busy: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    if (element && !element.open) element.showModal?.();
    return () => { element?.close?.(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return { ref: dialog, onCancel: (event: SyntheticEvent) => { event.preventDefault(); if (!busy) onCancel(); } };
}

function ConsentDialog({ busy, onClose, onConfirm }: { busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const modal = useModal(onClose, busy);
  const [checked, setChecked] = useState(false);
  return <dialog ref={modal.ref} className="sr-confirm-dialog scomp-dialog" aria-labelledby="scomp-consent-title" aria-describedby="scomp-consent-text" onCancel={modal.onCancel}>
    <h2 id="scomp-consent-title">Đồng ý đánh giá năng lực</h2>
    <div id="scomp-consent-text">
      <p>EduPath sẽ dùng bảng điểm, khóa, chuyên ngành và nghề mục tiêu của bạn để tính điểm năng lực, khoảng trống kỹ năng và gợi ý học phần. Kết quả được lưu trong tài khoản của bạn (tối đa 20 lần gần nhất) đến khi bạn xóa.</p>
      <p>Nếu nhận xét AI được bật, mô hình chạy cục bộ trên máy của nhóm phát triển chỉ nhận mã, tên học phần, điểm và kết quả đã tính — không nhận họ tên, MSSV, email hay tệp PDF.</p>
    </div>
    <label className="sr-confirm scomp-consent-check"><input type="checkbox" checked={checked} disabled={busy} onChange={(event) => setChecked(event.target.checked)} /><span>Tôi đồng ý để EduPath AI xử lý dữ liệu học tập của tôi cho việc đánh giá năng lực theo <a href={competencyPolicyHref} target="_blank" rel="noreferrer">Chính sách bảo mật</a>.</span></label>
    <div className="sr-actions sr-form-actions">
      <button type="button" className="sr-secondary" disabled={busy} onClick={onClose} autoFocus>Để sau</button>
      <button type="button" className="sw-primary" disabled={busy || !checked} onClick={onConfirm}>{busy ? "Đang đánh giá…" : "Đồng ý và đánh giá"}</button>
    </div>
  </dialog>;
}

function DeleteDialog({ busy, error, onClose, onConfirm }: { busy: boolean; error: string; onClose: () => void; onConfirm: () => void }) {
  const modal = useModal(onClose, busy);
  return <dialog ref={modal.ref} className="sr-confirm-dialog scomp-dialog" aria-labelledby="scomp-delete-title" aria-busy={busy} onCancel={modal.onCancel}>
    <h2 id="scomp-delete-title">Xóa kết quả đánh giá</h2>
    <p>Xóa toàn bộ kết quả đánh giá năng lực và nhận xét AI đã lưu, đồng thời rút lại đồng ý cho việc đánh giá? Bảng điểm và hồ sơ của bạn vẫn được giữ nguyên. Bạn có thể đánh giá lại bất cứ lúc nào.</p>
    {error && <p className="sr-error" role="alert">{error}</p>}
    <div className="sr-actions sr-form-actions">
      <button type="button" className="sr-secondary" disabled={busy} onClick={onClose} autoFocus>Hủy</button>
      <button type="button" className="sw-primary sr-delete-confirm" disabled={busy} onClick={onConfirm}>{busy ? "Đang xóa…" : "Xác nhận xóa"}</button>
    </div>
  </dialog>;
}

/* ------------------------------------------------- "Đánh giá năng lực" page */

function Overview({ result }: { result: AssessmentResult }) {
  const { overall, career } = result;
  const names = (keys: string[]) => keys.map((key) => ({ key, name: skillName(result, key) })).filter((item): item is { key: string; name: string } => Boolean(item.name));
  const strengths = names(result.highlights.strengths), improvements = names(result.highlights.improvements);
  return <Section id="scomp-overview" title="Tổng quan" className="scomp-overview">
    <div className="scomp-overview-grid">
      <div className="scomp-score-card">
        <span className="scomp-kicker">Điểm năng lực tổng</span>
        <p className="scomp-big"><strong>{formatScore(overall.score)}</strong><span>/100</span></p>
        <p className="scomp-score-tags"><LevelBadge level={overall.level} label={overall.levelLabel} />{overall.confidence && <span className="scomp-confidence">{CONFIDENCE_LABELS[overall.confidence]}</span>}</p>
        <p className="scomp-prose">{levelSentence(overall.level)}</p>
        <p className="scomp-meta">Dựa trên {overall.basis.skillsWithEvidence.toLocaleString("vi-VN")}/{overall.basis.applicableSkills.toLocaleString("vi-VN")} kỹ năng có minh chứng từ {overall.basis.evidenceCourses.toLocaleString("vi-VN")} học phần. Điểm tổng là trung bình của {overall.groupsWithScore.toLocaleString("vi-VN")} nhóm có dữ liệu.</p>
      </div>
      <div className="scomp-groups">
        <h3>Theo nhóm năng lực</h3>
        <ul>{result.groups.map((group) => { const counts = groupEvidenceCounts(result.skills, group.key); return <li key={group.key}>
          <div className="scomp-group-label"><strong>{group.name}</strong><span>{counts.withEvidence.toLocaleString("vi-VN")}/{counts.total.toLocaleString("vi-VN")} kỹ năng có minh chứng</span></div>
          <ScoreBar score={group.score} level={group.level} ticks={[50, 70, 85]} />
          <div className="scomp-group-value"><strong>{formatScore(group.score)}</strong><span>{group.levelLabel}</span></div>
        </li>; })}</ul>
        <div className="scomp-axis-row" aria-hidden="true"><span /><div className="scomp-axis"><span style={{ left: "0%" }}>0</span><span style={{ left: "50%" }}>50</span><span style={{ left: "70%" }}>70</span><span style={{ left: "85%" }}>85</span><span style={{ left: "100%" }}>100</span></div><span /></div>
      </div>
      <div className="scomp-fit-tile">
        <span className="scomp-kicker">Mức phù hợp nghề</span>
        {career ? <>
          <strong className="scomp-fit-label">{career.fitLabel}</strong>
          <p>{career.nameVi}</p>
          <p className="scomp-meta">{career.summaryText}</p>
          <a className="sw-text-link" href="#skill-gap">Xem khoảng trống kỹ năng <Icon name="arrow" /></a>
        </> : <>
          <strong className="scomp-fit-label">Chưa chọn nghề</strong>
          <p className="scomp-meta">Chọn nghề mục tiêu để biết kỹ năng nào cần bổ sung.</p>
          <a className="sw-text-link" href="#profile">Chọn nghề mục tiêu <Icon name="arrow" /></a>
        </>}
      </div>
    </div>
    {(strengths.length > 0 || improvements.length > 0) && <div className="scomp-chips">
      {strengths.length > 0 && <div><span className="scomp-chip-title">Điểm mạnh</span><ul>{strengths.map((item) => <li key={item.key} className="scomp-chip">{item.name}</li>)}</ul></div>}
      {improvements.length > 0 && <div><span className="scomp-chip-title">Cần củng cố</span><ul>{improvements.map((item) => <li key={item.key} className="scomp-chip scomp-chip-soft">{item.name}</li>)}</ul></div>}
    </div>}
    <details className="scomp-legend"><summary>Thang mức năng lực</summary>
      <ul>{LEVEL_SCALE.map((item) => <li key={item.code}><LevelBadge level={item.code} label={item.label} /><span className="scomp-legend-range">{item.range}</span><span>{item.text}</span></li>)}</ul>
    </details>
  </Section>;
}

/** STU-COMP-07: the competency at the end of each graded term, grouped by school year. */
function HistorySection({ result }: { result: AssessmentResult }) {
  const history = result.history;
  const years = useMemo(() => historyYears(history ?? []), [history]);
  const sentence = history ? historySentence(history) : null;
  const columns = 5 + result.groups.length;
  return <Section id="scomp-history" title="Theo dõi năng lực theo học kỳ" description="Điểm năng lực tính lũy kế đến cuối mỗi học kỳ, chỉ từ các học phần đã có kết quả đến học kỳ đó, theo cùng cách tính và trọng số hiện hành. Dùng để thấy năng lực của bạn thay đổi thế nào qua từng năm học.">
    {!history ? <p className="scomp-meta">Kết quả này được tính trước khi có phần theo dõi theo học kỳ. Bấm “Đánh giá lại” để xem năng lực của bạn qua từng năm, từng học kỳ.</p>
      : !history.length ? <p className="scomp-meta">Bảng điểm chưa có học kỳ nào có điểm nên chưa theo dõi được.</p> : <>
        {sentence && <p className="scomp-prose">{sentence}</p>}
        <div className="scomp-table-scroll" tabIndex={0} role="region" aria-labelledby="scomp-history-caption">
          <table className="scomp-table scomp-history-table">
            <caption id="scomp-history-caption">Điểm năng lực tổng và điểm từng nhóm năng lực ở cuối mỗi học kỳ (thang 100)</caption>
            <thead><tr>
              <th scope="col">Học kỳ</th>
              <th scope="col" className="scomp-num">Học phần có kết quả</th>
              <th scope="col">Điểm năng lực tổng</th>
              <th scope="col">Mức</th>
              {result.groups.map((group) => <th key={group.key} scope="col" className="scomp-num">{group.name}</th>)}
              <th scope="col" className="scomp-num">Thay đổi</th>
            </tr></thead>
            {years.map((year) => <tbody key={year.schoolYear}>
              <tr className="scomp-year-row"><th colSpan={columns} scope="rowgroup">Năm học {year.schoolYear}<span>Cuối năm: {formatScore(year.end.overall.score)} · {year.end.overall.levelLabel}</span></th></tr>
              {year.rows.map((row) => <tr key={row.term} className={row.latest ? "scomp-history-latest" : undefined}>
                <th scope="row">Học kỳ {row.semester}{row.latest && <span className="scomp-career-tag">Hiện tại</span>}<small>{row.term}</small></th>
                <td className="scomp-num">{row.gradedCourses.toLocaleString("vi-VN")}</td>
                <td><span className="scomp-bullet"><ScoreBar score={row.overall.score} level={row.overall.level} ticks={[50, 70, 85]} /><strong>{formatScore(row.overall.score)}</strong></span></td>
                <td><LevelBadge level={row.overall.level} label={row.overall.levelLabel} /></td>
                {result.groups.map((group) => { const value = row.groups.find((item) => item.key === group.key); return <td key={group.key} className="scomp-num">
                  {value && value.score !== null ? <><strong>{formatScore(value.score)}</strong><small>{value.levelLabel}</small></> : <span className="scomp-zero">—</span>}
                </td>; })}
                <td className="scomp-num">{row.change === null ? <span className="scomp-zero">—</span>
                  : <span className={row.change > 0 ? "sg-status-pass" : row.change < 0 ? "sg-status-fail" : "scomp-zero"}>{row.change > 0 ? `+${row.change}` : row.change < 0 ? `−${Math.abs(row.change)}` : "0"}</span>}</td>
              </tr>)}
            </tbody>)}
          </table>
        </div>
        <p className="scomp-meta">Điểm của học kỳ trước không thay đổi khi bạn học lại sau đó: mỗi dòng chỉ dùng kết quả có đến học kỳ đó. Học kỳ chưa có điểm (đang học) chưa có dòng.</p>
      </>}
  </Section>;
}

const LEVEL_COLUMN_LABELS: Record<(typeof LEVEL_COLUMNS)[number], string> = {
  proficient: "Thành thạo", good: "Khá", basic: "Cơ bản", needs_work: "Cần củng cố", no_evidence: "Chưa có minh chứng",
};

function SkillsSection({ result }: { result: AssessmentResult }) {
  const [filters, setFilters] = useState<SkillFilters>(EMPTY_SKILL_FILTERS);
  const filtered = useMemo(() => filterSkills(result.skills, filters), [result.skills, filters]);
  const buckets = useMemo(() => bucketSkills(result, filtered), [result, filtered]);
  const summary = useMemo(() => levelSummary(result), [result]);
  const defaultOpen = (id: string) => result.groups.some((group) => group.key === id);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => expanded[id] ?? defaultOpen(id);
  const allOpen = buckets.length > 0 && buckets.every((bucket) => isOpen(bucket.id));
  const courses = useMemo(() => new Map(result.courses.map((course) => [course.code, course])), [result.courses]);
  const groups = useMemo(() => new Map(result.groups.map((group) => [group.key, group])), [result.groups]);
  const set = (patch: Partial<SkillFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const filtering = (Object.keys(EMPTY_SKILL_FILTERS) as (keyof SkillFilters)[]).some((key) => filters[key] !== EMPTY_SKILL_FILTERS[key]);
  // A count in the summary table filters the list below to exactly those skills.
  const show = (group: string, level: string) => {
    setFilters({ ...EMPTY_SKILL_FILTERS, group, level });
    setExpanded((current) => ({ ...current, [level === "no_evidence" ? "no-evidence" : group]: true }));
    scrollToSection("scomp-skill-list");
  };
  return <Section id="scomp-skills" title="Bảng phân tích mức độ thành thạo theo nhóm năng lực" description={`${result.skills.length.toLocaleString("vi-VN")} kỹ năng, chia theo nhóm. Mỗi kỹ năng được chấm theo thang 0–100 từ điểm các học phần minh chứng, theo trọng số học phần do Khoa cấu hình, rồi xếp vào một mức thành thạo.`}>
    <div className="scomp-value">
      <h3>Kết quả này cho biết gì?</h3>
      <ul>
        <li><strong>Thành thạo, Khá:</strong> kỹ năng bạn đã nắm chắc qua các học phần đã học; có thể ghi vào hồ sơ xin việc và dùng ngay trong dự án.</li>
        <li><strong>Cơ bản, Cần củng cố:</strong> kỹ năng nên ôn lại hoặc học cải thiện; học phần cụ thể cho từng kỹ năng có ở trang <a className="sw-text-link" href="#skill-gap">Khoảng trống kỹ năng</a>.</li>
        <li><strong>Chưa có minh chứng:</strong> bạn chưa học học phần nào đo kỹ năng đó — không phải điểm yếu.</li>
        <li><strong>Độ tin cậy:</strong> cho biết kết quả dựa trên bao nhiêu minh chứng; tin cậy thấp nghĩa là mới có ít học phần đo kỹ năng này.</li>
      </ul>
    </div>
    <div className="scomp-table-scroll" tabIndex={0} role="region" aria-labelledby="scomp-level-caption">
      <table className="scomp-table scomp-level-table">
        <caption id="scomp-level-caption">Số kỹ năng ở từng mức thành thạo trong mỗi nhóm. Chọn một số để xem đúng các kỹ năng đó.</caption>
        <thead><tr><th scope="col">Nhóm năng lực</th><th scope="col" className="scomp-num">Điểm nhóm</th><th scope="col">Mức của nhóm</th>{LEVEL_COLUMNS.map((level) => <th key={level} scope="col" className="scomp-num">{LEVEL_COLUMN_LABELS[level]}</th>)}</tr></thead>
        <tbody>{summary.map((row) => <tr key={row.key}>
          <th scope="row">{row.name}<small>{row.total.toLocaleString("vi-VN")} kỹ năng</small></th>
          <td className="scomp-num"><strong>{formatScore(row.score)}</strong></td>
          <td><LevelBadge level={row.level} label={row.levelLabel} /></td>
          {LEVEL_COLUMNS.map((level) => <td key={level} className="scomp-num">{row.counts[level] > 0
            ? <button type="button" className="scomp-count-button" aria-label={`${row.counts[level]} kỹ năng ${LEVEL_COLUMN_LABELS[level]} trong nhóm ${row.name}`} onClick={() => show(row.key, level)}>{row.counts[level].toLocaleString("vi-VN")}</button>
            : <span className="scomp-zero">0</span>}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="scomp-filters" id="scomp-skill-list" tabIndex={-1}>
      <label>Nhóm<select value={filters.group} onChange={(event) => set({ group: event.target.value })}><option value="">Tất cả nhóm</option>{result.groups.map((group) => <option key={group.key} value={group.key}>{group.name}</option>)}</select></label>
      <label>Mức<select value={filters.level} onChange={(event) => set({ level: event.target.value })}><option value="">Tất cả mức</option>{LEVEL_SCALE.map((level) => <option key={level.code} value={level.code}>{level.label}</option>)}</select></label>
      <label>Độ tin cậy<select value={filters.confidence} onChange={(event) => set({ confidence: event.target.value })}><option value="">Tất cả</option><option value="high">Cao</option><option value="medium">Trung bình</option><option value="low">Thấp</option></select></label>
      <label className="scomp-search">Tìm kỹ năng<input type="search" value={filters.search} onChange={(event) => set({ search: event.target.value })} placeholder="Tên kỹ năng hoặc mã học phần…" /></label>
      <label className="scomp-toggle"><input type="checkbox" checked={filters.careerOnly} onChange={(event) => set({ careerOnly: event.target.checked })} />Chỉ kỹ năng của nghề</label>
      <label className="scomp-toggle"><input type="checkbox" checked={filters.needsWork} onChange={(event) => set({ needsWork: event.target.checked })} />Chỉ cần cải thiện</label>
      <button type="button" className="sr-secondary" onClick={() => setExpanded(Object.fromEntries(buckets.map((bucket) => [bucket.id, !allOpen])))}>{allOpen ? "Thu gọn tất cả" : "Mở rộng tất cả"}</button>
    </div>
    <p className="scomp-meta" aria-live="polite">{filtered.length.toLocaleString("vi-VN")} kỹ năng phù hợp bộ lọc{filtering && <> · <button type="button" className="scomp-link-button" onClick={() => setFilters(EMPTY_SKILL_FILTERS)}>Xem tất cả kỹ năng</button></>}</p>
    {buckets.map((bucket) => { const group = groups.get(bucket.id); return <details key={bucket.id} className="scomp-bucket" open={isOpen(bucket.id)} onToggle={(event) => { const open = event.currentTarget.open; if (open !== isOpen(bucket.id)) setExpanded((current) => ({ ...current, [bucket.id]: open })); }}>
      <summary><strong>{bucket.title} ({bucket.skills.length.toLocaleString("vi-VN")})</strong>{group && group.score !== null && <span>Điểm nhóm {formatScore(group.score)} · {group.levelLabel}</span>}{bucket.note && <span>{bucket.note}</span>}</summary>
      <ul className="scomp-skill-list">{bucket.skills.map((skill) => <SkillRow key={skill.key} skill={skill} courses={courses} />)}</ul>
    </details>; })}
    {!buckets.length && <p className="sw-empty">Không có kỹ năng nào phù hợp bộ lọc.</p>}
  </Section>;
}

const ROLE_NOTES: Partial<Record<SkillResult["evidenceCourses"][number]["role"], string>> = { planned: "Chưa học", not_chosen: "Không thuộc lựa chọn tự chọn của bạn", in_progress: "Đang học", exempt: "Miễn/công nhận", studied: "Đã học" };
function SkillRow({ skill, courses }: { skill: SkillResult; courses: Map<string, AssessmentResult["courses"][number]> }) {
  return <li><details className="scomp-skill">
    <summary>
      <span className="scomp-skill-name">{skill.name}{skill.careerSkill && <span className="scomp-career-tag">Nghề mục tiêu</span>}</span>
      <LevelBadge level={skill.level} label={skill.levelLabel} />
      <span className="scomp-skill-score">{formatScore(skill.score)}</span>
      <span className="scomp-skill-meta">{skill.confidence ? CONFIDENCE_LABELS[skill.confidence] : "—"} · độ phủ {formatPercent(skill.coverage)}</span>
    </summary>
    <div className="scomp-skill-body">
      {skill.scope && <p className="scomp-prose"><strong>Phạm vi: </strong>{skill.scope}</p>}
      {skill.status === "not_applicable" && <p className="scomp-meta">{skill.notApplicableReason === "other_specialty" ? "Kỹ năng này chỉ có trong học phần của chuyên ngành khác." : skill.notApplicableReason === "elective_not_chosen" ? "Kỹ năng này nằm trong nhóm tự chọn bạn đã chọn đủ bằng học phần khác — không thuộc lựa chọn tự chọn của bạn." : "Học phần đo kỹ năng này không có tín chỉ."}</p>}
      <div className="scomp-table-scroll" tabIndex={0} role="region" aria-label={`Học phần minh chứng của ${skill.name}`}>
        <table className="scomp-table scomp-evidence">
          <caption>Học phần minh chứng của {skill.name}</caption>
          <thead><tr><th scope="col">Mã</th><th scope="col">Tên học phần</th><th scope="col">TC</th><th scope="col">Điểm</th><th scope="col">Kết quả</th><th scope="col">Số lần học</th><th scope="col">Trọng số</th><th scope="col">Học kỳ</th><th scope="col">Độ phủ</th></tr></thead>
          <tbody>{skill.evidenceCourses.map((row) => {
            const course = courses.get(row.code);
            return <tr key={row.code}>
              <td>{row.code}</td>
              <td>{course?.name ?? "—"}{ROLE_NOTES[row.role] && row.role !== "score" && <small>{ROLE_NOTES[row.role]}</small>}</td>
              <td className="scomp-num">{formatNumber(course?.credits)}</td>
              <td className="scomp-num">{course?.score10 === null || course?.score10 === undefined ? (course?.letter ?? "—") : `${formatNumber(course.score10)}${course.letter ? ` · ${course.letter}` : ""}`}</td>
              <td>{course ? COURSE_STATE_LABELS[course.state] : "—"}{course?.inferred && <small>suy ra từ điểm chữ</small>}</td>
              <td className="scomp-num">{course ? course.attempts.toLocaleString("vi-VN") : "—"}</td>
              <td className="scomp-num">{formatNumber(row.weight)}</td>
              <td>{course?.term ?? (course?.plannedTerm ? `Dự kiến ${course.plannedTerm}` : "—")}</td>
              <td className="scomp-num">{formatPercent(row.share)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {skill.otherSpecialtyCourses.length > 0 && <p className="scomp-meta">Học phần chuyên ngành khác cũng đo kỹ năng này: {skill.otherSpecialtyCourses.join(", ")}</p>}
    </div>
  </details></li>;
}

function ProgressSection({ result }: { result: AssessmentResult }) {
  const progress = result.progress;
  const late = (progress?.lateCount ?? 0) > 0;
  return <Section id="scomp-progress" title="Tiến độ so với kế hoạch đào tạo">
    {!progress ? <p className="scomp-meta">Chưa xác định được kế hoạch đào tạo áp dụng cho bạn nên chưa so sánh tiến độ. Xem cảnh báo dữ liệu bên dưới.</p> : <>
      <p className={`scomp-plan-status ${late ? "scomp-plan-late" : "scomp-plan-ok"}`}>
        <span aria-hidden="true">{late ? "✗" : "✓"}</span>
        <span>{late ? `Chậm so với kế hoạch: ${progress.lateCount.toLocaleString("vi-VN")} học phần · ${formatNumber(progress.lateCredits)} TC chưa hoàn thành đúng học kỳ dự kiến.` : "Đúng kế hoạch: bạn đã hoàn thành mọi học phần theo kế hoạch đào tạo đến học kỳ hiện tại."}</span>
      </p>
      <dl className="sg-stats scomp-stats">
        <div><dt>Học kỳ hiện tại (suy từ bảng điểm)</dt><dd>{progress.currentTerm ?? "—"}</dd></div>
        <div><dt>Chậm so với kế hoạch</dt><dd className={late ? "sg-status-fail" : "sg-status-pass"}>{progress.lateCount.toLocaleString("vi-VN")} <small>học phần · {formatNumber(progress.lateCredits)} TC</small></dd></div>
        <div><dt>Học kỳ tới{progress.nextTerm ? ` (${progress.nextTerm})` : ""}</dt><dd>{progress.nextCount.toLocaleString("vi-VN")} <small>học phần · {formatNumber(progress.nextCredits)} TC</small></dd></div>
      </dl>
      <div className="scomp-two-columns">
        <div><h3 className={`scomp-subtitle ${late ? "sg-status-fail" : "sg-status-pass"}`}>{late ? "Chậm so với kế hoạch" : "Đúng kế hoạch"}</h3>{progress.late.length ? <ul className="scomp-plan-list scomp-plan-list-late">{progress.late.map((entry, index) => <li key={index}>
          {entry.kind === "course" ? <><strong>{entry.name}</strong> <span className="scomp-code">{entry.code}</span><small>{formatNumber(entry.credits)} TC · kế hoạch {entry.termCode} · {COURSE_STATE_LABELS[entry.state]}</small></>
            : entry.kind === "choice" ? <><strong>{entry.label}</strong><small>Còn thiếu {entry.missing.toLocaleString("vi-VN")} {entry.unit === "course" ? "học phần" : "TC"} · kế hoạch {entry.termCode}</small><small>Lựa chọn: {entry.options.map((option) => option.name).join(", ")}</small></>
              : <><strong>{entry.label}</strong><small>Đã đạt {entry.passed}/{entry.required} · kế hoạch {entry.termCode}</small></>}
        </li>)}</ul> : <p className="scomp-meta sg-status-pass">Bạn đang theo đúng kế hoạch đào tạo.</p>}</div>
        <div><h3 className="scomp-subtitle">Học kỳ tới</h3>{progress.next.length ? <ul className="scomp-plan-list">{progress.next.map((entry, index) => <li key={index}>
          {entry.kind === "course" ? <><strong>{entry.name}</strong> <span className="scomp-code">{entry.code}</span><small>{formatNumber(entry.credits)} TC</small></>
            : entry.kind === "choice" ? <><strong>{entry.label}</strong><small>Chọn {entry.remaining.toLocaleString("vi-VN")} {entry.unit === "course" ? "học phần" : "TC"} trong: {entry.options.map((option) => option.name).join(", ")}</small></>
              : <><strong>{entry.label}</strong><small>Đã đạt {entry.passed}/{entry.required}</small></>}
        </li>)}</ul> : <p className="scomp-meta">Chưa có học phần nào theo kế hoạch cho học kỳ tới.</p>}</div>
      </div>
      {progress.informationalSections.length > 0 && <details className="scomp-legend"><summary>Mục chỉ để tham khảo, không tính chậm ({progress.informationalSections.length})</summary><ul>{progress.informationalSections.map((section, index) => <li key={index}><strong>{section.label}</strong> · {section.termCode}<span>{section.options.map((option) => option.name).join(", ")}</span></li>)}</ul></details>}
    </>}
  </Section>;
}

/** Only the verdict and the way to the graduation page; the criteria and what to do live there (user, 2026-10-17). */
function GraduationVerdict({ evaluation }: { evaluation: GraduationEvaluation }) {
  const verdict = verdictHeadline(evaluation);
  return <div className={`scomp-grad-verdict scomp-grad-${verdict.tone}`}>
    <p><span className="scomp-grad-glyph" aria-hidden="true">{verdict.glyph}</span><span>{verdict.text}</span></p>
    <a className="sw-outline scomp-grad-detail" href="#graduation">Xem chi tiết <Icon name="arrow" /></a>
  </div>;
}

/**
 * The graduation check of the graduation page (GET /api/student/graduation, computed on the server
 * when the page opens), never the copy stored with the assessment: both screens show the same
 * criteria, numbers, order and reasons.
 */
function GraduationSection() {
  const [revision, setRevision] = useState(0);
  const live = useLiveData(GRADUATION_API, revision, readGraduation);
  const data = live.data;
  const unresolved = data && !data.standard ? unresolvedCopy(data) : null;
  return <Section id="scomp-graduation" title="Xét tốt nghiệp (tham khảo)">
    {!data ? live.loading ? <p className="scomp-meta">Đang tải kết quả xét tốt nghiệp…</p>
      : <div className="sr-error" role="alert">{live.error ?? "Chưa tải được kết quả xét tốt nghiệp."}<button type="button" onClick={() => setRevision((value) => value + 1)}>Thử lại</button></div>
      : unresolved ? <div className="scomp-grad-unresolved"><strong>{unresolved.title}</strong><p className="scomp-meta">{unresolved.text}</p>{unresolved.action && <a className="sw-outline" href={unresolved.action.href}>{unresolved.action.label}</a>}</div>
        : !data.evaluation ? <p className="scomp-meta">Chưa có bảng điểm để đối chiếu. <a className="sw-text-link" href="#profile">Import bảng điểm</a></p>
          : <GraduationVerdict evaluation={data.evaluation} />}
  </Section>;
}

/** Data warnings and how the fit is computed. Only on #skill-gap: #competency dropped it (user, 2026-10-17). */
function WarningsSection({ result }: { result: AssessmentResult }) {
  return <Section id="scomp-warnings" title="Cảnh báo dữ liệu và cách tính mức phù hợp">
    {result.warnings.length ? <ul className="scomp-warnings">{result.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>
      <strong>{warning.message}</strong><p>{warning.consequence}</p>{warning.details.length > 0 && <ul>{warning.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
    </li>)}</ul> : <p className="scomp-meta">Không có cảnh báo dữ liệu cho lần đánh giá này.</p>}
    <details className="scomp-legend scomp-method"><summary>Cách tính mức phù hợp và khoảng trống</summary>
      <div className="scomp-prose">
        <p>Điểm từng kỹ năng lấy từ trang Đánh giá năng lực. Với nghề mục tiêu, kỹ năng Ưu tiên cần từ 70 (mức Khá) và kỹ năng Bắt buộc cần từ 85 (mức Thành thạo). Mức thiếu hụt là số điểm còn thiếu so với ngưỡng: đến 5 điểm là Gần ngưỡng, đến 15 điểm là Thiếu vừa, nhiều hơn là Thiếu nhiều.</p>
        <p>Mức phù hợp tính theo hệ số 2 cho Bắt buộc và 1 cho Ưu tiên: đạt ngưỡng được trọn điểm, dưới ngưỡng được tối đa một nửa, chưa học được 0; kỹ năng sắp học hoặc chưa đủ dữ liệu không tính. Từ 0,80 là Phù hợp, 0,50 đến dưới 0,80 là Khá phù hợp; nếu dưới một nửa hệ số có dữ liệu thì ghi Chưa đủ dữ liệu.</p>
        <p>Học phần gợi ý là học phần trong chương trình của bạn có đo kỹ năng còn thiếu, xếp theo mức đóng góp (tín chỉ × trọng số). Điều kiện đăng ký được kiểm tra theo học phần tiên quyết và học trước trong chương trình đào tạo.</p>
        <p>Phiên bản cách tính: {result.meta.calcVersion}.</p>
      </div>
    </details>
  </Section>;
}

/* ------------------------------------------------- "Khoảng trống kỹ năng" page */

function GapSummary({ result }: { result: AssessmentResult }) {
  const career = result.career;
  if (!career) return <Section id="sgap-summary" title="Mức phù hợp với nghề mục tiêu">
    <div className="sw-empty scomp-empty"><h3>Bạn chưa chọn nghề mục tiêu</h3><p>Khoảng trống kỹ năng được tính so với yêu cầu của nghề mục tiêu. Năng lực của bạn vẫn được đánh giá đầy đủ ở trang Đánh giá năng lực; chọn một nghề để biết kỹ năng nào đã đạt, kỹ năng nào còn thiếu và học phần nên học.</p><a className="sw-outline" href="#profile">Chọn nghề mục tiêu</a></div>
  </Section>;
  const missing = sortRequirements(career.requirements).filter((req) => req.status === "below" || req.status === "not_studied");
  return <Section id="sgap-summary" title="Mức phù hợp với nghề mục tiêu" description={<>So với yêu cầu của nghề <strong>{career.nameVi}</strong> ({career.nameEn}).{career.deleted && " Nghề này đã ngừng sử dụng trong danh mục; bạn nên chọn nghề khác."}</>}>
    <div className="scomp-fit-summary">
      <div><span className="scomp-kicker">Mức phù hợp</span><strong className="scomp-fit-label">{career.fitLabel}</strong></div>
      <ul className="scomp-fit-facts">
        <li>{career.summaryText}</li>
        <li>{career.dataText}</li>
        {career.weightedMeanScore !== null && <li>Điểm trung bình các kỹ năng nghề có điểm: <strong>{formatScore(career.weightedMeanScore)}</strong> ({career.weightedMeanCount.toLocaleString("vi-VN")} kỹ năng)</li>}
      </ul>
    </div>
    <div className="sgap-missing">
      <h3>Kỹ năng còn thiếu{missing.length > 0 && <span className="scomp-count">{missing.length.toLocaleString("vi-VN")}</span>}</h3>
      {missing.length ? <ul>{missing.map((req) => <li key={req.requirementId}>
        <strong>{req.skillName ?? req.title}</strong>
        <span className={req.isRequired ? "scomp-required" : "scomp-code"}>{req.priorityLabel}</span>
        <StatusText {...gapStatusDisplay(req)} />
        {req.deficitBandLabel && req.status === "below" && <span className="scomp-code">{req.deficitBandLabel}</span>}
      </li>)}</ul>
        : <p className={career.requirements.length ? "scomp-meta sg-status-pass" : "scomp-meta"}>{career.requirements.length ? "✓ Bạn đã đạt mọi kỹ năng có dữ liệu của nghề này." : "Nghề này chưa có yêu cầu kỹ năng trong danh mục nên chưa so sánh được."}</p>}
    </div>
    <p className="scomp-meta">Ngưỡng đạt: kỹ năng Ưu tiên từ 70 (mức Khá), kỹ năng Bắt buộc từ 85 (mức Thành thạo). Kỹ năng sắp học hoặc chưa đủ dữ liệu không được tính vào mức phù hợp.</p>
  </Section>;
}

function GapTable({ result }: { result: AssessmentResult }) {
  const [gapsOnly, setGapsOnly] = useState(false);
  const career = result.career;
  if (!career) return null;
  const rows = sortRequirements(career.requirements).filter((req) => !gapsOnly || isGap(req));
  return <Section id="scomp-career" title="Báo cáo chi tiết khoảng trống kỹ năng" description="Từng kỹ năng nghề yêu cầu: điểm hiện tại của bạn, ngưỡng cần đạt, mức thiếu hụt và trạng thái.">
    <label className="scomp-toggle"><input type="checkbox" checked={gapsOnly} onChange={(event) => setGapsOnly(event.target.checked)} />Chỉ kỹ năng chưa đạt</label>
    <div className="scomp-table-scroll" tabIndex={0} role="region" aria-labelledby="scomp-career-caption">
      <table className="scomp-table scomp-gap-table">
        <caption id="scomp-career-caption">Kỹ năng nghề {career.nameVi}: điểm hiện tại so với ngưỡng</caption>
        <thead><tr><th scope="col">Kỹ năng</th><th scope="col">Tính chất</th><th scope="col">Hiện tại</th><th scope="col">Ngưỡng</th><th scope="col">Chênh lệch</th><th scope="col">Trạng thái</th></tr></thead>
        <tbody>{rows.map((req) => <GapRow key={req.requirementId} req={req} />)}
          {!rows.length && <tr><td colSpan={6}>{career.requirements.length ? "Bạn đã đạt mọi kỹ năng có dữ liệu của nghề này." : "Nghề này chưa có yêu cầu kỹ năng trong danh mục nên chưa so sánh được."}</td></tr>}
        </tbody>
      </table>
    </div>
  </Section>;
}

function GapRow({ req }: { req: CareerRequirementResult }) {
  const status = gapStatusDisplay(req);
  const difference = scoreDifference(req);
  return <tr>
    <th scope="row"><span className="scomp-cell-title">{req.skillName ?? req.title}</span>{req.skillName && req.skillName !== req.title && <small>{req.title}</small>}</th>
    <td data-label="Tính chất"><span className={req.isRequired ? "scomp-required" : undefined}>{req.priorityLabel}</span></td>
    <td data-label="Hiện tại"><span className="scomp-bullet"><ScoreBar score={req.score} level={req.level} threshold={req.threshold} /><strong>{formatScore(req.score)}</strong></span>{req.levelLabel && <small>{req.levelLabel}</small>}</td>
    <td className="scomp-num" data-label="Ngưỡng">{formatScore(req.threshold)}</td>
    <td className="scomp-num" data-label="Chênh lệch">{difference === null ? "—" : difference > 0 ? `+${formatScore(difference)}` : formatScore(difference)}{req.deficitBandLabel && <small>{req.deficitBandLabel}</small>}</td>
    <td data-label="Trạng thái"><StatusText {...status} />{req.status === "no_data" && <small>{req.noDataReason === "other_specialty" ? "Chỉ có trong học phần của chuyên ngành khác." : "Chương trình đào tạo chưa có học phần đo kỹ năng này — không phải điểm yếu."}</small>}</td>
  </tr>;
}

const STANDING_GLYPH: Record<StatusTone, string> = { pass: "✓", fail: "✗", unknown: "?", neutral: "○" };
function CourseCard({ course, result }: { course: CourseSuggestion; result: AssessmentResult }) {
  const eligibility = eligibilityDisplay(course.eligibility, course.missing);
  const standing = courseStanding(course);
  const helped = course.skills.map((skill) => skillName(result, skill.key)).filter(Boolean);
  return <li className="scomp-course">
    <div className="scomp-course-head"><strong>{course.name}</strong><span className="scomp-code">{course.code}</span></div>
    <dl className="scomp-course-facts">
      <div><dt>Tín chỉ</dt><dd>{formatNumber(course.credits)}</dd></div>
      <div><dt>Học kỳ</dt><dd>{course.term ? (course.termSource === "plan" ? `${course.term} theo KHĐT` : `${course.term} theo CTĐT`) : "Chưa xếp lịch"}</dd></div>
      <div className="scomp-course-wide"><dt>Tình trạng của bạn</dt><dd><StatusText tone={standing.tone} glyph={STANDING_GLYPH[standing.tone]} text={standing.text} /></dd></div>
      <div className="scomp-course-wide"><dt>{course.kind === "improve" ? "Đăng ký học cải thiện" : "Điều kiện đăng ký"}</dt><dd><StatusText {...eligibility} /></dd></div>
    </dl>
    <p className="scomp-course-reason">{course.reason}</p>
    {course.reviewNotes.length > 0 && <p className="scomp-meta">Cần xác nhận: {course.reviewNotes.join("; ")}</p>}
    {helped.length > 0 && <p className="scomp-meta">Giúp kỹ năng: {helped.join(", ")}</p>}
  </li>;
}

/** One course of a weak skill: what to do with it, where the student stands, and whether it can be registered. */
function PlanCourseLine({ course }: { course: SupportCourse }) {
  const standing = courseStanding(course);
  const action = course.kind === "improve" ? "Học cải thiện" : course.state === "failed" ? "Học lại" : course.state === "in_progress" ? "Đang học" : "Học mới";
  return <li>
    <div className="scomp-plan-course-head"><span className="scomp-plan-action">{action}</span><strong>{course.name}</strong><span className="scomp-code">{course.code} · {formatNumber(course.credits)} TC</span></div>
    <div className="scomp-plan-course-facts">
      <StatusText tone={standing.tone} glyph={STANDING_GLYPH[standing.tone]} text={standing.text} />
      {course.kind === "take" && course.state !== "in_progress" && <StatusText {...eligibilityDisplay(course.eligibility, course.missing)} />}
      {course.kind === "take" && <span>{course.term ? (course.termSource === "plan" ? `${course.term} theo KHĐT` : `${course.term} theo CTĐT`) : "Chưa xếp lịch"}</span>}
    </div>
  </li>;
}

function SkillPlans({ plans, career }: { plans: SkillPlan[]; career: string | null }) {
  const deepen = career !== null;
  return <>
    <h3 className="scomp-subtitle">{deepen ? "Nâng kỹ năng của nghề lên mức Thành thạo" : "Kỹ năng cần củng cố (dưới mức Khá)"}</h3>
    <p className="scomp-meta">{deepen
      ? `Kỹ năng nghề ${career} bạn đã đạt ngưỡng nhưng chưa đạt mức Thành thạo (từ 85), kèm học phần còn có thể học. Khi không còn học phần, hãy rèn thêm bằng một dự án gắn với nghề.`
      : "Kỹ năng ở mức Cơ bản hoặc Cần củng cố, kèm học phần cụ thể để học cải thiện hoặc học mới. Học phần đã đạt có thể đăng ký học cải thiện theo quy chế của trường."}</p>
    {plans.length ? <ul className="scomp-plan-cards">{plans.map((plan) => {
      const courses = [...plan.improve, ...plan.take];
      return <li key={plan.skillKey}>
        <div className="scomp-course-head"><strong>Kỹ năng: {plan.name}</strong><LevelBadge level={plan.level} label={`${plan.levelLabel} · ${formatScore(plan.score)}`} /></div>
        {courses.length ? <ul className="scomp-plan-courses">{courses.map((course) => <PlanCourseLine key={`${course.kind}:${course.code}`} course={course} />)}</ul>
          : <p className="scomp-meta">{deepen
            ? "Bạn đã học hết học phần đo kỹ năng này trong chương trình; hãy làm một dự án nhỏ gắn với nghề để rèn thêm và có sản phẩm minh chứng."
            : "Không còn học phần nào trong chương trình của bạn để học thêm cho kỹ năng này; hãy tự học và làm một sản phẩm nhỏ để kiểm chứng."}</p>}
      </li>;
    })}</ul> : <p className="scomp-meta">{deepen ? "Mọi kỹ năng của nghề đã đạt mức Thành thạo hoặc còn là khoảng trống ở trên." : "Không có kỹ năng nào dưới mức Khá."}</p>}
  </>;
}

function CoursesSection({ result, ai }: { result: AssessmentResult; ai: MappedAiOutput | null }) {
  const take = result.courseSuggestions.filter((course) => course.kind === "take");
  const improve = result.courseSuggestions.filter((course) => course.kind === "improve");
  const aiTips = new Map((ai?.gaps ?? []).map((gap) => [gap.key, gap.selfStudy]));
  const courseNames = new Map(result.courses.map((course) => [course.code, course.name]));
  const plans = plansFor(result);
  return <Section id="scomp-courses" title="Học phần nên ưu tiên và tự học" description={result.career ? `Học phần cụ thể cho các kỹ năng của nghề ${result.career.nameVi}: kỹ năng chưa đạt ngưỡng và kỹ năng có thể nâng lên mức Thành thạo. Mỗi học phần ghi rõ bạn đã học chưa, điểm hiện tại và đã đủ điều kiện đăng ký chưa.` : "Chọn nghề mục tiêu để nhận gợi ý học phần theo khoảng trống kỹ năng."}>
    {result.career && <>
      <h3 className="scomp-subtitle">Học phần nên học</h3>
      {take.length ? <ol className="scomp-course-list">{take.map((course) => <CourseCard key={course.code} course={course} result={result} />)}</ol> : <p className="scomp-meta">Không còn học phần nào cần học thêm cho các kỹ năng nghề chưa đạt.</p>}
      <h3 className="scomp-subtitle">Học cải thiện</h3>
      {improve.length ? <><p className="scomp-meta">Học phần bạn đã đạt nhưng điểm thấp hơn ngưỡng của kỹ năng nghề. Có thể đăng ký học cải thiện theo quy chế của trường.</p><ol className="scomp-course-list">{improve.map((course) => <CourseCard key={course.code} course={course} result={result} />)}</ol></> : <p className="scomp-meta">Không có học phần nào cần học cải thiện.</p>}
    </>}
    {plans.length > 0 && <SkillPlans plans={plans} career={result.career?.nameVi ?? null} />}
    <h3 className="scomp-subtitle">Kỹ năng cần tự học (CTĐT chưa đo)</h3>
    {result.selfStudy.length ? <ul className="scomp-selfstudy">{result.selfStudy.map((item) => {
      const related = item.relatedSkillKeys.map((key) => skillName(result, key)).filter(Boolean);
      const tips = aiTips.get(item.skillKey) ?? [];
      const other = item.otherSpecialtyCourses.map((code) => courseNames.get(code) ? `${courseNames.get(code)} (${code})` : code);
      return <li key={item.skillKey}>
        <div className="scomp-course-head"><strong>Kỹ năng: {item.name}</strong><span className={item.isRequired ? "scomp-required" : "scomp-code"}>{item.isRequired ? "Bắt buộc" : "Ưu tiên"}</span></div>
        <p className="scomp-meta">{item.reasonLabel}</p>
        <p className="scomp-meta">{other.length ? `Học phần đo kỹ năng này thuộc chuyên ngành khác, không nằm trong chương trình của bạn: ${other.join(", ")}.` : "Không có học phần nào trong chương trình đào tạo của bạn để đăng ký cho kỹ năng này."}</p>
        {related.length > 0 && <p className="scomp-meta">Kỹ năng gần giống đã đo (tham khảo, không thay thế): {related.join(", ")}</p>}
        {tips.length > 0 && <div className="scomp-ai-tip"><span className="scomp-ai-tag">AI</span><ul>{tips.map((tip) => <li key={tip}>{tip}</li>)}</ul></div>}
      </li>;
    })}</ul> : <p className="scomp-meta">Không có kỹ năng nào cần tự học ngoài chương trình.</p>}
  </Section>;
}

/* --------------------------------------------------------------------- AI */

function AiPanel({ assessment, aiEnabled, workerOnline, busy, onRegenerate, onCancel, view }: { assessment: StoredAssessment; aiEnabled: boolean; workerOnline: boolean; busy: boolean; onRegenerate: () => void; onCancel: () => void; view: CompetencyView }) {
  const { ai, result } = assessment;
  const mapped = ai.status === "completed" ? mapAiOutput(ai.output, result) : null;
  const pending = shouldPoll(ai.status);
  const copy = aiStateCopy(ai.status, workerOnline, aiEnabled);
  return <section id="scomp-ai" tabIndex={-1} className="sw-panel scomp-section scomp-ai" aria-labelledby="scomp-ai-title">
    <div className="scomp-section-heading"><div className="scomp-ai-heading"><span className="scomp-ai-icon"><Icon name="spark" /></span><h2 id="scomp-ai-title">{view === "gap" ? "Nhận xét từ EduPath AI về khoảng trống kỹ năng" : "Nhận xét từ EduPath AI"}</h2><span className="scomp-ai-tag">AI</span></div></div>
    {mapped ? view === "gap" ? <AiGapContent output={mapped} hasCareer={Boolean(result.career)} careerKeys={careerSkillKeys(result)} /> : <AiContent output={mapped} /> : <div className={`scomp-ai-state${pending ? " scomp-ai-pending" : ""}${ai.status === "failed" ? " scomp-ai-failed" : ""}`}>
      {pending && <span className="sr-job-spinner" aria-hidden="true" />}
      <strong>{ai.status === "completed" ? "Chưa hiển thị được nhận xét" : copy.title}</strong>
      <p>{ai.status === "failed" ? `${aiErrorMessage(ai.errorCode)} ${copy.text}` : ai.status === "completed" ? "Nhận xét đã lưu không đọc được. Kết quả tính toán bên dưới vẫn đầy đủ." : copy.text}</p>
      {pending && <ol className="sr-job-steps" aria-label="Tiến trình tạo nhận xét"><li>1. Đã tính kết quả</li><li aria-current={ai.status === "queued" ? "step" : undefined}>2. {workerOnline ? "Xếp hàng" : "Chờ máy AI"}</li><li aria-current={ai.status === "processing" ? "step" : undefined}>3. Viết nhận xét</li></ol>}
    </div>}
    {(canRegenerate(ai.status, aiEnabled) || pending) && <div className="scomp-actions">
      {canRegenerate(ai.status, aiEnabled) && <button type="button" className="sw-outline" disabled={busy} onClick={onRegenerate}><Icon name="refresh" />{ai.status === "disabled" ? "Tạo nhận xét" : "Tạo lại nhận xét"}</button>}
      {pending && <button type="button" className="sr-secondary" disabled={busy} onClick={onCancel}>Hủy tạo nhận xét</button>}
    </div>}
    <p className="scomp-ai-footer">{ai.status === "completed" ? `${modelLabel(ai.model)}, chạy cục bộ · tạo lúc ${formatDateTime(ai.completedAt)}. ` : "Mô hình Gemma 4 E4B chạy cục bộ trên máy của nhóm phát triển. "}Nhận xét do AI viết dựa trên kết quả đã tính, có thể chưa chính xác — hãy đối chiếu số liệu và trao đổi với cố vấn học tập.</p>
  </section>;
}

/** The competency part of the AI comment: overall picture, groups, strengths, what to improve and how. */
function AiContent({ output }: { output: MappedAiOutput }) {
  return <div className="scomp-ai-body">
    {output.summary && <p className="scomp-prose scomp-ai-summary">{output.summary}</p>}
    {output.groupInsights.length > 0 && <div className="scomp-ai-block"><h3>Theo nhóm năng lực</h3><ul>{output.groupInsights.map((item) => <li key={item.key}><strong>{item.name}.</strong> {item.comment}</li>)}</ul></div>}
    <div className="scomp-ai-columns">
      {output.strengths.length > 0 && <div className="scomp-ai-block"><h3>Điểm mạnh</h3><ul>{output.strengths.map((item) => <li key={item.key}><strong>{item.name}.</strong> {item.comment}</li>)}</ul></div>}
      {output.improvements.length > 0 && <div className="scomp-ai-block"><h3>Nên cải thiện</h3><ul>{output.improvements.map((item) => <li key={item.key}>
        <strong>{item.name}</strong> <span className="scomp-priority">{PRIORITY_LABELS[item.priority]}</span>. {item.comment}
        {item.courses.length > 0 && <ul className="scomp-ai-sub">{item.courses.map((course) => <li key={course.code}>Học phần {course.name} ({course.code}){course.reason && `: ${course.reason}`}</li>)}</ul>}
      </li>)}</ul></div>}
    </div>
    {output.progress && <div className="scomp-ai-block"><h3>Tiến độ học tập</h3><p className="scomp-prose">{output.progress}</p></div>}
    {output.nextSteps.length > 0 && <div className="scomp-ai-block"><h3>Bước tiếp theo</h3><ol>{output.nextSteps.map((step) => <li key={step}>{step}</li>)}</ol></div>}
  </div>;
}

/**
 * The gap part of the AI comment: fit with the target career, the gaps worth closing first with their
 * courses, and the AI's advice on raising the career's own skills (never the skills outside the career).
 */
function AiGapContent({ output, hasCareer, careerKeys }: { output: MappedAiOutput; hasCareer: boolean; careerKeys: Set<string> }) {
  const gapKeys = new Set(output.gaps.map((gap) => gap.key));
  const raise = output.improvements.filter((item) => careerKeys.has(item.key) && !gapKeys.has(item.key));
  if (!output.careerFit && !output.gaps.length && !raise.length) return <p className="scomp-meta">{hasCareer ? "Nhận xét lần này không có phần riêng về khoảng trống kỹ năng. Kết quả tính toán bên dưới vẫn đầy đủ." : "Chọn nghề mục tiêu rồi đánh giá lại để nhận nhận xét về khoảng trống kỹ năng."}</p>;
  return <div className="scomp-ai-body">
    {output.careerFit && <div className="scomp-ai-block"><h3>Với nghề mục tiêu</h3><p className="scomp-prose">{output.careerFit}</p></div>}
    {output.gaps.length > 0 && <div className="scomp-ai-block"><h3>Khoảng trống nên ưu tiên</h3><ul>{output.gaps.map((gap) => <li key={gap.key}>
      <strong>{gap.name}</strong> <span className="scomp-priority">{PRIORITY_LABELS[gap.priority]}</span>{gap.explanation && <>. {gap.explanation}</>}
      {gap.courses.length > 0 && <ul className="scomp-ai-sub">{gap.courses.map((course) => <li key={course.code}>Học phần {course.name} ({course.code}){course.reason && `: ${course.reason}`}</li>)}</ul>}
      {gap.selfStudy.length > 0 && <ul className="scomp-ai-sub">{gap.selfStudy.map((tip) => <li key={tip}>Tự học: {tip}</li>)}</ul>}
    </li>)}</ul></div>}
    {raise.length > 0 && <div className="scomp-ai-block"><h3>Nâng kỹ năng của nghề</h3><ul>{raise.map((item) => <li key={item.key}>
      <strong>{item.name}</strong> <span className="scomp-priority">{PRIORITY_LABELS[item.priority]}</span>. {item.comment}
      {item.courses.length > 0 && <ul className="scomp-ai-sub">{item.courses.map((course) => <li key={course.code}>Học phần {course.name} ({course.code}){course.reason && `: ${course.reason}`}</li>)}</ul>}
    </li>)}</ul></div>}
  </div>;
}

/* ------------------------------------------------------------------- page */

function Checklist({ hasTranscript, transcriptFailed, profile, suggestion }: { hasTranscript: boolean | null; transcriptFailed: boolean; profile: Profile | null; suggestion: string | null }) {
  const specialty = profile?.specialty ?? null;
  const items: { label: string; done: boolean | null; value: string; note?: string | null }[] = [
    { label: "Bảng điểm", done: hasTranscript, value: transcriptFailed ? "Chưa kiểm tra được — thử tải lại trang" : hasTranscript === null ? "Đang kiểm tra…" : hasTranscript ? "Đã import" : "Chưa có bảng điểm" },
    { label: "Nghề mục tiêu", done: profile ? Boolean(profile.careerPositionId) : null, value: profile?.careerPosition?.nameVi ?? (profile ? "Chưa chọn — vẫn đánh giá được năng lực" : "Đang tải…") },
    { label: "Chuyên ngành", done: profile ? Boolean(specialty) : null, value: profile ? specialtyLabel(specialty) : "Đang tải…", note: !specialty ? suggestion : null },
  ];
  return <ul className="scomp-checklist" aria-label="Điều kiện đánh giá">{items.map((item) => <li key={item.label}>
    <span className={`so-check ${item.done ? "so-check-done" : ""}`} aria-hidden="true">{item.done ? <Icon name="check" /> : null}</span>
    <span className="scomp-check-text"><strong>{item.label}</strong><span>{item.value}</span>{item.note && <span className="scomp-suggestion">{item.note}</span>}</span>
    <span className="sr-only">{item.done === null ? "Chưa xác định" : item.done ? "Đã có" : "Chưa có"}</span>
    <a className="sw-text-link" href="#profile">{item.done ? "Chỉnh sửa" : "Bổ sung"}</a>
  </li>)}</ul>;
}

const HEADER_COPY: Record<CompetencyView, { title: string; resultTitle: string; lead: string; introTitle: string; intro: string }> = {
  competency: {
    title: "Đánh giá năng lực của bạn", resultTitle: "Kết quả đánh giá năng lực",
    lead: "Hệ thống tính điểm từng kỹ năng từ bảng điểm và trọng số học phần do Khoa cấu hình, xếp mức thành thạo theo nhóm năng lực và đối chiếu tiến độ học tập.",
    introTitle: "Chưa có kết quả đánh giá",
    intro: "Bấm “Đánh giá năng lực” để xem điểm theo từng nhóm năng lực, mức thành thạo của từng kỹ năng, tiến độ so với kế hoạch đào tạo và điều kiện xét tốt nghiệp. Kết quả chỉ mang tính tham khảo.",
  },
  gap: {
    title: "Phân tích khoảng trống kỹ năng", resultTitle: "Kết quả phân tích khoảng trống kỹ năng",
    lead: "Khoảng trống được tính từ điểm từng kỹ năng ở trang Đánh giá năng lực, so với ngưỡng mà nghề mục tiêu của bạn yêu cầu.",
    introTitle: "Chưa có kết quả phân tích",
    intro: "Khoảng trống kỹ năng được tính cùng lúc với đánh giá năng lực, từ bảng điểm và nghề mục tiêu của bạn. Bấm “Đánh giá năng lực” để bắt đầu. Kết quả chỉ mang tính tham khảo.",
  },
};

export default function StudentCompetency({ profile, view = "competency" }: { profile: Profile | null; view?: CompetencyView }) {
  const [revision, setRevision] = useState(0);
  const live = useLiveData(`${COMPETENCY_API}/latest`, revision, readLatest);
  const transcript = useLiveData("/api/student/transcript", 0, readTranscriptPresence);
  const [current, setCurrent] = useState<LatestAssessmentResponse | null>(null);
  useEffect(() => { if (live.data) setCurrent(live.data); }, [live.data]);
  const data = current ?? live.data;
  const assessment = data?.assessment ?? null;
  const [busy, setBusy] = useState<"run" | "ai" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState<PreconditionError | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [consentOpen, setConsentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const aiStatus: AiStatus | null = assessment?.ai.status ?? null;
  const assessmentId = assessment?.id ?? null;
  const previous = useRef<{ id: string | null; status: AiStatus | null }>({ id: null, status: null });
  useEffect(() => {
    const before = previous.current;
    previous.current = { id: assessmentId, status: aiStatus };
    if (!assessmentId || before.id !== assessmentId || before.status === aiStatus || !aiStatus) return;
    setAnnouncement(aiStatus === "completed" ? "Đã có nhận xét từ EduPath AI." : aiStatus === "failed" ? "Chưa tạo được nhận xét AI." : aiStateCopy(aiStatus, data?.workerOnline ?? false, data?.aiEnabled ?? false).title);
  }, [assessmentId, aiStatus, data?.workerOnline, data?.aiEnabled]);

  // Poll the small status payload only while the AI comment can still change.
  useEffect(() => {
    if (!assessmentId || !shouldPoll(aiStatus)) return;
    const pending = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await send<AssessmentStatusResponse>(`${COMPETENCY_API}/latest/status`, { signal: pending.signal });
        if (pending.signal.aborted) return;
        if (status.id !== assessmentId || status.aiStatus !== aiStatus) {
          const latest = await readLatest(await fetch(`${COMPETENCY_API}/latest`, { credentials: "include", cache: "no-store", signal: pending.signal }));
          if (!pending.signal.aborted) setCurrent(latest);
          return;
        }
        setCurrent((value) => value && value.workerOnline !== status.workerOnline ? { ...value, workerOnline: status.workerOnline } : value);
      } catch { /* a failed poll keeps the last state; the next one tries again */ }
      if (!pending.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => { pending.abort(); clearTimeout(timer); };
  }, [assessmentId, aiStatus]);

  const run = async () => {
    setConsentOpen(false); setBusy("run"); setError(""); setAnnouncement("Đang tính kết quả đánh giá năng lực…");
    try {
      const response = await send<{ assessment: StoredAssessment }>(`${COMPETENCY_API}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Consent-Policy-Version": policyVersion }, body: "{}" });
      setBlocked(null);
      previous.current = { id: response.assessment.id, status: response.assessment.ai.status };
      setCurrent((value) => ({ assessment: response.assessment, aiEnabled: value?.aiEnabled ?? data?.aiEnabled ?? false, workerOnline: value?.workerOnline ?? data?.workerOnline ?? false, consentVersion: policyVersion }));
      setAnnouncement("Đã cập nhật kết quả đánh giá năng lực.");
    } catch (e) {
      const failure = e as ApiError;
      if (isPreconditionError(failure.code)) { setBlocked(failure.code); setAnnouncement(PRECONDITION_COPY[failure.code].title); }
      else if (failure.code === "consent_required") {
        // The server holds no consent for this student: ask instead of failing.
        setCurrent((value) => value ? { ...value, consentVersion: null } : value);
        setAnnouncement(""); setConsentOpen(true);
      } else {
        // policy_outdated means this page is older than the server's policy: only a reload helps.
        if (failure.code === "policy_outdated") setCurrent((value) => value ? { ...value, consentVersion: null } : value);
        setError(failure.message); setAnnouncement("");
      }
    } finally { setBusy(null); }
  };
  // Consent is per student and kept by the server (GET /latest consentVersion), never per browser.
  const start = () => { if (data?.consentVersion === policyVersion) void run(); else setConsentOpen(true); };
  const confirmConsent = () => { void run(); };
  const regenerate = async () => {
    if (!assessment) return;
    setBusy("ai"); setError("");
    try {
      const response = await send<{ aiStatus: AiStatus }>(`${COMPETENCY_API}/${encodeURIComponent(assessment.id)}/ai`, jsonWrite("POST"));
      setCurrent((value) => value?.assessment?.id === assessment.id ? { ...value, assessment: { ...value.assessment, ai: { ...value.assessment.ai, status: response.aiStatus, errorCode: null } } } : value);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };
  const cancelAi = async () => {
    if (!assessment) return;
    setBusy("ai"); setError("");
    try {
      await send<{ cancelled: boolean }>(`${COMPETENCY_API}/${encodeURIComponent(assessment.id)}/ai`, jsonWrite("DELETE"));
      setCurrent(await readLatest(await fetch(`${COMPETENCY_API}/latest`, { credentials: "include", cache: "no-store" })));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy("delete"); setDeleteError("");
    try {
      await send<{ deleted: boolean }>(`${COMPETENCY_API}`, jsonWrite("DELETE", { confirmed: true }));
      setDeleteOpen(false);
      setCurrent((value) => ({ assessment: null, aiEnabled: value?.aiEnabled ?? false, workerOnline: value?.workerOnline ?? false, consentVersion: null }));
      setAnnouncement("Đã xóa kết quả đánh giá năng lực và rút lại đồng ý.");
    } catch (e) { setDeleteError((e as Error).message); }
    finally { setBusy(null); }
  };

  const result = assessment?.result ?? null;
  const mapped = useMemo(() => assessment && assessment.ai.status === "completed" ? mapAiOutput(assessment.ai.output, assessment.result) : null, [assessment]);
  const warningCount = result?.warnings.length ?? 0;
  const hasTranscript = transcript.loading ? null : transcript.error ? null : transcript.data;
  // The result was computed for meta.specialty / meta.career; say so when the profile changed since.
  // profile.specialty is undefined only while an older API is serving: skip that comparison then.
  const profileChanged = Boolean(result && profile && (
    (profile.specialty !== undefined && (profile.specialty ?? null) !== result.meta.specialty)
    || (profile.careerPositionId ?? null) !== (result.meta.career?.id ?? null)));
  const copy = HEADER_COPY[view];
  const aiPanel = assessment && <AiPanel assessment={assessment} aiEnabled={data?.aiEnabled ?? false} workerOnline={data?.workerOnline ?? false} busy={busy !== null} onRegenerate={() => void regenerate()} onCancel={() => void cancelAi()} view={view} />;
  return <div className="scomp-page">
    <section className="sw-panel scomp-header" aria-labelledby="scomp-title">
      <div className="scomp-header-main">
        <div>
          <h2 id="scomp-title">{assessment ? copy.resultTitle : copy.title}</h2>
          <p className="scomp-lead">{copy.lead}</p>
        </div>
        <div className="scomp-header-actions">
          <button type="button" className="sw-primary" disabled={busy !== null || live.loading} onClick={start}><Icon name={assessment ? "refresh" : "chart"} />{busy === "run" ? "Đang đánh giá…" : assessment ? "Đánh giá lại" : "Đánh giá năng lực"}</button>
          {assessment && view === "competency" && <button type="button" className="sr-secondary sr-danger" disabled={busy !== null} onClick={() => { setDeleteError(""); setDeleteOpen(true); }}><Icon name="trash" />Xóa kết quả đánh giá</button>}
        </div>
      </div>
      <Checklist hasTranscript={hasTranscript} transcriptFailed={!transcript.loading && Boolean(transcript.error)} profile={profile} suggestion={result?.specialtySuggestion?.text ?? null} />
      {profileChanged && <p className="scomp-meta">Hồ sơ đã thay đổi sau lần đánh giá này. Bấm “Đánh giá lại” để cập nhật kết quả.</p>}
      {assessment && <p className="scomp-data-line">{dataUsedLine(assessment)}{view === "gap" && warningCount > 0 && <> · <button type="button" className="scomp-link-button" onClick={() => scrollToSection("scomp-warnings")}>{warningCount.toLocaleString("vi-VN")} cảnh báo dữ liệu →</button></>}</p>}
      <p className="scomp-live" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      {error && <div className="sr-error" role="alert">{error}</div>}
      {live.error && !data && <div className="sr-error" role="alert">{live.error}<button type="button" onClick={() => setRevision((n) => n + 1)}>Thử lại</button></div>}
    </section>
    {live.loading && !data && <section className="sw-panel scomp-section scomp-loading" aria-busy="true"><p>Đang tải kết quả đánh giá…</p><div /><div /><div /></section>}
    {blocked && <section className="sw-panel scomp-section" aria-labelledby="scomp-blocked-title"><div className="sw-empty scomp-empty"><span className="scomp-empty-icon" aria-hidden="true"><Icon name={blocked === "transcript_required" ? "document" : "info"} /></span><h3 id="scomp-blocked-title">{PRECONDITION_COPY[blocked].title}</h3><p>{PRECONDITION_COPY[blocked].text}</p>{PRECONDITION_COPY[blocked].action && <a className="sw-outline" href={PRECONDITION_COPY[blocked].action!.href}>{PRECONDITION_COPY[blocked].action!.label}</a>}</div></section>}
    {data && !assessment && !blocked && <section className="sw-panel scomp-section" aria-labelledby="scomp-intro-title"><div className="sw-empty scomp-empty">
      <span className="scomp-empty-icon" aria-hidden="true"><Icon name={view === "gap" ? "target" : "chart"} /></span>
      <h3 id="scomp-intro-title">{copy.introTitle}</h3>
      <p>{copy.intro}</p>
    </div></section>}
    {assessment && result && (view === "gap" ? <>
      <GapSummary result={result} />
      {aiPanel}
      <GapTable result={result} />
      <CoursesSection result={result} ai={mapped} />
      <WarningsSection result={result} />
    </> : <>
      <Overview result={result} />
      {aiPanel}
      <HistorySection result={result} />
      <SkillsSection key={assessment.id} result={result} />
      <ProgressSection result={result} />
      <GraduationSection />
    </>)}
    {consentOpen && <ConsentDialog busy={busy === "run"} onClose={() => setConsentOpen(false)} onConfirm={confirmConsent} />}
    {deleteOpen && <DeleteDialog busy={busy === "delete"} error={deleteError} onClose={() => setDeleteOpen(false)} onConfirm={() => void remove()} />}
  </div>;
}
