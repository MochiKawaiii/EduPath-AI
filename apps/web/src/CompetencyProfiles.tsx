import { useRef, useState } from "react";
import { ActionMenu, Modal, Pagination, Status } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { searchTerm } from "./student-curriculum-types";
import { useLiveFilters } from "./use-live-filters";
import {
  COMPETENCY_API, competencyDate, competencyRequest, percentage, statusLabels,
  useCompetencyData, type CatalogSkill, type EventEntry, type Group, type Skill, type SkillDetail,
} from "./competency-types";

type TabProps = { canManage: boolean; revision: number; onSaved: () => void };
type EditorProps<T> = { current: T | null; close: () => void; saved: () => void };
type GroupDetail = Group & { skills?: Skill[]; history?: EventEntry[] };

function ProfileState({ active }: { active: boolean }) {
  return <span className={`comp-state${active ? "" : " comp-state-inactive"}`}>{active ? "Đang sử dụng" : "Ngừng sử dụng"}</span>;
}

export function CompetencyGroupsTab({ canManage, revision, onSaved }: TabProps) {
  const remote = useCompetencyData<{ items: Group[] }>(`${COMPETENCY_API}/groups`, revision);
  const { draft, setDraft, filters, page, setPage, reset } = useLiveFilters({ q: "", active: "" });
  const [selected, setSelected] = useState<Group | null>(null);
  const [mode, setMode] = useState<"detail" | "edit" | null>(null);
  const close = () => { setSelected(null); setMode(null); };
  const saved = () => { close(); onSaved(); };
  const items = remote.data?.items.filter(group =>
    searchTerm(`${group.name} ${group.description}`).includes(searchTerm(filters.q)) &&
    (!filters.active || String(group.isActive) === filters.active)) ?? [];

  return <section className="cm-workspace comp-workspace">
    <div className="cm-toolbar">
      <p>Phân nhóm các kỹ năng trong hồ sơ đánh giá năng lực.</p>
      {canManage && <button className="am-primary" onClick={() => { setSelected(null); setMode("edit"); }}><Icon name="plus" /> Thêm nhóm năng lực</button>}
    </div>
    <section className="cm-panel">
      <div className="cm-filters">
        <label className="cm-search">Tìm nhóm năng lực<input value={draft.q} maxLength={200} placeholder="Tên hoặc mô tả nhóm…" onChange={event => setDraft({ ...draft, q: event.target.value })} /></label>
        <label>Trạng thái<select value={draft.active} onChange={event => setDraft({ ...draft, active: event.target.value })}><option value="">Tất cả</option><option value="true">Đang sử dụng</option><option value="false">Ngừng sử dụng</option></select></label>
        <button className="am-outline" onClick={reset}><Icon name="refresh" /> Xóa bộ lọc</button>
      </div>
      <Status {...remote} />
      {remote.data && <>
        <div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Bảng nhóm năng lực"><table className="cm-table comp-group-table">
          <thead><tr><th>Nhóm năng lực</th><th>Mô tả</th><th>Số kỹ năng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>{items.slice((page - 1) * 10, page * 10).map(group => <tr key={group.id}>
            <td><button className="am-name-link" onClick={() => { setSelected(group); setMode("detail"); }}>{group.name}</button></td>
            <td className="comp-description">{group.description || "Chưa bổ sung"}</td>
            <td>{group.skillCount}</td><td><ProfileState active={group.isActive} /></td>
            <td><ActionMenu label={`Thao tác với nhóm ${group.name}`} items={[
              { key: "detail", icon: "eye", label: "Chi tiết", onSelect: () => { setSelected(group); setMode("detail"); } },
              ...(canManage ? [{ key: "edit", icon: "edit", label: "Chỉnh sửa", onSelect: () => { setSelected(group); setMode("edit"); } }] : []),
            ]} /></td>
          </tr>)}</tbody>
        </table></div>
        {!items.length && <p className="am-empty">Không có nhóm năng lực phù hợp.</p>}
        <Pagination total={items.length} page={page} setPage={setPage} />
      </>}
    </section>
    {mode === "detail" && selected && <GroupDetails current={selected} revision={revision} canManage={canManage} close={close} edit={group => { setSelected(group); setMode("edit"); }} />}
    {canManage && mode === "edit" && <GroupEditor current={selected} close={close} saved={saved} />}
  </section>;
}

