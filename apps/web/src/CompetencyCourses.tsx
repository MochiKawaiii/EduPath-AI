import { useState } from "react";
import { Icon } from "./admin-account-shared";
import { ActionMenu, Modal, Pagination, Status } from "./admin-ui";
import { useLiveFilters } from "./use-live-filters";
import { assessAllocations, type AllocationInput } from "./competency-weights";
import { COMPETENCY_API, competencyDate, competencyRequest, percentage, statusLabels, useCompetencyData, type CompetencyCourse, type CompetencySummary, type CourseDetail, type CurriculumRevision, type EventEntry, type Skill } from "./competency-types";

type Props = { curriculum: CurriculumRevision; canManage: boolean; revision: number; onSaved: () => void };
const courseUrl = (revisionId: string, code: string) => `${COMPETENCY_API}/courses/${encodeURIComponent(revisionId)}/${encodeURIComponent(code)}`;

export function CompetencyCoursesTab({ curriculum, canManage, revision, onSaved }: Props) {
  const { draft, setDraft, filters, page, setPage, reset } = useLiveFilters({ q: "", status: "" });
  const query = new URLSearchParams({ revisionId: curriculum.revisionId, ...filters });
  const courses = useCompetencyData<{ items: CompetencyCourse[] }>(`${COMPETENCY_API}/courses?${query}`, revision);
  const summary = useCompetencyData<CompetencySummary>(`${COMPETENCY_API}/summary?revisionId=${encodeURIComponent(curriculum.revisionId)}`, revision);
  const [selected, setSelected] = useState<CompetencyCourse | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "archive">("view");
  const close = () => setSelected(null);
  const saved = () => { close(); onSaved(); };
  function open(course: CompetencyCourse, next: typeof mode) { setSelected(course); setMode(next); }

  return <div className="comp-section-stack">
    <section className="cm-panel comp-summary"><Status {...summary} />{summary.data && <>
      <div className="cm-stats">
        <div><span>Đang áp dụng</span><strong>{summary.data.activeCount}</strong><small>/ {summary.data.courseCount} học phần</small></div>
        <div><span>Bản nháp</span><strong>{summary.data.draftCount}</strong><small>Cần hoàn thiện trước khi áp dụng</small></div>
        <div><span>Chưa cấu hình</span><strong>{summary.data.missingCount}</strong><small>{summary.data.archivedCount} cấu hình đã lưu trữ</small></div>
        <div><span>Kỹ năng chưa đóng góp</span><strong>{summary.data.unlinkedSkillCount}</strong><small>Trong danh mục đánh giá năng lực</small></div>
      </div>
      {summary.data.activeCount === 0 && summary.data.draftCount === 0 && <p className="comp-empty-config" role="status">{curriculum.cohortCode} · phiên bản {curriculum.version} chưa có cấu hình năng lực đang sử dụng. Có thể nhập Excel đúng khóa hoặc tạo cấu hình từng học phần.</p>}
      {summary.data.warnings.length > 0 && <details className="cm-warning"><summary>{summary.data.warnings.length} cảnh báo cần rà soát</summary><ul>{summary.data.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.courseCode && <strong>{warning.courseCode}: </strong>}{warning.message}</li>)}</ul></details>}
    </>}</section>
    <section className="cm-panel">
      <div className="cm-filters"><label className="cm-search">Tìm học phần<input maxLength={200} value={draft.q} onChange={event => setDraft({ ...draft, q: event.target.value })} placeholder="Mã hoặc tên học phần…" /></label><label>Trạng thái<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="">Tất cả trạng thái</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="am-outline" onClick={reset}><Icon name="refresh" /> Xóa bộ lọc</button></div>
      <Status {...courses} />
      {courses.data && <><div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Bảng cấu hình năng lực theo học phần"><table className="cm-table comp-course-table"><thead><tr><th>Học phần</th><th>Khối kiến thức</th><th>Trạng thái</th><th>Kỹ năng / tổng trọng số</th><th>Thao tác</th></tr></thead><tbody>{courses.data.items.slice((page - 1) * 10, page * 10).map(course => <tr key={course.code}>
        <td><strong>{course.code}</strong>{course.name}<small>{course.credits} tín chỉ · {course.type || "Chưa xác định loại"}</small>{course.occurrenceCount > 1 && <span className="comp-state comp-state-inactive">Mã xuất hiện {course.occurrenceCount} lần · cần rà soát</span>}</td>
        <td>{course.block || "Chưa xác định"}{course.specialty && <small>{course.specialty}</small>}</td>
        <td><span className={`comp-state comp-state-${course.status}`}>{statusLabels[course.status]}</span></td>
        <td>{course.skillCount} kỹ năng<strong>{percentage(course.totalWeight)}</strong>{course.status === "archived" && <small>Trọng số lưu trong lịch sử; không đóng góp.</small>}</td>
        <td><ActionMenu label={`Thao tác với ${course.code}`} items={[
          { key: "view", icon: "eye", label: "Chi tiết và lịch sử", onSelect: () => open(course, "view") },
          ...(canManage ? [
            { key: "edit", icon: "edit", label: course.status === "missing" ? "Tạo cấu hình" : "Chỉnh sửa cấu hình", disabled: course.occurrenceCount > 1, onSelect: () => open(course, "edit") },
            ...(course.configId && course.status !== "archived" ? [{ key: "archive", icon: "trash", label: "Lưu trữ cấu hình", danger: true, onSelect: () => open(course, "archive") }] : []),
          ] : []),
        ]} /></td>
      </tr>)}</tbody></table></div>{!courses.data.items.length && <p className="am-empty">Không có học phần phù hợp.</p>}<Pagination total={courses.data.items.length} page={page} setPage={setPage} /></>}
    </section>
    {selected && <CourseDialog curriculum={curriculum} course={selected} mode={mode} canManage={canManage} close={close} saved={saved} />}
  </div>;
}

