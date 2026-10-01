import { useEffect, useState } from "react";
import { Modal, Pagination, Status, useData } from "./admin-ui";
import { Icon, RequiredLabel } from "./admin-account-shared";
import { useLiveFilters } from "./use-live-filters";
import { careerRequest, type Career, type CareerField } from "./career-types";
import CareerFieldsManagement from "./CareerFieldsManagement";
import "./curricula.css";
import "./careers.css";
const endpoint = "/api/admin/careers";
export default function CareersManagement({
  canManage,
}: {
  canManage: boolean;
}) {
  const [revision, setRevision] = useState(0),
    [tab, setTab] = useState<"positions" | "fields">("positions"),
    [selected, setSelected] = useState<Career | null>(null),
    [mode, setMode] = useState<"detail" | "edit" | "delete" | null>(null);
  const { draft, setDraft, filters, page, setPage, reset } = useLiveFilters({
    q: "",
    category: "",
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
  const switchTab = (next: "positions" | "fields") => {
    if (next !== tab) {
      setTab(next);
      setRevision(current => current + 1);
    }
  };
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
      <div className="career-tabs" role="group" aria-label="Danh mục nghề nghiệp">
        <button className={tab === "positions" ? "am-primary" : "am-outline"} aria-pressed={tab === "positions"} onClick={() => switchTab("positions")}>Vị trí nghề nghiệp</button>
        <button className={tab === "fields" ? "am-primary" : "am-outline"} aria-pressed={tab === "fields"} onClick={() => switchTab("fields")}>Lĩnh vực nghề nghiệp</button>
      </div>
      {tab === "fields" ? <CareerFieldsManagement canManage={canManage} remote={fields} saved={() => setRevision(current => current + 1)} /> : <>
      <div className="cm-toolbar">
        <p>Danh mục nghề nghiệp song ngữ để sinh viên lựa chọn định hướng.</p>
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
                    <th>Vị trí nghề nghiệp</th>
                    <th>Lĩnh vực</th>
                    <th>Kỹ năng tham khảo</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items
                    .slice((page - 1) * 10, page * 10)
                    .map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.nameVi}</strong>
                          <small>{c.nameEn}</small>
                        </td>
                        <td>{fieldNames.get(c.category) ?? c.categoryName ?? c.category}</td>
                        <td>
                          {c.skills.slice(0, 3).join(" · ") || "Chưa bổ sung"}
                        </td>
                        <td>
                          <div className="career-row-actions">
                            <button
                              className="am-outline"
                              onClick={() => {
                                setSelected(c);
                                setMode("detail");
                              }}
                            >
                              <Icon name="eye" />
                              Chi tiết
                            </button>
                            {canManage && (
                              <>
                                <button
                                  className="am-icon-btn"
                                  aria-label={`Sửa ${c.nameVi}`}
                                  title="Sửa vị trí"
                                  onClick={() => {
                                    setSelected(c);
                                    setMode("edit");
                                  }}
                                >
                                  <Icon name="edit" />
                                </button>
                                <button
                                  className="am-icon-btn am-delete-icon"
                                  aria-label={`Xóa ${c.nameVi}`}
                                  title="Xóa vị trí"
                                  onClick={() => {
                                    setSelected(c);
                                    setMode("delete");
                                  }}
                                >
                                  <Icon name="trash" />
                                </button>
                              </>
                            )}
                          </div>
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
      {mode === "detail" && selected && (
        <Detail id={selected.id} fields={fields.data?.items ?? []} close={close} />
      )}
      {mode === "edit" && (
        <Editor current={selected} fields={fields.data?.items ?? []} close={close} saved={saved} />
      )}
      {mode === "delete" && selected && (
        <Delete current={selected} close={close} saved={saved} />
      )}
      </>}
    </section>
  );
}
function Detail({ id, fields, close }: { id: string; fields: CareerField[]; close: () => void }) {
  const remote = useData<Career>(`${endpoint}/${id}`);
  return (
    <Modal title="Chi tiết vị trí nghề nghiệp" onClose={close}>
      <div className="cm-dialog-body career-detail">
        <Status {...remote} />
        {remote.data && (
          <>
            <h3>{remote.data.nameVi}</h3>
            <p>{remote.data.nameEn}</p>
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
            <h3>Kỹ năng tham khảo</h3>
            {remote.data.skills.length ? (
              <ul>
                {remote.data.skills.map((skill, i) => (
                  <li key={i}>{skill}</li>
                ))}
              </ul>
            ) : (
              <p>Chưa bổ sung kỹ năng.</p>
            )}
          </>
        )}
      </div>
    </Modal>
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
  saved: () => void;
}) {
  const [form, setForm] = useState({
      code: current?.code ?? "",
      nameVi: current?.nameVi ?? "",
      nameEn: current?.nameEn ?? "",
      category: current?.category ?? fields[0]?.code ?? "",
      description: current?.description ?? "",
      skills: current?.skills.join("\n") ?? "",
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
            await careerRequest(
              current ? `${endpoint}/${current.id}` : endpoint,
              {
                method: current ? "PATCH" : "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(current ? { "x-version": current.version } : {}),
                },
                body: JSON.stringify({
                  ...form,
                  skills: [
                    ...new Set(
                      form.skills
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    ),
                  ],
                }),
              },
            );
            saved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="career-fields">
          <label>
            <RequiredLabel>Mã vị trí</RequiredLabel>
            <input
              required
              maxLength={60}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="Ví dụ: frontend-developer"
            />
            <small>Chữ thường, số và dấu gạch ngang.</small>
          </label>
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
          <label>
            Kỹ năng tham khảo
            <textarea
              rows={4}
              value={form.skills}
              maxLength={3030}
              onChange={(e) => setForm({ ...form, skills: e.target.value })}
            />
            <small>
              Mỗi dòng một kỹ năng, tối đa 30 kỹ năng; mỗi kỹ năng tối đa 100 ký
              tự.
            </small>
          </label>
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
        <div className="cm-actions">
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
