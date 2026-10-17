import { useState, type ReactNode } from "react";
import { Icon } from "./admin-account-shared";
import { ActionMenu, Modal, Pagination, Status } from "./admin-ui";
import { useLiveFilters } from "./use-live-filters";
import { searchTerm } from "./student-curriculum-types";
import { assessAllocations, type AllocationInput } from "./competency-weights";
import { COMPETENCY_API, competencyDate, competencyRequest, percentage, statusLabels, useCompetencyData, type CompetencyCourse, type CompetencySummary, type CourseDetail, type CurriculumRevision, type EventEntry, type Group, type Skill } from "./competency-types";
import CompetencyCourseAi from "./CompetencyCourseAi";
import { CompetencyBulkAi } from "./CompetencyBulkAi";

type Props = { curriculum: CurriculumRevision; canManage: boolean; revision: number; onSaved: () => void };
/** What a course row opens: details, the full editor, one of the manual steps, or an AI proposal. */
type Mode = "view" | "edit" | "links" | "weights" | "removeLinks" | "clearWeights" | "aiLinks" | "aiWeights";
const courseUrl = (revisionId: string, code: string) => `${COMPETENCY_API}/courses/${encodeURIComponent(revisionId)}/${encodeURIComponent(code)}`;
const putCourse = (detail: CourseDetail, body: { status: "draft" | "active"; links: { skillId: string; weight: number }[]; note: string }) =>
  competencyRequest(courseUrl(detail.revisionId, detail.courseCode), { method: "PUT", headers: { "Content-Type": "application/json", "x-version": detail.version ?? "new" }, body: JSON.stringify(body) });

