import { Fragment, useEffect, useRef, useState } from "react";
import { Modal, Pagination, Status, useData } from "./admin-ui";
import { Icon } from "./admin-account-shared";
import { useLiveFilters } from "./use-live-filters";
import type {
  CurriculumCourse,
  CurriculumData,
  CurriculumDetail,
  CurriculumList,
} from "./curriculum-types";
import "./curricula.css";

const endpoint = "/api/admin/curricula";
const mime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const date = (s: string) => new Date(s).toLocaleString("vi-VN");
const errors: Record<string, string> = {
  invalid_workbook:
    "Không đọc được tệp Excel. Hãy chọn tệp .xlsx theo mẫu khung CTĐT của Khoa.",
  unsupported_curriculum_template:
    "Chưa nhận diện được mẫu. Cần một trang tính có các cột Mã học phần, Tên học phần, tín chỉ và kế hoạch học.",
  missing_curriculum_metadata:
    "Thiếu ngành, khóa hoặc tổng tín chỉ ở đầu khung CTĐT. Hãy bổ sung theo mẫu rồi nhập lại.",
  invalid_course_row:
    "Có dòng học phần thiếu tên hoặc sai mã. Hãy kiểm tra dòng được chỉ ra bên dưới.",
  invalid_course_credits:
    "Có học phần có tín chỉ không hợp lệ. Hãy sửa trong Excel rồi nhập lại.",
  invalid_course_type:
    "Có học phần chưa xác định BB/TC. Hãy kiểm tra cột loại học phần.",
  duplicate_course:
    "Mã học phần bị trùng trong cùng khung. Hãy kiểm tra trước khi lưu.",
  curriculum_exists:
    "Khung của ngành và khóa này đã tồn tại. Mở chi tiết khung rồi chọn Cập nhật từ Excel.",
  curriculum_identity_mismatch:
    "Tệp thay thế phải cùng ngành và khóa với khung đang mở. Với ngành hoặc khóa khác, hãy import khung mới.",
  curriculum_changed:
    "Khung đã được người khác cập nhật. Đóng hộp thoại và tải lại chi tiết trước khi sửa tiếp.",
  review_warnings:
    "Hãy xem và xác nhận các cảnh báo của dữ liệu trước khi nhập.",
  workbook_too_large:
    "Tệp vượt giới hạn 5 MB hoặc có quá nhiều dữ liệu. Hãy dùng khung CTĐT gọn theo mẫu.",
  import_busy: "Hệ thống đang xử lý một tệp Excel khác. Vui lòng thử lại sau.",
  import_timeout: "Đọc Excel quá lâu. Hãy kiểm tra tệp và thử lại.",
  invalid_curriculum_input:
    "Thông tin chưa hợp lệ. Kiểm tra mã môn, khối kiến thức, tín chỉ và học kỳ (1–3).",
  insufficient_role: "Chỉ quản trị viên được thay đổi khung CTĐT.",
  authentication_required: "Phiên đăng nhập đã hết. Hãy đăng nhập lại.",
  invalid_origin: "Không xác nhận được nguồn yêu cầu. Hãy tải lại trang.",
  database_required: "Chưa kết nối được cơ sở dữ liệu.",
  conflicting_elective_credits:
    "Số tín chỉ phải chọn trong cùng nhóm tự chọn không thống nhất.",
  invalid_course_group: "Hãy chọn một khối kiến thức có trong khung.",
  too_many_courses: "Khung chỉ hỗ trợ tối đa 2.000 học phần.",
  not_found: "Không tìm thấy học phần. Hãy tải lại khung.",
  invalid_filename: "Tên tệp không hợp lệ. Hãy chọn tệp .xlsx.",
};
async function request<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, credentials: "include" });
  const body = await res.json();
  if (!res.ok)
    throw new Error(
      (errors[body.error] ??
        "Chưa thực hiện được thao tác. Vui lòng thử lại.") +
        (body.details?.length ? "\n" + body.details.join("\n") : ""),
    );
  return body;
}
function WarningList({ data }: { data: CurriculumData }) {
  return data.warnings.length ? (
    <div className="cm-warning">
      <strong>{data.warnings.length} cảnh báo cần rà soát</strong>
      <p>
        Giữ nguyên dữ liệu nguồn. Quan hệ chưa rõ sẽ cần được xác nhận trước khi
        dùng để gợi ý lộ trình.
      </p>
      <ul>
        {data.warnings.map((w, i) => (
          <li key={i}>
            {w.row !== null && <span>Dòng {w.row} · </span>}
            {w.message}
          </li>
        ))}
      </ul>
    </div>
  ) : (
    <p className="cm-success">
      Không phát hiện vấn đề theo các quy tắc kiểm tra hiện tại.
    </p>
  );
}
function Summary({ data }: { data: CurriculumData }) {
  return (
    <div className="cm-stats">
      <div>
        <span>Khóa tuyển sinh</span>
        <strong>{data.cohortCode}</strong>
        <small>Năm nhập học {data.admissionYear}</small>
      </div>
      <div>
        <span>Tín chỉ của chương trình</span>
        <strong>{data.totalCredits}</strong>
        <small>Theo quy định trong khung</small>
      </div>
      <div>
        <span>Học phần trong khung</span>
        <strong>{data.courses.length}</strong>
        <small>Gồm các phương án tự chọn</small>
      </div>
      <div>
        <span>Nhóm tự chọn</span>
        <strong>{data.electives.length}</strong>
        <small>Không cộng tất cả lựa chọn</small>
      </div>
    </div>
  );
}

