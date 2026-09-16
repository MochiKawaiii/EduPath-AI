import { useEffect, useRef, useState } from "react";
import EduPathBrand from "./EduPathBrand";
import type { AuthenticatedUser } from "./types";
import { Icon, roleLabels } from "./admin-account-shared";
import AccountsManagement from "./AccountsManagement";
import StudentProfiles from "./StudentProfiles";
import CurriculaManagement from "./CurriculaManagement";
import { adminNavigation, resolveAdminPage } from "./admin-navigation";
import "./admin-workspace.css";

export default function AdminWorkspace({ user, studentPortal = true, busy, error, onLogout }: { user: AuthenticatedUser; studentPortal?: boolean; busy: boolean; error: string | null; onLogout: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [path, setPath] = useState(() => window.location.pathname);
  const heading = useRef<HTMLHeadingElement>(null);
  const header = useRef<HTMLElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!header.current) return;
    const syncHeight = () => shell.current?.style.setProperty("--am-header-height", `${header.current?.getBoundingClientRect().height ?? 80}px`);
    const observer = new ResizeObserver(syncHeight);
    observer.observe(header.current);
    syncHeight();
    return () => observer.disconnect();
  }, []);
  const current = resolveAdminPage(path);
  useEffect(() => {
    const onPopState = () => { setPath(window.location.pathname); setMenuOpen(false); };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    document.title = `${current.label} – EduPath AI`;
    if (window.location.pathname !== current.path) window.history.replaceState({}, "", current.path);
    heading.current?.focus();
  }, [current]);
  return <div ref={shell} className="admin-shell am-shell">
    <aside className={`am-sidebar${menuOpen ? " am-sidebar-open" : ""}`}>
      <div className="am-sidebar-brand"><EduPathBrand /></div>
      <p className="am-nav-label">QUẢN TRỊ HỆ THỐNG</p>
      <nav id="admin-navigation" aria-label="Danh mục quản trị">{adminNavigation.map((item) => <a key={item.path} href={item.path} aria-current={current.path === item.path ? "page" : undefined} onClick={(event) => { if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); if (window.location.pathname !== item.path) window.history.pushState({}, "", item.path); setPath(item.path); setMenuOpen(false); } }}><Icon name={item.icon} /><span>{item.label}</span></a>)}</nav>
      <div className="am-sidebar-footer"><span>VAN LANG UNIVERSITY</span><p>Khoa Công nghệ Thông tin</p><small>Học tập có định hướng.</small></div>
    </aside>
    <div className="am-main"><header ref={header} className="am-topbar"><div><button className="am-menu-toggle am-outline" aria-controls="admin-navigation" aria-expanded={menuOpen} aria-label="Đóng mở danh mục quản trị" onClick={() => setMenuOpen(!menuOpen)}><Icon name="menu" /></button>{studentPortal && <a className="am-portal-link" href="/dashboard">Cổng sinh viên</a>}<span>Quản trị / <strong>{current.breadcrumb}</strong></span></div><div className="am-topbar-user"><span className="am-avatar" aria-hidden="true">{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><small>{roleLabels[user.role]}</small></div><button className="am-logout" disabled={busy} onClick={onLogout}><Icon name="exit" /><span>{busy ? "Đang đăng xuất…" : "Đăng xuất"}</span></button></div></header>
      <main className="am-content"><div className="am-page-heading"><div><p className="admin-eyebrow">{current.eyebrow}</p><h1 ref={heading} tabIndex={-1}>{current.label}</h1></div></div>
        {error && <p className="admin-error" role="alert">{error}</p>}
        {current.path === "/quantri/chuong-trinh" ? <CurriculaManagement canManage={user.role === "admin"} /> : current.path === "/quantri/sinh-vien" ? <StudentProfiles /> : <AccountsManagement actorId={user.userId} canManage={user.role === "admin"} />}
      </main><footer className="am-footer">© 2026 · Bản Quyền Thuộc Khoa Công nghệ Thông tin · Trường Đại Học Văn Lang.</footer>
    </div>
  </div>;
}