export function CompetencyCoursesTab({ curriculum, canManage, revision, onSaved }: Props) {
  const { draft, setDraft, filters, page, setPage, reset } = useLiveFilters({ q: "", status: "" });
  const query = new URLSearchParams({ revisionId: curriculum.revisionId, ...filters });
  const courses = useCompetencyData<{ items: CompetencyCourse[] }>(`${COMPETENCY_API}/courses?${query}`, revision);
  const summary = useCompetencyData<CompetencySummary>(`${COMPETENCY_API}/summary?revisionId=${encodeURIComponent(curriculum.revisionId)}`, revision);
  const [selected, setSelected] = useState<CompetencyCourse | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const close = () => setSelected(null);
  const saved = () => { close(); onSaved(); };
  function open(course: CompetencyCourse, next: Mode) { setSelected(course); setMode(next); }

  return <div className="comp-section-stack">
    <section className="cm-panel comp-summary"><Status {...summary} />{summary.data && <>
      <div className="cm-stats">
        <div><span>Đang áp dụng</span><strong>{summary.data.activeCount}</strong><small>/ {summary.data.courseCount} học phần</small></div>
        <div><span>Bản nháp</span><strong>{summary.data.draftCount}</strong><small>Cần hoàn thiện trước khi áp dụng</small></div>
        <div><span>Chưa cấu hình</span><strong>{summary.data.missingCount}</strong><small>{summary.data.archivedCount} cấu hình đã lưu trữ</small></div>
        <div><span>Kỹ năng chưa đóng góp</span><strong>{summary.data.unlinkedSkillCount}</strong><small>Có cấu hình năng lực</small></div>
      </div>
      {summary.data.activeCount === 0 && summary.data.draftCount === 0 && <p className="comp-empty-config" role="status">{curriculum.cohortCode} · phiên bản {curriculum.version} chưa có cấu hình học phần nào đang sử dụng. Có thể chạy AI cho cả chương trình hoặc tạo liên kết, trọng số cho từng học phần.</p>}
      {summary.data.warnings.length > 0 && <details className="cm-warning"><summary>{summary.data.warnings.length} cảnh báo cần rà soát</summary><ul>{summary.data.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.courseCode && <strong>{warning.courseCode}: </strong>}{warning.message}</li>)}</ul></details>}
    </>}</section>
    <CompetencyBulkAi curriculum={curriculum} canManage={canManage} revision={revision} onSaved={onSaved} />
    <section className="cm-panel">
      <div className="cm-filters"><label className="cm-search">Tìm học phần<input maxLength={200} value={draft.q} onChange={event => setDraft({ ...draft, q: event.target.value })} placeholder="Mã hoặc tên học phần…" /></label><label>Trạng thái<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="">Tất cả trạng thái</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="am-outline" onClick={reset}><Icon name="refresh" /> Xóa bộ lọc</button></div>
      <Status {...courses} />
      {courses.data && <><div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Bảng cấu hình học phần"><table className="cm-table comp-course-table"><thead><tr><th className="cm-stt">STT</th><th>Học phần</th><th>Khối kiến thức</th><th>Trạng thái</th><th>Kỹ năng / tổng trọng số</th><th>Thao tác</th></tr></thead><tbody>{courses.data.items.slice((page - 1) * 10, page * 10).map((course, index) => {
        const repeated = course.occurrenceCount > 1;
        const linked = course.skillCount > 0;
        return <tr key={course.code}>
          <td className="cm-stt">{(page - 1) * 10 + index + 1}</td>
          <td><strong>{course.code}</strong>{course.name}<small>{course.credits} tín chỉ · {course.type || "Chưa xác định loại"}</small>{repeated && <span className="comp-state comp-state-inactive">Mã xuất hiện {course.occurrenceCount} lần · cần rà soát</span>}</td>
          <td>{course.block || "Chưa xác định"}{course.specialty && <small>{course.specialty}</small>}</td>
          <td><span className={`comp-state comp-state-${course.status}`}>{statusLabels[course.status]}</span></td>
          <td>{course.skillCount} kỹ năng<strong>{percentage(course.totalWeight)}</strong>{course.status === "archived" && <small>Trọng số lưu trong lịch sử; không đóng góp.</small>}</td>
          <td><ActionMenu label={`Thao tác với ${course.code}`} items={[
            { key: "view", icon: "eye", label: "Xem chi tiết học phần", onSelect: () => open(course, "view") },
            ...(canManage ? [
              { key: "links", icon: "link", label: "Tạo liên kết kỹ năng (Thủ công)", disabled: repeated, onSelect: () => open(course, "links") },
              { key: "aiLinks", icon: "spark", label: "Tạo liên kết kỹ năng (AI)", disabled: repeated, onSelect: () => open(course, "aiLinks") },
              { key: "weights", icon: "chart", label: "Thêm trọng số (Thủ công)", disabled: repeated || !linked, onSelect: () => open(course, "weights") },
              { key: "aiWeights", icon: "spark", label: "Thêm trọng số (AI)", disabled: repeated || !linked, onSelect: () => open(course, "aiWeights") },
              { key: "edit", icon: "edit", label: "Chỉnh sửa liên kết và trọng số", disabled: repeated, onSelect: () => open(course, "edit") },
              { key: "removeLinks", icon: "trash", label: "Xóa liên kết", danger: true, disabled: repeated || !linked, onSelect: () => open(course, "removeLinks") },
              { key: "clearWeights", icon: "trash", label: "Xóa trọng số", danger: true, disabled: repeated || course.totalWeight <= 0, onSelect: () => open(course, "clearWeights") },
            ] : []),
          ]} /></td>
        </tr>;
      })}</tbody></table></div>{!courses.data.items.length && <p className="am-empty">Không có học phần phù hợp.</p>}<Pagination total={courses.data.items.length} page={page} setPage={setPage} /></>}
    </section>
    {selected && (mode === "aiLinks" || mode === "aiWeights")
      ? <CompetencyCourseAi curriculum={curriculum} course={selected} mode={mode === "aiLinks" ? "links" : "weights"} close={close} saved={saved} />
      : selected && <CourseDialog curriculum={curriculum} course={selected} mode={mode} canManage={canManage} close={close} saved={saved} />}
  </div>;
}

const dialogTitles: Partial<Record<Mode, string>> = {
  links: "Tạo liên kết kỹ năng (Thủ công)", weights: "Thêm trọng số (Thủ công)", removeLinks: "Xóa liên kết kỹ năng", clearWeights: "Xóa trọng số",
};

