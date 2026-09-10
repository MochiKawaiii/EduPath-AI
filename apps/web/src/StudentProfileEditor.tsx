import { useEffect, useState, type FormEvent } from "react";
import "./student-records.css";

export type EditableStudentProfile = { className: string | null; interests: string | null; careerGoal: string | null; currentSemester: number | null };
export default function StudentProfileEditor({ profile, onSaved }: { profile: EditableStudentProfile; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ className: "", interests: "", careerGoal: "", currentSemester: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (!editing) setDraft({ className: profile.className ?? "", interests: profile.interests ?? "", careerGoal: profile.careerGoal ?? "", currentSemester: profile.currentSemester?.toString() ?? "" }); }, [profile, editing]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/student/profile", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, currentSemester: draft.currentSemester ? Number(draft.currentSemester) : null }) });
      if (!response.ok) throw new Error(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : response.status === 400 ? "Thông tin chưa hợp lệ. Lớp tối đa 32 ký tự, sở thích và mục tiêu tối đa 2.000 ký tự." : "Không lưu được hồ sơ. Vui lòng thử lại.");
      setMessage("Đã cập nhật thông tin cá nhân."); setEditing(false); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể lưu hồ sơ."); }
    finally { setBusy(false); }
  };
  return <section className="sw-panel sr-editor"><div className="sw-section-heading"><h2>Thông tin cá nhân</h2>{!editing && <button className="sw-text-link" onClick={() => { setEditing(true); setMessage(""); setError(""); }}>Chỉnh sửa thông tin</button>}</div>
    {message && <p className="sr-success" role="status">{message}</p>}{error && <p className="sr-error" role="alert">{error}</p>}
    {editing ? <form onSubmit={event => void save(event)}><fieldset disabled={busy} className="sr-form-fields"><label>Lớp học<input maxLength={32} value={draft.className} onChange={e => setDraft({ ...draft, className: e.target.value })} placeholder="Ví dụ: CNTT08" /></label><label>Học kỳ hiện tại<select value={draft.currentSemester} onChange={e => setDraft({ ...draft, currentSemester: e.target.value })}><option value="">Chưa cập nhật</option>{Array.from({ length: 20 }, (_, i) => <option key={i} value={i + 1}>Học kỳ {i + 1}</option>)}</select></label><label className="sr-wide">Sở thích<textarea rows={3} maxLength={2000} value={draft.interests} onChange={e => setDraft({ ...draft, interests: e.target.value })} placeholder="Lĩnh vực công nghệ, hoạt động bạn quan tâm…" /></label><label className="sr-wide">Mục tiêu nghề nghiệp<textarea rows={3} maxLength={2000} value={draft.careerGoal} onChange={e => setDraft({ ...draft, careerGoal: e.target.value })} placeholder="Bạn muốn phát triển theo hướng nào?" /></label></fieldset><p className="sw-muted">Họ tên, MSSV, khóa và năm nhập học được lấy từ hồ sơ tài khoản. Liên hệ quản trị viên nếu cần điều chỉnh.</p><div className="sr-actions"><button className="sw-primary" disabled={busy}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button><button className="sr-secondary" type="button" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>Hủy</button></div></form> : <dl className="sr-personal"><div><dt>Sở thích</dt><dd>{profile.interests || "Chưa cập nhật sở thích."}</dd></div><div><dt>Mục tiêu nghề nghiệp</dt><dd>{profile.careerGoal || "Chưa cập nhật mục tiêu nghề nghiệp."}</dd></div></dl>}
  </section>;
}
