import { Fragment, useEffect, useRef, useState } from "react";
import { Modal, Pagination, Status, useData } from "./admin-ui";
import { useLiveFilters } from "./use-live-filters";
import type { PlanData, PlanDetail, PlanItem, PlanList } from "./plan-types";
import "./curricula.css";
import "./plans.css";

const endpoint = "/api/admin/plans";
const mime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();
const date = (s: string) => new Date(s).toLocaleString("vi-VN");
const messages: Record<string, string> = {
  invalid_workbook:
    "Không đọc được Excel. Hãy dùng tệp .xlsx theo mẫu kế hoạch của Khoa.",
  unsupported_plan_template:
    "Không đúng mẫu kế hoạch đào tạo. Cần các cột Phân bổ học kỳ, Năm thứ, Mã học phần và Tên học phần.",
  missing_plan_metadata: "Thiếu ngành hoặc khóa trong tiêu đề kế hoạch.",
  invalid_plan_row:
    "Dòng môn học thiếu dữ liệu hoặc có năm/học kỳ mâu thuẫn. Hãy kiểm tra Excel.",
  invalid_plan_input:
    "Thông tin chưa hợp lệ. Kiểm tra tín chỉ, năm, học kỳ và nhóm môn.",
  plan_exists:
    "Kế hoạch của ngành và khóa này đã tồn tại. Hãy mở kế hoạch đó và chọn Cập nhật từ Excel.",
  plan_changed:
    "Kế hoạch đã thay đổi. Đóng hộp thoại và tải lại trước khi sửa tiếp.",
  preview_changed:
    "Dữ liệu liên kết đã thay đổi. Hãy xem trước lại rồi xác nhận lưu.",
  plan_identity_mismatch:
    "File thay thế phải cùng ngành và khóa với kế hoạch đang mở.",
  review_warnings: "Hãy đọc và xác nhận các ghi chú trước khi lưu.",
  workbook_too_large: "Tệp vượt giới hạn 5 MB hoặc quá nhiều dữ liệu.",
  no_courses: "Không tìm thấy môn học trong kế hoạch.",
  import_busy: "Hệ thống đang đọc một tệp khác. Vui lòng thử lại sau.",
  import_timeout: "Đọc Excel quá lâu. Hãy thử lại với tệp theo mẫu.",
  insufficient_role: "Chỉ quản trị viên được chỉnh sửa kế hoạch.",
  authentication_required: "Phiên đăng nhập đã hết. Hãy đăng nhập lại.",
  invalid_origin: "Không xác nhận được yêu cầu. Hãy tải lại trang.",
  invalid_filename: "Tên tệp không hợp lệ.",
  not_found: "Không tìm thấy kế hoạch hoặc dòng môn học.",
};
async function request<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, credentials: "include" });
  const body = await res.json();
  if (!res.ok)
    throw new Error(
      (messages[body.error] ??
        "Chưa thực hiện được thao tác. Vui lòng thử lại.") +
        (body.details?.length ? "\n" + body.details.join("\n") : ""),
    );
  return body;
}
function Warnings({ data }: { data: PlanData }) {
  return (
    <details className="cm-warning">
      <summary>{data.warnings.length} ghi chú cần rà soát</summary>
      <ul>
        {data.warnings.map((w, i) => (
          <li key={i}>
            {w.row !== null && `Dòng ${w.row}: `}
            {w.message}
          </li>
        ))}
      </ul>
    </details>
  );
}
function Summary({ data }: { data: PlanData }) {
  return (
    <>
      <div className="cm-stats">
        <div>
          <span>Khóa tuyển sinh</span>
          <strong>{data.cohortCode}</strong>
          <small>Nhập học {data.admissionYear}</small>
        </div>
        <div>
          <span>Tổng tín chỉ kế hoạch</span>
          <strong>{data.totalCredits ?? "—"}</strong>
          <small>Không cộng mọi phương án tự chọn</small>
        </div>
        <div>
          <span>Lượt phân bổ môn</span>
          <strong>{data.items.length}</strong>
          <small>Giữ các lần xuất hiện khác kỳ</small>
        </div>
        <div>
          <span>Học kỳ được phân bổ</span>
          <strong>{data.terms.length}</strong>
          <small>Năm học và học kỳ 1–3 tách riêng</small>
        </div>
      </div>
      <p className="pm-link-note">
        {data.curriculum ? (
          <>
            Liên kết CTĐT:{" "}
            <a href={`/quantri/chuong-trinh#${data.curriculum.id}`}>
              {data.curriculum.name}
            </a>{" "}
            · Phiên bản {data.curriculum.version}
          </>
        ) : (
          "Chưa liên kết CTĐT cùng ngành và khóa."
        )}
      </p>
    </>
  );
}
export default function PlansManagement({ canManage }: { canManage: boolean }) {
  const [id, setId] = useState(window.location.hash.slice(1));
  const [revision, setRevision] = useState(0),
    [importOpen, setImportOpen] = useState(false),
    [notice, setNotice] = useState("");
  const { draft, setDraft, filters, page, setPage, reset, flush } =
    useLiveFilters({ q: "", cohort: "", active: "" });
  const remote = useData<PlanList>(
    `${endpoint}?${new URLSearchParams({ ...filters, page: String(page) })}`,
    revision,
  );
  useEffect(() => {
    const onHash = () => setId(window.location.hash.slice(1));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const open = (next: string) => {
    window.location.hash = next;
    setId(next);
  };
  const refresh = () => setRevision((n) => n + 1);
  return (
    <div className="cm-workspace pm-workspace">
      {notice && (
        <p className="cm-success" role="status">
          {notice}
        </p>
      )}
      {id ? (
        <PlanView
          key={id}
          id={id}
          canManage={canManage}
          onBack={() => open("")}
          onChanged={refresh}
        />
      ) : (
        <section className="am-card">
          <div className="am-card-heading">
            <div>
              <h2>Kế hoạch đào tạo</h2>
              <p>Quản lý phân bổ học phần theo khóa, năm học và học kỳ.</p>
            </div>
            {canManage && (
              <button
                className="am-primary"
                onClick={() => setImportOpen(true)}
              >
                Import kế hoạch
              </button>
            )}
          </div>
          <form
            className="pm-filters"
            onSubmit={(e) => {
              e.preventDefault();
              flush();
            }}
          >
            <label>
              Tìm kế hoạch
              <input
                type="search"
                placeholder="Tên, ngành, chuyên ngành hoặc khóa…"
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              />
            </label>
            <label>
              Khóa
              <select
                value={draft.cohort}
                onChange={(e) => setDraft({ ...draft, cohort: e.target.value })}
              >
                <option value="">Tất cả khóa</option>
                {remote.data?.cohorts.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Trạng thái
              <select
                value={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.value })}
              >
                <option value="">Tất cả trạng thái</option>
                <option value="true">Đang mở</option>
                <option value="false">Đã khóa</option>
              </select>
            </label>
            <button type="button" className="am-outline" onClick={reset}>
              Xóa bộ lọc
            </button>
          </form>
          <Status {...remote} />
          {remote.data && (
            <>
              <div
                className="am-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Danh sách kế hoạch đào tạo"
              >
                <table className="am-table">
                  <thead>
                    <tr>
                      <th>Kế hoạch / Ngành</th>
                      <th>Khóa</th>
                      <th>Phân bổ</th>
                      <th>Trạng thái</th>
                      <th>Ghi chú</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {remote.data.items.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <button
                            className="am-name-link"
                            onClick={() => open(p.id)}
                          >
                            {p.name}
                          </button>
                          <small className="pm-muted">
                            {p.major} · Phiên bản {p.version}
                          </small>
                        </td>
                        <td>{p.cohortCode}</td>
                        <td>
                          {p.itemCount} lượt môn
                          <br />
                          {p.totalCredits ?? "—"} tín chỉ
                        </td>
                        <td>
                          <span className="am-badge">
                            {p.isActive ? "Đang mở" : "Đã khóa"}
                          </span>
                        </td>
                        <td>{p.warningCount} cần rà soát</td>
                        <td>
                          <button
                            className="am-outline"
                            onClick={() => open(p.id)}
                          >
                            Chi tiết
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!remote.data.items.length && (
                <p className="am-empty">Không có kế hoạch phù hợp.</p>
              )}
              <Pagination
                total={remote.data.total}
                page={page}
                setPage={setPage}
              />
            </>
          )}
        </section>
      )}
      {importOpen && (
        <ImportPlan
          onClose={() => setImportOpen(false)}
          onSaved={(p) => {
            setImportOpen(false);
            refresh();
            setNotice("Đã nhập kế hoạch đào tạo.");
            open(p.id);
          }}
        />
      )}
    </div>
  );
}
function PlanView({
  id,
  canManage,
  onBack,
  onChanged,
}: {
  id: string;
  canManage: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [revision, setRevision] = useState(""),
    [reload, setReload] = useState(0);
  const remote = useData<PlanDetail>(
    `${endpoint}/${id}${revision ? `?revision=${revision}` : ""}`,
    reload,
  );
  const [modal, setModal] = useState<"metadata" | "import" | "status" | null>(
      null,
    ),
    [item, setItem] = useState<PlanItem | null>(null),
    [notice, setNotice] = useState("");
  const p = remote.data,
    editable = !!p && canManage && p.revisionId === p.history[0]?.id;
  const saved = () => {
    setModal(null);
    setItem(null);
    setRevision("");
    setReload((n) => n + 1);
    onChanged();
    setNotice("Đã lưu thay đổi.");
  };
  return (
    <>
      <div className="pm-toolbar">
        <button className="am-outline" onClick={onBack}>
          ← Danh sách kế hoạch
        </button>
        <button className="am-outline" onClick={() => setReload((n) => n + 1)}>
          Tải lại
        </button>
      </div>
      <Status {...remote} />
      {notice && (
        <p className="cm-success" role="status">
          {notice}
        </p>
      )}
      {p && (
        <>
          <section className="am-card pm-overview">
            <div className="pm-title">
              <div>
                <p className="pm-muted">
                  {p.data.major} · {p.isActive ? "Đang mở" : "Đã khóa"}
                </p>
                <h2>{p.data.name}</h2>
              </div>
              <label>
                Phiên bản
                <select
                  value={p.revisionId}
                  onChange={(e) =>
                    setRevision(
                      e.target.value === p.history[0]?.id ? "" : e.target.value,
                    )
                  }
                >
                  {p.history.map((h) => (
                    <option key={h.id} value={h.id}>
                      Phiên bản {h.version} · {date(h.createdAt)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Summary data={p.data} />
            <div className="pm-toolbar">
              {editable && (
                <>
                  <button
                    className="am-outline"
                    onClick={() => setModal("metadata")}
                  >
                    Sửa thông tin
                  </button>
                  <button
                    className="am-outline"
                    onClick={() => setModal("import")}
                  >
                    Cập nhật từ Excel
                  </button>
                  <button
                    className="am-outline"
                    onClick={() => setModal("status")}
                  >
                    {p.isActive ? "Khóa kế hoạch" : "Mở kế hoạch"}
                  </button>
                </>
              )}
              <a
                className="am-outline"
                href={`${endpoint}/${id}/source/${p.revisionId}`}
              >
                Tải Excel gốc
              </a>
            </div>
            {!editable && (
              <p className="pm-muted">
                Chế độ chỉ xem
                {canManage ? " — chọn bản hiện hành để chỉnh sửa" : ""}.
              </p>
            )}
            <p className="pm-muted">Nguồn: {p.sourceFilename}</p>
            {p.data.notes && <p className="pm-prewrap">{p.data.notes}</p>}
            <Warnings data={p.data} />
          </section>
          <PlanStructure data={p.data} onItem={setItem} />
          <details className="am-card pm-history">
            <summary>Lịch sử cập nhật và mở/khóa</summary>
            <ul>
              {p.history.map((h) => (
                <li key={h.id}>
                  Phiên bản {h.version} · {date(h.createdAt)} · {h.note}
                </li>
              ))}
              {p.events.map((e, i) => (
                <li key={`event-${i}`}>
                  {date(e.createdAt)} · {e.action}
                </li>
              ))}
            </ul>
          </details>
          {modal === "import" && (
            <ImportPlan
              target={p}
              onClose={() => setModal(null)}
              onSaved={saved}
            />
          )}
          {modal === "metadata" && (
            <MetadataEditor
              plan={p}
              onClose={() => setModal(null)}
              onSaved={saved}
            />
          )}
          {modal === "status" && (
            <StatusEditor
              plan={p}
              onClose={() => setModal(null)}
              onSaved={saved}
            />
          )}
          {item && (
            <ItemEditor
              key={item.id}
              item={item}
              plan={p}
              canManage={editable}
              onClose={() => setItem(null)}
              onSaved={saved}
            />
          )}
        </>
      )}
    </>
  );
}
function PlanStructure({
  data,
  onItem,
}: {
  data: PlanData;
  onItem?: (i: PlanItem) => void;
}) {
  const { draft, setDraft, filters, reset } = useLiveFilters({
    q: "",
    term: "",
    group: "",
  });
  const labels = new Map(data.sections.map((s) => [s.id, s.label]));
  const items = data.items.filter(
    (i) =>
      (!filters.q || fold(`${i.code} ${i.name}`).includes(fold(filters.q))) &&
      (!filters.term || i.termCode === filters.term) &&
      (!filters.group || labels.get(i.sectionId) === filters.group),
  );
  return (
    <section className="am-card pm-structure">
      <div className="am-card-heading">
        <div>
          <h2>Phân bổ học phần</h2>
          <p>
            Tín chỉ từng kỳ giữ theo file nguồn, không cộng mọi môn tự chọn hoặc
            chuyên ngành.
          </p>
        </div>
        <span role="status">
          {items.length} / {data.items.length} lượt môn
        </span>
      </div>
      <div className="pm-filters">
        <label>
          Tìm môn
          <input
            type="search"
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            placeholder="Mã hoặc tên học phần…"
          />
        </label>
        <label>
          Năm / Học kỳ
          <select
            value={draft.term}
            onChange={(e) => setDraft({ ...draft, term: e.target.value })}
          >
            <option value="">Tất cả học kỳ</option>
            {data.terms.map((t) => (
              <option key={t.code} value={t.code}>
                Năm {t.studyYear} · HK {t.semester} · {t.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nhóm / Chuyên ngành
          <select
            value={draft.group}
            onChange={(e) => setDraft({ ...draft, group: e.target.value })}
          >
            <option value="">Tất cả nhóm</option>
            {[...new Set(data.sections.map((s) => s.label))].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button className="am-outline" onClick={reset}>
          Xóa bộ lọc
        </button>
      </div>
      {data.terms
        .filter((t) => items.some((i) => i.termCode === t.code))
        .map((t) => (
          <section className="pm-term" key={t.code}>
            <h3>
              Năm {t.studyYear} · Học kỳ {t.semester}{" "}
              <span>
                {t.code} · {t.sourceCredits ?? "—"} tín chỉ theo Excel
              </span>
            </h3>
            <div
              className="am-table-scroll"
              tabIndex={0}
              role="region"
              aria-label={`Học phần ${t.code}`}
            >
              <table className="am-table">
                <thead>
                  <tr>
                    <th>Mã học phần</th>
                    <th>Tên học phần</th>
                    <th>Tín chỉ</th>
                    <th>Loại môn</th>
                    <th>Tiên quyết / Học trước</th>
                    <th>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {items
                    .filter((i) => i.termCode === t.code)
                    .map((i, index, all) => (
                      <Fragment key={i.id}>
                        {i.sectionId !== all[index - 1]?.sectionId && (
                          <tr className="pm-group">
                            <th colSpan={6}>
                              {labels.get(i.sectionId) ??
                                "Các học phần trong kỳ"}
                            </th>
                          </tr>
                        )}
                        <tr>
                          <td>{i.code || "Chưa có mã"}</td>
                          <th scope="row">{i.name}</th>
                          <td>{i.credits ?? "Chưa xác định"}</td>
                          <td>{i.type || "Chưa xác định"}</td>
                          <td>
                            <p>Tiên quyết: {i.prerequisite || "Chưa ghi"}</p>
                            <p>Học trước: {i.prior || "Chưa ghi"}</p>
                          </td>
                          <td>
                            {onItem ? (
                              <button
                                className="am-outline"
                                onClick={() => onItem(i)}
                              >
                                Chi tiết
                              </button>
                            ) : (
                              <span>Dòng {i.sourceRow}</span>
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      {!items.length && (
        <p className="am-empty">Không có môn phù hợp với bộ lọc.</p>
      )}
    </section>
  );
}
function ImportPlan({
  target,
  onClose,
  onSaved,
}: {
  target?: PlanDetail;
  onClose: () => void;
  onSaved: (p: PlanDetail) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<{
      data: PlanData;
      previewHash: string;
    } | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function act(save: boolean) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 5 * 1024 * 1024 || !/\.xlsx$/i.test(file.name))
        throw new Error("Chọn file .xlsx tối đa 5 MB.");
      const result = await request<
        PlanDetail & { data: PlanData; previewHash: string }
      >(
        save
          ? target
            ? `${endpoint}/${target.id}/import`
            : endpoint
          : `${endpoint}/preview`,
        {
          method: save && target ? "PUT" : "POST",
          headers: {
            "Content-Type": mime,
            "x-filename": encodeURIComponent(file.name),
            "x-confirm-warnings": String(confirmed),
            "x-preview-hash": preview?.previewHash ?? "",
            ...(target ? { "x-version": target.token } : {}),
          },
          body: file,
        },
      );
      if (save) onSaved(result);
      else {
        setPreview(result);
        setConfirmed(false);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={target ? "Cập nhật kế hoạch từ Excel" : "Import kế hoạch đào tạo"}
      busy={busy}
      onClose={onClose}
    >
      <div className="cm-dialog-body pm-import">
        <p>
          Chọn kế hoạch hoàn chỉnh theo mẫu Khoa. Tên file bất kỳ; ngành và khóa
          được đọc từ nội dung.
        </p>
        {target && (
          <p>
            Thay toàn bộ phân bổ của {target.data.cohortCode}; bản hiện tại vẫn
            được giữ trong lịch sử.
          </p>
        )}
        <label className="am-field">
          File kế hoạch (.xlsx, tối đa 5 MB)
          <input
            type="file"
            accept=".xlsx"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setConfirmed(false);
              setError("");
            }}
          />
        </label>
        {error && (
          <p
            className="admin-error pm-prewrap"
            role="alert"
            tabIndex={-1}
            ref={errorRef}
          >
            {error}
          </p>
        )}
        <button
          className="am-outline"
          disabled={!file || busy}
          onClick={() => void act(false)}
        >
          {busy ? "Đang xử lý…" : "Xem trước"}
        </button>
        {preview && (
          <>
            <h3>{preview.data.name}</h3>
            <Summary data={preview.data} />
            <Warnings data={preview.data} />
            <PlanStructure data={preview.data} />
            <label className="am-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                Tôi đã rà soát dữ liệu và các ghi chú, đồng ý lưu kế hoạch này.
              </span>
            </label>
            <div className="pm-toolbar">
              <button
                className="am-primary"
                disabled={!confirmed || busy}
                onClick={() => void act(true)}
              >
                Lưu kế hoạch
              </button>
              <button className="am-outline" disabled={busy} onClick={onClose}>
                Hủy
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
function MetadataEditor({
  plan,
  onClose,
  onSaved,
}: {
  plan: PlanDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(plan.data.name),
    [total, setTotal] = useState(String(plan.data.totalCredits ?? "")),
    [notes, setNotes] = useState(plan.data.notes);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Thông tin kế hoạch" busy={busy} onClose={onClose}>
      <form
        className="cm-dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await request(`${endpoint}/${plan.id}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                "x-version": plan.token,
              },
              body: JSON.stringify({
                name,
                totalCredits: total === "" ? null : Number(total),
                notes,
              }),
            });
            onSaved();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="am-field">
          Tên kế hoạch
          <input
            required
            maxLength={500}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="am-field">
          Tổng tín chỉ kế hoạch
          <input
            type="number"
            min={0}
            max={400}
            step="0.5"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </label>
        <label className="am-field">
          Ghi chú
          <textarea
            maxLength={12000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {error && (
          <p className="admin-error pm-prewrap" role="alert">
            {error}
          </p>
        )}
        <button className="am-primary" disabled={busy}>
          {busy ? "Đang lưu…" : "Lưu phiên bản mới"}
        </button>
      </form>
    </Modal>
  );
}
function StatusEditor({
  plan,
  onClose,
  onSaved,
}: {
  plan: PlanDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={plan.isActive ? "Khóa kế hoạch đào tạo" : "Mở kế hoạch đào tạo"}
      busy={busy}
      onClose={onClose}
      size="sm"
    >
      <div className="cm-dialog-body">
        <p>
          {plan.isActive
            ? "Kế hoạch sẽ chuyển sang đã khóa, được giữ lại để tra cứu lịch sử."
            : "Kế hoạch sẽ được đánh dấu đang mở để tiếp tục áp dụng."}
        </p>
        <strong>{plan.data.name}</strong>
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        <div className="pm-toolbar">
          <button
            className="am-primary"
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await request(`${endpoint}/${plan.id}/status`, {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    "x-version": plan.token,
                  },
                  body: JSON.stringify({ isActive: !plan.isActive }),
                });
                onSaved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Đang lưu…" : "Xác nhận"}
          </button>
          <button className="am-outline" disabled={busy} onClick={onClose}>
            Hủy
          </button>
        </div>
      </div>
    </Modal>
  );
}
function ItemEditor({
  item,
  plan,
  canManage,
  onClose,
  onSaved,
}: {
  item: PlanItem;
  plan: PlanDetail;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(item),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const textFields = [
    ["code", "Mã học phần"],
    ["name", "Tên học phần"],
    ["type", "Loại môn (BB/TC theo kế hoạch)"],
    ["prerequisite", "Điều kiện tiên quyết"],
    ["prior", "Học phần học trước"],
    ["notes", "Ghi chú"],
  ] as const;
  const hours = [
    ["lecture", "Lý thuyết"],
    ["practice", "Thực hành"],
    ["project", "Đồ án"],
    ["internship", "Thực tập"],
  ] as const;
  return (
    <Modal
      title={`${item.code || "Học phần"} · ${item.name}`}
      onClose={onClose}
      busy={busy}
    >
      <form
        className="cm-dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !canManage || !editing) return;
          setBusy(true);
          setError("");
          try {
            const {
              id: _id,
              position: _position,
              sourceRow: _row,
              sourceSheet: _sheet,
              sourceCells: _cells,
              ...change
            } = form;
            await request(`${endpoint}/${plan.id}/items/${item.id}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                "x-version": plan.token,
              },
              body: JSON.stringify(change),
            });
            onSaved();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {editing ? (
          <>
            <div className="pm-edit-grid">
              <label className="am-field">
                Năm / Học kỳ
                <select
                  value={form.termCode}
                  onChange={(e) => {
                    const t = plan.data.terms.find(
                      (t) => t.code === e.target.value,
                    )!;
                    setForm({
                      ...form,
                      termCode: t.code,
                      semester: t.semester,
                      studyYear: t.studyYear,
                      sectionId: "",
                    });
                  }}
                >
                  {plan.data.terms.map((t) => (
                    <option key={t.code} value={t.code}>
                      Năm {t.studyYear} · Học kỳ {t.semester} · {t.code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="am-field">
                Nhóm môn
                <select
                  value={form.sectionId}
                  onChange={(e) =>
                    setForm({ ...form, sectionId: e.target.value })
                  }
                >
                  <option value="">Không thuộc nhóm riêng</option>
                  {plan.data.sections
                    .filter((s) => s.termCode === form.termCode)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="am-field">
                Tín chỉ (để trống nếu chưa xác định)
                <input
                  type="number"
                  min={0}
                  max={30}
                  step="0.5"
                  value={form.credits ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      credits:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            {textFields.map(([key, label]) => (
              <label className="am-field" key={key}>
                {label}
                <textarea
                  rows={key === "prerequisite" || key === "prior" ? 4 : 2}
                  required={key === "name"}
                  maxLength={
                    ["code", "name", "type"].includes(key)
                      ? key === "code"
                        ? 100
                        : 500
                      : 12000
                  }
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            <div className="pm-edit-grid">
              {hours.map(([key, label]) => (
                <label className="am-field" key={key}>
                  Giờ {label.toLowerCase()}
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={form.hours[key] ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        hours: {
                          ...form.hours,
                          [key]:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <p className="pm-muted">
              Thay đổi phân bổ không tự tính lại tổng tín chỉ ghi trong Excel.
              Dùng Cập nhật từ Excel để thay toàn bộ cấu trúc hoặc các nhóm môn.
            </p>
          </>
        ) : (
          <>
            <dl className="pm-detail-fields">
              <div>
                <dt>Phân bổ</dt>
                <dd>
                  Năm {item.studyYear} · Học kỳ {item.semester} ·{" "}
                  {item.termCode}
                </dd>
              </div>
              <div>
                <dt>Tín chỉ</dt>
                <dd>{item.credits ?? "Chưa xác định"}</dd>
              </div>
              <div>
                <dt>Nhóm môn</dt>
                <dd>
                  {plan.data.sections.find((s) => s.id === item.sectionId)
                    ?.label ?? "Không thuộc nhóm riêng"}
                </dd>
              </div>
              {hours.map(([key, label]) => (
                <div key={key}>
                  <dt>Giờ {label.toLowerCase()}</dt>
                  <dd>{item.hours[key] ?? "Chưa ghi"}</dd>
                </div>
              ))}
            </dl>
            {textFields.map(([key, label]) => (
              <section key={key}>
                <h3>{label}</h3>
                <p className="pm-prewrap">{item[key] || "Chưa ghi"}</p>
              </section>
            ))}
            <details>
              <summary>
                Đối chiếu ô nguồn · {item.sourceSheet}, dòng {item.sourceRow}
              </summary>
              <dl className="pm-source">
                {Object.entries(item.sourceCells).map(([key, val]) => (
                  <div key={key}>
                    <dt>
                      {key}
                      {item.sourceRow}
                    </dt>
                    <dd className="pm-prewrap">{val || "Ô trống"}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </>
        )}
        {error && (
          <p className="admin-error pm-prewrap" role="alert">
            {error}
          </p>
        )}
        {canManage && (
          <div className="pm-toolbar">
            {editing ? (
              <>
                <button
                  key="save-allocation"
                  type="submit"
                  className="am-primary"
                  disabled={busy}
                >
                  {busy ? "Đang lưu…" : "Lưu phân bổ"}
                </button>
                <button
                  type="button"
                  className="am-outline"
                  disabled={busy}
                  onClick={() => {
                    setForm(item);
                    setEditing(false);
                    setError("");
                  }}
                >
                  Hủy sửa
                </button>
              </>
            ) : (
              <button
                key="edit-allocation"
                type="button"
                className="am-primary"
                onClick={(event) => {
                  event.preventDefault();
                  setEditing(true);
                }}
              >
                Chỉnh sửa phân bổ
              </button>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
