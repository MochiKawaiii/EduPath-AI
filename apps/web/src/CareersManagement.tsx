import { useState } from "react";
import { Modal, Pagination, Status, useData } from "./admin-ui";
import { Icon } from "./admin-account-shared";
import { useLiveFilters } from "./use-live-filters";
import { careerCategories, careerRequest, type Career } from "./career-types";
import "./curricula.css";
import "./careers.css";
const endpoint = "/api/admin/careers";
export default function CareersManagement({
  canManage,
}: {
  canManage: boolean;
}) {
  const [revision, setRevision] = useState(0),
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
              {Object.entries(careerCategories).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="am-outline" onClick={reset}>
            Xóa bộ lọc
          </button>
        </div>
        <Status {...list} />
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
                        <td>{careerCategories[c.category]}</td>
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
        <Detail id={selected.id} close={close} />
      )}
      {mode === "edit" && (
        <Editor current={selected} close={close} saved={saved} />
      )}
      {mode === "delete" && selected && (
        <Delete current={selected} close={close} saved={saved} />
      )}
    </section>
  );
}
function Detail({ id, close }: { id: string; close: () => void }) {
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
                <dd>{careerCategories[remote.data.category]}</dd>
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
  close,
  saved,
}: {
  current: Career | null;
  close: () => void;
  saved: () => void;
}) {
  const [form, setForm] = useState({
      code: current?.code ?? "",
      nameVi: current?.nameVi ?? "",
      nameEn: current?.nameEn ?? "",
      category: current?.category ?? "software",
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
            Mã vị trí *
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
              Tên tiếng Việt *
              <input
                required
                maxLength={160}
                value={form.nameVi}
                onChange={(e) => setForm({ ...form, nameVi: e.target.value })}
              />
            </label>
            <label>
              Tên tiếng Anh *
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
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {Object.entries(careerCategories).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
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
        <div className="cm-actions">
          <button
            type="button"
            className="am-outline"
            disabled={busy}
            onClick={close}
          >
            Hủy
          </button>
          <button className="am-primary am-save" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu vị trí"}
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
            Hủy
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
            {busy ? "Đang xóa…" : "Xác nhận xóa"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
