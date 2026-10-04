import { useState } from "react";
import { ActionMenu, Modal, Pagination, Status, useData } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { careerRequest, type CareerField } from "./career-types";
import { searchTerm } from "./student-curriculum-types";
import "./curricula.css";
import "./careers.css";

const endpoint = "/api/admin/careers/fields";

export default function CareerFieldsManagement({ canManage }: { canManage: boolean }) {
  const [revision, setRevision] = useState(0);
  const remote = useData<{ items: CareerField[] }>(endpoint, revision);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CareerField | null>(null);
  const [mode, setMode] = useState<"detail" | "edit" | "delete" | null>(null);
  const close = () => { setMode(null); setSelected(null); };
  const onSaved = () => { close(); setRevision(value => value + 1); };
  const items = remote.data?.items.filter(field => searchTerm(`${field.code} ${field.name} ${field.description}`).includes(searchTerm(query))) ?? [];
  return <section className="cm-workspace career-workspace">
    <div className="cm-toolbar">
      <p>Quản lý lĩnh vực để phân nhóm các vị trí nghề nghiệp.</p>
      {canManage && <button className="am-primary" onClick={() => { setSelected(null); setMode("edit"); }}><Icon name="plus" /> Thêm lĩnh vực</button>}
    </div>
    <section className="cm-panel">
      <div className="cm-filters">
        <label className="cm-search">Tìm lĩnh vực<input value={query} maxLength={200} placeholder="Số thứ tự hoặc tên lĩnh vực…" onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
        <button className="am-outline" onClick={() => { setQuery(""); setPage(1); }}><Icon name="refresh" /> Xóa bộ lọc</button>
      </div>
      <Status {...remote} />
      {remote.data && <>
        <div className="cm-table-scroll"><table className="cm-table">
          <thead><tr><th>STT</th><th>Lĩnh vực nghề nghiệp</th><th>Mô tả</th><th>Thao tác</th></tr></thead>
          <tbody>{items.slice((page - 1) * 10, page * 10).map(field => <tr key={field.id}>
            <td>{field.code}</td><td><strong>{field.name}</strong></td>
            <td className="career-description">{field.description || "Chưa bổ sung"}</td>
            <td><ActionMenu label={`Thao tác với lĩnh vực ${field.name}`} items={[
              { key: "detail", icon: "eye", label: "Chi tiết", onSelect: () => { setSelected(field); setMode("detail"); } },
              ...(canManage ? [
                { key: "edit", icon: "edit", label: "Chỉnh sửa", onSelect: () => { setSelected(field); setMode("edit"); } },
                { key: "delete", icon: "trash", label: "Xóa", danger: true, onSelect: () => { setSelected(field); setMode("delete"); } },
              ] : []),
            ]} /></td>
          </tr>)}</tbody>
        </table></div>
        {!items.length && <p className="am-empty">Không có lĩnh vực phù hợp.</p>}
        <Pagination total={items.length} page={page} setPage={setPage} />
      </>}
    </section>
    {mode === "detail" && selected && <Modal title="Chi tiết lĩnh vực nghề nghiệp" onClose={close}>
      <div className="cm-dialog-body cm-form career-detail">
        <dl>
          <div><dt>Số thứ tự</dt><dd>{selected.code}</dd></div>
          <div><dt>Tên lĩnh vực</dt><dd>{selected.name}</dd></div>
          <div><dt>Mô tả</dt><dd className="career-description">{selected.description || "Chưa bổ sung mô tả."}</dd></div>
        </dl>
        <div className="cm-actions cm-dialog-actions">
          <button className="am-outline" onClick={close}><Icon name="close" /> Đóng</button>
          {canManage && <button className="am-primary" onClick={() => setMode("edit")}><Icon name="edit" /> Chỉnh sửa</button>}
        </div>
      </div>
    </Modal>}
    {canManage && mode === "edit" && <FieldEditor current={selected} close={close} saved={onSaved} />}
    {canManage && mode === "delete" && selected && <FieldDelete current={selected} close={close} saved={onSaved} />}
  </section>;
}

function FieldEditor({ current, close, saved }: { current: CareerField | null; close: () => void; saved: () => void }) {
  const [form, setForm] = useState({ name: current?.name ?? "", description: current?.description ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title={current ? "Chỉnh sửa lĩnh vực nghề nghiệp" : "Thêm lĩnh vực nghề nghiệp"} onClose={close} busy={busy}>
    <form className="cm-dialog-body cm-form" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        await careerRequest(current ? `${endpoint}/${current.id}` : endpoint, {
          method: current ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...(current ? { "x-version": current.version } : {}) },
          body: JSON.stringify(form),
        });
        saved();
      } catch (failure) { setError((failure as Error).message); }
      finally { setBusy(false); }
    }}>
      <fieldset className="career-fields" disabled={busy}>
        <p>{current ? `Số thứ tự: ${current.code}` : "Số thứ tự được cấp tự động khi lưu."}</p>
        <label><RequiredLabel>Tên lĩnh vực</RequiredLabel><input required maxLength={160} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>Mô tả<textarea rows={4} maxLength={2000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
      </fieldset>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button className="am-primary" disabled={busy}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu lĩnh vực"}</button>
      </div>
    </form>
  </Modal>;
}

function FieldDelete({ current, close, saved }: { current: CareerField; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inUse = (current.positionCount ?? 0) > 0;
  return <Modal title="Xóa lĩnh vực nghề nghiệp" onClose={close} busy={busy} size="sm">
    <div className="cm-dialog-body cm-form">
      <strong>{current.name}</strong>
      <p>{inUse ? `Lĩnh vực đang có ${current.positionCount} vị trí nghề nghiệp. Hãy chuyển các vị trí sang lĩnh vực khác hoặc xóa các vị trí đó trước.` : "Lĩnh vực sẽ được xóa khỏi danh mục lựa chọn."}</p>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button className="am-primary am-delete" disabled={busy || inUse} onClick={async () => {
          setBusy(true); setError("");
          try {
            await careerRequest(`${endpoint}/${current.id}`, { method: "DELETE", headers: { "Content-Type": "application/json", "x-version": current.version }, body: JSON.stringify({ confirmed: true }) });
            saved();
          } catch (failure) { setError((failure as Error).message); }
          finally { setBusy(false); }
        }}><Icon name="trash" /> {busy ? "Đang xóa…" : "Xác nhận xóa"}</button>
      </div>
    </div>
  </Modal>;
}
