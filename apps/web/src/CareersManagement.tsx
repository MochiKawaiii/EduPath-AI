import { useEffect, useState } from "react";
import { ActionMenu, Modal, Pagination, Status, useData } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { useLiveFilters } from "./use-live-filters";
import { careerRequest, type Career, type CareerField } from "./career-types";
import CareerRequirementsManagement from "./CareerRequirementsManagement";
import CareerLinksManagement from "./CareerLinksManagement";
import "./curricula.css";
import "./careers.css";
const endpoint = "/api/admin/careers";
export default function CareersManagement({
  canManage,
}: {
  canManage: boolean;
}) {
  const [revision, setRevision] = useState(0),
    [linksOpen, setLinksOpen] = useState(false),
    [detailId, setDetailId] = useState<string | null>(null),
    [selected, setSelected] = useState<Career | null>(null),
    [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const { draft, setDraft, filters, page, setPage, reset } = useLiveFilters({
    q: "",
    category: "",
    skillLink: "",
  });
  const list = useData<{ items: Career[] }>(
    `${endpoint}?${new URLSearchParams(filters)}`,
    revision,
  );
  const fields = useData<{ items: CareerField[] }>(`${endpoint}/fields`, revision);
  const fieldNames = new Map(fields.data?.items.map(field => [field.code, field.name]));
  useEffect(() => {
    if (fields.data && draft.category && !fields.data.items.some(field => field.code === draft.category)) {
      setDraft({ ...draft, category: "" });
    }
  }, [fields.data, draft, setDraft]);
  const close = () => {
    setMode(null);
    setSelected(null);
  };
  const saved = () => {
    close();
    setRevision((n) => n + 1);
  };
  return (
    <section className="cm-workspace career-workspace">
      {linksOpen ? <CareerLinksManagement canManage={canManage} revision={revision} saved={() => setRevision(current => current + 1)} close={() => setLinksOpen(false)} /> : detailId ? <Detail key={detailId} id={detailId} fields={fields.data?.items ?? []} revision={revision} close={() => setDetailId(null)} /> : <>
      <div className="cm-toolbar">
        <p>Danh mục nghề nghiệp song ngữ để sinh viên lựa chọn định hướng.</p>
        <div className="cm-actions">
        {canManage && <button className="am-primary" onClick={() => setLinksOpen(true)}><Icon name="plus" /> Kỹ năng liên kết</button>}
        {canManage && (
          <button
            className="am-primary"
            onClick={() => {
              setSelected(null);
              setMode("edit");
            }}
          >
            <Icon name="plus" /> Thêm vị trí nghề nghiệp
          </button>
        )}
        </div>
      </div>
      <section className="cm-panel">
        <div className="cm-filters">
          <label className="cm-search">
            Tìm vị trí
            <input
              value={draft.q}
              maxLength={200}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              placeholder="Tên tiếng Việt, English, mã hoặc kỹ năng…"
            />
          </label>
          <label>
            Nhóm lĩnh vực
            <select
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            >
              <option value="">Tất cả lĩnh vực</option>
              {fields.data?.items.map(field => (
                <option key={field.code} value={field.code}>
                  {field.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kỹ năng liên kết
            <select
              value={draft.skillLink}
              onChange={(e) => setDraft({ ...draft, skillLink: e.target.value })}
            >
              <option value="">Tất cả</option>
              <option value="linked">Đã liên kết</option>
              <option value="unlinked">Chưa liên kết</option>
            </select>
          </label>
          <button className="am-outline" onClick={reset}>
            <Icon name="refresh" /> Xóa bộ lọc
          </button>
        </div>
        <Status {...list} />
        <Status {...fields} />
        {list.data && (
          <>
            <div className="cm-table-scroll">
              <table className="cm-table">
                <thead>
                  <tr>
                    <th>Mã vị trí</th>
                    <th>Vị trí nghề nghiệp</th>
                    <th>Lĩnh vực</th>
                    <th>Kỹ năng liên kết</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items
                    .slice((page - 1) * 10, page * 10)
                    .map((c) => (
                      <tr key={c.id}>
                        <td className="career-code">{c.code}</td>
                        <td>
                          <strong>{c.nameVi}</strong>
                          <small>{c.nameEn}</small>
                        </td>
                        <td>{fieldNames.get(c.category) ?? c.categoryName ?? c.category}</td>
                        <td>
                          {c.skills.slice(0, 3).join(" · ") || "Chưa bổ sung"}
                        </td>
                        <td>
                          <ActionMenu
                            label={`Thao tác với ${c.nameVi}`}
                            items={[
                              { key: "detail", icon: "eye", label: "Chi tiết", onSelect: () => setDetailId(c.id) },
                              ...(canManage ? [
                                { key: "edit", icon: "edit", label: "Chỉnh sửa", onSelect: () => { setSelected(c); setMode("edit"); } },
                                { key: "delete", icon: "trash", label: "Xóa", danger: true, onSelect: () => { setSelected(c); setMode("delete"); } },
                              ] : []),
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!list.data.items.length && (
              <p className="am-empty">Không có vị trí phù hợp với bộ lọc.</p>
            )}
            <Pagination
              total={list.data.items.length}
              page={page}
              setPage={setPage}
            />
          </>
        )}
      </section>
      </>}
      {mode === "edit" && (
        <Editor current={selected} fields={fields.data?.items ?? []} close={close} saved={saved} />
      )}
      {mode === "delete" && selected && (
        <Delete current={selected} close={close} saved={saved} />
      )}
    </section>
  );
}
function Detail({ id, fields, close, revision }: { id: string; fields: CareerField[]; close: () => void; revision: number }) {
  const remote = useData<Career>(`${endpoint}/${id}`, revision);
  const [lastCareer, setLastCareer] = useState<Career | null>(null);
  useEffect(() => { if (remote.data) setLastCareer(remote.data); }, [remote.data]);
  const career = remote.data ?? lastCareer;
  return (
    <>
      <div><button className="am-outline" onClick={close}><Icon name="back" /> Danh sách vị trí</button></div>
      <section className="cm-panel career-detail career-detail-panel">
        <Status {...remote} />
        {remote.data && (
          <>
            <div className="cm-toolbar"><div><h2>{remote.data.nameVi}</h2><p>{remote.data.nameEn}</p></div></div>
            <dl>
              <div>
                <dt>Mã vị trí</dt>
                <dd>{remote.data.code}</dd>
              </div>
              <div>
                <dt>Lĩnh vực</dt>
                <dd>{fields.find(field => field.code === remote.data?.category)?.name ?? remote.data.categoryName ?? remote.data.category}</dd>
              </div>
              <div>
                <dt>Sinh viên đang chọn</dt>
                <dd>{remote.data.studentCount ?? 0}</dd>
              </div>
            </dl>
            <h3>Mô tả công việc</h3>
            <p className="career-description">
              {remote.data.description || "Chưa bổ sung mô tả."}
            </p>
          </>
        )}
      </section>
      {career && !remote.error && <CareerRequirementsManagement canManage={false} career={career} revision={revision} saved={() => {}} />}
    </>
  );
}
function Editor({
  current,
  fields,
  close,
  saved,
}: {
  current: Career | null;
  fields: CareerField[];
  close: () => void;
  saved: (career: Career) => void;
}) {
  const [form, setForm] = useState({
      nameVi: current?.nameVi ?? "",
      nameEn: current?.nameEn ?? "",
      category: current?.category ?? fields[0]?.code ?? "",
      description: current?.description ?? "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={current ? "Sửa vị trí nghề nghiệp" : "Thêm vị trí nghề nghiệp"}
      onClose={close}
      busy={busy}
    >
      <form
        className="cm-dialog-body cm-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const career = await careerRequest<Career>(
              current ? `${endpoint}/${current.id}` : endpoint,
              {
                method: current ? "PATCH" : "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(current ? { "x-version": current.version } : {}),
                },
                body: JSON.stringify(form),
              },
            );
            saved(career);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="career-fields">
          <p className="career-code-note">
            {current ? <>Mã vị trí: <strong>{current.code}</strong> · Mã được giữ nguyên khi cập nhật.</> : "Mã vị trí được cấp tự động khi lưu (NN001, NN002…)."}
          </p>
          <div className="cm-form-grid">
            <label>
              <RequiredLabel>Tên tiếng Việt</RequiredLabel>
              <input
                required
                maxLength={160}
                value={form.nameVi}
                onChange={(e) => setForm({ ...form, nameVi: e.target.value })}
              />
            </label>
            <label>
              <RequiredLabel>Tên tiếng Anh</RequiredLabel>
              <input
                required
                maxLength={160}
                value={form.nameEn}
                onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
              />
            </label>
          </div>
          <label>
            Lĩnh vực *
            <select
              required
              disabled={!fields.length}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="">Chọn lĩnh vực</option>
              {fields.map(field => (
                <option key={field.code} value={field.code}>
                  {field.name}
                </option>
              ))}
            </select>
            {!fields.length && <small>Thêm lĩnh vực nghề nghiệp trước khi thêm vị trí.</small>}
          </label>
          <label>
            Mô tả công việc
            <textarea
              rows={4}
              maxLength={4000}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          {current ? <div><strong>Kỹ năng liên kết</strong><p>{current.skills.join(" · ") || "Chưa liên kết kỹ năng."}</p><small>Quản lý yêu cầu và kỹ năng bằng nút Kỹ năng liên kết trên danh sách vị trí.</small></div> : <p>Sau khi lưu, dùng nút Kỹ năng liên kết trên danh sách vị trí để thêm yêu cầu và liên kết kỹ năng.</p>}
        </fieldset>
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        <div className="cm-actions cm-dialog-actions">
          <button
            type="button"
            className="am-outline"
            disabled={busy}
            onClick={close}
          >
            <Icon name="close" /> Hủy
          </button>
          <button type="submit" className="am-primary" disabled={busy || !fields.length}>
            <Icon name="save" /> {busy ? "Đang lưu…" : "Lưu vị trí"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Delete({
  current,
  close,
  saved,
}: {
  current: Career;
  close: () => void;
  saved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Xóa vị trí nghề nghiệp" onClose={close} busy={busy} size="sm">
      <div className="cm-dialog-body cm-form">
        <strong>
          {current.nameVi} — {current.nameEn}
        </strong>
        <p>
          Vị trí sẽ được xóa khỏi danh mục lựa chọn. Hồ sơ sinh viên đã chọn vẫn
          giữ thông tin này và có thể đổi sang vị trí khác.
        </p>
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        <div className="cm-actions cm-dialog-actions">
          <button className="am-outline" disabled={busy} onClick={close}>
            <Icon name="close" /> Hủy
          </button>
          <button
            className="am-primary am-delete"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await careerRequest(`${endpoint}/${current.id}`, {
                  method: "DELETE",
                  headers: {
                    "Content-Type": "application/json",
                    "x-version": current.version,
                  },
                  body: JSON.stringify({ confirmed: true }),
                });
                saved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="trash" /> {busy ? "Đang xóa…" : "Xác nhận xóa"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
