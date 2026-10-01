import { useState } from "react";
import { Modal, Pagination, Status } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { careerRequest, type CareerField } from "./career-types";
import { searchTerm } from "./student-curriculum-types";

const endpoint = "/api/admin/careers/fields";

export default function CareerFieldsManagement({ canManage, remote, saved, onClose }: {
  canManage: boolean;
  remote: { data: { items: CareerField[] } | null; loading: boolean; error: string | null; retry: () => void };
  saved: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CareerField | null>(null);
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const close = () => { setMode(null); setSelected(null); };
  const onSaved = () => { close(); saved(); };
  const items = remote.data?.items.filter(field => searchTerm(`${field.code} ${field.name} ${field.description}`).includes(searchTerm(query))) ?? [];
  if (canManage && mode === "edit") return <FieldEditor current={selected} close={close} saved={onSaved} />;
  if (canManage && mode === "delete" && selected) return <FieldDelete current={selected} close={close} saved={onSaved} />;
  return <Modal title="Lĩnh vực nghề nghiệp" onClose={onClose}><div className="cm-dialog-body career-field-dialog">
    <div className="cm-toolbar">
      <p>Quản lý lĩnh vực để phân nhóm các vị trí nghề nghiệp.</p>
      {canManage && <button className="am-primary" onClick={() => { setSelected(null); setMode("edit"); }}><Icon name="plus" /> Thêm lĩnh vực</button>}
    </div>
    <section className="cm-panel">
      <div className="cm-filters">
        <label className="cm-search">Tìm lĩnh vực<input value={query} maxLength={200} placeholder="Mã hoặc tên lĩnh vực…" onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
        <button className="am-outline" onClick={() => { setQuery(""); setPage(1); }}><Icon name="refresh" /> Xóa bộ lọc</button>
      </div>
      <Status {...remote} />
      {remote.data && <>
        <div className="cm-table-scroll"><table className="cm-table">
          <thead><tr><th>Lĩnh vực nghề nghiệp</th><th>Mô tả</th>{canManage && <th>Thao tác</th>}</tr></thead>
          <tbody>{items.slice((page - 1) * 10, page * 10).map(field => <tr key={field.id}>
            <td><strong>{field.name}</strong><small>{field.code}</small></td>
            <td className="career-description">{field.description || "Chưa bổ sung"}</td>
            {canManage && <td><div className="career-row-actions">
              <button className="am-outline" onClick={() => { setSelected(field); setMode("edit"); }}><Icon name="edit" /> Chỉnh sửa</button>
              <button className="am-icon-btn am-delete-icon" aria-label={`Xóa lĩnh vực ${field.name}`} title="Xóa lĩnh vực" onClick={() => { setSelected(field); setMode("delete"); }}><Icon name="trash" /></button>
            </div></td>}
          </tr>)}</tbody>
        </table></div>
        {!items.length && <p className="am-empty">Không có lĩnh vực phù hợp.</p>}
        <Pagination total={items.length} page={page} setPage={setPage} />
      </>}
    </section>
  </div></Modal>;
}

function FieldEditor({ current, close, saved }: { current: CareerField | null; close: () => void; saved: () => void }) {
  const [form, setForm] = useState({ code: current?.code ?? "", name: current?.name ?? "", description: current?.description ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title={current ? "Chỉnh sửa lĩnh vực nghề nghiệp" : "Thêm lĩnh vực nghề nghiệp"} onClose={close} busy={busy}>
    <form className="cm-dialog-body cm-form" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        await careerRequest(current ? `${endpoint}/${current.id}` : endpoint, {
          method: current ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...(current ? { "x-version": current.version } : {}) },
          body: JSON.stringify(current ? { name: form.name, description: form.description } : form),
        });
        saved();
      } catch (failure) { setError((failure as Error).message); }
      finally { setBusy(false); }
    }}>
      <fieldset className="career-fields" disabled={busy}>
        <label><RequiredLabel>Mã lĩnh vực</RequiredLabel><input required readOnly={Boolean(current)} maxLength={60} pattern="[a-z0-9]+((-|_)[a-z0-9]+)*" value={form.code} onChange={event => setForm({ ...form, code: event.target.value })} placeholder="Ví dụ: software" /><small>{current ? "Mã được giữ cố định để liên kết các vị trí nghề nghiệp." : "Chữ thường, số, dấu gạch ngang hoặc gạch dưới."}</small></label>
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
