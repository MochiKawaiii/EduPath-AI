import { useState } from "react";
import { ActionMenu, Modal, Pagination, Status, useData } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { useLiveFilters } from "./use-live-filters";
import { careerRequest, requirementLevels, type Career, type CareerRequirement, type CareerSkill } from "./career-types";

const endpoint = "/api/admin/careers/requirements";
const emptyFilters = { q: "", skillId: "", level: "", kind: "", priority: "" };
export default function CareerRequirementsManagement({ canManage, career, revision, saved }: {
  canManage: boolean; career: Career; revision: number; saved: () => void;
}) {
  const { draft, setDraft, filters, page, setPage } = useLiveFilters(emptyFilters);
  const remote = useData<{ items: CareerRequirement[] }>(`${endpoint}?${new URLSearchParams({ ...filters, careerPositionId: career.id })}`, revision);
  const skills = useData<{ items: CareerSkill[] }>(`${endpoint}/skills`, revision);
  const [selected, setSelected] = useState<CareerRequirement | null>(null);
  const [mode, setMode] = useState<"detail" | "edit" | "delete" | null>(null);
  const [kind, setKind] = useState<"skill" | "other">("other");
  const close = () => { setSelected(null); setMode(null); };
  const onSaved = () => { close(); saved(); };
  const start = (next: "skill" | "other") => { setSelected(null); setKind(next); setMode("edit"); };
  return <>
    <div className="cm-toolbar">
      <div><h3>Yêu cầu và kỹ năng</h3><p>Các yêu cầu áp dụng cho {career.nameVi}.</p></div>
      {canManage && <div className="cm-actions">
        <button className="am-primary" onClick={() => start("skill")}><Icon name="plus" /> Thêm kỹ năng liên kết</button>
      </div>}
    </div>
    <section className="cm-panel">
      <div className="cm-filters career-requirement-filters">
        <label className="cm-search">Tìm yêu cầu<input value={draft.q} maxLength={200} placeholder="Nội dung hoặc kỹ năng…" onChange={event => setDraft({ ...draft, q: event.target.value })} /></label>
        <label>Kỹ năng<select value={draft.skillId} onChange={event => setDraft({ ...draft, skillId: event.target.value })}>
          <option value="">Tất cả kỹ năng</option>{skills.data?.items.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
        </select></label>
        <label>Mức yêu cầu<select value={draft.level} onChange={event => setDraft({ ...draft, level: event.target.value })}>
          <option value="">Tất cả mức</option>{Object.entries(requirementLevels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Tính chất<select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value })}>
          <option value="">Tất cả</option><option value="required">Bắt buộc</option><option value="preferred">Ưu tiên</option>
        </select></label>
        <label>Loại yêu cầu<select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })}>
          <option value="">Tất cả loại</option><option value="skill">Liên kết kỹ năng</option><option value="other">Yêu cầu khác</option>
        </select></label>
        <button className="am-outline" onClick={() => setDraft(emptyFilters)}><Icon name="refresh" /> Xóa bộ lọc</button>
      </div>
      <Status {...remote} /><Status {...skills} />
      {remote.data && <>
        <div className="cm-table-scroll"><table className="cm-table career-requirement-table">
          <thead><tr><th>Yêu cầu</th><th>Kỹ năng</th><th>Mức yêu cầu</th><th>Tính chất</th><th>Thao tác</th></tr></thead>
          <tbody>{remote.data.items.slice((page - 1) * 10, page * 10).map(item => <tr key={item.id}>
            <td><strong>{item.title}</strong><small className="career-requirement-summary">{item.description || "Chưa bổ sung mô tả"}</small></td>
            <td>{item.skillName || "—"}</td><td>{requirementLevels[item.level]}</td><td>{item.isRequired ? "Bắt buộc" : "Ưu tiên"}</td>
            <td><ActionMenu label={`Thao tác với yêu cầu ${item.title}`} items={[
              { key: "detail", icon: "eye", label: "Chi tiết", onSelect: () => { setSelected(item); setMode("detail"); } },
              ...(canManage ? [
                { key: "edit", icon: "edit", label: "Chỉnh sửa", onSelect: () => { setSelected(item); setKind(item.skillId ? "skill" : "other"); setMode("edit"); } },
                { key: "delete", icon: "trash", label: "Xóa", danger: true, onSelect: () => { setSelected(item); setMode("delete"); } },
              ] : []),
            ]} /></td>
          </tr>)}</tbody>
        </table></div>
        {!remote.data.items.length && <p className="am-empty">Không có yêu cầu phù hợp với bộ lọc.</p>}
        <Pagination total={remote.data.items.length} page={page} setPage={setPage} />
      </>}
    </section>
    {mode === "detail" && selected && <RequirementDetail id={selected.id} close={close} />}
    {canManage && mode === "edit" && <RequirementEditor current={selected} kind={kind} career={career} skills={skills.data?.items ?? []} close={close} saved={onSaved} />}
    {canManage && mode === "delete" && selected && <RequirementDelete current={selected} close={close} saved={onSaved} />}
  </>;
}

