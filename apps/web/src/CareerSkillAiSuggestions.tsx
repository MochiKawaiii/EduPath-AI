import { useEffect, useMemo, useState } from "react";
import { Modal, Status, useData } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import type { Career, CareerRequirement, CareerSkill } from "./career-types";
import {
  CAREER_AI_API, CareerAiError, DESCRIPTION_MAX, POLL_STATUS_MS, POLL_SUGGESTION_MS, SKILL_NAME_MAX, TITLE_MAX,
  applyItems, careerAiRequest, failureMessage, formatDateTime, formatElapsed, hasEdits, isPending, jsonPost,
  rowSkillName, rowsFromSuggestion, similarLinkedSkillOf, validateRows, workerLine,
  type CareerAiStatus, type CareerAiSuggestion, type LinkedSkill, type SuggestionRow,
} from "./career-ai-suggestions";

const requirementsEndpoint = "/api/admin/careers/requirements";
type Busy = "create" | "cancel" | "apply" | null;

/** "AI đề xuất kỹ năng": ask the local AI for skills of one career, review them, save only what is kept. */
export default function CareerSkillAiSuggestions({ career, catalog, close, saved }: {
  career: Career;
  catalog: ReturnType<typeof useData<{ items: CareerSkill[] }>>;
  close: () => void; saved: () => void;
}) {
  const liveStatus = useData<CareerAiStatus>(`${CAREER_AI_API}/status`);
  const latest = useData<{ suggestion: CareerAiSuggestion | null }>(`${CAREER_AI_API}/latest?${new URLSearchParams({ careerPositionId: career.id })}`);
  const linkedUrl = `${requirementsEndpoint}?${new URLSearchParams({ careerPositionId: career.id, kind: "skill" })}`;
  const liveLinked = useData<{ items: CareerRequirement[] }>(linkedUrl);
  // Values polled or returned by a write replace the first loads.
  const [polledStatus, setPolledStatus] = useState<CareerAiStatus | null>(null);
  const [current, setCurrent] = useState<CareerAiSuggestion | null | undefined>(undefined);
  const [freshLinked, setFreshLinked] = useState<CareerRequirement[] | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const status = polledStatus ?? liveStatus.data;
  const suggestion = current !== undefined ? current : latest.data?.suggestion ?? null;
  const linkedItems = freshLinked ?? liveLinked.data?.items ?? null;
  const pending = isPending(suggestion?.status);
  const suggestionId = suggestion?.id ?? null;
  const suggestionStatus = suggestion?.status ?? null;
  const view = latest.loading && current === undefined ? "loading"
    : !suggestion || suggestion.status === "cancelled" ? "intro"
      : pending ? "waiting" : suggestion.status === "failed" ? "failed" : "completed";

  useEffect(() => {
    if (!suggestionId || !isPending(suggestionStatus)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await careerAiRequest<{ suggestion: CareerAiSuggestion }>(`${CAREER_AI_API}/${encodeURIComponent(suggestionId)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (next.suggestion.status !== suggestionStatus) { setCurrent(next.suggestion); return; }
      } catch (failure) {
        // A suggestion that no longer exists is never polled again; any other failure keeps the last state.
        if (!controller.signal.aborted && failure instanceof CareerAiError && failure.code === "suggestion_not_found") { setCurrent(null); return; }
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
      careerAiRequest<CareerAiStatus>(`${CAREER_AI_API}/status`, { signal: controller.signal })
        .then((next) => { if (!controller.signal.aborted) setPolledStatus(next); })
        .catch(() => { /* keep the last known worker state */ });
    }, POLL_STATUS_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [view]);

  const create = async () => {
    setBusy("create"); setError("");
    try {
      const response = await careerAiRequest<{ suggestion: CareerAiSuggestion }>(CAREER_AI_API, jsonPost({ careerPositionId: career.id }));
      setCurrent(response.suggestion);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };
  const cancel = async () => {
    if (!suggestion) return;
    setBusy("cancel"); setError("");
    try {
      const response = await careerAiRequest<{ suggestion: CareerAiSuggestion }>(`${CAREER_AI_API}/${encodeURIComponent(suggestion.id)}/cancel`, jsonPost({}));
      setCurrent(response.suggestion);
    } catch (failure) {
      setError((failure as Error).message);
      // Finished meanwhile: show what the job ended with.
      if (failure instanceof CareerAiError && failure.code === "suggestion_not_active") {
        careerAiRequest<{ suggestion: CareerAiSuggestion }>(`${CAREER_AI_API}/${encodeURIComponent(suggestion.id)}`).then((next) => setCurrent(next.suggestion)).catch(() => {});
      }
    } finally { setBusy(null); }
  };
  const refreshLinked = async () => {
    const response = await careerAiRequest<{ items: CareerRequirement[] }>(linkedUrl);
    setFreshLinked(response.items);
    return response.items;
  };

  const worker = workerLine(status);
  return <Modal title="AI đề xuất kỹ năng liên kết" onClose={close} busy={busy !== null}>
    <div className="cm-dialog-body cm-form cai-body">
      {view === "loading" && <Status {...latest} />}
      {latest.error && current === undefined && <Status {...latest} />}
      {view === "intro" && !latest.error && <>
        <div className="cai-intro">
          <span className="cai-intro-icon" aria-hidden="true"><Icon name="spark" /></span>
          <div>
            <h3>{career.nameVi}</h3>
            <p>AI đọc tên, mô tả vị trí nghề nghiệp, lĩnh vực và danh mục kỹ năng để gợi ý kỹ năng còn thiếu. AI không nhận dữ liệu sinh viên. Kết quả chỉ là gợi ý: bạn chọn, sửa rồi mới lưu.</p>
          </div>
        </div>
        <WorkerLine line={worker} loading={liveStatus.loading && !status} />
        {error && <p className="admin-error" role="alert">{error}</p>}
        <div className="cm-actions cm-dialog-actions">
          <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Hủy</button>
          <button type="button" className="am-primary" disabled={busy !== null || !worker.canCreate} onClick={() => void create()}><Icon name="spark" /> {busy === "create" ? "Đang gửi…" : "Tạo đề xuất"}</button>
        </div>
      </>}
      {view === "waiting" && suggestion && <>
        <div className="cai-waiting">
          <span className="cai-spinner" aria-hidden="true" />
          <div>
            <p className="cai-state" role="status" aria-live="polite">{suggestion.status === "queued" ? "Đang chờ máy AI nhận việc…" : "AI đang phân tích vị trí nghề nghiệp…"}</p>
            {suggestion.status === "processing" && <p className="cai-muted"><Elapsed since={suggestion.createdAt} /> · Thường mất khoảng 30–60 giây.</p>}
            <p className="cai-muted">{career.nameVi}</p>
          </div>
        </div>
        <WorkerLine line={worker} loading={false} />
        {error && <p className="admin-error" role="alert">{error}</p>}
        <div className="cm-actions cm-dialog-actions">
          <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Đóng</button>
          <button type="button" className="am-outline" disabled={busy !== null} onClick={() => void cancel()}><Icon name="close" /> {busy === "cancel" ? "Đang hủy…" : "Hủy đề xuất"}</button>
        </div>
      </>}
      {view === "failed" && suggestion && <>
        <div className="cai-failed" role="status" aria-live="polite">
          <h3>Chưa tạo được đề xuất</h3>
          <p>{failureMessage(suggestion.errorCode)}</p>
        </div>
        <WorkerLine line={worker} loading={false} />
        {error && <p className="admin-error" role="alert">{error}</p>}
        <div className="cm-actions cm-dialog-actions">
          <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Hủy</button>
          <button type="button" className="am-primary" disabled={busy !== null || !worker.canCreate} onClick={() => void create()}><Icon name="refresh" /> {busy === "create" ? "Đang gửi…" : "Tạo lại đề xuất"}</button>
        </div>
      </>}
      {view === "completed" && suggestion && <Review
        key={suggestion.id} suggestion={suggestion} career={career} catalog={catalog}
        linked={linkedItems} linkedState={liveLinked} refreshLinked={refreshLinked}
        busy={busy} setBusy={setBusy} createError={error} canCreate={worker.canCreate}
        regenerate={() => void create()} close={close} saved={saved}
      />}
    </div>
  </Modal>;
}

function WorkerLine({ line, loading }: { line: ReturnType<typeof workerLine>; loading: boolean }) {
  return <p className={`cai-worker cai-worker-${line.tone}`}><span aria-hidden="true" />{loading ? "Đang kiểm tra máy AI…" : line.text}</p>;
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <span className="cai-elapsed" aria-label={`Đã chạy ${formatElapsed(since, now)}`}>{formatElapsed(since, now)}</span>;
}

function Review({ suggestion, career, catalog, linked, linkedState, refreshLinked, busy, setBusy, createError, canCreate, regenerate, close, saved }: {
  suggestion: CareerAiSuggestion; career: Career;
  catalog: ReturnType<typeof useData<{ items: CareerSkill[] }>>;
  linked: CareerRequirement[] | null; linkedState: ReturnType<typeof useData<{ items: CareerRequirement[] }>>;
  refreshLinked: () => Promise<CareerRequirement[]>;
  busy: Busy; setBusy: (busy: Busy) => void; createError: string; canCreate: boolean;
  regenerate: () => void; close: () => void; saved: () => void;
}) {
  const [rows, setRows] = useState<SuggestionRow[]>(() => rowsFromSuggestion(suggestion.items));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const skills = catalog.data?.items ?? [];
  const links: LinkedSkill[] = useMemo(() => (linked ?? []).map((item) => ({ skillId: item.skillId, skillName: item.skillName })), [linked]);
  const linkedIds = useMemo(() => new Set(links.map((item) => item.skillId)), [links]);
  const check = validateRows(rows, links, skills);
  const ready = Boolean(linked && catalog.data);
  const update = (key: string, patch: Partial<SuggestionRow>) => { setError(""); setRows((previous) => previous.map((row) => row.key === key ? { ...row, ...patch } : row)); };
  const catalogRows = rows.filter((row) => !row.isNewSkill), newRows = rows.filter((row) => row.isNewSkill);

  const apply = async () => {
    setBusy("apply"); setError("");
    try {
      // Someone may have linked a skill since the list loaded: check against the current links first.
      const fresh = await refreshLinked();
      if (!validateRows(rows, fresh.map((item) => ({ skillId: item.skillId, skillName: item.skillName })), skills).valid) {
        setError("Danh sách kỹ năng đã liên kết vừa thay đổi. Kiểm tra các dòng được đánh dấu rồi lưu lại.");
        return;
      }
      await careerAiRequest<{ created: number }>(`${CAREER_AI_API}/${encodeURIComponent(suggestion.id)}/apply`, jsonPost({ items: applyItems(rows) }));
      saved();
    } catch (failure) {
      setError((failure as Error).message);
      if (failure instanceof CareerAiError && failure.code === "requirement_exists") void refreshLinked().catch(() => {});
    } finally { setBusy(null); }
  };

  const renderRow = (row: SuggestionRow) => {
    const name = rowSkillName(row, skills) || "kỹ năng mới";
    const rowErrors = check.errors[row.key] ?? [];
    const id = `cai-${suggestion.id}-${row.key}`;
    const similar = similarLinkedSkillOf(row, suggestion.items);
    return <li key={row.key} className={`cai-row${row.checked && !row.alreadyLinked ? " cai-row-on" : ""}${row.alreadyLinked ? " cai-row-linked" : ""}${rowErrors.length ? " cai-row-invalid" : ""}`}>
      <div className="cai-row-head">
        <label className="cai-check">
          <input type="checkbox" checked={row.checked && !row.alreadyLinked} disabled={row.alreadyLinked || busy !== null} onChange={(event) => update(row.key, { checked: event.target.checked })} />
          <span>{name}</span>
        </label>
        {row.alreadyLinked && <span className="cai-tag">Đã liên kết</span>}
        {similar && <span className="cai-tag cai-tag-similar" title={`Gần giống: ${similar}`}>Gần giống: {similar}</span>}
        {row.isRequired && !row.alreadyLinked && <span className="cai-tag cai-tag-required">Bắt buộc</span>}
        <button type="button" className="am-icon-btn am-delete-icon cai-remove" disabled={busy !== null} aria-label={`Bỏ đề xuất ${name}`} title="Bỏ đề xuất" onClick={() => setRows((previous) => previous.filter((item) => item.key !== row.key))}><Icon name="trash" /></button>
      </div>
      <fieldset className="cai-row-fields" disabled={row.alreadyLinked || busy !== null}>
        <legend className="sr-only">Chi tiết đề xuất {name}</legend>
        {row.isNewSkill
          ? <label htmlFor={`${id}-name`}><RequiredLabel>Tên kỹ năng mới</RequiredLabel><input id={`${id}-name`} maxLength={SKILL_NAME_MAX} value={row.skillName} onChange={(event) => update(row.key, { skillName: event.target.value })} /></label>
          : <label htmlFor={`${id}-skill`}><RequiredLabel>Kỹ năng</RequiredLabel><select id={`${id}-skill`} value={row.skillId ?? ""} disabled={!catalog.data} onChange={(event) => update(row.key, { skillId: event.target.value || null })}>
            {!skills.some((skill) => skill.id === row.skillId) && <option value={row.skillId ?? ""}>{row.skillName}</option>}
            {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}{linkedIds.has(skill.id) ? " — Đã liên kết" : ""}</option>)}
          </select></label>}
        <label htmlFor={`${id}-priority`}>Tính chất<select id={`${id}-priority`} value={row.isRequired ? "required" : "preferred"} onChange={(event) => update(row.key, { isRequired: event.target.value === "required" })}>
          <option value="preferred">Ưu tiên</option><option value="required">Bắt buộc</option>
        </select></label>
        <label htmlFor={`${id}-title`} className="cai-wide"><RequiredLabel>Nội dung yêu cầu</RequiredLabel><input id={`${id}-title`} maxLength={TITLE_MAX} value={row.title} onChange={(event) => update(row.key, { title: event.target.value })} /></label>
        <label htmlFor={`${id}-description`} className="cai-wide">Mô tả<textarea id={`${id}-description`} rows={2} maxLength={DESCRIPTION_MAX} value={row.description} onChange={(event) => update(row.key, { description: event.target.value })} /></label>
      </fieldset>
      {similar && <p className="cai-similar">Nghề này đã có kỹ năng “{similar}”. Chỉ chọn nếu đây là kỹ năng khác.</p>}
      {row.reason && <p className="cai-reason">Lý do AI đề xuất: {row.reason}</p>}
      {rowErrors.length > 0 && <ul className="cai-row-errors" role="alert">{rowErrors.map((message) => <li key={message}>{message}</li>)}</ul>}
    </li>;
  };

  const ask = () => { if (hasEdits(rows, suggestion.items)) setConfirming(true); else regenerate(); };
  const blocked = busy !== null || !ready || confirming || !check.valid || check.selected === 0;
  return <>
    <div className="cai-review-head">
      <h3>{suggestion.items.length ? `AI đề xuất ${suggestion.items.length.toLocaleString("vi-VN")} kỹ năng cho ${career.nameVi}` : `AI chưa đề xuất kỹ năng nào cho ${career.nameVi}`}</h3>
      <p className="cai-muted">{suggestion.items.length ? "Bỏ chọn hoặc xóa dòng không phù hợp, sửa nội dung rồi lưu." : "AI chưa tìm thấy kỹ năng nào còn thiếu cho vị trí này. Bạn có thể tạo lại đề xuất hoặc thêm kỹ năng thủ công."}</p>
      <p className="cai-meta">Gợi ý bởi {suggestion.model ?? "mô hình AI"} chạy cục bộ · {formatDateTime(suggestion.completedAt)}</p>
    </div>
    <Status {...linkedState} /><Status {...catalog} />
    {catalogRows.length > 0 && <section className="cai-section" aria-labelledby={`cai-${suggestion.id}-catalog`}>
      <h4 id={`cai-${suggestion.id}-catalog`}>Kỹ năng trong danh mục <span>({catalogRows.length.toLocaleString("vi-VN")})</span></h4>
      <ul className="cai-rows">{catalogRows.map(renderRow)}</ul>
    </section>}
    {newRows.length > 0 && <section className="cai-section" aria-labelledby={`cai-${suggestion.id}-new`}>
      <h4 id={`cai-${suggestion.id}-new`}>Kỹ năng chưa có trong danh mục <span>({newRows.length.toLocaleString("vi-VN")})</span></h4>
      <p className="cai-muted">Khi lưu, kỹ năng mới sẽ được thêm vào mục Kỹ năng.</p>
      <ul className="cai-rows">{newRows.map(renderRow)}</ul>
    </section>}
    {suggestion.items.length > 0 && !rows.length && <p className="cai-empty">Bạn đã bỏ hết các đề xuất. Tạo lại đề xuất hoặc đóng hộp thoại.</p>}
    {rows.length > 0 && <p className="cai-summary" aria-live="polite">Đã chọn {check.selected.toLocaleString("vi-VN")}/{check.selectable.toLocaleString("vi-VN")} kỹ năng · {check.required.toLocaleString("vi-VN")} bắt buộc</p>}
    {confirming && <div className="cai-confirm" role="alertdialog" aria-label="Xác nhận tạo lại đề xuất">
      <p>Tạo đề xuất mới sẽ bỏ các thay đổi bạn vừa chọn và chỉnh sửa trong danh sách này.</p>
      <div className="cm-actions">
        <button type="button" className="am-outline" onClick={() => setConfirming(false)}>Giữ danh sách</button>
        <button type="button" className="am-primary" onClick={() => { setConfirming(false); regenerate(); }}>Tạo đề xuất mới</button>
      </div>
    </div>}
    {(error || createError) && <p className="admin-error" role="alert">{error || createError}</p>}
    <div className="cm-actions cm-dialog-actions">
      <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Hủy</button>
      <div className="cm-dialog-actions-main">
        <button type="button" className="am-outline" disabled={busy !== null || confirming || !canCreate} onClick={ask}><Icon name="refresh" /> {busy === "create" ? "Đang gửi…" : "Tạo lại đề xuất"}</button>
        {suggestion.items.length > 0 && <button type="button" className="am-primary" disabled={blocked} onClick={() => void apply()}><Icon name="save" /> {busy === "apply" ? "Đang lưu…" : `Lưu ${check.selected.toLocaleString("vi-VN")} liên kết`}</button>}
      </div>
    </div>
  </>;
}