function GroupDetails({ current, revision, canManage, close, edit }: { current: Group; revision: number; canManage: boolean; close: () => void; edit: (group: Group) => void }) {
  const remote = useCompetencyData<GroupDetail>(`${COMPETENCY_API}/groups/${current.id}`, revision);
  const [page, setPage] = useState(1);
  const detail = remote.data;
  return <Modal title={`Chi tiết nhóm năng lực — ${current.name}`} onClose={close}>
    <div className="cm-dialog-body cm-form">
      <Status {...remote} />
      {detail && <>
        <dl className="comp-detail-grid">
          <div><dt>Tên nhóm</dt><dd>{detail.name}</dd></div>
          <div><dt>Mô tả</dt><dd className="comp-description">{detail.description || "Chưa bổ sung mô tả."}</dd></div>
          <div><dt>Số kỹ năng</dt><dd>{detail.skillCount}</dd></div>
          <div><dt>Trạng thái</dt><dd><ProfileState active={detail.isActive} /></dd></div>
        </dl>
        {detail.skills && <section className="comp-section">
          <h3>Kỹ năng thuộc nhóm</h3>
          {detail.skills.length ? <>
            <div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Các kỹ năng thuộc nhóm năng lực"><table className="cm-table">
              <thead><tr><th>Kỹ năng</th><th>Phạm vi đánh giá</th><th>Trạng thái</th></tr></thead>
              <tbody>{detail.skills.slice((page - 1) * 10, page * 10).map(skill => <tr key={skill.id}><td><strong>{skill.name}</strong></td><td className="comp-description">{skill.scope || "Chưa bổ sung."}</td><td><ProfileState active={skill.isActive} /></td></tr>)}</tbody>
            </table></div>
            <Pagination total={detail.skills.length} page={page} setPage={setPage} />
          </> : <p className="am-empty">Chưa có kỹ năng thuộc nhóm này.</p>}
        </section>}
        <ProfileHistory entries={detail.history ?? []} entity="group" />
      </>}
      <div className="cm-actions cm-dialog-actions">
        <button className="am-outline" onClick={close}><Icon name="close" /> Đóng</button>
        {canManage && detail && <button className="am-primary" onClick={() => edit(detail)}><Icon name="edit" /> Chỉnh sửa</button>}
      </div>
    </div>
  </Modal>;
}

function GroupEditor({ current, close, saved }: EditorProps<Group>) {
  const [form, setForm] = useState({ name: current?.name ?? "", description: current?.description ?? "", isActive: current?.isActive ?? true });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submitting = useRef(false);
  return <Modal title={current ? "Chỉnh sửa nhóm năng lực" : "Thêm nhóm năng lực"} onClose={close} busy={busy}>
    <form className="cm-dialog-body cm-form" onSubmit={async event => {
      event.preventDefault(); if (submitting.current) return;
      submitting.current = true; setBusy(true); setError("");
      try {
        await competencyRequest(current ? `${COMPETENCY_API}/groups/${current.id}` : `${COMPETENCY_API}/groups`, {
          method: current ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...(current ? { "x-version": current.version } : {}) },
          body: JSON.stringify(form),
        }); saved();
      } catch (failure) { setError((failure as Error).message); }
      finally { submitting.current = false; setBusy(false); }
    }}>
      <fieldset className="comp-fields" disabled={busy}>
        <label><RequiredLabel>Tên nhóm năng lực</RequiredLabel><input required maxLength={160} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>Mô tả<textarea rows={4} maxLength={2000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
        <label className="comp-check"><input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })} /> Đang sử dụng</label>
        {current && <p className="comp-hint">Để ngừng sử dụng nhóm, cần điều chỉnh các cấu hình học phần đang áp dụng có kỹ năng thuộc nhóm này.</p>}
      </fieldset>
      {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        {error && <button type="button" className="am-outline" disabled={busy} onClick={saved}><Icon name="refresh" /> Đóng và tải lại</button>}
        <button className="am-primary" disabled={busy}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu nhóm"}</button>
      </div>
    </form>
  </Modal>;
}