function RequirementDetail({ id, close }: { id: string; close: () => void }) {
  const remote = useData<CareerRequirement>(`${endpoint}/${id}`);
  return <Modal title="Chi tiết yêu cầu nghề nghiệp" onClose={close}>
    <div className="cm-dialog-body career-detail"><Status {...remote} />{remote.data && <>
      <h3>{remote.data.title}</h3><p className="career-description">{remote.data.description || "Chưa bổ sung mô tả."}</p>
      <dl><div><dt>Vị trí nghề nghiệp</dt><dd>{remote.data.careerName} · {remote.data.categoryName}</dd></div>
        <div><dt>Kỹ năng liên kết</dt><dd>{remote.data.skillName || "Không liên kết kỹ năng"}</dd></div>
        <div><dt>Mức yêu cầu</dt><dd>{requirementLevels[remote.data.level]}</dd></div>
        <div><dt>Tính chất</dt><dd>{remote.data.isRequired ? "Bắt buộc" : "Ưu tiên"}</dd></div></dl>
    </>}<div className="cm-actions cm-dialog-actions"><button type="button" className="am-outline" onClick={close}><Icon name="close" /> Đóng</button></div></div>
  </Modal>;
}

function RequirementEditor({ current, kind, career, skills, close, saved }: {
  current: CareerRequirement | null; kind: "skill" | "other"; career: Career; skills: CareerSkill[];
  close: () => void; saved: () => void;
}) {
  const [form, setForm] = useState({
    title: current?.title ?? "", description: current?.description ?? "",
    skillId: current?.skillId ?? "", skillName: "",
    level: current?.level ?? "unspecified", isRequired: current?.isRequired ?? false,
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const isSkill = kind === "skill";
  const chooseSkill = (id: string, name: string) => setForm(previous => ({ ...previous, skillId: id,
    skillName: id === "new" ? name : "",
    title: !previous.title || previous.title === (skills.find(skill => skill.id === previous.skillId)?.name ?? previous.skillName) ? name : previous.title,
  }));
  return <Modal title={current ? (isSkill ? "Chỉnh sửa liên kết kỹ năng" : "Chỉnh sửa yêu cầu nghề nghiệp") : (isSkill ? "Liên kết kỹ năng với nghề nghiệp" : "Thêm yêu cầu nghề nghiệp")} onClose={close} busy={busy}>
    <form className="cm-dialog-body cm-form" onSubmit={async event => {
      event.preventDefault();
      if (isSkill && (!form.skillId || (form.skillId === "new" && !form.skillName.trim()))) {
        setError("Chọn kỹ năng hoặc nhập tên kỹ năng mới."); return;
      }
      setBusy(true); setError("");
      try {
        await careerRequest(current ? `${endpoint}/${current.id}` : endpoint, {
          method: current ? "PATCH" : "POST", headers: { "Content-Type": "application/json", ...(current ? { "x-version": current.version } : {}) },
          body: JSON.stringify({ ...form, careerPositionId: career.id, skillId: isSkill && form.skillId !== "new" ? form.skillId : null, skillName: isSkill && form.skillId === "new" ? form.skillName : "" }),
        }); saved();
      } catch (failure) { setError((failure as Error).message); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy} className="career-fields">
        <div><strong>Vị trí nghề nghiệp</strong><p>{career.nameVi}</p></div>
        {isSkill && <>
          <label><RequiredLabel>Kỹ năng liên kết</RequiredLabel><select required value={form.skillId} onChange={event => chooseSkill(event.target.value, skills.find(skill => skill.id === event.target.value)?.name ?? "")}>
            <option value="">Chọn kỹ năng</option>{skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}<option value="new">Thêm kỹ năng mới…</option>
          </select></label>
          {form.skillId === "new" && <label><RequiredLabel>Tên kỹ năng mới</RequiredLabel><input required maxLength={100} value={form.skillName} onChange={event => chooseSkill("new", event.target.value)} /></label>}
        </>}
        <label><RequiredLabel>Nội dung yêu cầu</RequiredLabel><input required maxLength={160} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
        <label>Mô tả<textarea rows={4} maxLength={4000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
        <div className="cm-form-grid">
          <label>Mức yêu cầu<select value={form.level} onChange={event => setForm({ ...form, level: event.target.value as CareerRequirement["level"] })}>
            {Object.entries(requirementLevels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Tính chất<select value={form.isRequired ? "required" : "preferred"} onChange={event => setForm({ ...form, isRequired: event.target.value === "required" })}>
            <option value="preferred">Ưu tiên</option><option value="required">Bắt buộc</option>
          </select></label>
        </div>
      </fieldset>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button type="button" className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button className="am-primary" disabled={busy}><Icon name="save" /> {busy ? "Đang lưu…" : "Lưu thay đổi"}</button>
      </div>
    </form>
  </Modal>;
}

function RequirementDelete({ current, close, saved }: { current: CareerRequirement; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <Modal title={current.skillId ? "Xóa liên kết kỹ năng" : "Xóa yêu cầu nghề nghiệp"} onClose={close} busy={busy} size="sm">
    <div className="cm-dialog-body cm-form"><strong>{current.title}</strong>
      <p>{current.skillId ? `Xóa liên kết kỹ năng với ${current.careerName}. Kỹ năng vẫn được giữ để sử dụng cho các nghề khác.` : `Xóa yêu cầu này khỏi ${current.careerName}.`}</p>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="cm-actions cm-dialog-actions">
        <button className="am-outline" disabled={busy} onClick={close}><Icon name="close" /> Hủy</button>
        <button className="am-primary am-delete" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try { await careerRequest(`${endpoint}/${current.id}`, { method: "DELETE", headers: { "Content-Type": "application/json", "x-version": current.version }, body: JSON.stringify({ confirmed: true }) }); saved(); }
          catch (failure) { setError((failure as Error).message); }
          finally { setBusy(false); }
        }}><Icon name="trash" /> {busy ? "Đang xóa…" : "Xóa"}</button>
      </div>
    </div>
  </Modal>;
}
