import { useEffect, useState } from "react";
import { useData, Status, Pagination, Modal } from "./admin-ui";
import "./student-profiles.css";

type ProfileStatus = "missing" | "incomplete" | "complete";
type Student = { id: string; name: string; email: string | null; isActive: boolean; studentCode: string | null; cohortCode: string | null; className: string | null; cohortYear: number | null; currentSemester: number | null; profileStatus: ProfileStatus };
type StudentDetail = Student & { username: string | null; careerGoal: string | null; accountCreatedAt: string; firstLoginAt: string; lastLoginAt: string; profileCreatedAt: string | null; profileUpdatedAt: string | null };
type StudentPage = { items: Student[]; total: number; cohortYears: number[] };
const statusLabels: Record<ProfileStatus, string> = { missing: "Chưa có hồ sơ", incomplete: "Chưa hoàn tất", complete: "Đã hoàn tất" };
const emptyFilters = { q: "", cohortYear: "", semester: "", active: "", profileStatus: "" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Chưa có dữ liệu";

function ProfileBadge({ status }: { status: ProfileStatus }) {
  return <span className={`sp-badge sp-badge-${status}`}>{statusLabels[status]}</span>;
}
function StudentDetails({ id }: { id: string }) {
  const state = useData<{ student: StudentDetail }>(`/api/admin/students/${id}`);
  const student = state.data?.student;
  return <><Status {...state} />{student && <div className="sp-detail">
    <div className="sp-detail-heading"><span className="am-avatar" aria-hidden="true">{student.name.slice(0, 1)}</span><div><h3>{student.name}</h3><p>{student.studentCode ? `MSSV: ${student.studentCode}` : "Chưa cập nhật mã sinh viên"}</p></div><ProfileBadge status={student.profileStatus} /></div>
    {student.profileStatus === "missing" && <p className="sp-note">Tài khoản sinh viên đã có trong EduPath nhưng chưa có bản ghi hồ sơ. Các trường học tập bên dưới chưa được cung cấp.</p>}
    <h3>Thông tin cá nhân và học tập</h3>
    <dl className="am-detail-grid">{Object.entries({ "Họ và tên": student.name, "Mã sinh viên": student.studentCode, "Email": student.email, "Tên đăng nhập": student.username, "Khóa học": student.cohortCode, "Lớp học": student.className, "Năm nhập học": student.cohortYear, "Học kỳ hiện tại": student.currentSemester, "Trạng thái tài khoản": student.isActive ? "Đang hoạt động" : "Đã khóa", "Trạng thái hồ sơ": statusLabels[student.profileStatus] }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "Chưa cập nhật"}</dd></div>)}</dl>
    <h3>Mục tiêu nghề nghiệp</h3><p className="sp-career-goal">{student.careerGoal?.trim() || "Sinh viên chưa cập nhật mục tiêu nghề nghiệp."}</p>
    <h3>Thông tin cập nhật</h3><dl className="am-detail-grid">{Object.entries({ "Tạo tài khoản EduPath": date(student.accountCreatedAt), "Đăng nhập đầu tiên": date(student.firstLoginAt), "Đăng nhập gần nhất": date(student.lastLoginAt), "Tạo hồ sơ": date(student.profileCreatedAt), "Cập nhật hồ sơ gần nhất": date(student.profileUpdatedAt) }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className="sp-note"></p>
  </div>}</>;
}

export default function StudentProfiles() {
  const [draft, setDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Student | null>(null);
  const [cohortYears, setCohortYears] = useState<number[]>([]);
  const params = new URLSearchParams({ page: String(page), pageSize: "10" });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const state = useData<StudentPage>(`/api/admin/students?${params}`);
  useEffect(() => { if (state.data) setCohortYears(state.data.cohortYears); }, [state.data]);
  const filtered = Object.values(filters).some(Boolean);
  return <><section className="am-card" aria-labelledby="student-list-title">
    <div className="am-card-heading"><div><h2 id="student-list-title">Danh sách sinh viên {state.data && <span className="am-count">{state.data.total}</span>}</h2><p>Tra cứu thông tin cá nhân, học tập và mục tiêu nghề nghiệp của sinh viên.</p></div><span className="sp-readonly">Chỉ xem hồ sơ</span></div>
    <form className="am-filters sp-filters" onSubmit={(event) => { event.preventDefault(); setFilters({ ...draft, q: draft.q.trim() }); setPage(1); state.retry(); }}>
      <label className="sp-search" htmlFor="student-search">Từ khóa<input id="student-search" maxLength={120} value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} placeholder="MSSV, họ tên, email, khóa, lớp, mục tiêu…" /></label>
      <label htmlFor="student-cohort">Năm nhập học<select id="student-cohort" value={draft.cohortYear} onChange={(e) => setDraft({ ...draft, cohortYear: e.target.value })}><option value="">Tất cả năm</option>{cohortYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
      <label htmlFor="student-semester">Học kỳ hiện tại<select id="student-semester" value={draft.semester} onChange={(e) => setDraft({ ...draft, semester: e.target.value })}><option value="">Tất cả học kỳ</option>{Array.from({ length: 3 }, (_, i) => <option key={i + 1} value={i + 1}>Học kỳ {i + 1}</option>)}</select></label>
      <label htmlFor="student-profile-status">Trạng thái hồ sơ<select id="student-profile-status" value={draft.profileStatus} onChange={(e) => setDraft({ ...draft, profileStatus: e.target.value })}><option value="">Tất cả hồ sơ</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label htmlFor="student-active">Trạng thái tài khoản<select id="student-active" value={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.value })}><option value="">Tất cả tài khoản</option><option value="true">Đang hoạt động</option><option value="false">Đã khóa</option></select></label>
      <div className="sp-filter-actions"><button className="am-primary" type="submit">Tìm kiếm / Lọc</button><button className="am-outline" type="button" onClick={() => { setFilters(emptyFilters); setDraft(emptyFilters); setPage(1); state.retry(); }}>Xóa bộ lọc</button></div>
    </form>
    <Status {...state} />{state.data && <><div className="am-table-scroll" tabIndex={0} role="region" aria-label="Bảng hồ sơ sinh viên, cuộn ngang trên màn hình nhỏ"><table className="am-table sp-table"><thead><tr><th scope="col">STT</th><th scope="col">Sinh viên</th><th scope="col">Mã sinh viên</th><th scope="col">Khóa học</th><th scope="col">Lớp học</th><th scope="col">Năm nhập học</th><th scope="col">Học kỳ</th><th scope="col">Hồ sơ</th><th scope="col">Tài khoản</th><th scope="col">Thao tác</th></tr></thead><tbody>{state.data.items.map((student, index) => <tr key={student.id}><td>{(page - 1) * 10 + index + 1}</td><td><div className="am-person"><span className="am-avatar" aria-hidden="true">{student.name.slice(0, 1)}</span><div><button className="am-name-link" onClick={() => setSelected(student)}>{student.name}</button><small>{student.email ?? "Chưa có email"}</small></div></div></td><td>{student.studentCode ?? "Chưa cập nhật"}</td><td>{student.cohortCode ?? "—"}</td><td>{student.className ?? "—"}</td><td>{student.cohortYear ?? "—"}</td><td>{student.currentSemester ?? "—"}</td><td><ProfileBadge status={student.profileStatus} /></td><td><span className={`am-state ${student.isActive ? "" : "am-state-locked"}`}>{student.isActive ? "Đang hoạt động" : "Đã khóa"}</span></td><td><button className="am-outline" onClick={() => setSelected(student)}>Xem hồ sơ</button></td></tr>)}</tbody></table></div>
      {!state.data.items.length && <div className="am-empty"><h3>{filtered ? "Không tìm thấy hồ sơ phù hợp" : "Chưa có sinh viên trong danh sách"}</h3><p>{filtered ? "Thử từ khóa khác hoặc xóa bộ lọc." : "Danh sách sẽ hiển thị khi có tài khoản mang vai trò Sinh viên trong hệ thống."}</p></div>}
      <Pagination total={state.data.total} page={page} setPage={setPage} /></>}
    <p className="am-table-note"></p>
  </section>{selected && <Modal title="Chi tiết hồ sơ sinh viên" onClose={() => setSelected(null)}><StudentDetails id={selected.id} /></Modal>}</>;
}