function CourseDialog({ curriculum, course, mode, canManage, close, saved }: { curriculum: CurriculumRevision; course: CompetencyCourse; mode: Mode; canManage: boolean; close: () => void; saved: () => void }) {
  const remote = useCompetencyData<CourseDetail>(courseUrl(curriculum.revisionId, course.code));
  const [busy, setBusy] = useState(false);
  const step = { detail: remote.data!, canManage, close, saved, busy, setBusy };
  const title = dialogTitles[mode];
  return <Modal title={title ? `${title} · ${course.code}` : `${course.code} · ${course.name}`} onClose={close} busy={busy}>
    <div className="cm-dialog-body comp-course-dialog"><p className="comp-hint">{course.code} · {course.name} · {curriculum.cohortCode} · phiên bản {curriculum.version} · {curriculum.isCurrent ? "Hiện hành" : "Lịch sử"}</p><Status {...remote} />
      {remote.data && (mode === "links" ? <ManualLinks key={course.code} {...step} />
        : mode === "weights" ? <ManualWeights key={course.code} {...step} />
          : mode === "removeLinks" ? <RemoveLinks key={course.code} {...step} />
            : mode === "clearWeights" ? <ClearWeights key={course.code} {...step} />
              : <CourseConfiguration key={course.code} initial={remote.data} canManage={canManage} startEditing={mode === "edit"} close={close} saved={saved} busy={busy} setBusy={setBusy} />)}
      {!remote.data && <div className="cm-actions"><button className="am-outline" onClick={close}><Icon name="close" /> Đóng</button></div>}
    </div>
  </Modal>;
}

type StepProps = { detail: CourseDetail; canManage: boolean; close: () => void; saved: () => void; busy: boolean; setBusy: (value: boolean) => void };

/** Status after a change that keeps the weights: an applied course stays applied while its total is 100%. */
const keepStatus = (detail: CourseDetail, links: { weight: number }[]) =>
  detail.status === "active" && Math.abs(links.reduce((sum, link) => sum + link.weight, 0) - 1) <= 0.000001 ? "active" as const : "draft" as const;

function DialogActions({ busy, close, children }: { busy: boolean; close: () => void; children: ReactNode }) {
  return <div className="cm-actions cm-dialog-actions"><button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button><div className="cm-dialog-actions-main">{children}</div></div>;
}

