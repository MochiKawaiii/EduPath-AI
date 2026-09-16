import { canAccessAdmin } from "./types";
import { useCallback, useEffect, useState } from "react";
import EduPathBrand from "./EduPathBrand";
import { beginMicrosoftLogin, logout } from "./auth-api";
import type { AuthenticatedUser } from "./types";
import "./admin.css";
import AdminWorkspace from "./AdminWorkspace";

const messages: Record<string, string> = {
  microsoft_denied: "Bạn đã hủy hoặc Microsoft từ chối đăng nhập. Bạn có thể thử lại.",
  invalid_state: "Phiên xác thực đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.",
  missing_code: "Microsoft chưa trả về mã xác thực. Vui lòng thử lại.",
  callback_failed: "Không thể hoàn tất đăng nhập. Hãy thử lại hoặc liên hệ người quản lý hệ thống.",
  admin_required: "Tài khoản này chưa được cấp quyền quản trị EduPath AI. Vui lòng sử dụng tài khoản có quyền Admin."
};

function ShieldIcon() {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="m16 3 11 4v9c0 6-6 11-11 13C11 27 5 22 5 16V7l11-4Z" stroke="currentColor" strokeWidth="1.8" />
    <path d="m11 16 3.5 3.5L22 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

type AdminState =
  | { kind: "loading" | "login" | "forbidden" | "error" }
  | { kind: "authenticated"; user: AuthenticatedUser };

export default function AdminPortal() {
  const [state, setState] = useState<AdminState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [authError] = useState(() => {
    const code = new URLSearchParams(window.location.search).get("authError");
    return code ? messages[code] ?? messages.callback_failed : null;
  });

  useEffect(() => {
    document.title = "EduPath AI – Cổng quản trị";
    const controller = new AbortController();
    setState({ kind: "loading" });
    void fetch("/api/admin/me", {
      credentials: "include", headers: { Accept: "application/json" },
      cache: "no-store", signal: controller.signal
    }).then(async (response) => {
      if (response.status === 401) return { kind: "login" } as const;
      if (response.status === 403) return { kind: "forbidden" } as const;
      if (!response.ok) throw new Error("Admin API unavailable");
      const data = await response.json();
      if (!data.authenticated || (!data.user || !canAccessAdmin(data.user.role))) return { kind: "forbidden" } as const;
      return { kind: "authenticated", user: data.user as AuthenticatedUser } as const;
    }).then((result) => {
      if (!controller.signal.aborted) {
        setState(result);
        if (result.kind === "authenticated" && window.location.search) window.history.replaceState({}, "", window.location.pathname);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setState({ kind: "error" });
    });
    // Recheck a page restored by browser Back; never trust a cached admin view.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setBusy(false);
        setAttempt((value) => value + 1);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    const onSessionExpired = () => { setBusy(false); setAttempt((value) => value + 1); };
    window.addEventListener("edupath-session-expired", onSessionExpired);
    return () => {
      controller.abort();
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("edupath-session-expired", onSessionExpired);
    };
  }, [attempt]);

  const handleLogout = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await logout("admin");
    } catch {
      setActionError("Chưa thể hoàn tất đăng xuất. Vui lòng kiểm tra kết nối và thử lại.");
      setBusy(false);
    }
  }, []);

  const signedIn = state.kind === "authenticated";
  const error = actionError ?? (state.kind === "forbidden" ? messages.admin_required : authError);

  if (state.kind === "authenticated") return <AdminWorkspace user={state.user} busy={busy} error={actionError} onLogout={() => void handleLogout()} />;

  return <div className={`admin-shell${signedIn ? " admin-shell-signed-in" : ""}`}>
    <header className="admin-header">
      <EduPathBrand />
      <img className="admin-university-logo" src="/vlu-logo-horizontal.png" alt="Trường Đại học Văn Lang" width="225" height="57" />
    </header>

    <main className="admin-login-layout">
      <section className="admin-intro" aria-labelledby="admin-intro-title">
        <p className="admin-eyebrow">EDUPATH AI / QUẢN TRỊ VIÊN</p>
        <h1 id="admin-intro-title">Một nền tảng.<br />Kết nối hành trình<br /><em>học tập.</em></h1>
        <p>Không gian quản trị dành cho đội ngũ vận hành hệ thống đánh giá năng lực và tư vấn lộ trình học tập.</p>
        <div className="admin-intro-rule" />
        <div className="admin-access-note"><ShieldIcon /><div><strong>Truy cập có phân quyền</strong><p>Chỉ dành cho tài khoản được cấp quyền quản trị EduPath AI.</p></div></div>
        <span className="admin-intro-caption">KHOA CÔNG NGHỆ THÔNG TIN · ĐẠI HỌC VĂN LANG</span>
      </section>
      <section className="admin-login-panel" aria-labelledby="admin-login-title">
        <div className="admin-login-form">
          <span className="admin-lock"><ShieldIcon /></span>
          <p className="admin-eyebrow">DÀNH CHO QUẢN TRỊ VIÊN</p>
          <h2 id="admin-login-title">Đăng nhập quản trị</h2>
          <p className="admin-login-description">Sử dụng tài khoản Microsoft đã được cấp quyền để truy cập trang quản trị.</p>
          {error && <p className="admin-error" role="alert">{error}</p>}
          {state.kind === "loading" ? <p className="admin-loading" role="status">Đang kiểm tra phiên quản trị…</p>
            : state.kind === "error" ? <div><p className="admin-error" role="alert">Không thể kết nối máy chủ. Vui lòng thử lại.</p><button className="admin-secondary" onClick={() => setAttempt((value) => value + 1)}>Thử lại kết nối</button></div>
              : state.kind === "forbidden" ? <button className="admin-primary" disabled={busy} onClick={() => void handleLogout()}>{busy ? "Đang đăng xuất…" : "Đăng xuất để đổi tài khoản"}</button>
                : <button className="admin-primary" disabled={busy} onClick={() => { setBusy(true); beginMicrosoftLogin("/quantri"); }}>
                  <span className="microsoft-icon" aria-hidden="true"><i /><i /><i /><i /></span>
                  {busy ? "Đang chuyển đến Microsoft…" : "Đăng nhập bằng Microsoft"}
                </button>}
          <div className="admin-login-divider"><span><b>Đăng nhập với tài khoản Văn Lang</b></span></div>
          <p className="admin-login-help">Chưa có quyền truy cập?<br />Vui lòng liên hệ người quản lý hệ thống để được cấp quyền.</p>
        </div>
        <p className="admin-panel-caption">EduPath AI · Cổng quản lý học tập thông minh</p>
      </section>
    </main>
    <footer className="admin-footer">© 2026 · Bản Quyền Thuộc Khoa Công nghệ Thông tin · Trường Đại Học Văn Lang.</footer>
  </div>;
}
