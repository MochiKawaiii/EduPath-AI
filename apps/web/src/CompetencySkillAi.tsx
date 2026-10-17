import { useState } from "react";
import { Modal, Status } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { COMPETENCY_API, useCompetencyData, type CurriculumRevision, type Group } from "./competency-types";
import {
  COMPETENCY_AI_API, SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, SKILL_SCOPE_MAX,
  aiRequest, applySkillItems, defaultSkillRevision, failureMessage, jsonPost, skillRows, validateSkillRows,
  type CourseAiSuggestion, type SkillRow,
} from "./competency-ai";
import { Elapsed, ReviewHead, WorkerLine } from "./CompetencyAiParts";
import { useCompetencySuggestion, type SuggestionBusy } from "./use-competency-suggestion";
import "./careers.css";

type Props = { close: () => void; saved: () => void };

const revisionLabel = (item: CurriculumRevision) =>
  `${item.cohortCode} · ${item.name} · v${item.version} · ${item.isCurrent ? "Hiện hành" : "Lịch sử"}`;

/**
 * "Thêm kỹ năng (AI)" of Danh mục kỹ năng: the local AI reads the courses of one CTĐT revision and the
 * catalog, then proposes career skills that are not assessed yet and new skills the program trains,
 * each with a group and a scope. The admin reviews, edits and saves; the AI never gets student data.
 */
export default function CompetencySkillAi({ close, saved }: Props) {
  const curricula = useCompetencyData<{ items: CurriculumRevision[] }>(`${COMPETENCY_API}/curricula`);
  const [revisionId, setRevisionId] = useState("");
  const [busy, setBusy] = useState(false);
  const items = curricula.data?.items ?? [];
  const curriculum = items.find((item) => item.revisionId === revisionId) ?? (revisionId ? null : defaultSkillRevision(items));
  return <Modal title="Thêm kỹ năng bằng AI" onClose={close} busy={busy}>
    <div className="cm-dialog-body cm-form cai-body">
      <label>Chương trình đào tạo AI đọc<select value={curriculum?.revisionId ?? ""} disabled={busy || curricula.loading || !items.length} onChange={(event) => setRevisionId(event.target.value)}>
        {!curriculum && <option value="">Chọn chương trình đào tạo</option>}
        {items.filter((item) => item.courseCount > 0).map((item) => <option key={item.revisionId} value={item.revisionId}>{revisionLabel(item)}</option>)}
      </select></label>
      <Status {...curricula} />
      {curricula.data && !items.some((item) => item.courseCount > 0) && <p className="comp-hint">Chưa có chương trình đào tạo nào có học phần. Hãy thêm khung ở mục Chương trình trước.</p>}
      {curriculum && <SkillAiFlow key={curriculum.revisionId} curriculum={curriculum} setLocked={setBusy} close={close} saved={saved} />}
    </div>
  </Modal>;
}

