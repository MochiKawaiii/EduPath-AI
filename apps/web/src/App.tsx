import { useCallback, useEffect, useMemo, useState } from "react";
import { beginMicrosoftLogin, getCurrentUser, logout } from "./auth-api";
import LandingPage from "./LandingPage";
import { resolveAppRoute, safeReturnTo } from "./routing";
import type { AuthResponse, AuthenticatedUser } from "./types";

const errorMessages: Record<string, string> = {
  microsoft_denied: "Bạn đã hủy hoặc Microsoft từ chối yêu cầu đăng nhập.",
  invalid_state: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.",
  missing_code: "Microsoft không trả về mã đăng nhập hợp lệ.",
  callback_failed:
    "Không thể hoàn tất đăng nhập. Hãy kiểm tra quyền tài khoản và thử lại."
};

const loginLinks = [
  { targetId: "gioi-thieu", label: "Giới thiệu" },
  { targetId: "tinh-nang", label: "Tính năng" },
  { targetId: "huong-dan", label: "Hướng dẫn" }
];

function getAuthError(): string | null {
  const code = new URLSearchParams(window.location.search).get("authError");
  return code ? (errorMessages[code] ?? "Đăng nhập không thành công.") : null;
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

function LocationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <circle cx="12" cy="10" r="2.5" fill="currentColor" />
    </svg>
  );
}

function LoginPage({ error }: { error: string | null }) {
  return (
    <div className="auth-shell">
      <header className="login-header">
        <a
          className="login-brand"
          href="/"
          aria-label="EduPath AI - Về trang tổng quan"
        >
          <EduPathLogo />
          <span className="brand-wordmark">
            <strong>
              EduPath <em>AI</em>
            </strong>
            <small>AI đồng hành · Học tập bứt phá</small>
          </span>
        </a>

        <nav className="login-navigation" aria-label="Điều hướng trang đăng nhập">
          {loginLinks.map((link) => (
            <a
              key={link.targetId}
              href={`/#${link.targetId}`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="header-vlu-logo">
          <img src="/vlu-logo-horizontal.png" alt="Trường Đại học Văn Lang" />
        </div>
      </header>

      <main className="auth-content" id="dang-nhap">
        <section
          className="login-card"
          id="gioi-thieu"
          aria-labelledby="login-title"
        >
          <img
            className="vlu-logo"
            src="/vlu-logo.png"
            alt="Logo Trường Đại học Văn Lang"
          />

          <p className="login-eyebrow">Cổng học tập thông minh</p>
          <h1 id="login-title">Chào mừng đến với EduPath AI!</h1>
          <section id="tinh-nang" aria-labelledby="feature-title">
            <h2 id="feature-title" className="sr-only">
              Tính năng
            </h2>
            <p className="login-description">
              Đăng nhập để đánh giá năng lực, xây dựng lộ trình học tập
              <br className="desktop-break" /> và khám phá định hướng nghề nghiệp phù hợp.
            </p>
          </section>

          {error ? (
            <div className="error-banner" role="alert">
              {error}
            </div>
          ) : null}

          <button
            className="microsoft-button"
            type="button"
            aria-describedby="login-help login-security"
            onClick={() => beginMicrosoftLogin(safeReturnTo(window.location.search))}
          >
            <MicrosoftIcon />
            <span>Đăng nhập bằng Microsoft</span>
          </button>

          <section id="huong-dan" aria-labelledby="guide-title">
            <h2 id="guide-title" className="sr-only">
              Hướng dẫn đăng nhập
            </h2>
            <p id="login-help" className="login-help">
              Sử dụng tài khoản Microsoft do Trường Đại học Văn Lang cấp
            </p>
          </section>
          <p id="login-security" className="sr-only">
            EduPath AI không nhận hoặc lưu mật khẩu Microsoft của bạn.
          </p>

          <div className="student-badge">
            <span className="student-badge-icon">
              <AcademicCapIcon />
            </span>
            <strong>Dành cho sinh viên Văn Lang</strong>
          </div>
        </section>
      </main>

      <footer className="login-footer">
        <div className="footer-grid">
          <section className="footer-column footer-copyright" aria-labelledby="footer-project-title">
            <h2 id="footer-project-title">EduPath AI</h2>
            <p>
              Hệ thống đánh giá năng lực và tư vấn lộ trình học tập dành cho sinh viên
              Công nghệ Thông tin.
            </p>
            <small>© 2026 EduPath AI. All rights reserved.</small>
          </section>

          <nav className="footer-column footer-links" aria-label="Liên kết nhanh">
            <h2>Liên kết</h2>
            <ul>
              {loginLinks.map((link) => (
                <li key={link.targetId}>
                  <a href={`/#${link.targetId}`}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <section className="footer-column footer-addresses" aria-labelledby="footer-vlu-title">
            <h2 id="footer-vlu-title">Trường Đại học Văn Lang</h2>
            <address>
              <span>
                <LocationIcon />
                <span>
                  <b>Cơ sở 1:</b> 45 Nguyễn Khắc Nhu, P. Cầu Ông Lãnh, TP. HCM
                </span>
              </span>
              <span>
                <LocationIcon />
                <span>
                  <b>Cơ sở 2:</b> 233A Phan Văn Trị, P. Bình Lợi Trung, TP. HCM
                </span>
              </span>
              <span>
                <LocationIcon />
                <span>
                  <b>Cơ sở chính:</b> 69/68 Đặng Thùy Trâm, P. Bình Lợi Trung, TP. HCM
                </span>
              </span>
              <span>
                <LocationIcon />
                <span>
                  <b>Ký túc xá:</b> 160/63A-B Phan Huy Ích, P. An Hội Tây, TP. HCM
                </span>
              </span>
            </address>
          </section>
        </div>
      </footer>
    </div>
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

function AuthenticatedApp({ isLoginRoute }: { isLoginRoute: boolean }) {
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
    if (auth?.authenticated) {
      document.title = "EduPath AI – Không gian học tập";
      if (isLoginRoute || window.location.pathname.replace(/\/+$/, "") === "/auth/callback") {
        window.history.replaceState({}, "", safeReturnTo(window.location.search));
      }
    } else {
      document.title = "EduPath AI – Đăng nhập";
      if (auth || isLoginRoute) {
        const search = new URLSearchParams(window.location.search);
        const loginSearch = new URLSearchParams();
        if (search.has("authError")) {
          loginSearch.set("authError", search.get("authError") ?? "callback_failed");
        }
        if (search.has("returnTo")) {
          loginSearch.set("returnTo", safeReturnTo(window.location.search));
        }
        const query = loginSearch.toString();
        window.history.replaceState({}, "", `/login${query ? `?${query}` : ""}`);
      }
    }
  }, [auth, isLoginRoute]);

  const authError = useMemo(() => getAuthError(), []);

  if (!auth && !isLoginRoute) {
    return <main className="loading-screen">Đang kiểm tra phiên đăng nhập…</main>;
  }

  if (!auth?.authenticated) {
    return <LoginPage error={authError ?? loadError} />;
  }

  return <Dashboard user={auth.user} onLogout={() => void logout()} />;
}

export default function App() {
  const route = resolveAppRoute(window.location.pathname, window.location.search);

  useEffect(() => {
    if (route === "landing") {
      document.title = "EduPath AI – Hiểu năng lực, định hướng tương lai";
    }
  }, [route]);

  // The overview is public and renders even when the API is unavailable.
  // Authentication is requested only when entering login or the dashboard.
  return route === "landing"
    ? <LandingPage />
    : <AuthenticatedApp isLoginRoute={route === "login"} />;
}