export function CompetencySkillsTab({ canManage, revision, onSaved }: TabProps) {
  const { draft, setDraft, filters, page, setPage, reset } = useLiveFilters({ q: "", groupId: "", active: "" });
  const remote = useCompetencyData<{ items: Skill[] }>(`${COMPETENCY_API}/skills?${new URLSearchParams(filters)}`, revision);
  const groups = useCompetencyData<{ items: Group[] }>(`${COMPETENCY_API}/groups`, revision);
  const [selected, setSelected] = useState<Skill | null>(null);
  const [mode, setMode] = useState<"detail" | "edit" | "delete" | null>(null);
  const close = () => { setMode(null); setSelected(null); };
  const saved = () => { close(); onSaved(); };

  return <section className="cm-workspace comp-workspace">
    <div className="cm-toolbar">
      <p>Quản lý nhóm, phạm vi và trạng thái của từng kỹ năng đánh giá năng lực.</p>
      {canManage && <button className="am-primary" onClick={() => { setSelected(null); setMode("edit"); }}><Icon name="plus" /> Thêm hồ sơ năng lực</button>}
    </div>
    <section className="cm-panel">
      <div className="cm-filters">
        <label className="cm-search">Tìm kỹ năng<input value={draft.q} maxLength={200} placeholder="Tên, mô tả hoặc phạm vi…" onChange={event => setDraft({ ...draft, q: event.target.value })} /></label>
        <label>Nhóm năng lực<select value={draft.groupId} disabled={groups.loading} onChange={event => setDraft({ ...draft, groupId: event.target.value })}>
          <option value="">Tất cả nhóm</option>{groups.data?.items.map(group => <option key={group.id} value={group.id}>{group.name}{group.isActive ? "" : " (ngừng sử dụng)"}</option>)}
        </select></label>
        <label>Trạng thái<select value={draft.active} onChange={event => setDraft({ ...draft, active: event.target.value })}><option value="">Tất cả</option><option value="true">Đang sử dụng</option><option value="false">Ngừng sử dụng</option></select></label>
        <button className="am-outline" onClick={reset}><Icon name="refresh" /> Xóa bộ lọc</button>
      </div>
      {groups.error && <Status {...groups} />}
      <Status {...remote} />
      {remote.data && <>
        <div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Bảng hồ sơ năng lực"><table className="cm-table comp-skill-table">
          <thead><tr><th>Kỹ năng</th><th>Nhóm năng lực</th><th>Phạm vi</th><th>Trạng thái</th><th>Liên kết</th><th>Thao tác</th></tr></thead>
          <tbody>{remote.data.items.slice((page - 1) * 10, page * 10).map(skill => <tr key={skill.id}>
            <td><button className="am-name-link" onClick={() => { setSelected(skill); setMode("detail"); }}>{skill.name}</button></td>
            <td>{skill.groupName}{!skill.groupActive && <small className="comp-hint">Nhóm ngừng sử dụng</small>}</td>
            <td className="comp-description">{skill.scope || "Chưa bổ sung"}</td>
            <td><ProfileState active={skill.isActive} /></td>
            <td>{skill.courseCount} học phần<br />{skill.careerCount} nghề nghiệp</td>
            <td><ActionMenu label={`Thao tác với kỹ năng ${skill.name}`} items={[
              { key: "detail", icon: "eye", label: "Chi tiết và lịch sử", onSelect: () => { setSelected(skill); setMode("detail"); } },
              ...(canManage ? [
                { key: "edit", icon: "edit", label: "Chỉnh sửa", onSelect: () => { setSelected(skill); setMode("edit"); } },
                { key: "delete", icon: "trash", label: "Xóa hồ sơ năng lực", danger: true, onSelect: () => { setSelected(skill); setMode("delete"); } },
              ] : []),
            ]} /></td>
          </tr>)}</tbody>
        </table></div>
        {!remote.data.items.length && <p className="am-empty">Không có kỹ năng phù hợp.</p>}
        <Pagination total={remote.data.items.length} page={page} setPage={setPage} />
      </>}
    </section>
    {mode === "detail" && selected && <SkillDetails current={selected} revision={revision} canManage={canManage} close={close} edit={skill => { setSelected(skill); setMode("edit"); }} />}
    {canManage && mode === "edit" && <SkillEditor current={selected} revision={revision} groups={groups.data?.items ?? []} close={close} saved={saved} />}
    {canManage && mode === "delete" && selected && <SkillDelete current={selected} close={close} saved={saved} />}
  </section>;
}

