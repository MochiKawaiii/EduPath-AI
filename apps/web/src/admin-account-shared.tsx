import { useEffect, useRef, useState, type FormEvent } from "react";
const failures: Record<string, string> = {
  student_not_found: "Không tìm thấy sinh viên hoặc tài khoản không còn mang vai trò Sinh viên.",
  self_change_forbidden: "Không thể tự thay đổi quyền hoặc khóa tài khoản đang sử dụng.",
  account_not_found: "Không tìm thấy tài khoản trong hệ thống.",
  invalid_query: "Bộ lọc hoặc khoảng ngày chưa hợp lệ.",
  account_not_registered: "Chưa tìm thấy tài khoản. Người dùng cần đăng nhập EduPath bằng Microsoft ít nhất một lần trước khi được thêm làm quản trị viên.",
  already_admin: "Tài khoản này đã là quản trị viên. Không cần tạo lại.",
  account_locked: "Tài khoản đang bị khóa. Không thể thêm làm quản trị viên.",
  ambiguous_account: "Email trùng với nhiều danh tính. Cần kiểm tra dữ liệu trước khi cấp quyền.",
  insufficient_role: "Bạn không còn quyền thực hiện thao tác này. Hãy đăng xuất và kiểm tra lại tài khoản.",
  database_required: "Chức năng quản lý tài khoản cần kết nối PostgreSQL; hiện đang ở chế độ xem thử.",
  invalid_input: "Email hoặc xác nhận quyền quản trị chưa hợp lệ.",
  invalid_origin: "Yêu cầu không hợp lệ. Vui lòng tải lại trang rồi thử lại.",
  authentication_required: "Phiên đăng nhập đã hết hạn. Vui lòng đăng xuất và đăng nhập lại."
};
export type Account = { id: string; name: string; email: string | null; username: string | null; role: "admin" | "student"; isActive: boolean; lastLoginAt: string };
export type AccountPage = { items: Account[]; total: number; page: number; pageSize: number };

export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    add: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M20 8v6M17 11h6",
    profile: "M4 3h16v18H4zM9 8a3 3 0 1 0 6 0 3 3 0 1 0-6 0M7 18a5 5 0 0 1 10 0",
    shield: "m12 3 9 3v6c0 5-5 8-9 10-4-2-9-5-9-10V6zM8 12l3 3 5-6",
    lock: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4M12 14v3",
    clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 6v6l4 2",
    search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    exit: "M9 21H3V3h6M10 12h12M18 8l4 4-4 4",
    menu: "M3 6h18M3 12h18M3 18h18"
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.users} /></svg>;
}

export async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("edupath-session-expired"));
    const data = await response.json().catch(() => ({}));
    throw new Error(failures[data.error] ?? "Không thể kết nối hệ thống. Vui lòng thử lại.");
  }
  return response.json();
}

export function CreateAccount({ onList, onBusy }: { onList: () => void; onBusy?: (busy: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusy?.(busy); }, [busy, onBusy]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Account | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await fetch("/api/admin/accounts", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim().toLowerCase(), confirmAdmin: confirmed }) }).then(readResponse<{ user: Account }>);
      setCreated(result.user);
    } catch (err) { setError(err instanceof Error ? err.message : "Không thể tạo tài khoản."); }
    finally { setBusy(false); }
  }
  return <div className="am-create-layout"><section className="am-card am-create-card"><p className="admin-eyebrow">TÀI KHOẢN MICROSOFT · EDUPATH AI</p><h2>Thêm quản trị viên</h2><p>Thêm một người dùng đã xác thực vào đội ngũ quản trị.</p>
    {created ? <div className="am-success" role="status"><Icon name="shield" /><h3>Đã thêm quản trị viên</h3><p><strong>{created.name}</strong><br />{created.email ?? created.username}</p><p>Người dùng cần đăng xuất và đăng nhập lại tại <code>/quantri</code> để nhận quyền mới.</p><button className="am-primary" onClick={onList}>Xem danh sách tài khoản</button></div>
      : <form onSubmit={(event) => void submit(event)}>
        {error && <p ref={errorRef} tabIndex={-1} className="admin-error" role="alert">{error}</p>}
        <label className="am-field" htmlFor="new-admin-email">Email Microsoft <span aria-hidden="true">*</span><input id="new-admin-email" type="email" autoComplete="off" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ten@vanlanguni.vn" aria-describedby="new-admin-help" disabled={busy} /></label>
        <p id="new-admin-help" className="am-field-help">Tài khoản phải từng đăng nhập EduPath bằng Microsoft, không giới hạn tổ chức hoặc tên miền email.</p>
        <label className="am-field">Vai trò được cấp<input readOnly value="Quản trị viên" /></label>
        <label className="am-confirm"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} /><span>Tôi xác nhận cấp quyền quản trị EduPath AI cho tài khoản trên.</span></label>
        <div className="am-form-actions"><button className="am-primary" type="submit" disabled={busy}>{busy ? "Đang tạo…" : "Tạo tài khoản quản trị"}</button><button className="am-quiet" type="button" onClick={onList} disabled={busy}>Hủy</button></div>
      </form>}
  </section><aside className="am-create-note"><Icon name="shield" /><h3>Cấp đúng quyền.<br />Đúng người dùng.</h3><p>Quản trị viên có thể truy cập khu vực quản trị và thêm quản trị viên khác.</p><hr /><h4>Không cần tạo mật khẩu</h4><p>Người dùng tiếp tục đăng nhập bằng Microsoft. Thao tác này không tạo hộp thư hay tài khoản mới trên hệ thống của trường.</p><h4>Email chưa có trong hệ thống?</h4><p>Nhờ người dùng đăng nhập EduPath một lần trước, rồi quay lại thêm quyền quản trị.</p></aside></div>;
}
