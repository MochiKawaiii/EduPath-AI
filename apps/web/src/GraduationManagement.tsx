import { useEffect, useState } from "react";
import { Modal, Pagination, Status, useData } from "./admin-ui";
import { Icon } from "./admin-account-shared";
import { useLiveFilters } from "./use-live-filters";
import type {
  GraduationData,
  GraduationDetail,
  GraduationList,
  GraduationPreview,
} from "./graduation-types";
import "./curricula.css";
import "./graduation.css";
const endpoint = "/api/admin/graduation";
const errors: Record<string, string> = {
  invalid_workbook:
    "Tệp không đúng biểu mẫu tiêu chuẩn xét tốt nghiệp. Chọn Excel (.xls, .xlsx) hoặc ZIP chứa các biểu mẫu.",
  workbook_too_large:
    "Tệp vượt giới hạn: tối đa 5 MB, 30 file trong ZIP và 50 sheet tiêu chuẩn.",
  invalid_graduation_metadata:
    "Biểu mẫu thiếu tên tiêu chuẩn, khối lớp hoặc ngành đào tạo.",
  invalid_graduation_columns:
    "Không tìm thấy các cột Mã MH, Tên môn học trong biểu mẫu.",
  invalid_graduation_row:
    "Có dòng môn học thiếu mã hoặc tên. Kiểm tra lại biểu mẫu.",
  invalid_numeric_value: "Có ô tín chỉ hoặc điểm trung bình không phải số.",
  course_without_group: "Có môn học chưa thuộc nhóm điều kiện.",
  no_courses: "Biểu mẫu chưa có môn học.",
  import_busy: "Đang xử lý một lượt import khác. Vui lòng thử lại.",
  import_timeout: "Đọc biểu mẫu quá thời gian cho phép.",
  standard_exists:
    "Tiêu chuẩn đã tồn tại. Mở chi tiết và dùng Cập nhật từ Excel để tạo phiên bản mới.",
  duplicate_selection:
    "Các sheet được chọn trùng mã tiêu chuẩn và khối lớp. Chỉ chọn một bản cho mỗi tiêu chuẩn.",
  standard_changed:
    "Tiêu chuẩn đã được cập nhật ở nơi khác. Đóng hộp thoại và tải lại trước khi lưu.",
  preview_required: "Tệp đã thay đổi. Vui lòng xem trước lại.",
  identity_mismatch:
    "Bản cập nhật phải có cùng mã tiêu chuẩn, khối lớp và khóa tuyển sinh.",
  invalid_graduation_input:
    "Thông tin chưa hợp lệ. Kiểm tra các ngưỡng, nhóm và môn học.",
  insufficient_role: "Bạn không có quyền thay đổi tiêu chuẩn.",
  authentication_required: "Phiên đăng nhập đã hết hạn.",
  invalid_filename: "Tên hoặc phần mở rộng tệp không hợp lệ.",
  not_found: "Không tìm thấy tiêu chuẩn.",
};
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  const body = await res.json();
  if (!res.ok)
    throw new Error(
      errors[body.error] ?? "Không thể thực hiện thao tác. Vui lòng thử lại.",
    );
  return body;
}
const fmt = (n: number | null) => (n === null ? "Chưa xác định" : String(n));
const thresholdFields = [
  ["minimumCredits", "Tín chỉ tích lũy tối thiểu"],
  ["mandatoryCredits", "Tín chỉ bắt buộc"],
  ["electiveCredits", "Tín chỉ nhóm tự chọn"],
  ["freeElectiveCredits", "Tín chỉ tự chọn tự do"],
  ["minimumGpa", "Điểm trung bình tích lũy tối thiểu"],
] as const;
export default function GraduationManagement({
  canManage,
}: {
  canManage: boolean;
}) {
  const [id, setId] = useState(() => window.location.hash.slice(1)),
    [revision, setRevision] = useState(0),
    [importing, setImporting] = useState(false);
  const { draft, setDraft, filters, page, setPage, reset } = useLiveFilters({
    q: "",
    cohort: "",
    active: "",
  });
  const setFilter = (key: keyof typeof draft, value: string) =>
    setDraft({ ...draft, [key]: value });
  const list = useData<GraduationList>(
    `${endpoint}?${new URLSearchParams(filters)}`,
    revision,
  );
  const catalogue = useData<GraduationList>(endpoint, revision);
  const cohorts = [...new Set((catalogue.data?.items ?? []).map((item) => item.cohortCode))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  useEffect(() => {
    const change = () => setId(window.location.hash.slice(1));
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const open = (value: string) => {
    window.location.hash = value;
    setId(value);
  };
  if (id)
    return (
      <Standard
        key={id}
        id={id}
        canManage={canManage}
        back={() => {
          open("");
          setRevision((n) => n + 1);
        }}
      />
    );
  return (
    <section className="cm-workspace grad-workspace">
      <div className="cm-toolbar">
        <div>
          <h2>Tiêu chuẩn xét tốt nghiệp</h2>
          <p>
            Quản lý ngưỡng tín chỉ, điểm trung bình và nhóm môn theo từng khóa,
            chuyên ngành.
          </p>
        </div>
        {canManage && (
          <button className="am-primary" onClick={() => setImporting(true)}>
            <Icon name="upload" /> Import tiêu chuẩn
          </button>
        )}
      </div>
      <section className="cm-panel">
        <div className="cm-filters">
          <label className="cm-search">
            Tìm tiêu chuẩn
            <input
              value={draft.q}
              onChange={(e) => setFilter("q", e.target.value)}
              placeholder="Tên, khóa hoặc chuyên ngành…"
            />
          </label>
          <label>
            Khóa học
            <select value={draft.cohort} onChange={(e) => setFilter("cohort", e.target.value)}>
              <option value="">Tất cả khóa</option>
              {cohorts.map((cohort) => <option key={cohort} value={cohort}>{cohort}</option>)}
            </select>
          </label>
          <label>
            Trạng thái
            <select
              value={draft.active}
              onChange={(e) => setFilter("active", e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="true">Đang mở</option>
              <option value="false">Đã khóa</option>
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
                    <th>Tiêu chuẩn</th>
                    <th>Khóa</th>
                    <th>Chuyên ngành</th>
                    <th>TC tối thiểu</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items
                    .slice((page - 1) * 10, page * 10)
                    .map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.name}</strong>
                          <small>
                            {item.classBlock} · Phiên bản {item.version}
                          </small>
                        </td>
                        <td><span className="cm-cohort">{item.cohortCode}</span></td>
                        <td>{item.specialty || "Không phân chuyên ngành"}</td>
                        <td>{fmt(item.minimumCredits)}</td>
                        <td><span className={`cm-tag ${item.isActive ? "cm-open" : ""}`}>{item.isActive ? "Đang mở" : "Đã khóa"}</span></td>
                        <td>
                          <button
                            className="am-outline"
                            onClick={() => open(item.id)}
                          >
                            <Icon name="eye" />
                            Xem chi tiết
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!list.data.items.length && (
              <p className="am-empty">
                Chưa có tiêu chuẩn phù hợp. Import biểu mẫu để bắt đầu.
              </p>
            )}
            <Pagination
              total={list.data.items.length}
              page={page}
              setPage={setPage}
            />
          </>
        )}
      </section>
      {importing && (
        <ImportDialog
          close={() => setImporting(false)}
          saved={() => {
            setImporting(false);
            setRevision((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
function ImportDialog({
  close,
  saved,
  current,
}: {
  close: () => void;
  saved: () => void;
  current?: GraduationDetail;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<GraduationPreview | null>(null),
    [selected, setSelected] = useState<number[]>([]),
    [inspect, setInspect] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const headers = () => ({
    "Content-Type": "application/octet-stream",
    "x-filename": encodeURIComponent(file!.name),
  });
  async function read() {
    if (!file) return;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const p = await request<GraduationPreview>(`${endpoint}/preview`, {
        method: "POST",
        headers: headers(),
        body: file,
      });
      setPreview(p);
      setSelected([]);
      setInspect(p.items[0]?.index ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!file || !preview) return;
    setBusy(true);
    setError("");
    try {
      await request(
        current ? `${endpoint}/${current.id}/replace` : `${endpoint}/import`,
        {
          method: "POST",
          headers: {
            ...headers(),
            "x-preview": preview.fingerprint,
            ...(current
              ? { "x-version": current.token, "x-sheet": String(selected[0]) }
              : { "x-selection": JSON.stringify(selected) }),
          },
          body: file,
        },
      );
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const chosen = preview?.items.find((p) => p.index === inspect);
  return (
    <Modal
      title={
        current
          ? "Cập nhật tiêu chuẩn từ Excel"
          : "Import tiêu chuẩn xét tốt nghiệp"
      }
      onClose={close}
      busy={busy}
    >
      <div className="cm-dialog-body cm-form">
        <p>
          Chọn Excel .xls, .xlsx hoặc ZIP, tối đa 5 MB.
        </p>
        <label>
          Biểu mẫu
          <input
            type="file"
            accept=".xls,.xlsx,.zip"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setSelected([]);
              setError("");
            }}
          />
        </label>
        <button
          className="am-outline"
          disabled={!file || busy}
          onClick={() => void read()}
        >
          {busy ? "Đang xử lý…" : "Đọc và xem trước"}
        </button>
        {preview && (
          <>
            <p>
              Chọn{" "}
              {current
                ? "một sheet có cùng mã tiêu chuẩn và khối lớp"
                : "các tiêu chuẩn cần lưu"}
              . Bản trùng mã/khối lớp cần chọn riêng hoặc cập nhật qua trang chi
              tiết.
            </p>
            <div className="grad-preview-list">
              {preview.items.map((item) => {
                const duplicate =
                  preview.items.filter((p) => p.key === item.key).length > 1;
                const allowed = current
                  ? item.data.standardCode === current.data.standardCode &&
                  item.data.classBlock === current.data.classBlock
                  : !item.existingId;
                return (
                  <div className="grad-preview-item" key={item.index}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(item.index)}
                        disabled={busy || !allowed}
                        onChange={(e) =>
                          setSelected(
                            current
                              ? e.target.checked
                                ? [item.index]
                                : []
                              : e.target.checked
                                ? [...selected, item.index]
                                : selected.filter((i) => i !== item.index),
                          )
                        }
                      />
                      <span>
                        <strong>{item.data.name}</strong>
                        <small>
                          {item.data.sourceWorkbook} · Sheet{" "}
                          {item.data.sourceSheet}
                        </small>
                        {item.existingId && (
                          <small>Tiêu chuẩn đã tồn tại</small>
                        )}
                        {duplicate && (
                          <small>Có bản trùng mã/khối lớp trong tệp này</small>
                        )}
                      </span>
                    </label>
                    <button
                      className="am-outline"
                      disabled={busy}
                      onClick={() => setInspect(item.index)}
                    >
                      Xem trước
                    </button>
                  </div>
                );
              })}
            </div>
            {chosen && (
              <div className="grad-preview-detail">
                <h3>{chosen.data.name}</h3>
                <DataSummary data={chosen.data} />
                <WarningList items={chosen.warnings} />
                <Conditions data={chosen.data} />
              </div>
            )}
          </>
        )}
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
            className="am-primary"
            disabled={busy || !preview || !selected.length}
            onClick={() => void save()}
          >
            Xác nhận lưu {selected.length} tiêu chuẩn
          </button>
        </div>
      </div>
    </Modal>
  );
}
function DataSummary({ data }: { data: GraduationData }) {
  return (
    <>
      <div className="cm-stats grad-stats">
        {thresholdFields.map(([key, label]) => (
          <div key={key}>
            <small>{label}</small>
            <strong>{fmt(data[key])}</strong>
          </div>
        ))}
      </div>
      <p>
        {data.major}
        {data.specialty ? ` · ${data.specialty}` : ""} · {data.classBlock}
      </p>
      <p>
        {data.educationSystem} · {data.faculty}
      </p>
      {data.notes && <p className="cm-prewrap">{data.notes}</p>}
    </>
  );
}
function WarningList({ items }: { items: string[] }) {
  return items.length ? (
    <div className="cm-warning">
      <h3>Cần lưu ý</h3>
      <ul>
        {items.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  ) : null;
}
function Conditions({
  data,
  editGroup,
  editCourse,
}: {
  data: GraduationData;
  editGroup?: (id: string) => void;
  editCourse?: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase();
  return (
    <>
      <label className="grad-search">
        Tìm môn trong tiêu chuẩn
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Mã hoặc tên học phần…"
        />
      </label>
      {data.groups.map((group) => {
        const items = data.courses.filter(
          (c) =>
            c.groupId === group.id &&
            fold(`${c.code} ${c.name}`).includes(fold(q)),
        );
        if (q && !items.length) return null;
        return (
          <section key={group.id} className="grad-group">
            <div className="cm-toolbar">
              <div>
                <h3>{group.name}</h3>
                <p>
                  {group.kind === "mandatory"
                    ? "Nhóm bắt buộc"
                    : "Nhóm tự chọn"}{" "}
                  · Yêu cầu {fmt(group.minimumCredits)} tín chỉ
                </p>
              </div>
              {editGroup && (
                <button
                  className="am-outline"
                  onClick={() => editGroup(group.id)}
                >
                  <Icon name="edit" /> Sửa nhóm
                </button>
              )}
            </div>
            <div className="cm-table-scroll">
              <table className="cm-table">
                <thead>
                  <tr>
                    <th>Mã học phần</th>
                    <th>Tên học phần</th>
                    <th>TC</th>
                    <th>Môn điều kiện (*)</th>
                    {editCourse && <th>Thao tác</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id}>
                      <td>{c.code}</td>
                      <td>{c.name}</td>
                      <td>{fmt(c.credits)}</td>
                      <td>
                        {c.conditionOnly ? "Có · không tính TC/GPA" : "Không"}
                      </td>
                      {editCourse && (
                        <td>
                          <button
                            className="am-outline"
                            onClick={() => editCourse(c.id)}
                          >
                            Sửa môn
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
function Standard({
  id,
  canManage,
  back,
}: {
  id: string;
  canManage: boolean;
  back: () => void;
}) {
  const [revision, setRevision] = useState(0),
    [version, setVersion] = useState(""),
    [dialog, setDialog] = useState<"edit" | "import" | "status" | null>(null),
    [group, setGroup] = useState<string | undefined>(),
    [course, setCourse] = useState<string | undefined>(),
    [tab, setTab] = useState<"conditions" | "history">("conditions");
  const remote = useData<GraduationDetail>(
    `${endpoint}/${id}${version ? "?revision=" + version : ""}`,
    revision,
  );
  const data = remote.data;
  const saved = () => {
    setDialog(null);
    setVersion("");
    setRevision((n) => n + 1);
  };
  const editable = canManage && data?.revisionId === data?.history[0]?.id;
  return (
    <section className="cm-workspace grad-workspace">
      <div className="cm-toolbar">
        <button className="am-outline" onClick={back}>
          ← Danh sách tiêu chuẩn
        </button>
      </div>
      <Status {...remote} />
      {data && (
        <>
          <section className="cm-intro cm-panel">
            <div className="cm-toolbar">
              <div>
                <p className="cm-eyebrow">
                  {data.data.cohortCode}
                </p>
                <h2>{data.data.name}</h2>
                <p><span className={`cm-tag ${data.isActive ? "cm-open" : ""}`}>{data.isActive ? "Đang mở" : "Đã khóa"}</span>{" "}<span>Phiên bản {data.version}</span></p>
              </div>
            </div>
            {editable && (
              <button
                    className="am-icon-btn cm-metadata-edit" title="Sửa thông tin" aria-label="Sửa thông tin"
                    onClick={() => {
                      setGroup(undefined);
                      setCourse(undefined);
                      setDialog("edit");
                    }}
                  >
                    <Icon name="edit" />
              </button>
            )}
            <DataSummary data={data.data} />
            <div className="cm-actions">
              <a
                className="am-outline am-tone-brand"
                href={`${endpoint}/${id}/source/${data.revisionId}`}
              >
                <Icon name="download" /> Tải tệp nguồn
              </a>
              {editable && (
                <>
                  <button
                    className="am-outline am-tone-green"
                    onClick={() => setDialog("import")}
                  >
                    <Icon name="upload" /> Cập nhật từ Excel
                  </button>
                  <button
                    className={data.isActive ? "am-outline am-tone-amber" : "am-outline am-tone-green"}
                    onClick={() => setDialog("status")}
                  >
                    <Icon name={data.isActive ? "lock" : "unlock"} />
                    {data.isActive ? "Khóa tiêu chuẩn" : "Mở tiêu chuẩn"}
                  </button>
                </>
              )}
            </div>
            <p className="cm-help">
              Nguồn: {data.data.sourceWorkbook} · Sheet {data.data.sourceSheet}.
              Tệp tải xuống là nguồn gốc, chưa bao gồm chỉnh sửa trực tiếp.
            </p>
          </section>
          <section className="cm-panel">
            <div className="cm-tabs">
              <button
                aria-pressed={tab === "conditions"}
                onClick={() => setTab("conditions")}
              >
                Điều kiện xét tốt nghiệp
              </button>
              <button
                aria-pressed={tab === "history"}
                onClick={() => setTab("history")}
              >
                Lịch sử phiên bản
              </button>
            </div>
            <div className="cm-dialog-body">
              {tab === "conditions" ? (
                <>
                  <WarningList items={data.warnings} />
                  <Conditions
                    data={data.data}
                    editGroup={
                      editable
                        ? (g) => {
                          setGroup(g);
                          setCourse(undefined);
                          setDialog("edit");
                        }
                        : undefined
                    }
                    editCourse={
                      editable
                        ? (c) => {
                          setCourse(c);
                          setGroup(undefined);
                          setDialog("edit");
                        }
                        : undefined
                    }
                  />
                </>
              ) : (
                <>
                  <p>Chọn phiên bản để tra cứu. Bản lịch sử chỉ xem.</p>
                  {data.history.map((h) => (
                    <div className="cm-toolbar grad-history" key={h.id}>
                      <div>
                        <strong>Phiên bản {h.version}</strong>
                        <p>
                          {h.note} ·{" "}
                          {new Date(h.createdAt).toLocaleString("vi-VN")}
                        </p>
                      </div>
                      <button
                        className="am-outline"
                        onClick={() =>
                          setVersion(h.id === data.history[0]?.id ? "" : h.id)
                        }
                      >
                        Xem phiên bản
                      </button>
                    </div>
                  ))}
                  <h3>Hoạt động</h3>
                  {data.events.map((e, i) => (
                    <p key={i}>
                      {e.action} ·{" "}
                      {new Date(e.createdAt).toLocaleString("vi-VN")}
                    </p>
                  ))}
                </>
              )}
            </div>
          </section>
          {dialog === "import" && (
            <ImportDialog
              current={data}
              close={() => setDialog(null)}
              saved={saved}
            />
          )}
          {dialog === "edit" && (
            <EditDialog
              current={data}
              groupId={group}
              courseId={course}
              close={() => setDialog(null)}
              saved={saved}
            />
          )}
          {dialog === "status" && (
            <StatusDialog
              current={data}
              close={() => setDialog(null)}
              saved={saved}
            />
          )}
        </>
      )}
    </section>
  );
}
function EditDialog({
  current,
  groupId,
  courseId,
  close,
  saved,
}: {
  current: GraduationDetail;
  groupId?: string;
  courseId?: string;
  close: () => void;
  saved: () => void;
}) {
  const [form, setForm] = useState(() => structuredClone(current.data)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const group = form.groups.find((g) => g.id === groupId),
    course = form.courses.find((c) => c.id === courseId);
  const setGroup = (patch: Partial<GraduationData["groups"][number]>) =>
    setForm({
      ...form,
      groups: form.groups.map((g) =>
        g.id === groupId ? { ...g, ...patch } : g,
      ),
    });
  const setCourse = (patch: Partial<GraduationData["courses"][number]>) =>
    setForm({
      ...form,
      courses: form.courses.map((c) =>
        c.id === courseId ? { ...c, ...patch } : c,
      ),
    });
  return (
    <Modal
      title={
        group
          ? "Cập nhật nhóm điều kiện"
          : course
            ? "Cập nhật môn học điều kiện"
            : "Cập nhật tiêu chuẩn xét tốt nghiệp"
      }
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
            await request(`${endpoint}/${current.id}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                "x-version": current.token,
              },
              body: JSON.stringify(form),
            });
            saved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {group ? (
          <>
            <label>
              Tên nhóm
              <input
                required
                maxLength={500}
                value={group.name}
                onChange={(e) => setGroup({ name: e.target.value })}
              />
            </label>
            <label>
              Loại nhóm
              <select
                value={group.kind}
                onChange={(e) =>
                  setGroup({ kind: e.target.value as typeof group.kind })
                }
              >
                <option value="mandatory">Bắt buộc</option>
                <option value="elective">Tự chọn</option>
              </select>
            </label>
            <NumberField
              label="Tín chỉ yêu cầu"
              value={group.minimumCredits}
              change={(n) => setGroup({ minimumCredits: n })}
            />
          </>
        ) : course ? (
          <>
            <label>
              Mã học phần
              <input
                required
                maxLength={500}
                value={course.code}
                onChange={(e) => setCourse({ code: e.target.value })}
              />
            </label>
            <label>
              Tên học phần
              <input
                required
                maxLength={500}
                value={course.name}
                onChange={(e) => setCourse({ name: e.target.value })}
              />
            </label>
            <label>
              Nhóm điều kiện
              <select
                value={course.groupId}
                onChange={(e) => setCourse({ groupId: e.target.value })}
              >
                {form.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              label="Tín chỉ"
              value={course.credits}
              max={50}
              change={(n) => setCourse({ credits: n })}
            />
            <label className="grad-check">
              <input
                type="checkbox"
                checked={course.conditionOnly}
                onChange={(e) => setCourse({ conditionOnly: e.target.checked })}
              />
              Môn điều kiện, không tính tín chỉ tích lũy và GPA
            </label>
          </>
        ) : (
          <>
            <label>
              Tên tiêu chuẩn
              <input
                required
                maxLength={500}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <p>
              Mã: {form.standardCode} · Khối lớp: {form.classBlock} ·{" "}
              {form.cohortCode}
            </p>
            <div className="cm-form-grid">
              {thresholdFields.map(([key, label]) => (
                <NumberField
                  key={key}
                  label={label}
                  value={form[key]}
                  max={key === "minimumGpa" ? 10 : 500}
                  change={(n) => setForm({ ...form, [key]: n })}
                />
              ))}
            </div>
            <label>
              Ghi chú điều kiện
              <textarea
                maxLength={12000}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
          </>
        )}
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
          <button type="submit" className="am-primary am-save" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu phiên bản mới"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function NumberField({
  label,
  value,
  change,
  max = 500,
}: {
  label: string;
  value: number | null;
  change: (n: number | null) => void;
  max?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        min={0}
        max={max}
        step="0.01"
        value={value ?? ""}
        onChange={(e) =>
          change(e.target.value === "" ? null : Number(e.target.value))
        }
      />
    </label>
  );
}
function StatusDialog({
  current,
  close,
  saved,
}: {
  current: GraduationDetail;
  close: () => void;
  saved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={current.isActive ? "Khóa tiêu chuẩn" : "Mở tiêu chuẩn"}
      onClose={close}
      busy={busy}
      size="sm"
    >
      <div className="cm-dialog-body cm-form">
        <p>
          {current.isActive
            ? "Tiêu chuẩn sẽ được đánh dấu ngừng áp dụng. Lịch sử và dữ liệu vẫn được giữ để tra cứu."
            : "Cho phép áp dụng lại tiêu chuẩn này."}
        </p>
        <strong>{current.data.name}</strong>
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
            className={current.isActive ? "am-primary am-warning" : "am-primary am-save"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await request(`${endpoint}/${current.id}/status`, {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    "x-version": current.token,
                  },
                  body: JSON.stringify({ isActive: !current.isActive }),
                });
                saved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Xác nhận
          </button>
        </div>
      </div>
    </Modal>
  );
}
