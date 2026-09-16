import { useCallback, useEffect, useMemo, useState } from "react";
import { beginMicrosoftLogin, getCurrentUser, logout } from "./auth-api";
import LandingPage from "./LandingPage";
import EduPathBrand from "./EduPathBrand";
import AdminPortal from "./AdminPortal";
import { resolveAppRoute, safeReturnTo } from "./routing";
import type { AuthResponse } from "./types";
import StudentWorkspace from "./StudentWorkspace";

const errorMessages: Record<string, string> = {
  microsoft_denied: "Bạn đã hủy hoặc Microsoft từ chối yêu cầu đăng nhập.",
  invalid_state: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.",
  missing_code: "Microsoft không trả về mã đăng nhập hợp lệ.",
  callback_failed:
    "Không thể hoàn tất đăng nhập. Hãy kiểm tra quyền tài khoản và thử lại.",
  staff_portal_only:
    "Tài khoản email nội bộ của Trường chỉ đăng nhập được cổng quản trị EduPath AI. Không gian học tập dành riêng cho sinh viên."
};

const loginLinks = [
  { targetId: "/gioi-thieu", label: "Giới thiệu" },
  { targetId: "/tinh-nang", label: "Tính năng" },
  { targetId: "/huong-dan", label: "Hướng dẫn" }
];

function getAuthError(): string | null {
  const code = new URLSearchParams(window.location.search).get("authError");
  return code ? (errorMessages[code] ?? "Đăng nhập không thành công.") : null;
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
          <EduPathBrand />
        </a>

        <nav className="login-navigation" aria-label="Điều hướng trang đăng nhập">
          <a href="/">Trang chủ</a>
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
            src="/vlu-shield.jpg"
            alt="Biểu tượng Trường Đại học Văn Lang"
          />

          <p className="login-eyebrow"></p>
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
            <small>© 2026 · Bản Quyền Thuộc Khoa Công nghệ Thông tin · Trường Đại Học Văn Lang.</small>
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

// Staff mailboxes keep a valid session for the admin portal, so the student
// workspace shows them the way back instead of any student data.
function StaffPortalNotice() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth-shell">
      <main className="auth-content">
        <section className="login-card" aria-labelledby="staff-portal-title">
          <img
            className="vlu-logo"
            src="/vlu-shield.jpg"
            alt="Biểu tượng Trường Đại học Văn Lang"
          />
          <h1 id="staff-portal-title">Tài khoản dành cho cổng quản trị</h1>
          <p className="login-description">{errorMessages.staff_portal_only}</p>
          <a className="microsoft-button" href="/quantri">
            <span>Đi tới cổng quản trị</span>
          </a>
          <p className="login-help">
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => { setBusy(true); void logout().catch(() => setBusy(false)); }}
            >
              {busy ? "Đang đăng xuất…" : "Đăng xuất khỏi EduPath"}
            </button>
          </p>
        </section>
      </main>
    </div>
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
      if (safeReturnTo(window.location.search) === "/quantri") {
        window.location.replace("/quantri");
        return;
      }
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

  if (auth.studentPortal === false) return <StaffPortalNotice />;

  return <StudentWorkspace user={auth.user} />;
}

export default function App() {
  const route = resolveAppRoute(window.location.pathname, window.location.search);

  useEffect(() => {
    if (route === "landing") {
      document.title = "EduPath AI – Hiểu năng lực, định hướng tương lai";
    }
  }, [route]);

  // The overview is public and renders even when the API is unavailable.
  // The landing page checks the session separately to update its portal links.
  return route === "landing"
    ? <LandingPage />
    : route === "admin" ? <AdminPortal />
      : <AuthenticatedApp isLoginRoute={route === "login"} />;
}