function SkillEditor({ current, revision, groups, close, saved }: EditorProps<Skill> & { revision: number; groups: Group[] }) {
  const catalog = useCompetencyData<{ items: CatalogSkill[] }>(`${COMPETENCY_API}/catalog`, revision);
  const [source, setSource] = useState<"new" | "existing">("new");
  const [existingSkillId, setExistingSkillId] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [form, setForm] = useState({ name: current?.name ?? "", description: current?.description ?? "", scope: current?.scope ?? "", groupId: current?.groupId ?? "", isActive: current?.isActive ?? true });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submitting = useRef(false);
  const reusing = !current && source === "existing";
  const candidates = catalog.data?.items.filter(skill => skill.id === existingSkillId || searchTerm(`${skill.name} ${skill.description}`).includes(searchTerm(catalogQuery))) ?? [];
  const selectedCatalogSkill = catalog.data?.items.find(skill => skill.id === existingSkillId);
  const canSave = Boolean(form.groupId && (reusing ? selectedCatalogSkill : form.name.trim()));

  return <Modal title={current ? "Chỉnh sửa hồ sơ năng lực" : "Thêm hồ sơ năng lực"} onClose={close} busy={busy}>
    {reusing && <Status {...catalog} />}
    <form className="cm-dialog-body cm-form" onSubmit={async event => {
      event.preventDefault();
      if (submitting.current) return;
      if (!canSave) { setError("Hãy nhập tên, chọn nhóm và chọn kỹ năng chung nếu dùng lại."); return; }
      submitting.current = true; setBusy(true); setError("");
      try {
        const body = reusing && selectedCatalogSkill ? { ...form, name: selectedCatalogSkill.name, description: selectedCatalogSkill.description, existingSkillId } : form;
        await competencyRequest(current ? `${COMPETENCY_API}/skills/${current.id}` : `${COMPETENCY_API}/skills`, {
          method: current ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...(current ? { "x-version": current.version } : {}) },
          body: JSON.stringify(body),
        }); saved();
      } catch (failure) { setError((failure as Error).message); }
      finally { submitting.current = false; setBusy(false); }
    }}>
      <fieldset className="comp-fields" disabled={busy}>
        {!current && <>
          <label>Nguồn kỹ năng<select value={source} onChange={event => {
            setSource(event.target.value as "new" | "existing"); setExistingSkillId(""); setCatalogQuery(""); setForm({ ...form, name: "", description: "" }); setError("");
          }}><option value="new">Tạo kỹ năng chung mới</option><option value="existing">Dùng lại kỹ năng chung đã có</option></select></label>
          {reusing && <>
            <label>Tìm kỹ năng chung<input maxLength={200} value={catalogQuery} placeholder="Nhập tên kỹ năng để thu hẹp danh sách…" onChange={event => setCatalogQuery(event.target.value)} /></label>
            <label><RequiredLabel>Kỹ năng chung</RequiredLabel><select required value={existingSkillId} disabled={catalog.loading || Boolean(catalog.error)} onChange={event => {
              const skill = catalog.data?.items.find(item => item.id === event.target.value);
              setExistingSkillId(event.target.value); setForm({ ...form, name: skill?.name ?? "", description: skill?.description ?? "" });
            }}><option value="">Chọn kỹ năng chung</option>{candidates.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
            {catalog.data && !candidates.length && <p className="comp-hint">Không có kỹ năng chung phù hợp.</p>}
            <p className="comp-hint">Hồ sơ năng lực sẽ dùng kỹ năng đã chọn với tên và mô tả hiện có. Kỹ năng đã có hồ sơ năng lực sẽ được hệ thống thông báo khi lưu.</p>
          </>}
        </>}
        <label><RequiredLabel>Tên kỹ năng</RequiredLabel><input required maxLength={100} readOnly={reusing} value={reusing ? selectedCatalogSkill?.name ?? "" : form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>Mô tả kỹ năng chung<textarea rows={3} maxLength={2000} readOnly={reusing} value={reusing ? selectedCatalogSkill?.description ?? "" : form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
        <label><RequiredLabel>Nhóm năng lực</RequiredLabel><select required value={form.groupId} onChange={event => setForm({ ...form, groupId: event.target.value })}>
          <option value="">Chọn nhóm năng lực</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}{group.isActive ? "" : " (ngừng sử dụng)"}</option>)}
          {current && !groups.some(group => group.id === current.groupId) && <option value={current.groupId}>{current.groupName}</option>}
        </select></label>
        {!groups.length && <p className="comp-hint">Chưa tải được nhóm năng lực. Đóng hộp thoại và tải lại danh sách nhóm trước khi lưu.</p>}
        <label>Phạm vi đánh giá<textarea rows={5} maxLength={4000} value={form.scope} placeholder="Nội dung và phạm vi đánh giá kỹ năng…" onChange={event => setForm({ ...form, scope: event.target.value })} /></label>
        <label className="comp-check"><input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })} /> Đang sử dụng trong đánh giá năng lực</label>
        {current && <p className="comp-hint">Tên và mô tả dùng chung với quản lý nghề nghiệp. Việc chỉnh sửa sẽ cập nhật thông tin liên quan. Để ngừng sử dụng kỹ năng, cần điều chỉnh các cấu hình học phần đang áp dụng kỹ năng này.</p>}
      </fieldset>
      {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        {error && <button type="button" className="am-outline" disabled={busy} onClick={saved}><Icon name="refresh" /> Đóng và tải lại</button>}
        <button className="am-primary" disabled={busy || !canSave}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu hồ sơ năng lực"}</button>
      </div>
    </form>
  </Modal>;
}