function SkillAiFlow({ curriculum, setLocked, close, saved }: { curriculum: CurriculumRevision; setLocked: (locked: boolean) => void } & Props) {
  const { latest, latestFailed, statusLoading, worker, suggestion, view, busy, setBusy: setFlowBusy, error, create, cancel } = useCompetencySuggestion(
    `${COMPETENCY_AI_API}/skills/latest?${new URLSearchParams({ revisionId: curriculum.revisionId })}`,
    `${COMPETENCY_AI_API}/skills`, { revisionId: curriculum.revisionId });
  const setBusy = (next: SuggestionBusy) => { setFlowBusy(next); setLocked(next !== null); };
  const run = (action: () => Promise<void>) => { setLocked(true); void action().finally(() => setLocked(false)); };

  return <>
    {view === "loading" && <Status {...latest} />}
    {latestFailed && <Status {...latest} />}
    {view === "intro" && !latest.error && <>
      <div className="cai-intro">
        <span className="cai-intro-icon" aria-hidden="true"><Icon name="spark" /></span>
        <div>
          <h3>{curriculum.cohortCode} · {curriculum.name}</h3>
          <p>AI đọc tên, khối kiến thức và mô tả của {curriculum.courseCount.toLocaleString("vi-VN")} học phần cùng danh mục kỹ năng hiện có, rồi đề xuất: kỹ năng nghề nghiệp đang được yêu cầu nhưng chưa có trong danh mục, và kỹ năng mới mà chương trình có dạy. Mỗi kỹ năng kèm nhóm, phạm vi đánh giá và lý do.</p>
          <p className="cai-muted">AI chỉ nhận dữ liệu chương trình đào tạo, không nhận dữ liệu sinh viên. Kết quả chỉ là gợi ý: bạn chọn, sửa rồi mới lưu.</p>
        </div>
      </div>
      <WorkerLine line={worker} loading={statusLoading} />
      {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Hủy</button>
        <button type="button" className="am-primary" disabled={busy !== null || !worker.canCreate} onClick={() => run(create)}><Icon name="spark" /> {busy === "create" ? "Đang gửi…" : "Tạo đề xuất"}</button>
      </div>
    </>}
    {view === "waiting" && suggestion && <>
      <div className="cai-waiting">
        <span className="cai-spinner" aria-hidden="true" />
        <div>
          <p className="cai-state" role="status" aria-live="polite">{suggestion.status === "queued" ? "Đang chờ máy AI nhận việc…" : "AI đang đọc chương trình và đề xuất kỹ năng…"}</p>
          {suggestion.status === "processing" && <p className="cai-muted"><Elapsed since={suggestion.updatedAt} /> · AI suy luận trước khi trả lời nên thường mất 2–4 phút.</p>}
          <p className="cai-muted">{curriculum.cohortCode} · {curriculum.name}</p>
        </div>
      </div>
      <WorkerLine line={worker} loading={false} />
      {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Đóng</button>
        <button type="button" className="am-outline" disabled={busy !== null} onClick={() => run(cancel)}><Icon name="close" /> {busy === "cancel" ? "Đang hủy…" : "Hủy đề xuất"}</button>
      </div>
    </>}
    {view === "failed" && suggestion && <>
      <div className="cai-failed" role="status" aria-live="polite"><h3>Chưa tạo được đề xuất</h3><p>{failureMessage(suggestion.errorCode)}</p></div>
      <WorkerLine line={worker} loading={false} />
      {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Hủy</button>
        <button type="button" className="am-primary" disabled={busy !== null || !worker.canCreate} onClick={() => run(create)}><Icon name="refresh" /> {busy === "create" ? "Đang gửi…" : "Tạo lại đề xuất"}</button>
      </div>
    </>}
    {view === "completed" && suggestion && <SkillsReview key={suggestion.id} suggestion={suggestion} busy={busy} setBusy={setBusy} createError={error}
      canCreate={worker.canCreate} regenerate={() => run(create)} close={close} saved={saved} />}
  </>;
}

type ReviewProps = {
  suggestion: CourseAiSuggestion; busy: SuggestionBusy; setBusy: (busy: SuggestionBusy) => void;
  createError: string; canCreate: boolean; regenerate: () => void; close: () => void; saved: () => void;
};

function SkillsReview({ suggestion, busy, setBusy, createError, canCreate, regenerate, close, saved }: ReviewProps) {
  const groups = useCompetencyData<{ items: Group[] }>(`${COMPETENCY_API}/groups`);
  const [rows, setRows] = useState<SkillRow[]>(() => skillRows(suggestion.items));
  const [error, setError] = useState("");
  const check = validateSkillRows(rows);
  const options = (groups.data?.items ?? []).filter((group) => group.isActive);
  const update = (key: string, patch: Partial<SkillRow>) => { setError(""); setRows((previous) => previous.map((row) => row.key === key ? { ...row, ...patch } : row)); };
  const apply = async () => {
    setBusy("apply"); setError("");
    try {
      await aiRequest(`${COMPETENCY_AI_API}/${encodeURIComponent(suggestion.id)}/apply`, jsonPost({ items: applySkillItems(rows) }));
      setBusy(null);
      saved();
    } catch (failure) { setError((failure as Error).message); setBusy(null); }
  };
  const count = suggestion.items.length;
  return <>
    <ReviewHead suggestion={suggestion} heading={count ? `AI đề xuất ${count.toLocaleString("vi-VN")} kỹ năng cho danh mục` : "AI chưa thấy kỹ năng nào cần bổ sung"}
      text={count ? "Bỏ chọn kỹ năng không phù hợp; sửa nhóm, phạm vi đánh giá và tên kỹ năng mới nếu cần rồi lưu. Kỹ năng mới cần bạn tự chọn." : "Danh mục có vẻ đã bao quát chương trình này. Bạn có thể tạo lại đề xuất hoặc thêm hồ sơ năng lực thủ công."} />
    <Status {...groups} />
    {rows.length > 0 && <ul className="cai-rows">{rows.map((row) => {
      const id = `sa-${suggestion.id}-${row.key}`;
      const rowErrors = check.errors[row.key] ?? [];
      return <li key={row.key} className={`cai-row${row.checked && !row.inCatalog ? " cai-row-on" : ""}${row.inCatalog ? " cai-row-linked" : ""}${rowErrors.length ? " cai-row-invalid" : ""}`}>
        <div className="cai-row-head">
          <label className="cai-check"><input type="checkbox" checked={row.checked && !row.inCatalog} disabled={row.inCatalog || busy !== null} onChange={(event) => update(row.key, { checked: event.target.checked })} /><span>{row.skillName || "kỹ năng mới"}</span></label>
          {row.inCatalog && <span className="cai-tag">Đã có trong danh mục</span>}
          {!row.inCatalog && (row.isNewSkill ? <span className="cai-tag cai-tag-similar">Kỹ năng mới</span> : <span className="cai-tag cai-tag-required">Kỹ năng nghề chưa đo</span>)}
          <button type="button" className="am-icon-btn am-delete-icon cai-remove" disabled={busy !== null} aria-label={`Bỏ đề xuất ${row.skillName}`} title="Bỏ đề xuất" onClick={() => setRows((previous) => previous.filter((item) => item.key !== row.key))}><Icon name="trash" /></button>
        </div>
        {!row.inCatalog && <fieldset className="cai-row-fields comp-skill-fields" disabled={busy !== null}>
          <legend className="sr-only">Thông tin kỹ năng {row.skillName}</legend>
          {row.isNewSkill && <label htmlFor={`${id}-name`}><RequiredLabel>Tên kỹ năng mới</RequiredLabel><input id={`${id}-name`} maxLength={SKILL_NAME_MAX} value={row.skillName} onChange={(event) => update(row.key, { skillName: event.target.value })} /></label>}
          <label htmlFor={`${id}-group`} className={row.isNewSkill ? undefined : "cai-wide"}><RequiredLabel>Nhóm kỹ năng</RequiredLabel><select id={`${id}-group`} value={row.groupId} disabled={!groups.data} onChange={(event) => update(row.key, { groupId: event.target.value })}>
            <option value="">Chọn nhóm</option>{options.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select></label>
          {row.isNewSkill && <label htmlFor={`${id}-description`} className="cai-wide">Mô tả kỹ năng<textarea id={`${id}-description`} rows={2} maxLength={SKILL_DESCRIPTION_MAX} value={row.description} onChange={(event) => update(row.key, { description: event.target.value })} /></label>}
          <label htmlFor={`${id}-scope`} className="cai-wide">Phạm vi đánh giá<textarea id={`${id}-scope`} rows={3} maxLength={SKILL_SCOPE_MAX} value={row.scope} onChange={(event) => update(row.key, { scope: event.target.value })} /></label>
        </fieldset>}
        {!row.inCatalog && <p className="cai-similar">{row.isNewSkill ? "Khi lưu, kỹ năng mới được thêm vào mục Kỹ năng của Nghề nghiệp và vào danh mục đánh giá năng lực." : "Kỹ năng này đang được nghề nghiệp yêu cầu nhưng chưa có trong danh mục đánh giá năng lực. Khi lưu, kỹ năng được thêm vào danh mục."}</p>}
        {row.reason && <p className="cai-reason">Lý do AI đề xuất: {row.reason}</p>}
        {rowErrors.length > 0 && <ul className="cai-row-errors" role="alert">{rowErrors.map((message) => <li key={message}>{message}</li>)}</ul>}
      </li>;
    })}</ul>}
    {rows.length > 0 && <p className="cai-summary" aria-live="polite">Đã chọn {check.selected.toLocaleString("vi-VN")} kỹ năng để thêm vào danh mục. Bạn liên kết kỹ năng với học phần ở tab Trọng số học phần.</p>}
    {(error || createError) && <p className="admin-error cm-prewrap" role="alert">{error || createError}</p>}
    <div className="cm-actions cm-dialog-actions">
      <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Hủy</button>
      <div className="cm-dialog-actions-main">
        <button type="button" className="am-outline" disabled={busy !== null || !canCreate} onClick={regenerate}><Icon name="refresh" /> {busy === "create" ? "Đang gửi…" : "Tạo lại đề xuất"}</button>
        {count > 0 && <button type="button" className="am-primary" disabled={busy !== null || !check.valid || !groups.data} onClick={() => void apply()}><Icon name="save" /> {busy === "apply" ? "Đang lưu…" : `Lưu ${check.selected.toLocaleString("vi-VN")} kỹ năng`}</button>}
      </div>
    </div>
  </>;
}