function CourseDialog({ curriculum, course, mode, canManage, close, saved }: { curriculum: CurriculumRevision; course: CompetencyCourse; mode: "view" | "edit" | "archive"; canManage: boolean; close: () => void; saved: () => void }) {
  const remote = useCompetencyData<CourseDetail>(courseUrl(curriculum.revisionId, course.code));
  const [busy, setBusy] = useState(false);
  return <Modal title={`${course.code} · ${course.name}`} onClose={close} busy={busy}>
    <div className="cm-dialog-body comp-course-dialog"><p className="comp-hint">{curriculum.cohortCode} · phiên bản {curriculum.version} · {curriculum.isCurrent ? "Hiện hành" : "Lịch sử"}</p><Status {...remote} />
      {remote.data && (mode === "archive" ? <ArchiveConfiguration initial={remote.data} canManage={canManage} close={close} saved={saved} busy={busy} setBusy={setBusy} /> : <CourseConfiguration key={course.code} initial={remote.data} canManage={canManage} startEditing={mode === "edit"} close={close} saved={saved} busy={busy} setBusy={setBusy} />)}
      {!remote.data && <div className="cm-actions"><button className="am-outline" onClick={close}><Icon name="close" /> Đóng</button></div>}
    </div>
  </Modal>;
}

function CourseConfiguration({ initial, canManage, startEditing, close, saved, busy, setBusy }: { initial: CourseDetail; canManage: boolean; startEditing: boolean; close: () => void; saved: () => void; busy: boolean; setBusy: (value: boolean) => void }) {
  // Pin the version originally opened. Background refreshes never replace an unsaved edit.
  const [current] = useState(initial);
  const [editing, setEditing] = useState(startEditing && canManage);
  const [rows, setRows] = useState<AllocationInput[]>(current.links.map(link => ({ skillId: link.skillId, percent: String(Number((link.weight * 100).toFixed(8))) })));
  const [note, setNote] = useState(current.note);
  const [error, setError] = useState("");
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const skills = useCompetencyData<{ items: Skill[] }>(`${COMPETENCY_API}/skills`);
  const options = skills.data?.items ?? [];
  const allocation = assessAllocations(rows);
  const catalogReady = !!skills.data && !skills.loading && !skills.error;
  const missingSkills = catalogReady && rows.some(row => !!row.skillId && !options.some(skill => skill.id === row.skillId));
  const unavailable = rows.some(row => {
    const skill = options.find(item => item.id === row.skillId);
    return !skill || !skill.isActive || !skill.groupActive;
  });
  const duplicateCode = current.occurrenceCount > 1;
  const validDraft = catalogReady && allocation.errors.length === 0 && !duplicateCode && !missingSkills;
  const canActivate = validDraft && allocation.canActivate && !unavailable;
  const skillName = (id: string) => options.find(item => item.id === id)?.name ?? current.links.find(link => link.skillId === id)?.skillName ?? "Kỹ năng chưa chọn";
  async function save(status: "draft" | "active") {
    if (busy || !editing || !canManage || !validDraft || (status === "active" && !canActivate)) return;
    setBusy(true); setError("");
    try {
      await competencyRequest(courseUrl(current.revisionId, current.courseCode), { method: "PUT", headers: { "Content-Type": "application/json", "x-version": current.version ?? "new" }, body: JSON.stringify({ status, links: allocation.links, note }) });
      saved();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="cm-form">
    <p><span className={`comp-state comp-state-${current.status}`}>{statusLabels[current.status]}</span>{current.status === "archived" && <span className="comp-hint"> Cấu hình đã lưu trữ, không đóng góp vào năng lực. Chọn chỉnh sửa để tạo trạng thái mới.</span>}</p>
    {duplicateCode && <p className="cm-warning" role="alert">Mã học phần xuất hiện {current.occurrenceCount} lần trong phiên bản chương trình. Cần rà soát khung trước khi lưu trọng số.</p>}
    {editing && <><p className="comp-hint">Nhập phần trăm cho toàn bộ danh sách. Áp dụng cần ít nhất một kỹ năng, tổng 100% và mọi kỹ năng đang hoạt động. Trọng số 0% được giữ nhưng không đóng góp.</p><Status {...skills} /></>}
    <fieldset className="comp-fields" disabled={busy || !editing}>
      <div className="comp-allocation-list">
        {rows.map((row, index) => {
          const selected = options.find(skill => skill.id === row.skillId);
          const linked = current.links.find(link => link.skillId === row.skillId);
          return <div className="comp-allocation-row" key={index}>
            <label>Kỹ năng {index + 1}{editing ? <select value={row.skillId} onChange={event => setRows(rows.map((item, at) => at === index ? { ...item, skillId: event.target.value } : item))}><option value="">Chọn kỹ năng</option>{!selected && row.skillId && <option value={row.skillId}>{linked?.skillName ?? "Kỹ năng không còn khả dụng"}</option>}{options.map(skill => <option key={skill.id} value={skill.id} disabled={!skill.isActive || !skill.groupActive || rows.some((item, at) => at !== index && item.skillId === skill.id)}>{skill.name} · {skill.groupName}{!skill.isActive || !skill.groupActive ? " · Ngừng sử dụng" : ""}</option>)}</select> : <strong>{skillName(row.skillId)}</strong>}</label>
            <label className="comp-percent">Trọng số (%)<input type="number" min="0" max="100" step="any" value={row.percent} onChange={event => setRows(rows.map((item, at) => at === index ? { ...item, percent: event.target.value } : item))} /></label>
            {editing && <button type="button" className="am-outline comp-remove-link" aria-label={`Gỡ ${skillName(row.skillId)} khỏi cấu hình`} onClick={() => setRemoveIndex(index)}><Icon name="trash" /> Gỡ</button>}
            {(selected && (!selected.isActive || !selected.groupActive)) || (!selected && linked && !linked.isActive) ? <small className="comp-row-warning">Kỹ năng hoặc nhóm đang ngừng sử dụng; không thể áp dụng.</small> : null}
          </div>;
        })}
        {!rows.length && <p className="comp-hint">Chưa liên kết kỹ năng với học phần này.</p>}
      </div>
      {editing && <button type="button" className="am-outline" disabled={busy || skills.loading || !!skills.error || rows.length >= 200} onClick={() => setRows([...rows, { skillId: "", percent: "0" }])}><Icon name="plus" /> Thêm liên kết kỹ năng</button>}
      <label>Ghi chú cấu hình<textarea rows={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>
    </fieldset>
    {removeIndex !== null && <div className="comp-inline-confirm"><p>Gỡ liên kết <strong>{skillName(rows[removeIndex]?.skillId ?? "")}</strong>? Thay đổi được ghi khi lưu toàn bộ cấu hình.</p><div className="cm-actions"><button className="am-outline" disabled={busy} onClick={() => setRemoveIndex(null)}>Giữ liên kết</button><button className="am-primary am-delete" disabled={busy} onClick={() => { setRows(rows.filter((_, index) => index !== removeIndex)); setRemoveIndex(null); }}>Xác nhận gỡ</button></div></div>}
    <div className={`comp-weight-total${allocation.canActivate ? " comp-weight-valid" : ""}`} role="status"><span>Tổng trọng số</span><strong>{percentage(allocation.total)} / 100%</strong></div>
    {editing && allocation.errors.length > 0 && <div className="admin-error" role="alert"><ul>{allocation.errors.map(message => <li key={message}>{message}</li>)}</ul></div>}
    {editing && missingSkills && <p className="cm-warning" role="alert">Có kỹ năng không còn trong danh mục đánh giá năng lực. Hãy thay thế hoặc gỡ các liên kết đó trước khi lưu bản nháp hoặc áp dụng.</p>}
    {editing && !missingSkills && unavailable && catalogReady && <p className="cm-warning">Có kỹ năng hoặc nhóm ngừng sử dụng. Hãy thay thế hoặc gỡ liên kết trước khi áp dụng.</p>}
    {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
    <div className="cm-actions cm-dialog-actions"><button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Đóng</button><div className="cm-dialog-actions-main">{canManage && (editing ? <><button className="am-outline" disabled={busy || !validDraft || removeIndex !== null} onClick={() => void save("draft")}><Icon name="save" />{busy ? "Đang lưu…" : "Lưu bản nháp"}</button><button className="am-primary" disabled={busy || !canActivate || removeIndex !== null} onClick={() => void save("active")}><Icon name="save" />{busy ? "Đang lưu…" : "Lưu và áp dụng"}</button></> : <button className="am-primary" disabled={duplicateCode} onClick={() => setEditing(true)}><Icon name="edit" />{current.status === "missing" ? "Tạo cấu hình" : "Chỉnh sửa"}</button>)}</div></div>
    <CourseHistory entries={current.history} />
  </div>;
}

function ArchiveConfiguration({ initial, canManage, close, saved, busy, setBusy }: { initial: CourseDetail; canManage: boolean; close: () => void; saved: () => void; busy: boolean; setBusy: (value: boolean) => void }) {
  const [current] = useState(initial);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  return <div className="cm-form"><h3>Lưu trữ toàn bộ cấu hình</h3><p>Cấu hình có {current.links.length} liên kết kỹ năng. Lưu trữ sẽ dừng đóng góp vào đánh giá năng lực và giữ trọng số cùng lịch sử để đối chiếu.</p><label className="comp-check"><input type="checkbox" checked={confirmed} disabled={busy || !canManage} onChange={event => setConfirmed(event.target.checked)} /><span>Tôi xác nhận lưu trữ cấu hình của {current.courseCode} trong phiên bản đã chọn.</span></label>{error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}<div className="cm-actions cm-dialog-actions"><button className="am-outline" disabled={busy} onClick={close}>Hủy</button><button className="am-primary am-delete" disabled={busy || !canManage || !confirmed || !current.version || current.status === "archived"} onClick={async () => {
    if (busy || !canManage || !current.version || !confirmed) return;
    setBusy(true); setError("");
    try { await competencyRequest(courseUrl(current.revisionId, current.courseCode), { method: "DELETE", headers: { "Content-Type": "application/json", "x-version": current.version }, body: JSON.stringify({ confirmed: true }) }); saved(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }}><Icon name="trash" />{busy ? "Đang lưu trữ…" : "Xác nhận lưu trữ"}</button></div></div>;
}

function CourseHistory({ entries }: { entries: EventEntry[] }) {
  const [page, setPage] = useState(1);
  return <section className="comp-history"><h3>Lịch sử cấu hình</h3>{!entries.length && <p className="comp-hint">Chưa có lần lưu cấu hình.</p>}{entries.slice((page - 1) * 10, page * 10).map(entry => {
    const snapshot = entry.snapshot && typeof entry.snapshot === "object" ? entry.snapshot as Partial<CourseDetail> : null;
    return <details key={entry.id}><summary>{competencyDate(entry.createdAt)} · {entry.actorName || "Hệ thống"}{snapshot?.status && ` · ${statusLabels[snapshot.status]}`}</summary>{entry.note && <p>{entry.note}</p>}{snapshot?.note && snapshot.note !== entry.note && <p className="cm-prewrap">Ghi chú: {snapshot.note}</p>}{Array.isArray(snapshot?.links) && <div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Trọng số tại thời điểm lưu"><table className="cm-table"><thead><tr><th>Kỹ năng tại thời điểm lưu</th><th>Nhóm</th><th>Trọng số</th></tr></thead><tbody>{snapshot.links.map(link => <tr key={link.skillId}><td>{link.skillName}</td><td>{link.groupName}</td><td>{percentage(link.weight)}</td></tr>)}</tbody></table></div>}</details>;
  })}{entries.length > 0 && <Pagination total={entries.length} page={page} setPage={setPage} />}</section>;
}
