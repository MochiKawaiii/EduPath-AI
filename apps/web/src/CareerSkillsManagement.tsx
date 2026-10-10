import { useState } from "react";
import { ActionMenu, Modal, Pagination, Status, useData } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { careerRequest, type ManagedCareerSkill } from "./career-types";
import { useLiveFilters } from "./use-live-filters";
import "./curricula.css";
import "./careers.css";

const endpoint = "/api/admin/careers/skills";

export default function CareerSkillsManagement({ canManage }: { canManage: boolean }) {
  const [revision, setRevision] = useState(0);
  const { draft, setDraft, filters, page, setPage, reset } = useLiveFilters({ q: "" });
  const remote = useData<{ items: ManagedCareerSkill[] }>(`${endpoint}?${new URLSearchParams(filters)}`, revision);
  const [selected, setSelected] = useState<ManagedCareerSkill | null>(null);
  const [mode, setMode] = useState<"detail" | "edit" | "delete" | null>(null);
  const close = () => { setMode(null); setSelected(null); };
  const saved = () => { close(); setRevision(value => value + 1); };
  return <section className="cm-workspace career-workspace">
    <div className="cm-toolbar">
      <p>Quản lý kỹ năng dùng chung với các vị trí nghề nghiệp và danh mục Đánh giá năng lực.</p>
      {canManage && <button className="am-primary" onClick={() => { setSelected(null); setMode("edit"); }}><Icon name="plus" /> Thêm kỹ năng</button>}
    </div>
    <section className="cm-panel">
      <div className="cm-filters">
        <label className="cm-search">Tìm kỹ năng<input value={draft.q} maxLength={200} placeholder="Tên hoặc mô tả kỹ năng…" onChange={event => setDraft({ q: event.target.value })} /></label>
        <button className="am-outline" onClick={reset}><Icon name="refresh" /> Xóa bộ lọc</button>
      </div>
      <Status {...remote} />
      {remote.data && <>
        <div className="cm-table-scroll"><table className="cm-table">
          <thead><tr><th>Kỹ năng</th><th>Mô tả</th><th>Thao tác</th></tr></thead>
          <tbody>{remote.data.items.slice((page - 1) * 10, page * 10).map(skill => <tr key={skill.id}>
            <td><strong>{skill.name}</strong></td>
            <td className="career-description">{skill.description || "Chưa bổ sung"}</td>
            <td><ActionMenu label={`Thao tác với kỹ năng ${skill.name}`} items={[
              { key: "detail", icon: "eye", label: "Chi tiết", onSelect: () => { setSelected(skill); setMode("detail"); } },
              ...(canManage ? [
                { key: "edit", icon: "edit", label: "Chỉnh sửa", onSelect: () => { setSelected(skill); setMode("edit"); } },
                { key: "delete", icon: "trash", label: "Xóa", danger: true, onSelect: () => { setSelected(skill); setMode("delete"); } },
              ] : []),
            ]} /></td>
          </tr>)}</tbody>
        </table></div>
        {!remote.data.items.length && <p className="am-empty">Không có kỹ năng phù hợp.</p>}
        <Pagination total={remote.data.items.length} page={page} setPage={setPage} />
      </>}
    </section>
    {mode === "detail" && selected && <Modal title="Chi tiết kỹ năng" onClose={close}>
      <div className="cm-dialog-body cm-form career-detail">
        <dl><div><dt>Tên kỹ năng</dt><dd>{selected.name}</dd></div><div><dt>Mô tả</dt><dd className="career-description">{selected.description || "Chưa bổ sung mô tả."}</dd></div></dl>
        <div className="cm-actions cm-dialog-actions">
          <button className="am-outline" onClick={close}><Icon name="close" /> Đóng</button>
          {canManage && <button className="am-primary" onClick={() => setMode("edit")}><Icon name="edit" /> Chỉnh sửa</button>}
        </div>
      </div>
    </Modal>}
    {canManage && mode === "edit" && <SkillEditor current={selected} close={close} saved={saved} />}
    {canManage && mode === "delete" && selected && <SkillDelete current={selected} close={close} saved={saved} />}
  </section>;
}

function SkillEditor({ current, close, saved }: { current: ManagedCareerSkill | null; close: () => void; saved: () => void }) {
  const [form, setForm] = useState({ name: current?.name ?? "", description: current?.description ?? "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <Modal title={current ? "Chỉnh sửa kỹ năng" : "Thêm kỹ năng"} onClose={close} busy={busy}>
    <form className="cm-dialog-body cm-form" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        await careerRequest(current ? `${endpoint}/${current.id}` : endpoint, {
          method: current ? "PATCH" : "POST", headers: { "Content-Type": "application/json", ...(current ? { "x-version": current.version } : {}) },
          body: JSON.stringify(form),
        }); saved();
      } catch (failure) { setError((failure as Error).message); }
      finally { setBusy(false); }
    }}>
      <fieldset className="career-fields" disabled={busy}>
        <label><RequiredLabel>Tên kỹ năng</RequiredLabel><input required maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Ví dụ: SQL, Docker, Phân tích dữ liệu" /></label>
        <label>Mô tả<textarea rows={4} maxLength={2000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
        {current && <p>Đổi tên kỹ năng sẽ cập nhật tên trong Nghề nghiệp và Đánh giá năng lực; các liên kết giữ nguyên ID.</p>}
      </fieldset>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button className="am-primary" disabled={busy}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu kỹ năng"}</button>
      </div>
    </form>
  </Modal>;
}

function SkillDelete({ current, close, saved }: { current: ManagedCareerSkill; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const assessmentInUse = (current.assessmentCount ?? 0) > 0;
  const inUse = current.careerCount > 0 || assessmentInUse;
  return <Modal title="Xóa kỹ năng" onClose={close} busy={busy} size="sm">
    <div className="cm-dialog-body cm-form">
      <strong>{current.name}</strong>
      {current.careerCount > 0 && <p>Kỹ năng đang liên kết với {current.careerCount} vị trí nghề nghiệp. Vào Quản lý nghề nghiệp → Kỹ năng liên kết, chọn vị trí và gỡ liên kết trước khi xóa.</p>}
      {assessmentInUse && <p>Kỹ năng đang được dùng trong danh mục Đánh giá năng lực. Hãy lưu trữ các cấu hình học phần đang áp dụng và xóa hồ sơ khỏi danh mục đánh giá trước khi xóa kỹ năng dùng chung. Lịch sử vẫn được giữ nguyên.</p>}
      {!inUse && <p>Kỹ năng sẽ được xóa khỏi danh sách lựa chọn.</p>}
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button className="am-primary am-delete" disabled={busy || inUse} onClick={async () => {
          setBusy(true); setError("");
          try {
            await careerRequest(`${endpoint}/${current.id}`, { method: "DELETE", headers: { "Content-Type": "application/json", "x-version": current.version }, body: JSON.stringify({ confirmed: true }) }); saved();
          } catch (failure) { setError((failure as Error).message); }
          finally { setBusy(false); }
        }}><Icon name="trash" /> {busy ? "Đang xóa…" : "Xác nhận xóa"}</button>
      </div>
    </div>
  </Modal>;
}
