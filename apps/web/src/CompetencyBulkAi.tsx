import { useEffect, useState } from "react";
import { Modal, Status } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { formatDateTime, workerLine } from "./career-ai-suggestions";
import { COMPETENCY_API, competencyRequest, useCompetencyData, type CompetencyCourse, type CurriculumRevision } from "./competency-types";
import {
  COMPETENCY_AI_API, POLL_BATCH_MS, aiRequest, batchPending, batchProgress, jsonPost, skipReason,
  type BatchApplyResult, type CourseAiBatch, type CourseAiStatus,
} from "./competency-ai";

type Busy = "run" | "cancel" | "draft" | "active" | null;
type Props = { curriculum: CurriculumRevision; canManage: boolean; revision: number; onSaved: () => void };

/**
 * "Chạy AI cho cả chương trình": one AI proposal (skills and weights) for every course of the revision
 * that has no link yet, processed one by one by the local AI. Nothing is saved until the admin saves
 * the finished proposals as drafts, or applies them.
 */
export function CompetencyBulkAi({ curriculum, canManage, revision, onSaved }: Props) {
  const revisionQuery = encodeURIComponent(curriculum.revisionId);
  const courses = useCompetencyData<{ items: CompetencyCourse[] }>(`${COMPETENCY_API}/courses?revisionId=${revisionQuery}`, revision);
  const status = useCompetencyData<CourseAiStatus>(`${COMPETENCY_AI_API}/status`);
  const latest = useCompetencyData<{ batch: CourseAiBatch | null }>(`${COMPETENCY_AI_API}/batches/latest?revisionId=${revisionQuery}`, revision);
  const [polled, setPolled] = useState<CourseAiBatch | null | undefined>(undefined);
  const [busy, setBusy] = useState<Busy>(null);
  const [confirmActive, setConfirmActive] = useState(false);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<BatchApplyResult | null>(null);
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const batch = polled !== undefined ? polled : latest.data?.batch ?? null;
  const pending = batchPending(batch);
  const unlinked = (courses.data?.items ?? []).filter((course) => course.occurrenceCount === 1 && course.skillCount === 0).length;
  const linked = (courses.data?.items ?? []).filter((course) => course.skillCount > 0).length;
  const worker = workerLine(status.data);

  useEffect(() => {
    if (!pending || !batch) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      aiRequest<{ batch: CourseAiBatch | null }>(`${COMPETENCY_AI_API}/batches/latest?revisionId=${revisionQuery}`, { signal: controller.signal })
        .then((next) => { if (!controller.signal.aborted) setPolled(next.batch); })
        .catch(() => { /* keep the last progress */ });
    }, POLL_BATCH_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [pending, batch?.id, revisionQuery]);

  const run = async () => {
    setBusy("run"); setError(""); setNotice(""); setResult(null);
    try {
      const response = await aiRequest<{ queued: number; batch: CourseAiBatch | null; skipped: { linked: number; duplicate: number; pending: number } }>(
        `${COMPETENCY_AI_API}/batches`, jsonPost({ revisionId: curriculum.revisionId }));
      if (response.batch) setPolled(response.batch);
      setNotice(response.queued
        ? `Đã gửi ${response.queued.toLocaleString("vi-VN")} học phần cho máy AI.${response.skipped.duplicate ? ` Bỏ qua ${response.skipped.duplicate} học phần có mã lặp trong CTĐT.` : ""}`
        : "Không còn học phần nào cần chạy: các học phần đã có liên kết hoặc đang chờ AI xử lý.");
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };
  const cancel = async () => {
    if (!batch) return;
    setBusy("cancel"); setError("");
    try { setPolled((await aiRequest<{ batch: CourseAiBatch }>(`${COMPETENCY_AI_API}/batches/${encodeURIComponent(batch.id)}/cancel`, jsonPost({}))).batch); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };
  const apply = async (target: "draft" | "active") => {
    if (!batch) return;
    setBusy(target); setError(""); setNotice("");
    try {
      const response = await aiRequest<BatchApplyResult>(`${COMPETENCY_AI_API}/batches/${encodeURIComponent(batch.id)}/apply`, jsonPost({ status: target }));
      setResult(response); setPolled(response.batch); setConfirmActive(false);
      onSaved();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };

  const progress = batch ? batchProgress(batch) : null;
  return <section className="cm-panel comp-ai-batch" aria-labelledby={`comp-ai-batch-${curriculum.revisionId}`}>
    <div className="comp-ai-batch-head">
      <span className="cai-intro-icon" aria-hidden="true"><Icon name="spark" /></span>
      <div>
        <h3 id={`comp-ai-batch-${curriculum.revisionId}`}>Chạy AI cho cả chương trình</h3>
        <p className="comp-hint">AI đề xuất liên kết kỹ năng và trọng số cho từng học phần chưa có liên kết của {curriculum.cohortCode} · phiên bản {curriculum.version}. AI suy luận trước khi trả lời nên mỗi học phần mất khoảng 30 giây đến 2 phút; cả chương trình khoảng 1–2 giờ. Đề xuất chỉ được lưu khi bạn bấm lưu; học phần đã có liên kết được giữ nguyên.</p>
      </div>
    </div>
    <p className={`cai-worker cai-worker-${worker.tone}`}><span aria-hidden="true" />{status.loading && !status.data ? "Đang kiểm tra máy AI…" : worker.text}</p>
    <Status {...courses} /><Status {...latest} />
    {batch && progress && <div className="comp-ai-batch-progress">
      <p><strong>{progress.done.toLocaleString("vi-VN")}/{batch.total.toLocaleString("vi-VN")} học phần đã xong</strong><span> · lần chạy lúc {formatDateTime(batch.createdAt)}</span></p>
      <div className="comp-ai-bar" role="progressbar" aria-label="Tiến độ chạy AI cho cả chương trình" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></div>
      <ul className="comp-ai-counts">
        <li><span>Đang chờ</span><strong>{batch.queued}</strong></li>
        <li><span>Đang xử lý</span><strong>{batch.processing}</strong></li>
        <li><span>Có đề xuất chưa lưu</span><strong>{batch.ready}</strong></li>
        <li><span>Đã lưu</span><strong>{batch.applied}</strong></li>
        <li><span>Lỗi</span><strong>{batch.failed}</strong></li>
        <li><span>Đã hủy</span><strong>{batch.cancelled}</strong></li>
      </ul>
    </div>}
    {notice && <p className="comp-hint" role="status">{notice}</p>}
    {result && <div className="comp-ai-result" role="status">
      <p>Đã lưu {result.drafted.toLocaleString("vi-VN")} bản nháp và áp dụng {result.activated.toLocaleString("vi-VN")} học phần.{result.empty ? ` ${result.empty} học phần AI không đề xuất kỹ năng nào.` : ""}</p>
      {result.skipped.length > 0 && <p>Bỏ qua {result.skipped.length} học phần: {result.skipped.slice(0, 8).map((item) => `${item.courseCode} (${skipReason(item.reason)})`).join(", ")}{result.skipped.length > 8 ? "…" : ""}</p>}
    </div>}
    {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
    {canManage && <>
      {batch && batch.ready > 0 && <div className="comp-ai-apply">
        <label className="cm-check"><input type="checkbox" checked={confirmActive} disabled={busy !== null} onChange={(event) => setConfirmActive(event.target.checked)} />
          <span>Tôi hiểu khi áp dụng, các học phần này được tính ngay vào đánh giá năng lực của sinh viên {curriculum.cohortCode}.</span></label>
      </div>}
      <div className="cm-actions">
        {pending && <button type="button" className="am-outline" disabled={busy !== null} onClick={() => void cancel()}><Icon name="close" /> {busy === "cancel" ? "Đang hủy…" : "Hủy lần chạy"}</button>}
        {batch && batch.ready > 0 && <>
          <button type="button" className="am-outline" disabled={busy !== null} onClick={() => void apply("draft")}><Icon name="save" /> {busy === "draft" ? "Đang lưu…" : `Lưu ${batch.ready} đề xuất thành bản nháp`}</button>
          <button type="button" className="am-primary" disabled={busy !== null || !confirmActive} onClick={() => void apply("active")}><Icon name="save" /> {busy === "active" ? "Đang lưu…" : `Lưu và áp dụng ${batch.ready} học phần`}</button>
        </>}
        {!pending && linked > 0 && <button type="button" className="am-outline" disabled={busy !== null} onClick={() => { setNotice(""); setResult(null); setClearing(true); }}>
          <Icon name="trash" /> Xóa liên kết của {linked.toLocaleString("vi-VN")} học phần</button>}
        {!pending && <button type="button" className={batch && batch.ready > 0 ? "am-outline" : "am-primary"} disabled={busy !== null || !worker.canCreate || !courses.data || unlinked === 0} onClick={() => void run()}>
          <Icon name="spark" /> {busy === "run" ? "Đang gửi…" : unlinked ? `Chạy AI cho ${unlinked.toLocaleString("vi-VN")} học phần chưa có liên kết` : "Mọi học phần đã có liên kết"}</button>}
      </div>
    </>}
    {clearing && <ClearRevision curriculum={curriculum} linked={linked} close={() => setClearing(false)} cleared={(count) => {
      setClearing(false);
      setNotice(`Đã xóa liên kết và trọng số của ${count.toLocaleString("vi-VN")} học phần. Bấm "Chạy AI" để AI đề xuất lại.`);
      onSaved();
    }} />}
  </section>;
}

/**
 * "Xóa liên kết của cả chương trình": every course of the revision loses its links and weights and
 * becomes an empty draft, so a whole-program run can redo them. The admin types the cohort code.
 */
export function ClearRevision({ curriculum, linked, close, cleared }: { curriculum: CurriculumRevision; linked: number; close: () => void; cleared: (count: number) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const matches = code.trim().toLowerCase() === curriculum.cohortCode.toLowerCase();
  return <Modal title="Xóa liên kết của cả chương trình" onClose={close} busy={busy} size="sm">
    <form className="cm-dialog-body cm-form" onSubmit={async (event) => {
      event.preventDefault();
      if (!matches || busy) return;
      setBusy(true); setError("");
      try {
        const response = await competencyRequest<{ cleared: number }>(`${COMPETENCY_API}/courses/clear`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revisionId: curriculum.revisionId, confirm: code.trim() }),
        });
        cleared(response.cleared);
      } catch (failure) { setError((failure as Error).message); setBusy(false); }
    }}>
      <p>Toàn bộ liên kết kỹ năng và trọng số của <strong>{linked.toLocaleString("vi-VN")} học phần</strong> thuộc {curriculum.cohortCode} · phiên bản {curriculum.version} sẽ bị xóa; các học phần về bản nháp trống.</p>
      <p className="cm-warning">Sinh viên {curriculum.cohortCode} sẽ chưa có điểm năng lực cho tới khi bạn lưu và áp dụng lại liên kết, trọng số. Lịch sử thay đổi của từng học phần vẫn được giữ.</p>
      <p className="comp-hint">Sau khi xóa, bấm "Chạy AI cho … học phần chưa có liên kết" để AI đề xuất lại cho cả chương trình.</p>
      <label><RequiredLabel>Nhập {curriculum.cohortCode} để xác nhận</RequiredLabel><input value={code} maxLength={40} autoComplete="off" disabled={busy} onChange={(event) => setCode(event.target.value)} /></label>
      {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button className="am-primary am-delete" disabled={busy || !matches}><Icon name="trash" /> {busy ? "Đang xóa…" : "Xóa liên kết"}</button>
      </div>
    </form>
  </Modal>;
}