/** "Tạo liên kết kỹ năng (Thủ công)": tick skills of the competency catalog; they join the course at 0%. */
function ManualLinks({ detail, canManage, close, saved, busy, setBusy }: StepProps) {
  const [current] = useState(detail);
  const skills = useCompetencyData<{ items: Skill[] }>(`${COMPETENCY_API}/skills`);
  const groups = useCompetencyData<{ items: Group[] }>(`${COMPETENCY_API}/groups`);
  const [chosen, setChosen] = useState<string[]>([]);
  const [term, setTerm] = useState("");
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState("");
  const linked = new Set(current.links.map((link) => link.skillId));
  const available = (skills.data?.items ?? []).filter((skill) => !linked.has(skill.id) && skill.isActive && skill.groupActive
    && (!groupId || skill.groupId === groupId) && searchTerm(`${skill.name} ${skill.groupName}`).includes(searchTerm(term)));
  const toggle = (id: string) => setChosen((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  async function save() {
    if (busy || !canManage || !chosen.length) return;
    setBusy(true); setError("");
    try {
      const links = [...current.links.map((link) => ({ skillId: link.skillId, weight: link.weight })), ...chosen.map((skillId) => ({ skillId, weight: 0 }))];
      await putCourse(current, { status: keepStatus(current, links), links, note: current.note });
      saved();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="cm-form">
    <p className="comp-hint">Chọn kỹ năng học phần này rèn luyện. Kỹ năng mới được thêm với trọng số 0%; dùng “Thêm trọng số” để chia 100% sau. Học phần đã có {current.links.length} kỹ năng liên kết.</p>
    <Status {...skills} />
    <div className="cm-filters comp-pick-filters">
      <label className="cm-search">Tìm kỹ năng<input maxLength={200} value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Tên kỹ năng…" /></label>
      <label>Nhóm<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Tất cả nhóm</option>{(groups.data?.items ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    </div>
    {skills.data && <fieldset className="cm-fields comp-pick-list" disabled={busy}>
      <legend className="sr-only">Kỹ năng có thể liên kết</legend>
      {available.map((skill) => <label key={skill.id} className="cm-check"><input type="checkbox" checked={chosen.includes(skill.id)} onChange={() => toggle(skill.id)} /><span>{skill.name}<small> · {skill.groupName}</small></span></label>)}
      {!available.length && <p className="comp-hint">Không còn kỹ năng phù hợp để liên kết.</p>}
    </fieldset>}
    <p className="cai-summary" aria-live="polite">Đã chọn {chosen.length.toLocaleString("vi-VN")} kỹ năng</p>
    {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
    <DialogActions busy={busy} close={close}><button type="button" className="am-primary" disabled={busy || !chosen.length} onClick={() => void save()}><Icon name="link" /> {busy ? "Đang lưu…" : `Lưu ${chosen.length.toLocaleString("vi-VN")} liên kết`}</button></DialogActions>
  </div>;
}

/** "Thêm trọng số (Thủ công)": split the course's 100% over its linked skills. */
function ManualWeights({ detail, canManage, close, saved, busy, setBusy }: StepProps) {
  const [current] = useState(detail);
  const [rows, setRows] = useState<AllocationInput[]>(current.links.map((link) => ({ skillId: link.skillId, percent: String(Number((link.weight * 100).toFixed(8))) })));
  const [error, setError] = useState("");
  const allocation = assessAllocations(rows);
  const unavailable = current.links.some((link) => !link.isActive);
  async function save(status: "draft" | "active") {
    if (busy || !canManage || allocation.errors.length || (status === "active" && (!allocation.canActivate || unavailable))) return;
    setBusy(true); setError("");
    try { await putCourse(current, { status, links: allocation.links, note: current.note }); saved(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="cm-form">
    <p className="comp-hint">Nhập phần trăm cho từng kỹ năng đã liên kết. Áp dụng cần tổng đúng 100%; bản nháp được lưu dù tổng chưa đủ.</p>
    <fieldset className="cm-fields" disabled={busy}><div className="comp-allocation-list">
      {current.links.map((link, index) => <div className="comp-allocation-row comp-weight-row" key={link.skillId}>
        <label>Kỹ năng<strong>{link.skillName}<small> · {link.groupName}</small></strong></label>
        <label className="comp-percent">Trọng số (%)<input type="number" min="0" max="100" step="any" value={rows[index]?.percent ?? "0"} onChange={(event) => setRows(rows.map((row, at) => at === index ? { ...row, percent: event.target.value } : row))} /></label>
        {!link.isActive && <small className="comp-row-warning">Kỹ năng hoặc nhóm đang ngừng sử dụng; không thể áp dụng.</small>}
      </div>)}
    </div></fieldset>
    <div className={`comp-weight-total${allocation.canActivate ? " comp-weight-valid" : ""}`} role="status"><span>Tổng trọng số</span><strong>{percentage(allocation.total)} / 100%</strong></div>
    {allocation.errors.length > 0 && <div className="admin-error" role="alert"><ul>{allocation.errors.map((message) => <li key={message}>{message}</li>)}</ul></div>}
    {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
    <DialogActions busy={busy} close={close}>
      <button type="button" className="am-outline" disabled={busy || allocation.errors.length > 0} onClick={() => void save("draft")}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu bản nháp"}</button>
      <button type="button" className="am-primary" disabled={busy || !allocation.canActivate || unavailable} onClick={() => void save("active")}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu và áp dụng"}</button>
    </DialogActions>
  </div>;
}

/** "Xóa liên kết": untick skills from the course; an applied course goes back to draft when its total is no longer 100%. */
function RemoveLinks({ detail, canManage, close, saved, busy, setBusy }: StepProps) {
  const [current] = useState(detail);
  const [removed, setRemoved] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const kept = current.links.filter((link) => !removed.includes(link.skillId)).map((link) => ({ skillId: link.skillId, weight: link.weight }));
  const nextStatus = keepStatus(current, kept);
  const toDraft = current.status === "active" && nextStatus === "draft";
  async function save() {
    if (busy || !canManage || !removed.length || !confirmed) return;
    setBusy(true); setError("");
    try { await putCourse(current, { status: nextStatus, links: kept, note: current.note }); saved(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="cm-form">
    <p className="comp-hint">Chọn kỹ năng cần xóa liên kết khỏi học phần. Lịch sử cấu hình vẫn giữ trọng số cũ để đối chiếu.</p>
    <fieldset className="cm-fields comp-pick-list" disabled={busy}>
      <legend className="sr-only">Kỹ năng đang liên kết</legend>
      {current.links.map((link) => <label key={link.skillId} className="cm-check"><input type="checkbox" checked={removed.includes(link.skillId)}
        onChange={() => setRemoved((previous) => previous.includes(link.skillId) ? previous.filter((id) => id !== link.skillId) : [...previous, link.skillId])} /><span>{link.skillName}<small> · {percentage(link.weight)}</small></span></label>)}
    </fieldset>
    {toDraft && <p className="cm-warning" role="alert">Sau khi xóa liên kết, tổng trọng số không còn 100% nên học phần chuyển về Bản nháp và tạm không được tính vào đánh giá năng lực. Hãy thêm trọng số lại để áp dụng.</p>}
    <label className="cm-check"><input type="checkbox" checked={confirmed} disabled={busy || !removed.length} onChange={(event) => setConfirmed(event.target.checked)} /><span>Tôi xác nhận xóa liên kết {removed.length} kỹ năng khỏi {current.courseCode}.</span></label>
    {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
    <DialogActions busy={busy} close={close}><button type="button" className="am-primary am-delete" disabled={busy || !removed.length || !confirmed} onClick={() => void save()}><Icon name="trash" /> {busy ? "Đang xóa…" : "Xác nhận xóa liên kết"}</button></DialogActions>
  </div>;
}

/** "Xóa trọng số": every weight back to 0% and the course back to draft; the links stay. */
function ClearWeights({ detail, canManage, close, saved, busy, setBusy }: StepProps) {
  const [current] = useState(detail);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (busy || !canManage || !confirmed) return;
    setBusy(true); setError("");
    try { await putCourse(current, { status: "draft", links: current.links.map((link) => ({ skillId: link.skillId, weight: 0 })), note: current.note }); saved(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="cm-form">
    <p>Đặt trọng số của {current.links.length} kỹ năng về 0% và chuyển học phần về Bản nháp. Học phần sẽ không được tính vào đánh giá năng lực cho đến khi thêm trọng số lại. Liên kết kỹ năng được giữ nguyên.</p>
    <label className="cm-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>Tôi xác nhận xóa trọng số của {current.courseCode}.</span></label>
    {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
    <DialogActions busy={busy} close={close}><button type="button" className="am-primary am-delete" disabled={busy || !confirmed} onClick={() => void save()}><Icon name="trash" /> {busy ? "Đang xóa…" : "Xác nhận xóa trọng số"}</button></DialogActions>
  </div>;
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
      await putCourse(current, { status, links: allocation.links, note });
      saved();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="cm-form">
    <p><span className={`comp-state comp-state-${current.status}`}>{statusLabels[current.status]}</span>{current.status === "archived" && <span className="comp-hint"> Cấu hình đã lưu trữ, không đóng góp vào năng lực. Chọn chỉnh sửa để tạo trạng thái mới.</span>}</p>
    {duplicateCode && <p className="cm-warning" role="alert">Mã học phần xuất hiện {current.occurrenceCount} lần trong phiên bản chương trình. Cần rà soát khung trước khi lưu trọng số.</p>}
    {editing && <><p className="comp-hint">Nhập phần trăm cho toàn bộ danh sách. Áp dụng cần ít nhất một kỹ năng, tổng 100% và mọi kỹ năng đang hoạt động. Trọng số 0% được giữ nhưng không đóng góp.</p><Status {...skills} /></>}
    <fieldset className="cm-fields" disabled={busy || !editing}>
      <div className="comp-allocation-list">
        {rows.map((row, index) => {
          const selected = options.find(skill => skill.id === row.skillId);
          const linked = current.links.find(link => link.skillId === row.skillId);
          return <div className="comp-allocation-row" key={index}>
            <label>Kỹ năng {index + 1}{editing ? <select value={row.skillId} onChange={event => setRows(rows.map((item, at) => at === index ? { ...item, skillId: event.target.value } : item))}><option value="">Chọn kỹ năng</option>{!selected && row.skillId && <option value={row.skillId}>{linked?.skillName ?? "Kỹ năng không còn khả dụng"}</option>}{options.map(skill => <option key={skill.id} value={skill.id} disabled={!skill.isActive || !skill.groupActive || rows.some((item, at) => at !== index && item.skillId === skill.id)}>{skill.name} · {skill.groupName}{!skill.isActive || !skill.groupActive ? " · Ngừng sử dụng" : ""}</option>)}</select> : <strong>{skillName(row.skillId)}</strong>}</label>
            <label className="comp-percent">Trọng số (%)<input type="number" min="0" max="100" step="any" value={row.percent} onChange={event => setRows(rows.map((item, at) => at === index ? { ...item, percent: event.target.value } : item))} /></label>
            {editing && <button type="button" className="am-outline comp-remove-link" aria-label={`Xóa liên kết ${skillName(row.skillId)} khỏi cấu hình học phần`} onClick={() => setRemoveIndex(index)}><Icon name="trash" /> Xóa liên kết</button>}
            {(selected && (!selected.isActive || !selected.groupActive)) || (!selected && linked && !linked.isActive) ? <small className="comp-row-warning">Kỹ năng hoặc nhóm đang ngừng sử dụng; không thể áp dụng.</small> : null}
          </div>;
        })}
        {!rows.length && <p className="comp-hint">Chưa liên kết kỹ năng với học phần này.</p>}
      </div>
      {editing && <button type="button" className="am-outline" disabled={busy || skills.loading || !!skills.error || rows.length >= 200} onClick={() => setRows([...rows, { skillId: "", percent: "0" }])}><Icon name="plus" /> Thêm liên kết kỹ năng</button>}
      <label>Ghi chú cấu hình<textarea rows={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>
    </fieldset>
    {removeIndex !== null && <div className="comp-inline-confirm"><p>Xóa liên kết <strong>{skillName(rows[removeIndex]?.skillId ?? "")}</strong>? Thay đổi được ghi khi lưu toàn bộ cấu hình.</p><div className="cm-actions"><button className="am-outline" disabled={busy} onClick={() => setRemoveIndex(null)}>Giữ liên kết</button><button className="am-primary am-delete" disabled={busy} onClick={() => { setRows(rows.filter((_, index) => index !== removeIndex)); setRemoveIndex(null); }}>Xác nhận xóa</button></div></div>}
    <div className={`comp-weight-total${allocation.canActivate ? " comp-weight-valid" : ""}`} role="status"><span>Tổng trọng số</span><strong>{percentage(allocation.total)} / 100%</strong></div>
    {editing && allocation.errors.length > 0 && <div className="admin-error" role="alert"><ul>{allocation.errors.map(message => <li key={message}>{message}</li>)}</ul></div>}
    {editing && missingSkills && <p className="cm-warning" role="alert">Có kỹ năng không còn cấu hình năng lực. Hãy thay thế hoặc xóa các liên kết đó trước khi lưu bản nháp hoặc áp dụng.</p>}
    {editing && !missingSkills && unavailable && catalogReady && <p className="cm-warning">Có kỹ năng hoặc nhóm ngừng sử dụng. Hãy thay thế hoặc xóa liên kết trước khi áp dụng.</p>}
    {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
    <div className="cm-actions cm-dialog-actions"><button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Đóng</button><div className="cm-dialog-actions-main">{canManage && (editing ? <><button className="am-outline" disabled={busy || !validDraft || removeIndex !== null} onClick={() => void save("draft")}><Icon name="save" />{busy ? "Đang lưu…" : "Lưu bản nháp"}</button><button className="am-primary" disabled={busy || !canActivate || removeIndex !== null} onClick={() => void save("active")}><Icon name="save" />{busy ? "Đang lưu…" : "Lưu và áp dụng"}</button></> : <button className="am-primary" disabled={duplicateCode} onClick={() => setEditing(true)}><Icon name="edit" />{current.status === "missing" ? "Tạo cấu hình học phần" : "Chỉnh sửa cấu hình học phần"}</button>)}</div></div>
    <CourseHistory entries={current.history} />
  </div>;
}

function CourseHistory({ entries }: { entries: EventEntry[] }) {
  const [page, setPage] = useState(1);
  return <section className="comp-history"><h3>Lịch sử cấu hình</h3>{!entries.length && <p className="comp-hint">Chưa có lần lưu cấu hình.</p>}{entries.slice((page - 1) * 10, page * 10).map(entry => {
    const snapshot = entry.snapshot && typeof entry.snapshot === "object" ? entry.snapshot as Partial<CourseDetail> : null;
    return <details key={entry.id}><summary>{competencyDate(entry.createdAt)} · {entry.actorName || "Hệ thống"}{snapshot?.status && ` · ${statusLabels[snapshot.status]}`}</summary>{entry.note && <p>{entry.note}</p>}{snapshot?.note && snapshot.note !== entry.note && <p className="cm-prewrap">Ghi chú: {snapshot.note}</p>}{Array.isArray(snapshot?.links) && <div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Trọng số tại thời điểm lưu"><table className="cm-table"><thead><tr><th className="cm-stt">STT</th><th>Kỹ năng tại thời điểm lưu</th><th>Nhóm</th><th>Trọng số</th></tr></thead><tbody>{snapshot.links.map((link, index) => <tr key={link.skillId}><td className="cm-stt">{index + 1}</td><td>{link.skillName}</td><td>{link.groupName}</td><td>{percentage(link.weight)}</td></tr>)}</tbody></table></div>}</details>;
  })}{entries.length > 0 && <Pagination total={entries.length} page={page} setPage={setPage} />}</section>;
}