export default function CurriculaManagement({
  canManage,
}: {
  canManage: boolean;
}) {
  const [id, setId] = useState(() => window.location.hash.slice(1));
  const [revision, setRevision] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const { draft, setDraft, filters, page, setPage, reset, flush } =
    useLiveFilters({ q: "", cohort: "", active: "" });
  const remote = useData<CurriculumList>(
    `${endpoint}?${new URLSearchParams({ ...filters, page: String(page) })}`,
    revision,
  );
  useEffect(() => {
    const handler = () => setId(window.location.hash.slice(1));
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  function open(next: string) {
    window.location.hash = next;
    setId(next);
    setNotice("");
  }
  if (id)
    return (
      <CurriculumView
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
    <section className="cm-workspace">
      <div className="cm-toolbar">
        <div>
          <h2>Khung chương trình đào tạo</h2>
          <p>
            Quản lý học phần, điều kiện học và kế hoạch đào tạo theo từng khóa.
          </p>
        </div>
        {canManage ? (
          <button className="am-primary" onClick={() => setImportOpen(true)}>
            <Icon name="upload" /> Import khung CTĐT
          </button>
        ) : (
          <span className="cm-tag">Chỉ xem</span>
        )}
      </div>
      {notice && (
        <p role="status" className="cm-success">
          {notice}
        </p>
      )}
      <div className="cm-panel">
        <form
          className="cm-filters"
          onSubmit={(e) => {
            e.preventDefault();
            flush();
          }}
        >
          <label className="cm-search">
            Tìm khung CTĐT
            <input
              type="search"
              placeholder="Tên chương trình, ngành, chuyên ngành, khóa…"
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            />
          </label>
          <label>
            Khóa học
            <select
              value={draft.cohort}
              onChange={(e) => setDraft({ ...draft, cohort: e.target.value })}
            >
              <option value="">Tất cả khóa</option>
              {remote.data?.cohorts.map((c) => (
                <option key={c}>{c}</option>
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
            <div className="cm-table-scroll">
              <table className="cm-table">
                <thead>
                  <tr>
                    <th>Chương trình đào tạo</th>
                    <th>Khóa</th>
                    <th>Học phần</th>
                    <th>Phiên bản</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {remote.data.items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                        <small>
                          {c.major} · {c.totalCredits} tín chỉ
                        </small>
                        {c.warningCount > 0 && (
                          <small className="cm-warning-text">
                            {c.warningCount} cảnh báo cần rà soát
                          </small>
                        )}
                      </td>
                      <td>
                        <span className="cm-cohort">{c.cohortCode}</span>
                      </td>
                      <td>{c.courseCount}</td>
                      <td>
                        v{c.version}
                        <small>{date(c.updatedAt)}</small>
                      </td>
                      <td>
                        <span
                          className={`cm-tag ${c.isActive ? "cm-open" : ""}`}
                        >
                          {c.isActive ? "Đang mở" : "Đã khóa"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="am-outline"
                          onClick={() => open(c.id)}
                        >
                          Xem chi tiết
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!remote.data.total && (
              <p className="am-empty">
                Chưa có khung phù hợp. Thử đổi bộ lọc
                {canManage ? " hoặc import tệp Excel mới." : "."}
              </p>
            )}
            <Pagination
              total={remote.data.total}
              page={page}
              setPage={setPage}
            />
          </>
        )}
      </div>
      <p className="cm-help">
        Mỗi khung gắn với một ngành và khóa. Khung đã khóa vẫn giữ lịch sử để
        tra cứu; các phiên bản cũ không bị xóa khi cập nhật.
      </p>
      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onSaved={(d) => {
            setImportOpen(false);
            setRevision((n) => n + 1);
            setNotice(
              `Đã nhập khung ${d.data.cohortCode}, gồm ${d.data.courses.length} học phần.`,
            );
          }}
        />
      )}
    </section>
  );
}

function ImportDialog({
  current,
  onClose,
  onSaved,
}: {
  current?: CurriculumDetail;
  onClose: () => void;
  onSaved: (data: CurriculumDetail) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<CurriculumData | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const generation = useRef(0);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorSummary.current?.focus();
  }, [error]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function inspect(selected: File | null) {
    const own = ++generation.current;
    setFile(selected);
    setPreview(null);
    setConfirmed(false);
    setError("");
    if (!selected) return;
    if (!/\.xlsx$/i.test(selected.name) || selected.size > 5 * 1024 * 1024) {
      setError("Chọn tệp .xlsx không quá 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const result = await request<{ data: CurriculumData }>(
        `${endpoint}/preview`,
        { method: "POST", headers: { "Content-Type": mime }, body: selected },
      );
      if (own === generation.current) setPreview(result.data);
    } catch (e) {
      if (own === generation.current) setError((e as Error).message);
    } finally {
      if (own === generation.current) setBusy(false);
    }
  }
  async function save() {
    if (!file || !preview) return;
    setBusy(true);
    setError("");
    try {
      onSaved(
        await request<CurriculumDetail>(
          current ? `${endpoint}/${current.id}/import` : endpoint,
          {
            method: current ? "PUT" : "POST",
            headers: {
              "Content-Type": mime,
              "x-filename": encodeURIComponent(file.name),
              "x-confirm-warnings": String(confirmed),
              ...(current ? { "x-version": current.token } : {}),
            },
            body: file,
          },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        current
          ? `Cập nhật khung ${current.data.cohortCode} từ Excel`
          : "Import khung chương trình đào tạo"
      }
      onClose={onClose}
      busy={busy}
    >
      <div className="cm-dialog-body">
        <p>1. Chọn tệp Excel → 2. Xem trước và rà soát → 3. Lưu vào hệ thống</p>
        <label className="cm-upload">
          Khung CTĐT (.xlsx · tối đa 5 MB)
          <input
            type="file"
            accept=".xlsx"
            disabled={busy}
            onChange={(e) => void inspect(e.target.files?.[0] ?? null)}
          />
        </label>
        <p className="cm-help">
          Dùng mẫu Khoa gồm mã và tên học phần, tín chỉ, BB/TC, tiên quyết, học
          trước, khối kiến thức, chuyên ngành, học kỳ và năm học.
        </p>
        {busy && <p role="status">Đang xử lý khung CTĐT…</p>}
        {error && (
          <p
            ref={errorSummary}
            tabIndex={-1}
            role="alert"
            className="admin-error cm-prewrap"
          >
            {error}
          </p>
        )}
        {preview && (
          <>
            <h3>{preview.name}</h3>
            <Summary data={preview} />
            <WarningList data={preview} />
            <details>
              <summary>Xem trước danh sách học phần</summary>
              <div className="cm-table-scroll">
                <table className="cm-table">
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Học phần</th>
                      <th>Tín chỉ</th>
                      <th>Loại</th>
                      <th>Năm · HK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.courses.map((c) => (
                      <tr key={c.code}>
                        <td>{c.code}</td>
                        <td>{c.name}</td>
                        <td>{c.credits}</td>
                        <td>{c.type || "—"}</td>
                        <td>
                          {c.studyYear ?? "—"} · {c.semester ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            {!!preview.warnings.length && (
              <label className="cm-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Tôi đã xem các cảnh báo và đồng ý lưu khung cùng các mục cần rà
                soát.
              </label>
            )}
            {current && (
              <p>
                Thao tác tạo phiên bản mới cho toàn bộ khung. Phiên bản hiện tại
                v{current.version} được giữ trong lịch sử.
              </p>
            )}
          </>
        )}
        <div className="cm-actions">
          <button className="am-outline" disabled={busy} onClick={onClose}>
            Hủy
          </button>
          <button
            className="am-primary"
            disabled={
              busy || !preview || (!!preview.warnings.length && !confirmed)
            }
            onClick={() => void save()}
          >
            Lưu khung CTĐT
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CurriculumView({
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
    [tab, setTab] = useState("courses"),
    [edit, setEdit] = useState<"metadata" | "import" | "status" | null>(null),
    [course, setCourse] = useState<CurriculumCourse | null>(null),
    [courseMode, setCourseMode] = useState<"view" | "edit" | "add" | "delete">(
      "view",
    ),
    [groupAction, setGroupAction] = useState<{
      id: string;
      mode: "edit" | "delete";
    } | null>(null),
    [notice, setNotice] = useState("");
  const remote = useData<CurriculumDetail>(
    `${endpoint}/${id}${version ? "?revision=" + version : ""}`,
    revision,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  // Only after a load the person waited for; background refreshes must not move focus.
  useEffect(() => { if (!remote.loading) heading.current?.focus(); }, [remote.loading]);
  const current = remote.data;
  const historical = current && current.revisionId !== current.history[0]?.id;
  const mutable = canManage && !historical;
  function saved() {
    setEdit(null);
    setCourse(null);
    setGroupAction(null);
    setVersion("");
    setRevision((n) => n + 1);
    setNotice("Đã lưu thay đổi. Dữ liệu và phiên bản trước được giữ nguyên.");
  }
  function actOnCourse(
    c: CurriculumCourse,
    mode: "view" | "edit" | "add" | "delete",
  ) {
    setCourseMode(mode);
    setCourse(c);
    setGroupAction(null);
  }
  function addToGroup(groupId: string) {
    actOnCourse(
      {
        position: 1,
        code: "",
        name: "",
        englishName: "",
        description: "",
        credits: 3,
        type: "",
        block: "",
        specialty: "",
        semester: null,
        studyYear: null,
        prerequisite: "",
        prior: "",
        notes: "",
        department: "",
        departmentCode: "",
        hours: {
          lecture: null,
          practice: null,
          project: null,
          internship: null,
        },
        groupId,
        sourceRow: 0,
        sourceSheet: "Thêm trực tiếp",
        sourceCells: {},
      },
      "add",
    );
  }
  return (
    <section className="cm-workspace">
      <div className="cm-toolbar">
        <button className="am-outline" onClick={back}>
          <Icon name="back" /> Danh sách khung
        </button>
      </div>
      <Status {...remote} />
      {current && (
        <>
          <div className="cm-panel cm-intro">
            <div className="cm-toolbar">
              <div>
                <p className="cm-eyebrow">
                  {current.data.major} · {current.data.cohortCode}
                </p>
                <h2 ref={heading} tabIndex={-1}>
                  {current.data.name}
                </h2>
                <p>
                  <span
                    className={`cm-tag ${current.isActive ? "cm-open" : ""}`}
                  >
                    {current.isActive ? "Đang mở" : "Đã khóa"}
                  </span>{" "}
                  <span>
                    Phiên bản {current.version}{" "}
                    {historical ? "· Bản lưu lịch sử" : ""}
                  </span>
                </p>
              </div>
            </div>
            {mutable && (
              <button
                className="am-icon-btn cm-metadata-edit"
                title="Sửa thông tin"
                aria-label="Sửa thông tin"
                onClick={() => setEdit("metadata")}
              >
                <Icon name="edit" />
              </button>
            )}
            <Summary data={current.data} />
            {current.data.notes && (
              <p className="cm-prewrap">{current.data.notes}</p>
            )}
            <div className="cm-actions">
              <a
                className="am-outline am-tone-brand"
                href={`${endpoint}/${id}/source/${current.revisionId}`}
                title="Tải tệp Excel nguồn; các chỉnh sửa trực tiếp được lưu trong phiên bản trên hệ thống"
              >
                <Icon name="download" /> Tải khung CTĐT
              </a>
              {mutable && (
                <>
                  <button
                    className="am-outline am-tone-green"
                    onClick={() => setEdit("import")}
                  >
                    <Icon name="upload" /> Cập nhật từ Excel
                  </button>
                  <button
                    className={current.isActive ? "am-outline am-tone-amber" : "am-outline am-tone-green"}
                    onClick={() => setEdit("status")}
                  >
                    <Icon name={current.isActive ? "lock" : "unlock"} />{" "}
                    {current.isActive ? "Khóa khung" : "Mở khung"}
                  </button>
                </>
              )}
            </div>
            <p className="cm-help">
              Tệp nguồn: {current.sourceFilename}. Tổng tín chỉ chương trình
              không phải tổng của tất cả các môn tự chọn và chuyên ngành. Tệp
              tải xuống là Excel nguồn; các chỉnh sửa trực tiếp được lưu trong
              phiên bản trên hệ thống.
            </p>
          </div>
          {notice && (
            <p className="cm-success" role="status">
              {notice}
            </p>
          )}
          <div className="cm-panel">
            <div className="cm-tabs" aria-label="Nội dung khung CTĐT">
              {[
                ["courses", "Cấu trúc học phần"],
                ["rules", "Nhóm & điều kiện"],
                ["warnings", `Cảnh báo (${current.data.warnings.length})`],
                ["history", "Lịch sử phiên bản"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={tab === value}
                  onClick={() => setTab(value!)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "courses" && (
              <Courses
                data={current.data}
                open={(c) => actOnCourse(c, "view")}
                onGroupAction={
                  mutable
                    ? (groupId, mode) =>
                        mode === "add"
                          ? addToGroup(groupId)
                          : setGroupAction({ id: groupId, mode })
                    : undefined
                }
              />
            )}
            {tab === "rules" && (
              <div className="cm-dialog-body">
                <h3>Các khối trong khung gốc</h3>
                <div className="cm-blocks">
                  {current.data.groups.map((g) => (
                    <div key={g.id}>
                      <strong>{g.label}</strong>
                      <span>
                        {g.credits === null
                          ? "Chưa ghi số tín chỉ"
                          : g.credits + " tín chỉ theo khung"}
                      </span>
                    </div>
                  ))}
                </div>
                <h3>Nhóm tự chọn</h3>
                <p className="cm-help">
                  Các nhóm và chuyên ngành là những lựa chọn theo quy định;
                  không mặc định sinh viên học tất cả.
                </p>
                <div className="cm-blocks">
                  {current.data.electives.map((g) => (
                    <div key={g.code}>
                      <strong>{g.code}</strong>
                      <span>
                        {g.requiredCredits === null
                          ? "Số tín chỉ phải chọn: cần rà soát khung gốc"
                          : `Chọn ${g.requiredCredits} tín chỉ`}
                      </span>
                      <small>{g.courseCodes.length} phương án học phần</small>
                    </div>
                  ))}
                </div>
                <h3>Điều kiện học phần</h3>
                <div className="cm-table-scroll">
                  <table className="cm-table">
                    <thead>
                      <tr>
                        <th>Học phần</th>
                        <th>Loại điều kiện</th>
                        <th>Nội dung</th>
                        <th>Đối chiếu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.data.relations.map((r) => (
                        <tr key={r.courseCode + r.kind}>
                          <td>{r.courseCode}</td>
                          <td>
                            {r.kind === "prior" ? "Học trước" : "Tiên quyết"}
                          </td>
                          <td className="cm-prewrap">{r.raw}</td>
                          <td>
                            {r.reviewRequired ? (
                              <span className="cm-warning-text">
                                Cần rà soát
                              </span>
                            ) : (
                              "Đã nhận diện mã trong khung"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {tab === "warnings" && (
              <div className="cm-dialog-body">
                <WarningList data={current.data} />
              </div>
            )}
            {tab === "history" && (
              <div className="cm-dialog-body">
                <h3>Lịch sử cập nhật</h3>
                <p>
                  Chọn một phiên bản để xem toàn bộ khung tại thời điểm đó.
                  Chỉnh sửa chỉ thực hiện trên bản hiện hành.
                </p>
                <div className="cm-history">
                  {current.history.map((h, i) => (
                    <div key={h.id}>
                      <div>
                        <strong>
                          Phiên bản {h.version}
                          {i === 0 ? " · Hiện hành" : ""}
                        </strong>
                        <p>{h.note}</p>
                        <small>{date(h.createdAt)}</small>
                      </div>
                      <button
                        className="am-outline"
                        disabled={h.id === current.revisionId}
                        onClick={() => {
                          setVersion(i === 0 ? "" : h.id);
                          setTab("courses");
                          setNotice("");
                        }}
                      >
                        Xem phiên bản
                      </button>
                    </div>
                  ))}
                </div>
                {current.events.length > 0 && (
                  <>
                    <h3>Lịch sử mở / khóa</h3>
                    {current.events.map((e, i) => (
                      <p key={i}>
                        {date(e.createdAt)} · {e.action}
                      </p>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          {edit === "import" && (
            <ImportDialog
              current={current}
              onClose={() => setEdit(null)}
              onSaved={saved}
            />
          )}
          {edit === "metadata" && (
            <MetadataDialog
              current={current}
              onClose={() => setEdit(null)}
              onSaved={saved}
            />
          )}
          {edit === "status" && (
            <StatusDialog
              current={current}
              onClose={() => setEdit(null)}
              onSaved={saved}
            />
          )}
          {groupAction && (
            <GroupCoursePicker
              data={current.data}
              groupId={groupAction.id}
              mode={groupAction.mode}
              onClose={() => setGroupAction(null)}
              onPick={(c) => actOnCourse(c, groupAction.mode)}
            />
          )}
          {course && courseMode === "delete" && (
            <DeleteCourseDialog
              current={current}
              course={course}
              onClose={() => setCourse(null)}
              onSaved={saved}
            />
          )}
          {course && courseMode !== "delete" && (
            <CourseDialog
              mode={courseMode}
              onDelete={() => setCourseMode("delete")}
              current={current}
              course={course}
              canManage={!!mutable}
              onClose={() => setCourse(null)}
              onSaved={saved}
            />
          )}
        </>
      )}
    </section>
  );
}

function Courses({
  data,
  open,
  onGroupAction,
}: {
  data: CurriculumData;
  open: (c: CurriculumCourse) => void;
  onGroupAction?: (id: string, mode: "add" | "edit" | "delete") => void;
}) {
  const { draft, setDraft, filters, reset } = useLiveFilters({
    q: "",
    block: "",
    specialty: "",
    semester: "",
  });
  const rows = data.courses.filter(
    (c) =>
      (!filters.q ||
        `${c.code} ${c.name} ${c.englishName}`
          .toLocaleLowerCase("vi")
          .includes(filters.q.toLocaleLowerCase("vi"))) &&
      (!filters.block || c.groupId === filters.block) &&
      (!filters.specialty || c.specialty === filters.specialty) &&
      (!filters.semester || String(c.semester) === filters.semester),
  );
  return (
    <>
      <div className="cm-filters">
        <label className="cm-search">
          Tìm học phần
          <input
            type="search"
            value={draft.q}
            placeholder="Mã hoặc tên học phần…"
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
          />
        </label>
        <label>
          Khối học phần
          <select
            value={draft.block}
            onChange={(e) => setDraft({ ...draft, block: e.target.value })}
          >
            <option value="">Tất cả khối</option>
            {data.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Chuyên ngành
          <select
            value={draft.specialty}
            onChange={(e) => setDraft({ ...draft, specialty: e.target.value })}
          >
            <option value="">Tất cả chuyên ngành</option>
            {[
              ...new Set(data.courses.map((c) => c.specialty).filter(Boolean)),
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Học kỳ
          <select
            value={draft.semester}
            onChange={(e) => setDraft({ ...draft, semester: e.target.value })}
          >
            <option value="">Tất cả</option>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                Học kỳ {n}
              </option>
            ))}
          </select>
        </label>
        <button className="am-outline" onClick={reset}>
          Xóa bộ lọc
        </button>
      </div>
      <p className="cm-result" role="status">
        {rows.length} / {data.courses.length} học phần
      </p>
      <div className="cm-table-scroll">
        <table className="cm-table cm-courses">
          <thead>
            <tr>
              <th>Mã học phần</th>
              <th>Tên học phần</th>
              <th>TC</th>
              <th>BB / TC</th>
              <th>Năm · HK</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {[
              ...data.groups,
              ...(data.courses.some(
                (c) => !data.groups.some((g) => g.id === c.groupId),
              )
                ? [{ id: "", label: "Học phần chưa phân khối" }]
                : []),
            ]
              .filter(
                (g) =>
                  (!filters.block || filters.block === g.id) &&
                  (rows.some((c) => c.groupId === g.id) ||
                    (!filters.q && !filters.specialty && !filters.semester)),
              )
              .map((g) => (
                <Fragment key={g.id}>
                  <tr className="cm-group-row">
                    <th colSpan={6}>
                      <div className="cm-group-heading">
                        <span>{g.label}</span>
                        {onGroupAction &&
                          g.id &&
                          !("isHeading" in g && g.isHeading) && (
                            <details
                              className="cm-group-actions"
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  e.currentTarget.open = false;
                                  e.currentTarget
                                    .querySelector("summary")
                                    ?.focus();
                                }
                              }}
                            >
                              <summary
                                title={`Thao tác ${g.label}`}
                                aria-label={`Thao tác ${g.label}`}
                              >
                                <Icon name="more" />
                              </summary>
                              <div className="cm-group-buttons">
                                {(
                                  [
                                    ["add", "Thêm môn học", "plus"],
                                    ["edit", "Chỉnh sửa môn học", "edit"],
                                    ["delete", "Xóa môn học", "trash"],
                                  ] as const
                                ).map(([mode, label, icon]) => (
                                  <button
                                    key={mode}
                                    type="button"
                                    className={mode === "delete" ? "am-outline am-tone-danger" : "am-outline"}
                                    disabled={
                                      mode !== "add" &&
                                      !data.courses.some(
                                        (c) => c.groupId === g.id,
                                      )
                                    }
                                    onClick={(e) => {
                                      const menu =
                                        e.currentTarget.closest("details");
                                      menu?.removeAttribute("open");
                                      menu?.querySelector("summary")?.focus();
                                      onGroupAction(g.id, mode);
                                    }}
                                  >
                                    <Icon name={icon} />
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </details>
                          )}
                      </div>
                    </th>
                  </tr>
                  {rows
                    .filter((c) => c.groupId === g.id)
                    .map((c) => (
                      <Fragment key={c.code}>
                        <tr>
                          <td>{c.code}</td>
                          <td>
                            <strong>{c.name}</strong>
                            <small>{c.englishName}</small>
                            {c.specialty && <small>{c.specialty}</small>}
                          </td>
                          <td>{c.credits}</td>
                          <td>{c.type || "—"}</td>
                          <td>
                            {c.studyYear ?? "—"} · {c.semester ?? "—"}
                          </td>
                          <td>
                            <button
                              className="am-outline"
                              onClick={() => open(c)}
                            >
                              Chi tiết
                            </button>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                </Fragment>
              ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="am-empty">Không có học phần phù hợp với bộ lọc.</p>
      )}
    </>
  );
}

function GroupCoursePicker({
  data,
  groupId,
  mode,
  onClose,
  onPick,
}: {
  data: CurriculumData;
  groupId: string;
  mode: "edit" | "delete";
  onClose: () => void;
  onPick: (course: CurriculumCourse) => void;
}) {
  const courses = data.courses.filter((c) => c.groupId === groupId);
  const [code, setCode] = useState(courses[0]?.code ?? "");
  return (
    <Modal
      title={
        mode === "edit"
          ? "Chỉnh sửa môn học trong khối"
          : "Xóa môn học trong khối"
      }
      onClose={onClose}
    >
      <form
        className="cm-dialog-body cm-form"
        onSubmit={(e) => {
          e.preventDefault();
          const course = courses.find((c) => c.code === code);
          if (course) onPick(course);
        }}
      >
        <p>{data.groups.find((g) => g.id === groupId)?.label}</p>
        <label>
          Môn học
          <select
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          >
            {courses.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>
        {!courses.length && <p>Khối chưa có môn học.</p>}
        <div className="cm-actions">
          <button type="button" className="am-outline" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" className="am-primary" disabled={!code}>
            Tiếp tục
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteCourseDialog({
  current,
  course,
  onClose,
  onSaved,
}: {
  current: CurriculumDetail;
  course: CurriculumCourse;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const references = current.data.relations.filter(
    (r) => r.courseCode !== course.code && r.targetCodes.includes(course.code),
  );
  return (
    <Modal title="Xóa môn học khỏi khung" onClose={onClose} busy={busy}>
      <div className="cm-dialog-body cm-form">
        <p>
          Bạn muốn xóa{" "}
          <strong>
            {course.code} · {course.name}
          </strong>{" "}
          khỏi phiên bản hiện hành?
        </p>
        <p>
          Phiên bản trước vẫn giữ môn này. Tổng tín chỉ quy định của khung không
          tự thay đổi.
        </p>
        {references.length > 0 && (
          <div className="cm-warning">
            <strong>
              Còn {references.length} điều kiện tham chiếu môn này
            </strong>
            <p>
              {[...new Set(references.map((r) => r.courseCode))].join(", ")}.
              Các điều kiện này sẽ được đánh dấu cần rà soát sau khi xóa.
            </p>
          </div>
        )}
        {error && (
          <p className="admin-error cm-prewrap" role="alert">
            {error}
          </p>
        )}
        <div className="cm-actions">
          <button
            type="button"
            className="am-outline"
            disabled={busy}
            onClick={onClose}
          >
            Hủy
          </button>
          <button
            type="button"
            className="am-primary am-delete"
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                await request(
                  `${endpoint}/${current.id}/courses/${encodeURIComponent(course.code)}`,
                  { method: "DELETE", headers: { "x-version": current.token } },
                );
                onSaved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Đang xóa…" : "Xác nhận xóa môn"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MetadataDialog({
  current,
  onClose,
  onSaved,
}: {
  current: CurriculumDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
      name: current.data.name,
      totalCredits: current.data.totalCredits,
      notes: current.data.notes,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Cập nhật thông tin khung CTĐT" onClose={onClose} busy={busy}>
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
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Tên chương trình
          <input
            required
            maxLength={500}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          Tổng tín chỉ quy định
          <input
            type="number"
            required
            min={1}
            max={400}
            value={form.totalCredits}
            onChange={(e) =>
              setForm({ ...form, totalCredits: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Ghi chú
          <textarea
            rows={4}
            maxLength={12000}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>
        <p className="cm-help">
          Ngành và khóa giữ nguyên để bảo toàn liên kết dữ liệu. Thêm, sửa hoặc
          xóa môn bằng menu … ở từng khối kiến thức.
        </p>
        {error && (
          <p className="admin-error cm-prewrap" role="alert">
            {error}
          </p>
        )}
        <div className="cm-actions">
          <button
            type="button"
            className="am-outline"
            disabled={busy}
            onClick={onClose}
          >
            Hủy
          </button>
          <button className="am-primary am-save" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu phiên bản mới"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function StatusDialog({
  current,
  onClose,
  onSaved,
}: {
  current: CurriculumDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={
        current.isActive
          ? "Khóa khung chương trình đào tạo"
          : "Mở khung chương trình đào tạo"
      }
      onClose={onClose}
      busy={busy}
      size="sm"
    >
      <div className="cm-dialog-body">
        <p>
          {current.isActive
            ? "Khung không còn được áp dụng cho lựa chọn mới. Dữ liệu và lịch sử vẫn được giữ để tra cứu."
            : "Khung được phép áp dụng trở lại."}
        </p>
        <strong>{current.data.name}</strong>
        {error && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
        <div className="cm-actions">
          <button className="am-outline" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button
            className={current.isActive ? "am-primary am-warning" : "am-primary am-save"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await request(`${endpoint}/${current.id}/status`, {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    "x-version": current.token,
                  },
                  body: JSON.stringify({ isActive: !current.isActive }),
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
        </div>
      </div>
    </Modal>
  );
}

function CourseDialog({
  mode = "view",
  onDelete,
  current,
  course,
  canManage,
  onClose,
  onSaved,
}: {
  mode?: "view" | "edit" | "add";
  onDelete: () => void;
  current: CurriculumDetail;
  course: CurriculumCourse;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [credits, setCredits] = useState(
    mode === "add" ? "" : String(course.credits),
  );
  const [form, setForm] = useState(course),
    [editing, setEditing] = useState(mode !== "view"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const fields = [
    ["code", "Mã học phần"],
    ["name", "Tên học phần"],
    ["englishName", "Tên tiếng Anh"],
    ["type", "Loại (BB, BBKTL, TC…)"],
    ["specialty", "Chuyên ngành"],
    ["departmentCode", "Mã bộ môn"],
    ["department", "Bộ môn"],
  ] as const;
  async function save() {
    if (busy || !editing || !canManage || credits.trim() === "") return;
    setBusy(true);
    setError("");
    const { position, sourceRow, sourceSheet, sourceCells, ...change } = form;
    void position;
    void sourceRow;
    void sourceSheet;
    void sourceCells;
    change.credits = Number(credits);
    try {
      await request(
        `${endpoint}/${current.id}/courses${mode === "add" ? "" : "/" + encodeURIComponent(course.code)}`,
        {
          method: mode === "add" ? "POST" : "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-version": current.token,
          },
          body: JSON.stringify(change),
        },
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        mode === "add"
          ? "Thêm môn học"
          : editing
            ? "Chỉnh sửa môn học"
            : course.name
      }
      onClose={onClose}
      busy={busy}
    >
      <form
        className="cm-dialog-body cm-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {editing ? (
          <>
            <p>
              Chỉ bắt buộc Mã học phần, Tên học phần và Số tín chỉ. Các thông
              tin còn lại có thể bổ sung sau.
            </p>
            <div className="cm-form-grid">
              <label>
                Khối kiến thức
                <select
                  required
                  value={form.groupId}
                  onChange={(e) =>
                    setForm({ ...form, groupId: e.target.value })
                  }
                >
                  <option value="" disabled>
                    Chọn khối kiến thức
                  </option>
                  {current.data.groups
                    .filter((g) => !g.isHeading)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                </select>
              </label>
              {fields.map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    maxLength={500}
                    required={["code", "name"].includes(key)}
                    value={form[key]}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label>
                Số tín chỉ
                <input
                  type="number"
                  min={0}
                  max={30}
                  step="0.5"
                  required
                  value={credits}
                  onChange={(e) => setCredits(e.target.value)}
                />
              </label>
              <label>
                Học kỳ
                <select
                  value={form.semester ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      semester: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">Chưa xác định</option>
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      Học kỳ {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Năm học dự kiến
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={form.studyYear ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      studyYear: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </label>
            </div>
            <div className="cm-form-grid">
              {(
                [
                  ["lecture", "Giờ lý thuyết"],
                  ["practice", "Giờ thực hành"],
                  ["project", "Giờ đồ án"],
                  ["internship", "Giờ thực tập"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
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
                          [key]: e.target.value ? Number(e.target.value) : null,
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            {(
              [
                ["description", "Mô tả học phần"],
                ["prerequisite", "Điều kiện tiên quyết"],
                ["prior", "Học phần học trước"],
                ["notes", "Ghi chú"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <textarea
                  maxLength={12000}
                  rows={3}
                  value={form[key] ?? ""}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            <p className="cm-help">
              Có thể ghi mã học phần trong dấu ngoặc vuông, ví dụ [71ITSE30503].
              Điều kiện theo chuyên ngành hoặc quy định sẽ được giữ nguyên để rà
              soát.
            </p>
          </>
        ) : (
          <>
            <div className="cm-detail-grid">
              <div>
                <span>Khối kiến thức</span>
                <strong>
                  {current.data.groups.find((g) => g.id === course.groupId)
                    ?.label ?? course.block}
                </strong>
              </div>
              {fields.map(([key, label]) => (
                <div key={key}>
                  <span>{label}</span>
                  <strong>{course[key] || "Chưa xác định"}</strong>
                </div>
              ))}
              <div>
                <span>Tín chỉ</span>
                <strong>{course.credits}</strong>
              </div>
              <div>
                <span>Kế hoạch học</span>
                <strong>
                  Năm {course.studyYear ?? "—"} · Học kỳ{" "}
                  {course.semester ?? "—"}
                </strong>
              </div>
              <div>
                <span>Giờ LT / TH / ĐA / TT</span>
                <strong>
                  {Object.values(course.hours)
                    .map((v) => v ?? "—")
                    .join(" / ")}
                </strong>
              </div>
            </div>
            {(
              [
                ["description", "Mô tả học phần"],
                ["prerequisite", "Tiên quyết"],
                ["prior", "Học trước"],
                ["notes", "Ghi chú"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <h3>{label}</h3>
                <p className="cm-prewrap">
                  {course[key] || "Không ghi trong khung"}
                </p>
              </div>
            ))}
            <details>
              <summary>
                {course.sourceRow > 0
                  ? `Dữ liệu Excel gốc · ${course.sourceSheet}, dòng ${course.sourceRow}`
                  : "Môn được thêm trực tiếp trong khung"}
              </summary>
              <dl className="cm-source">
                {Object.entries(course.sourceCells).map(([col, value]) => (
                  <div key={col}>
                    <dt>Cột {col}</dt>
                    <dd>{value || "—"}</dd>
                  </div>
                ))}
              </dl>
              <p className="cm-help">
                Giữ nguyên bản nguồn để đối chiếu với các lần chỉnh sửa.
              </p>
            </details>
          </>
        )}
        {error && (
          <p role="alert" className="admin-error cm-prewrap">
            {error}
          </p>
        )}
        <div className="cm-actions">
          <button
            className="am-outline"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Đóng
          </button>
          {canManage && mode !== "add" && (
            <button
              type="button"
              className="am-outline am-tone-danger cm-delete"
              disabled={busy}
              onClick={onDelete}
            >
              <Icon name="trash" />
              Xóa môn học
            </button>
          )}
          {canManage &&
            (editing ? (
              <button
                key="save-course"
                type="submit"
                className="am-primary am-save"
                disabled={busy}
              >
                {busy ? "Đang lưu…" : "Lưu phiên bản mới"}
              </button>
            ) : (
              <button
                key="edit-course"
                className="am-primary"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setEditing(true);
                }}
              >
                Chỉnh sửa học phần
              </button>
            ))}
        </div>
      </form>
    </Modal>
  );
}
