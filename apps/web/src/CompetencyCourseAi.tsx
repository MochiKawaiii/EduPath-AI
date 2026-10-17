import { useState } from "react";
import { Modal, Status } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { COMPETENCY_API, percentage, useCompetencyData, type CompetencyCourse, type CurriculumRevision, type Group } from "./competency-types";
import {
  COMPETENCY_AI_API, SKILL_NAME_MAX,
  aiRequest, applyLinkItems, assessWeightRows, failureMessage, jsonPost, linkRows, validateLinkRows, weightRows,
  type CourseAiMode, type CourseAiSuggestion, type LinkRow, type WeightRow,
} from "./competency-ai";
import { Elapsed, ReviewHead, WorkerLine } from "./CompetencyAiParts";
import { useCompetencySuggestion, type SuggestionBusy as Busy } from "./use-competency-suggestion";
import "./careers.css";

type Props = { curriculum: CurriculumRevision; course: CompetencyCourse; mode: CourseAiMode; close: () => void; saved: () => void };

/**
 * "Tạo liên kết kỹ năng (AI)" and "Thêm trọng số (AI)" for one course: the local AI proposes, the
 * admin reviews and saves only what is kept. The AI receives curriculum data only, never student data.
 */
export default function CompetencyCourseAi({ curriculum, course, mode, close, saved }: Props) {
  const query = new URLSearchParams({ revisionId: curriculum.revisionId, code: course.code, mode });
  const { latest, latestFailed, statusLoading, worker, suggestion, view, busy, setBusy, error, create, cancel } =
    useCompetencySuggestion(`${COMPETENCY_AI_API}/latest?${query}`, COMPETENCY_AI_API, { revisionId: curriculum.revisionId, code: course.code, mode });

  const title = mode === "links" ? "Tạo liên kết kỹ năng (AI)" : "Thêm trọng số (AI)";
  return <Modal title={`${title} · ${course.code}`} onClose={close} busy={busy !== null}>
    <div className="cm-dialog-body cm-form cai-body">
      {view === "loading" && <Status {...latest} />}
      {latestFailed && <Status {...latest} />}
      {view === "intro" && !latest.error && <>
        <div className="cai-intro">
          <span className="cai-intro-icon" aria-hidden="true"><Icon name="spark" /></span>
          <div>
            <h3>{course.code} · {course.name}</h3>
            <p>{mode === "links"
              ? "AI đọc tên, mô tả, khối kiến thức và số giờ của học phần cùng các kỹ năng đã có cấu hình năng lực (gồm cả kỹ năng nghề nghiệp chưa có học phần đo) để đề xuất những kỹ năng học phần rèn luyện. Kỹ năng được lưu với trọng số 0%; bạn chia trọng số sau."
              : `AI chia 100% trọng số của học phần cho ${course.skillCount} kỹ năng đã liên kết. Bạn xem, sửa phần trăm rồi lưu bản nháp hoặc áp dụng.`}</p>
            <p className="cai-muted">AI chỉ nhận dữ liệu chương trình đào tạo, không nhận dữ liệu sinh viên. Kết quả chỉ là gợi ý: bạn chọn, sửa rồi mới lưu.</p>
          </div>
        </div>
        <WorkerLine line={worker} loading={statusLoading} />
        {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
        <div className="cm-actions cm-dialog-actions">
          <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Hủy</button>
          <button type="button" className="am-primary" disabled={busy !== null || !worker.canCreate} onClick={() => void create()}><Icon name="spark" /> {busy === "create" ? "Đang gửi…" : "Tạo đề xuất"}</button>
        </div>
      </>}
      {view === "waiting" && suggestion && <>
        <div className="cai-waiting">
          <span className="cai-spinner" aria-hidden="true" />
          <div>
            <p className="cai-state" role="status" aria-live="polite">{suggestion.status === "queued" ? "Đang chờ máy AI nhận việc…" : mode === "links" ? "AI đang chọn kỹ năng cho học phần…" : "AI đang chia trọng số…"}</p>
            {suggestion.status === "processing" && <p className="cai-muted"><Elapsed since={suggestion.updatedAt} /> · AI suy luận trước khi trả lời nên thường mất 30 giây đến 2 phút.</p>}
            <p className="cai-muted">{course.code} · {course.name}</p>
          </div>
        </div>
        <WorkerLine line={worker} loading={false} />
        {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
        <div className="cm-actions cm-dialog-actions">
          <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Đóng</button>
          <button type="button" className="am-outline" disabled={busy !== null} onClick={() => void cancel()}><Icon name="close" /> {busy === "cancel" ? "Đang hủy…" : "Hủy đề xuất"}</button>
        </div>
      </>}
      {view === "failed" && suggestion && <>
        <div className="cai-failed" role="status" aria-live="polite"><h3>Chưa tạo được đề xuất</h3><p>{failureMessage(suggestion.errorCode)}</p></div>
        <WorkerLine line={worker} loading={false} />
        {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
        <div className="cm-actions cm-dialog-actions">
          <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Hủy</button>
          <button type="button" className="am-primary" disabled={busy !== null || !worker.canCreate} onClick={() => void create()}><Icon name="refresh" /> {busy === "create" ? "Đang gửi…" : "Tạo lại đề xuất"}</button>
        </div>
      </>}
      {view === "completed" && suggestion && (mode === "links"
        ? <LinksReview key={suggestion.id} suggestion={suggestion} course={course} busy={busy} setBusy={setBusy} createError={error} canCreate={worker.canCreate} regenerate={() => void create()} close={close} saved={saved} />
        : <WeightsReview key={suggestion.id} suggestion={suggestion} course={course} busy={busy} setBusy={setBusy} createError={error} canCreate={worker.canCreate} regenerate={() => void create()} close={close} saved={saved} />)}
    </div>
  </Modal>;
}

type ReviewProps = {
  suggestion: CourseAiSuggestion; course: CompetencyCourse; busy: Busy; setBusy: (busy: Busy) => void;
  createError: string; canCreate: boolean; regenerate: () => void; close: () => void; saved: () => void;
};

function LinksReview({ suggestion, course, busy, setBusy, createError, canCreate, regenerate, close, saved }: ReviewProps) {
  const groups = useCompetencyData<{ items: Group[] }>(`${COMPETENCY_API}/groups`);
  const [rows, setRows] = useState<LinkRow[]>(() => linkRows(suggestion.items));
  const [error, setError] = useState("");
  const check = validateLinkRows(rows);
  const options = (groups.data?.items ?? []).filter((group) => group.isActive);
  const update = (key: string, patch: Partial<LinkRow>) => { setError(""); setRows((previous) => previous.map((row) => row.key === key ? { ...row, ...patch } : row)); };
  const apply = async () => {
    setBusy("apply"); setError("");
    try {
      await aiRequest(`${COMPETENCY_AI_API}/${encodeURIComponent(suggestion.id)}/apply`, jsonPost({ items: applyLinkItems(rows) }));
      saved();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };
  return <>
    <ReviewHead suggestion={suggestion} heading={suggestion.items.length ? `AI đề xuất ${suggestion.items.length.toLocaleString("vi-VN")} kỹ năng cho ${course.code}` : `AI chưa đề xuất kỹ năng nào cho ${course.code}`}
      text={suggestion.items.length ? "Bỏ chọn kỹ năng không phù hợp, chọn nhóm năng lực cho kỹ năng chưa có cấu hình năng lực rồi lưu. Kỹ năng được thêm với trọng số 0%." : "AI không tìm thấy kỹ năng phù hợp trong cấu hình năng lực. Bạn có thể tạo lại đề xuất hoặc tạo liên kết thủ công."} />
    <Status {...groups} />
    {rows.length > 0 && <ul className="cai-rows">{rows.map((row) => {
      const id = `ca-${suggestion.id}-${row.key}`;
      const rowErrors = check.errors[row.key] ?? [];
      return <li key={row.key} className={`cai-row${row.checked && !row.alreadyLinked ? " cai-row-on" : ""}${row.alreadyLinked ? " cai-row-linked" : ""}${rowErrors.length ? " cai-row-invalid" : ""}`}>
        <div className="cai-row-head">
          <label className="cai-check"><input type="checkbox" checked={row.checked && !row.alreadyLinked} disabled={row.alreadyLinked || busy !== null} onChange={(event) => update(row.key, { checked: event.target.checked })} /><span>{row.skillName || "kỹ năng mới"}</span></label>
          {row.alreadyLinked && <span className="cai-tag">Đã liên kết</span>}
          {row.isNewSkill && <span className="cai-tag cai-tag-similar">Kỹ năng mới</span>}
          {!row.hasProfile && !row.isNewSkill && <span className="cai-tag cai-tag-required">Kỹ năng nghề chưa đo</span>}
          <button type="button" className="am-icon-btn am-delete-icon cai-remove" disabled={busy !== null} aria-label={`Bỏ đề xuất ${row.skillName}`} title="Bỏ đề xuất" onClick={() => setRows((previous) => previous.filter((item) => item.key !== row.key))}><Icon name="trash" /></button>
        </div>
        {(row.isNewSkill || !row.hasProfile) && !row.alreadyLinked && <fieldset className="cai-row-fields" disabled={busy !== null}>
          <legend className="sr-only">Thông tin kỹ năng {row.skillName}</legend>
          {row.isNewSkill && <label htmlFor={`${id}-name`}><RequiredLabel>Tên kỹ năng mới</RequiredLabel><input id={`${id}-name`} maxLength={SKILL_NAME_MAX} value={row.skillName} onChange={(event) => update(row.key, { skillName: event.target.value })} /></label>}
          <label htmlFor={`${id}-group`}><RequiredLabel>Nhóm năng lực</RequiredLabel><select id={`${id}-group`} value={row.groupId} disabled={!groups.data} onChange={(event) => update(row.key, { groupId: event.target.value })}>
            <option value="">Chọn nhóm</option>{options.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select></label>
        </fieldset>}
        {!row.hasProfile && !row.alreadyLinked && <p className="cai-similar">{row.isNewSkill ? "Khi lưu, kỹ năng mới được thêm vào mục Kỹ năng của Nghề nghiệp và được tạo cấu hình năng lực." : "Kỹ năng này đang được nghề nghiệp yêu cầu nhưng chưa có học phần đo. Khi lưu, kỹ năng được tạo cấu hình năng lực."}</p>}
        {row.reason && <p className="cai-reason">Lý do AI đề xuất: {row.reason}</p>}
        {rowErrors.length > 0 && <ul className="cai-row-errors" role="alert">{rowErrors.map((message) => <li key={message}>{message}</li>)}</ul>}
      </li>;
    })}</ul>}
    {rows.length > 0 && <p className="cai-summary" aria-live="polite">Đã chọn {check.selected.toLocaleString("vi-VN")} kỹ năng để liên kết với {course.code}</p>}
    {(error || createError) && <p className="admin-error cm-prewrap" role="alert">{error || createError}</p>}
    <div className="cm-actions cm-dialog-actions">
      <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Hủy</button>
      <div className="cm-dialog-actions-main">
        <button type="button" className="am-outline" disabled={busy !== null || !canCreate} onClick={regenerate}><Icon name="refresh" /> {busy === "create" ? "Đang gửi…" : "Tạo lại đề xuất"}</button>
        {suggestion.items.length > 0 && <button type="button" className="am-primary" disabled={busy !== null || !check.valid || !groups.data} onClick={() => void apply()}><Icon name="save" /> {busy === "apply" ? "Đang lưu…" : `Lưu ${check.selected.toLocaleString("vi-VN")} liên kết`}</button>}
      </div>
    </div>
  </>;
}

function WeightsReview({ suggestion, course, busy, setBusy, createError, canCreate, regenerate, close, saved }: ReviewProps) {
  const [rows, setRows] = useState<WeightRow[]>(() => weightRows(suggestion.items));
  const [error, setError] = useState("");
  const assessment = assessWeightRows(rows);
  const apply = async (status: "draft" | "active") => {
    setBusy("apply"); setError("");
    try {
      await aiRequest(`${COMPETENCY_AI_API}/${encodeURIComponent(suggestion.id)}/apply`, jsonPost({ weights: assessment.weights, status }));
      saved();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };
  return <>
    <ReviewHead suggestion={suggestion} heading={`AI chia trọng số cho ${rows.length.toLocaleString("vi-VN")} kỹ năng của ${course.code}`}
      text="Sửa phần trăm nếu cần. Áp dụng cần tổng đúng 100%; bản nháp được lưu dù tổng chưa đủ." />
    {suggestion.stale && <p className="cm-warning" role="alert">Liên kết kỹ năng của học phần đã thay đổi sau khi AI đề xuất. Hãy tạo lại đề xuất trọng số.</p>}
    <ul className="cai-rows">{rows.map((row) => <li key={row.key} className={`cai-row cai-row-on${assessment.errors[row.key] ? " cai-row-invalid" : ""}`}>
      <div className="cai-row-head comp-ai-weight-row">
        <strong>{row.skillName}</strong>
        <label className="comp-percent">Trọng số (%)<input type="number" min="0" max="100" step="1" value={row.percent} disabled={busy !== null || suggestion.stale}
          onChange={(event) => { setError(""); setRows((previous) => previous.map((item) => item.key === row.key ? { ...item, percent: event.target.value } : item)); }} /></label>
      </div>
      {row.reason && <p className="cai-reason">Lý do AI đề xuất: {row.reason}</p>}
    </li>)}</ul>
    <div className={`comp-weight-total${assessment.canActivate ? " comp-weight-valid" : ""}`} role="status"><span>Tổng trọng số</span><strong>{percentage(assessment.total / 100)} / 100%</strong></div>
    {!assessment.valid && rows.length > 0 && <p className="admin-error" role="alert">Mỗi trọng số phải là số từ 0 đến 100.</p>}
    {(error || createError) && <p className="admin-error cm-prewrap" role="alert">{error || createError}</p>}
    <div className="cm-actions cm-dialog-actions">
      <button type="button" className="am-outline" disabled={busy !== null} onClick={close}><Icon name="close" /> Hủy</button>
      <div className="cm-dialog-actions-main">
        <button type="button" className="am-outline" disabled={busy !== null || !canCreate} onClick={regenerate}><Icon name="refresh" /> {busy === "create" ? "Đang gửi…" : "Tạo lại đề xuất"}</button>
        <button type="button" className="am-outline" disabled={busy !== null || !assessment.valid || suggestion.stale} onClick={() => void apply("draft")}><Icon name="save" /> {busy === "apply" ? "Đang lưu…" : "Lưu bản nháp"}</button>
        <button type="button" className="am-primary" disabled={busy !== null || !assessment.canActivate || suggestion.stale} onClick={() => void apply("active")}><Icon name="save" /> {busy === "apply" ? "Đang lưu…" : "Lưu và áp dụng"}</button>
      </div>
    </div>
  </>;
}
