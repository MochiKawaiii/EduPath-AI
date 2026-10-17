import CareersManagement from "./CareersManagement";
import CareerFieldsManagement from "./CareerFieldsManagement";
import CareerSkillsManagement from "./CareerSkillsManagement";
import GraduationManagement from "./GraduationManagement";
import { useEffect, useRef, useState } from "react";
import EduPathBrand from "./EduPathBrand";
import { layoutHeight } from "./page-scale";
import { canAccessAdmin, type AuthenticatedUser } from "./types";
import { Icon, roleLabels } from "./admin-account-shared";
import AccountsManagement from "./AccountsManagement";
import StudentProfiles from "./StudentProfiles";
import CurriculaManagement from "./CurriculaManagement";
import PlansManagement from "./PlansManagement";
import CompetencyManagement from "./CompetencyManagement";
import { adminSidebar, resolveAdminPage, type AdminPage } from "./admin-navigation";
import "./admin-workspace.css";

export default function AdminWorkspace({ user, busy, error, onLogout }: { user: AuthenticatedUser; busy: boolean; error: string | null; onLogout: () => void }) {
  const canManage = canAccessAdmin(user.role);
  const [menuOpen, setMenuOpen] = useState(false);
  const [path, setPath] = useState(() => window.location.pathname);
  /** Groups the admin opened or closed; untouched, a group is open while one of its pages is shown. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const header = useRef<HTMLElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!header.current) return;
    const syncHeight = () => shell.current?.style.setProperty("--am-header-height", `${header.current ? layoutHeight(header.current) : 80}px`);
    const observer = new ResizeObserver(syncHeight);
    observer.observe(header.current);
    syncHeight();
    return () => observer.disconnect();
  }, []);
  const current = resolveAdminPage(path);
  const navigate = (nextPath: string) => {
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    setPath(nextPath);
    setMenuOpen(false);
  };
  useEffect(() => {
    const onPopState = () => { setPath(window.location.pathname); setMenuOpen(false); };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    // Reaching a page of a closed group (guide link, back button) opens that group.
    const group = adminSidebar.find((entry) => entry.kind === "group" && entry.pages.some((page) => page.path === current.path));
    if (group?.kind === "group") setOpenGroups((previous) => previous[group.id] === false ? { ...previous, [group.id]: true } : previous);
  }, [current]);
  useEffect(() => {
    document.title = `${current.label} – EduPath AI`;
    if (window.location.pathname !== current.path) window.history.replaceState({}, "", current.path);
    heading.current?.focus();
  }, [current]);
  const pageLink = (page: AdminPage) => <a key={page.path} href={page.path} aria-current={current.path === page.path ? "page" : undefined} onClick={(event) => { if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(page.path); } }}><Icon name={page.icon} /><span>{page.label}</span></a>;
  return <div ref={shell} className="admin-shell am-shell">
    <aside className={`am-sidebar${menuOpen ? " am-sidebar-open" : ""}`}>
      <div className="am-sidebar-brand"><EduPathBrand /></div>
      <p className="am-nav-label">QUẢN TRỊ HỆ THỐNG</p>
      <nav id="admin-navigation" aria-label="Danh mục quản trị">{adminSidebar.map((entry) => {
        if (entry.kind === "page") return pageLink(entry.page);
        const holdsCurrent = entry.pages.some((page) => page.path === current.path);
        const open = openGroups[entry.id] ?? holdsCurrent;
        return <div key={entry.id} className="am-nav-group">
          <button type="button" className={`am-nav-group-toggle${holdsCurrent ? " am-nav-group-current" : ""}`} aria-expanded={open} aria-controls={`admin-navigation-${entry.id}`}
            onClick={() => setOpenGroups((previous) => ({ ...previous, [entry.id]: !open }))}><Icon name={entry.icon} /><span>{entry.label}</span><Icon name="chevronDown" className="am-nav-chevron" /></button>
          <div id={`admin-navigation-${entry.id}`} className="am-nav-sub" hidden={!open}>{entry.pages.map(pageLink)}</div>
        </div>;
      })}</nav>
      <div className="am-sidebar-footer"><span>VAN LANG UNIVERSITY</span><p>Khoa Công nghệ Thông tin</p><small>Học tập có định hướng.</small></div>
    </aside>
    <div className="am-main"><header ref={header} className="am-topbar"><div><button className="am-menu-toggle am-outline" aria-controls="admin-navigation" aria-expanded={menuOpen} aria-label="Đóng mở danh mục quản trị" onClick={() => setMenuOpen(!menuOpen)}><Icon name="menu" /></button><span>Quản trị / <strong>{current.label}</strong></span></div><div className="am-topbar-user"><span className="am-avatar" aria-hidden="true">{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><small>{roleLabels[user.role]}</small></div><button className="am-logout" disabled={busy} onClick={onLogout}><Icon name="exit" /><span>{busy ? "Đang đăng xuất…" : "Đăng xuất"}</span></button></div></header>
      <main className="am-content"><div className="am-page-heading"><div><p className="admin-eyebrow">{current.eyebrow}</p><h1 ref={heading} tabIndex={-1}>{current.label}</h1></div></div>
        {error && <p className="admin-error" role="alert">{error}</p>}
        {current.path === "/quantri/nhom-nang-luc" ? <CompetencyManagement key="groups" canManage={canManage} section="groups" /> : current.path === "/quantri/cau-hinh-nang-luc" ? <CompetencyManagement key="profiles" canManage={canManage} section="profiles" /> : current.path === "/quantri/cau-hinh-hoc-phan" ? <CompetencyManagement key="courses" canManage={canManage} section="courses" /> : current.path === "/quantri/ky-nang" ? <CareerSkillsManagement canManage={canManage} /> : current.path === "/quantri/linh-vuc-nghe-nghiep" ? <CareerFieldsManagement canManage={canManage} /> : current.path === "/quantri/vi-tri-nghe-nghiep" ? <CareersManagement canManage={canManage} /> : current.path === "/quantri/tieu-chuan-tot-nghiep" ? <GraduationManagement canManage={canManage} /> : current.path === "/quantri/ke-hoach" ? <PlansManagement canManage={canManage} /> : current.path === "/quantri/chuong-trinh" ? <CurriculaManagement canManage={canManage} /> : current.path === "/quantri/sinh-vien" ? <StudentProfiles /> : <AccountsManagement actorId={user.userId} canManage={canManage} canAssignRoles={user.role === "admin"} />}
      </main><footer className="am-footer">© 2026 · Bản Quyền Thuộc Khoa Công nghệ Thông tin · Trường Đại Học Văn Lang.</footer>
    </div>
  </div>;
}