function SkillDetails({ current, revision, canManage, close, edit }: { current: Skill; revision: number; canManage: boolean; close: () => void; edit: (skill: Skill) => void }) {
  const remote = useCompetencyData<SkillDetail>(`${COMPETENCY_API}/skills/${current.id}`, revision);
  const [page, setPage] = useState(1);
  const detail = remote.data;
  return <Modal title={`Chi tiết năng lực — ${current.name}`} onClose={close}>
    <div className="cm-dialog-body cm-form">
      <Status {...remote} />
      {detail && <>
        <dl className="comp-detail-grid">
          <div><dt>Tên kỹ năng</dt><dd>{detail.name}</dd></div>
          <div><dt>Nhóm năng lực</dt><dd>{detail.groupName}{!detail.groupActive && <small className="comp-hint">Nhóm ngừng sử dụng</small>}</dd></div>
          <div><dt>Mô tả kỹ năng chung</dt><dd className="comp-description">{detail.description || "Chưa bổ sung."}</dd></div>
          <div><dt>Phạm vi đánh giá</dt><dd className="comp-description">{detail.scope || "Chưa bổ sung."}</dd></div>
          <div><dt>Trạng thái hồ sơ</dt><dd><ProfileState active={detail.isActive} /></dd></div>
          <div><dt>Liên kết nghề nghiệp</dt><dd>{detail.careerCount} nghề nghiệp</dd></div>
          {detail.legacySkillId && <div><dt>Dữ liệu đánh giá cũ</dt><dd>Giữ liên kết với hồ sơ đánh giá cũ.</dd></div>}
        </dl>
        <section className="comp-section">
          <h3>Học phần liên kết và đóng góp</h3>
          <p className="comp-hint">Đóng góp được tính từ cấu hình đang áp dụng có trọng số lớn hơn 0. Mỗi dòng thuộc đúng khóa và phiên bản chương trình ghi trong bảng.</p>
          {detail.contributions.length ? <>
            <div className="cm-table-scroll" tabIndex={0} role="region" aria-label="Học phần đóng góp vào năng lực"><table className="cm-table">
              <thead><tr><th>Khóa / phiên bản CTĐT</th><th>Học phần</th><th>Trọng số</th><th>Trạng thái cấu hình</th></tr></thead>
              <tbody>{detail.contributions.slice((page - 1) * 10, page * 10).map(item => <tr key={`${item.revisionId}:${item.courseCode}`}>
                <td><strong>{item.cohortCode} · Phiên bản {item.curriculumVersion}</strong><br />{item.curriculumName}{item.isCurrent && <small className="comp-hint">Phiên bản hiện hành</small>}</td>
                <td><strong>{item.courseCode}</strong><br />{item.courseName}</td>
                <td>{percentage(item.weight)}{item.weight === 0 && <small className="comp-hint">Không đóng góp</small>}</td>
                <td>{statusLabels[item.status]}</td>
              </tr>)}</tbody>
            </table></div>
            <Pagination total={detail.contributions.length} page={page} setPage={setPage} />
          </> : <p className="am-empty">Chưa có học phần liên kết với hồ sơ năng lực này.</p>}
        </section>
        <ProfileHistory entries={detail.history ?? detail.events ?? []} entity="skill" />
      </>}
      <div className="cm-actions cm-dialog-actions">
        <button className="am-outline" onClick={close}><Icon name="close" /> Đóng</button>
        {canManage && detail && <button className="am-primary" onClick={() => edit(detail)}><Icon name="edit" /> Chỉnh sửa</button>}
      </div>
    </div>
  </Modal>;
}

