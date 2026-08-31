import { useCallback, useEffect, useMemo, useState } from "react";
import { beginMicrosoftLogin, getCurrentUser, logout } from "./auth-api";
import type { AuthResponse, AuthenticatedUser } from "./types";

const errorMessages: Record<string, string> = {
  microsoft_denied: "Bạn đã hủy hoặc Microsoft từ chối yêu cầu đăng nhập.",
  invalid_state: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.",
  missing_code: "Microsoft không trả về mã đăng nhập hợp lệ.",
  callback_failed:
    "Không thể hoàn tất đăng nhập. Hãy kiểm tra quyền tài khoản và thử lại."
};

function getAuthError(): string | null {
  const code = new URLSearchParams(window.location.search).get("authError");
  return code ? (errorMessages[code] ?? "Đăng nhập không thành công.") : null;
}

function safeReturnTo(): string {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

function EduPathLogo() {
  return (
    <svg
      className="edupath-symbol"
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M31.5 5 55 14.2v18.4c0 13.7-8.8 22.1-23.5 27.1C16.8 54.7 8 46.3 8 32.6V14.2L31.5 5Z"
        fill="#0a397e"
      />
      <path
        d="m31.5 12.2 16.3 6.2v13.3c0 9.5-5.5 15.5-16.3 20-10.8-4.5-16.3-10.5-16.3-20V18.4l16.3-6.2Z"
        fill="#f7fbff"
      />
      <path
        d="M22 25.5 31.5 30l9.5-4.5v10.7l-9.5 4.6-9.5-4.6V25.5Z"
        fill="#2c68b4"
      />
      <path
        d="m18.5 23.6 13-6.1 13 6.1-13 6.2-13-6.2Zm22.1 5.1v8.7"
        fill="none"
        stroke="#0a397e"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3.4"
      />
      <path
        d="m50.5 6.2 1.6 3.7 3.8 1.6-3.8 1.6-1.6 3.8-1.6-3.8-3.8-1.6 3.8-1.6 1.6-3.7ZM58 17.8l.9 2.2 2.2.9-2.2.9L58 24l-.9-2.2-2.2-.9 2.2-.9.9-2.2Z"
        fill="#d5a44a"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <span className="microsoft-icon" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function AcademicCapIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="m3.5 12.5 12.5-6 12.5 6L16 18.4 3.5 12.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M8.5 15.2v6.3c4.7 3.4 10.3 3.4 15 0v-6.3M28.5 13v7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9.4 9a2.8 2.8 0 1 1 4.6 2.1c-1.1.9-2 1.5-2 3M12 18h.01"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function DecorativeWaves() {
  return (
    <svg
      className="decorative-waves"
      viewBox="0 0 1600 250"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M0 149C173 93 337 225 541 205c205-20 310-123 493-77 182 46 314 65 566-29v151H0V149Z"
        fill="rgba(16, 71, 164, .80)"
      />
      <path
        d="M964 250c87-126 183-180 286-167 103 13 207 71 350 17v150H964Z"
        fill="#073985"
      />
      <path
        d="M0 142c178-50 344 73 539 53 199-21 319-121 502-75 184 46 313 66 559-29"
        fill="none"
        stroke="#e4ac45"
        strokeWidth="3"
      />
      <path
        d="M1142 207c99-36 220-42 458-11"
        fill="none"
        stroke="rgba(255,255,255,.25)"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function LoginPage({ error }: { error: string | null }) {
  return (
    <main className="auth-shell">
      <header className="login-header">
        <a className="login-brand" href="/" aria-label="EduPath AI - Trang đăng nhập">
          <EduPathLogo />
          <span className="brand-wordmark">
            <strong>
              EduPath <em>AI</em>
            </strong>
            <small>AI đồng hành · Học tập bứt phá</small>
          </span>
        </a>

        <nav className="login-navigation" aria-label="Điều hướng trang đăng nhập">
          <a href="#login-title">Giới thiệu</a>
          <a href="#login-description">Tính năng</a>
          <a href="#login-help">Hỗ trợ</a>
          <a
            className="help-link"
            href="#login-help"
            aria-label="Trợ giúp đăng nhập"
            title="Trợ giúp đăng nhập"
          >
            <HelpIcon />
          </a>
        </nav>
      </header>

      <section className="auth-content" aria-labelledby="login-title">
        <div className="login-card" id="login-card">
          <img
            className="vlu-logo"
            src="/vlu-logo.png"
            alt="Logo Trường Đại học Văn Lang"
          />

          <h1 id="login-title">Chào mừng trở lại</h1>
          <p id="login-description" className="login-description">
            Đăng nhập để xem năng lực, lộ trình học tập
            <br className="desktop-break" /> và gợi ý nghề nghiệp của bạn
          </p>

          <div className="gold-divider" aria-hidden="true">
            <span />
            <i>✦</i>
            <span />
          </div>

          {error ? (
            <div className="error-banner" role="alert">
              {error}
            </div>
          ) : null}

          <button
            className="microsoft-button"
            type="button"
            aria-describedby="login-help login-security"
            onClick={() => beginMicrosoftLogin("/dashboard")}
          >
            <MicrosoftIcon />
            <span>Đăng nhập bằng Microsoft</span>
          </button>

          <p id="login-help" className="login-help">
            Hỗ trợ đăng nhập bằng tài khoản Microsoft của VLU
          </p>
          <p id="login-security" className="sr-only">
            EduPath AI không nhận hoặc lưu mật khẩu Microsoft của bạn.
          </p>

          <div className="student-badge">
            <span className="student-badge-icon">
              <AcademicCapIcon />
            </span>
            <strong>Dành cho sinh viên Văn Lang</strong>
          </div>
        </div>
      </section>

      <DecorativeWaves />
    </main>
  );
}

function Dashboard({
  user,
  onLogout
}: {
  user: AuthenticatedUser;
  onLogout: () => void;
}) {
  const roleLabel = user.role === "admin" ? "Quản trị viên" : "Sinh viên";
  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <EduPathLogo />
          <div>
            <strong>EduPath AI</strong>
            <span>Learning intelligence</span>
          </div>
        </div>
        <button className="text-button" type="button" onClick={onLogout}>
          Đăng xuất
        </button>
      </header>

      <section className="dashboard-content">
        <p className="eyebrow dark">Đăng nhập thành công</p>
        <h1>Xin chào, {user.name}</h1>
        <p className="muted large">
          Tài khoản Microsoft đã được xác thực và phiên đăng nhập an toàn đã được tạo.
        </p>

        <div className="profile-grid">
          <article>
            <span>Vai trò</span>
            <strong>{roleLabel}</strong>
          </article>
          <article>
            <span>Tài khoản</span>
            <strong>{user.email ?? user.username ?? "Không có email claim"}</strong>
          </article>
          <article>
            <span>Thời điểm đăng nhập</span>
            <strong>{new Date(user.signedInAt).toLocaleString("vi-VN")}</strong>
          </article>
        </div>

        <div className="next-step">
          <span>Tiếp theo</span>
          <p>
            {user.role === "admin"
              ? "Trang quản trị sẽ được phát triển trên quyền Admin đã xác thực."
              : "Hồ sơ, bảng điểm và lộ trình cá nhân sẽ được phát triển tại đây."}
          </p>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      setAuth(await getCurrentUser());
      setLoadError(null);
    } catch {
      setLoadError("Không thể kết nối đến máy chủ EduPath API.");
      setAuth({ authenticated: false });
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (auth?.authenticated && window.location.pathname === "/auth/callback") {
      window.history.replaceState({}, "", safeReturnTo());
    }
  }, [auth]);

  const authError = useMemo(() => getAuthError(), []);

  if (!auth) {
    return <main className="loading-screen">Đang kiểm tra phiên đăng nhập…</main>;
  }

  if (!auth.authenticated) {
    return <LoginPage error={authError ?? loadError} />;
  }

  return <Dashboard user={auth.user} onLogout={() => void logout()} />;
}
