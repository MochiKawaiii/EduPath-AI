import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLiveData } from "./use-live-data";
import { useLiveFilters } from "./use-live-filters";
import { careerFailures, requirementLevels, type Career, type CareerField, type StudentCareerDetail } from "./career-types";
import { Icon } from "./ui-icon";
import "./student-careers.css";

const endpoint = "/api/student/careers";
type CareerChoice = Pick<Career, "id" | "nameVi" | "nameEn">;
async function readCareerResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    throw new Error(careerFailures[body.error] ?? "Chưa tải được thông tin nghề nghiệp. Vui lòng thử lại.");
  }
  return body;
}
function useCareerData<T>(url: string) {
  const [revision, setRevision] = useState(0);
  return { ...useLiveData<T>(url, revision, readCareerResponse), retry: () => setRevision(value => value + 1) };
}

export default function StudentCareerExplorer({ selectedId, initialCareerId, onSelect, onClose }: {
  selectedId: string; initialCareerId?: string; onSelect: (career: CareerChoice) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [pendingCareer, setPendingCareer] = useState<CareerChoice | null>(null);
  const highlightedId = pendingCareer?.id ?? selectedId;
  const selectCareer = async (career: CareerChoice) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      await onSelect(career);
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  const [detailId, setDetailId] = useState(initialCareerId ?? "");
  const { draft, setDraft, filters, page, setPage, reset } = useLiveFilters({ q: "", category: "" });
  const fields = useCareerData<{ items: CareerField[] }>(`${endpoint}/fields`);
  const careers = useCareerData<{ items: Career[] }>(`${endpoint}?${new URLSearchParams(filters)}`);
  const pages = Math.max(1, Math.ceil((careers.data?.items.length ?? 0) / 10));
  useEffect(() => { if (careers.data && page > pages) setPage(pages); }, [careers.data, page, pages, setPage]);
  useEffect(() => { dialog.current?.scrollTo({ top: 0 }); }, [detailId]);
  return <dialog ref={dialog} className="sr-career-dialog" aria-labelledby="student-career-title" aria-busy={saving} onCancel={event => { event.preventDefault(); if (!savingRef.current) onClose(); }}>
    <header><h2 id="student-career-title">Khám phá nghề nghiệp</h2><button type="button" className="sr-secondary" disabled={saving} onClick={onClose} aria-label="Đóng khám phá nghề nghiệp">Đóng</button></header>
    <div className="sr-career-content">
      {detailId ? <>
        <button type="button" className="sr-secondary" disabled={saving} onClick={() => { setSaveError(""); setDetailId(""); }}><Icon name="back" />Danh sách vị trí</button>
        <CareerDetail key={detailId} id={detailId} selectedId={selectedId} saving={saving} saveError={saveError} onSelect={career => void selectCareer(career)} onClose={onClose} />
      </> : <>
        <p>Chọn một vị trí trong danh sách rồi bấm Lưu để đặt mục tiêu nghề nghiệp. Bạn có thể xem yêu cầu để tìm hiểu thêm trước khi chọn.</p>
        <details className="sr-career-fields">
          <summary>Lĩnh vực nghề nghiệp</summary>
          {fields.data && <div className="sr-career-field-grid">{fields.data.items.map(field => <article key={field.id}>
            <h3>{field.name}</h3><p>{field.description || "Khám phá các vị trí trong lĩnh vực này."}</p>
            <button type="button" className="sr-secondary" disabled={saving} aria-label={`Xem vị trí thuộc ${field.name}`} onClick={() => setDraft({ q: "", category: field.code })}>Xem vị trí</button>
          </article>)}</div>}
          {fields.data && !fields.data.items.length && <p>Chưa có lĩnh vực nghề nghiệp.</p>}
        </details>
        <div className="sr-table-filters sr-career-filters">
          <label>Tìm vị trí<input value={draft.q} disabled={saving} maxLength={200} placeholder="Tên Việt/Anh, mã hoặc kỹ năng…" onChange={event => setDraft({ ...draft, q: event.target.value })} /></label>
          <label>Lĩnh vực<select value={draft.category} disabled={saving} onChange={event => setDraft({ ...draft, category: event.target.value })}>
            <option value="">Tất cả lĩnh vực</option>{fields.data?.items.map(field => <option key={field.id} value={field.code}>{field.name}</option>)}
          </select></label>
          <button type="button" className="sr-secondary" disabled={saving} onClick={reset}><Icon name="refresh" />Xóa bộ lọc</button>
        </div>
        {!fields.data && <CareerStatus {...fields} />}
        <CareerStatus {...careers} />
        {careers.data && <>
          <p className="sw-muted" role="status">{careers.data.items.length} vị trí nghề nghiệp</p>
          <div className="sr-career-list" role="radiogroup" aria-label="Chọn mục tiêu nghề nghiệp">{careers.data.items.slice((page - 1) * 10, page * 10).map(career => <article key={career.id} className={career.id === highlightedId ? "sr-career-card-selected" : undefined}>
            <label className="sr-career-option">
              <input type="radio" name="student-career-choice" value={career.id} checked={career.id === highlightedId} disabled={saving} aria-label={`${career.nameVi} — ${career.nameEn}`} onChange={() => { setPendingCareer(career); setSaveError(""); }} />
              <span className="sr-career-option-info"><strong>{career.nameVi}</strong><span>{career.nameEn}</span><small>{fields.data?.items.find(field => field.code === career.category)?.name ?? career.categoryName ?? career.category}</small>
                {career.id === selectedId && <span className="sr-career-selected">Mục tiêu đã lưu</span>}
                {career.id === pendingCareer?.id && career.id !== selectedId && <span className="sr-career-staged">Đang chọn</span>}
              </span>
            </label>
            <button type="button" className="sr-secondary" disabled={saving} onClick={() => setDetailId(career.id)}><Icon name="eye" />Xem yêu cầu</button>
          </article>)}</div>
          {!careers.data.items.length && <p>Không có vị trí phù hợp với bộ lọc.</p>}
          {pages > 1 && <div className="sr-career-pagination"><button type="button" className="sr-secondary" disabled={saving || page <= 1} onClick={() => setPage(page - 1)}><Icon name="back" />Trước</button><span>Trang {page} / {pages}</span><button type="button" className="sr-secondary" disabled={saving || page >= pages} onClick={() => setPage(page + 1)}>Sau<Icon name="chevron" /></button></div>}
        </>}
        {pendingCareer && <p className="sr-career-choice-summary" role="status">Đang chọn: <strong>{pendingCareer.nameVi} — {pendingCareer.nameEn}</strong></p>}
        {saveError && <p className="sr-error" role="alert">{saveError}</p>}
        <div className="sr-actions sr-form-actions"><button type="button" className="sr-secondary" disabled={saving} onClick={onClose}><Icon name="close" />Hủy</button><button type="button" className="sw-primary" disabled={saving || !pendingCareer || pendingCareer.id === selectedId} onClick={() => { if (pendingCareer) void selectCareer(pendingCareer); }}><Icon name="save" />{saving ? "Đang lưu…" : "Lưu"}</button></div>
      </>}
    </div>
  </dialog>;
}

function CareerStatus({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => void }) {
  return loading ? <p role="status">Đang tải nghề nghiệp…</p> : error ? <div className="sr-error" role="alert"><p>{error}</p><button type="button" onClick={retry}>Tải lại</button></div> : null;
}

function CareerDetail({ id, selectedId, saving, saveError, onSelect, onClose }: { id: string; selectedId: string; saving: boolean; saveError: string; onSelect: (career: StudentCareerDetail) => void; onClose: () => void }) {
  const remote = useCareerData<StudentCareerDetail>(`${endpoint}/${id}`);
  const career = remote.data;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (career) heading.current?.focus(); }, [career?.id]);
  return <>
    <CareerStatus {...remote} />
    {career && <>
      <section className="sr-career-overview"><h3 ref={heading} tabIndex={-1}>{career.nameVi}</h3><p>{career.nameEn}</p><small>{career.categoryName}</small><p className="sr-career-description">{career.description || "Chưa bổ sung mô tả công việc."}</p></section>
      <section><h3>Yêu cầu, kỹ năng và công nghệ</h3>
        {career.requirements.length ? <div className="sr-career-table-scroll"><table className="sr-career-table"><thead><tr><th>Yêu cầu</th><th>Kỹ năng / Công nghệ</th><th>Mức yêu cầu</th><th>Tính chất</th></tr></thead>
          <tbody>{career.requirements.map(item => <tr key={item.id}><td><strong>{item.title}</strong>{item.description && <p className="sr-career-description">{item.description}</p>}</td><td>{item.skillName || "—"}</td><td>{requirementLevels[item.level]}</td><td>{item.isRequired ? "Bắt buộc" : "Ưu tiên"}</td></tr>)}</tbody>
        </table></div> : <p>Chưa có yêu cầu hoặc kỹ năng được cập nhật cho vị trí này.</p>}
      </section>
      {saveError && <p className="sr-error" role="alert">{saveError}</p>}
      <p className="sw-muted">Bấm chọn để lưu ngay mục tiêu nghề nghiệp. Sở thích của bạn được giữ nguyên.</p>
    </>}
    <div className="sr-actions sr-form-actions">
      <button type="button" className="sr-secondary" disabled={saving} onClick={onClose}><Icon name="close" />Hủy</button>
      {career && <button type="button" className="sw-primary" disabled={saving || selectedId === career.id} onClick={() => onSelect(career)}><Icon name="check" />{saving ? "Đang lưu mục tiêu…" : selectedId === career.id ? "Đã chọn mục tiêu này" : "Chọn làm mục tiêu nghề nghiệp"}</button>}
    </div>
  </>;
}