function ProfileHistory({ entries, entity }: { entries: EventEntry[]; entity: "skill" | "group" }) {
  const [page, setPage] = useState(1);
  return <section className="comp-section">
    <h3>Lịch sử thay đổi</h3>
    {entries.length ? <>
      <ol className="comp-history">{entries.slice((page - 1) * 10, page * 10).map(entry => {
        const snapshot = entry.snapshot && typeof entry.snapshot === "object" ? entry.snapshot as Record<string, unknown> : {};
        return <li key={entry.id}>
          <div className="comp-history-meta"><time dateTime={entry.createdAt}>{competencyDate(entry.createdAt)}</time><span>{entry.actorName || "Hệ thống"}</span></div>
          <p className="cm-prewrap">{entry.note || (entity === "group" ? "Cập nhật nhóm năng lực" : "Cập nhật hồ sơ năng lực")}</p>
          {(typeof snapshot.name === "string" || typeof snapshot.scope === "string" || typeof snapshot.isActive === "boolean") && <details>
            <summary>Thông tin tại thời điểm thay đổi</summary>
            <dl className="comp-detail-grid comp-snapshot">
              {typeof snapshot.name === "string" && <div><dt>{entity === "group" ? "Tên nhóm" : "Tên kỹ năng"}</dt><dd>{snapshot.name}</dd></div>}
              {typeof snapshot.description === "string" && <div><dt>Mô tả</dt><dd className="comp-description">{snapshot.description || "Chưa bổ sung."}</dd></div>}
              {typeof snapshot.groupName === "string" && <div><dt>Nhóm năng lực</dt><dd>{snapshot.groupName}</dd></div>}
              {typeof snapshot.scope === "string" && <div><dt>Phạm vi</dt><dd className="comp-description">{snapshot.scope || "Chưa bổ sung."}</dd></div>}
              {typeof snapshot.skillCount === "number" && <div><dt>Số kỹ năng</dt><dd>{snapshot.skillCount}</dd></div>}
              {typeof snapshot.isActive === "boolean" && <div><dt>Trạng thái</dt><dd><ProfileState active={snapshot.isActive} /></dd></div>}
            </dl>
          </details>}
        </li>;
      })}</ol>
      <Pagination total={entries.length} page={page} setPage={setPage} />
    </> : <p className="am-empty">Chưa có lịch sử thay đổi.</p>}
  </section>;
}

function SkillDelete({ current, close, saved }: { current: Skill; close: () => void; saved: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submitting = useRef(false);
  return <Modal title="Xóa hồ sơ năng lực" onClose={close} busy={busy} size="sm">
    <form className="cm-dialog-body cm-form" onSubmit={async event => {
      event.preventDefault(); if (!confirmed || submitting.current) return;
      submitting.current = true; setBusy(true); setError("");
      try {
        await competencyRequest(`${COMPETENCY_API}/skills/${current.id}`, { method: "DELETE", headers: { "Content-Type": "application/json", "x-version": current.version }, body: JSON.stringify({ confirmed: true }) }); saved();
      } catch (failure) { setError((failure as Error).message); }
      finally { submitting.current = false; setBusy(false); }
    }}>
      <strong>{current.name}</strong>
      <p>Hồ sơ sẽ được gỡ khỏi danh mục đánh giá năng lực. Kỹ năng chung và các liên kết nghề nghiệp vẫn được giữ lại.</p>
      <p className="comp-hint">Cần điều chỉnh hoặc lưu trữ các cấu hình học phần đang áp dụng kỹ năng này trước khi xóa hồ sơ.</p>
      <label className="comp-check"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> Tôi xác nhận xóa hồ sơ năng lực này.</label>
      {error && <p className="admin-error cm-prewrap" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        {error && <button type="button" className="am-outline" disabled={busy} onClick={saved}><Icon name="refresh" /> Đóng và tải lại</button>}
        <button className="am-primary am-delete" disabled={busy || !confirmed}><Icon name="trash" /> {busy ? "Đang xóa…" : "Xác nhận xóa"}</button>
      </div>
    </form>
  </Modal>;
}
