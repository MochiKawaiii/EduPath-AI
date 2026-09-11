import { useEffect, useRef, useState } from "react";
import EduPathBrand from "./EduPathBrand";
import StudentProfileEditor from "./StudentProfileEditor";
import StudentTranscript from "./StudentTranscript";
import StudentOverview, { type StudentProfile } from "./StudentOverview";
import { logout } from "./auth-api";
import type { AuthenticatedUser } from "./types";
import "./student-workspace.css";
import "./student-header.css";
import "./student-layout.css";

const pages = [
  { id: "overview", label: "Tổng quan", icon: "home" },
  { id: "profile", label: "Hồ sơ & bảng điểm", icon: "user" },
  { id: "competency", label: "Năng lực của tôi", icon: "chart" },
  { id: "career", label: "Định hướng nghề nghiệp", icon: "compass" },
  { id: "roadmap", label: "Lộ trình học tập", icon: "route" },
  { id: "curriculum", label: "Chương trình đào tạo", icon: "book" },
  { id: "assistant", label: "Trợ lý AI", icon: "spark" }
] as const;
type Page = typeof pages[number]["id"];
type Profile = StudentProfile;
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8",
    user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
    chart: "M4 20V10m8 10V4m8 16v-7M2 21h20",
    compass: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM16 8l-3 5-5 3 3-5 5-3Z",
    route: "M5 3v12a5 5 0 0 0 10 0V9m-4 4 4-4 4 4M2 3h6",
    book: "M12 5v16M3 3l9 2 9-2v16l-9 2-9-2V3Z",
    spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z",
    bell: "M5 17h14l-2-3V8A5 5 0 0 0 7 8v6l-2 3ZM10 21h4",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6",
    logout: "M9 3H3v18h6m1-9h12m-5-5 5 5-5 5",
    menu: "M3 6h18M3 12h18M3 18h18",
    help: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v1"
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.book} /></svg>;
}
function currentPage(): Page {
  const hash = window.location.hash.slice(1);
  return pages.find(p => p.id === hash)?.id ?? "overview";
}
const featureCopy: Partial<Record<Page, { title: string; text: string; steps: string[] }>> = {
  competency: { title: "Hiểu năng lực, biết điểm cần cải thiện", text: "Đánh giá các nhóm kỹ năng từ kết quả học tập, theo dõi sự thay đổi và nhận diện kỹ năng cần bổ sung.", steps: ["Kết quả theo nhóm kỹ năng", "Phân tích khoảng trống kỹ năng", "Theo dõi năng lực theo thời gian"] },
  career: { title: "Tìm hướng đi phù hợp với bạn", text: "Khám phá nghề nghiệp trong ngành CNTT và đối chiếu năng lực hiện tại với các kỹ năng nghề nghiệp yêu cầu.", steps: ["Khám phá vị trí nghề nghiệp", "Lựa chọn nghề nghiệp mục tiêu", "Đối chiếu yêu cầu kỹ năng"] },
  roadmap: { title: "Từng học kỳ, tiến gần hơn đến mục tiêu", text: "Lộ trình học tập sẽ kết hợp năng lực, mục tiêu nghề nghiệp và chương trình đào tạo của bạn.", steps: ["Kiểm tra môn tiên quyết và tín chỉ", "Gợi ý môn học theo từng học kỳ", "Bổ sung kỹ năng và tài nguyên tự học"] },
  curriculum: { title: "Nắm rõ hành trình học tập của bạn", text: "Tra cứu học phần, số tín chỉ, điều kiện tiên quyết và các yêu cầu xét tốt nghiệp.", steps: ["Chương trình đào tạo theo khóa", "Danh mục học phần", "Điều kiện xét tốt nghiệp"] },
  assistant: { title: "Một người bạn đồng hành trong học tập", text: "Trợ lý AI sẽ giúp giải thích kết quả đánh giá và lý do đề xuất môn học, đồng thời tư vấn kỹ năng tự học.", steps: ["Giải thích kết quả năng lực", "Hỏi đáp về lộ trình", "Gợi ý tài nguyên học tập"] }
};

export default function StudentWorkspace({ user }: { user: AuthenticatedUser }) {
  const [page, setPage] = useState<Page>(currentPage);
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<"notifications" | "help" | "account" | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const resize = new ResizeObserver(() => {
      header.closest<HTMLElement>(".sw-shell")?.style.setProperty("--sw-header-height", `${header.getBoundingClientRect().height}px`);
    });
    resize.observe(header);
    return () => resize.disconnect();
  }, []);
  const navigationButton = useRef<HTMLButtonElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!accountRef.current?.contains(event.target as Node)) setPanel(p => p === "account" ? null : p); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { if (panel === "account") accountButton.current?.focus(); if (menu) navigationButton.current?.focus(); setPanel(null); setMenu(false); } };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [panel, menu]);
  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => {
    const update = () => {
      const hash = window.location.hash.slice(1);
      if (!hash || pages.some(p => p.id === hash)) setPage(currentPage());
      setMenu(false); setQuery(""); setPanel(null);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/student/profile", { credentials: "include", signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error(r.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : "Chưa tải được hồ sơ của bạn."); return r.json() as Promise<{ student: Profile }>; })
      .then(data => setProfile(data.student))
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Không thể tải hồ sơ."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => { document.title = `${pages.find(p => p.id === page)?.label} · EduPath AI`; }, [page]);
  const name = profile?.name ?? user.name;
  const initials = name.split(/\s+/).filter(Boolean).slice(-2).map(s => s[0]).join("").toUpperCase();
  const selected = pages.find(p => p.id === page)!;
  const navigate = (id: Page) => { window.location.hash = id; setPage(id); setMenu(false); setQuery(""); setPanel(null); };
  const exit = async () => {
    setLoggingOut(true);
    try { await logout(); }
    catch { setError("Đăng xuất chưa thành công. Vui lòng thử lại."); setLoggingOut(false); }
  };
  const fields = { "Mã sinh viên": profile?.studentCode, "Khóa học": profile?.cohortCode, "Lớp học": profile?.className, "Năm nhập học": profile?.cohortYear, "Học kỳ hiện tại": profile?.currentSemester, "Email": profile?.email ?? user.email };
  const profileCard = <section className="sw-panel sw-profile"><div className="sw-section-heading"><h2>Thông tin học tập</h2><span className="sw-tag">Hồ sơ của bạn</span></div><div className="sw-profile-intro"><span className="sw-avatar sw-avatar-large">{initials}</span><div><h3>{name}</h3><p>{profile?.email ?? user.email ?? "Chưa cập nhật email"}</p></div></div><dl className="sw-fields">{Object.entries(fields).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{loading ? "Đang tải…" : value ?? "Chưa cập nhật"}</dd></div>)}</dl></section>;
  return <div className="sw-shell">
    <a className="sw-skip" href="#student-main">Đến nội dung chính</a>
    <div className="sw-workspace">
      <header ref={headerRef} className="sw-topbar"><div className="sw-header-brand"><EduPathBrand href="/dashboard" /></div><button ref={navigationButton} className="sw-icon-button sw-menu-button" aria-label={menu ? "Ẩn menu bên trái" : "Hiện menu bên trái"} aria-controls="student-sidebar" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="menu" /></button><nav id="student-navigation" className="sw-header-nav" aria-label="Điều hướng sinh viên">{pages.map(p => <a key={p.id} href={`#${p.id}`} aria-current={page === p.id ? "page" : undefined} onClick={() => navigate(p.id)}><span>{p.label}</span></a>)}</nav><div className="sw-tools"><div className="sw-search"><Icon name="search" /><input aria-label="Tìm chức năng" placeholder="Tìm chức năng…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setQuery(""); }} />{query.trim() && <div className="sw-search-results">{pages.filter(p => p.label.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi"))).map(p => <button key={p.id} onClick={() => navigate(p.id)}>{p.label}<Icon name="arrow" /></button>)}{!pages.some(p => p.label.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi"))) && <p>Không tìm thấy chức năng.</p>}</div>}</div><button className="sw-icon-button" aria-label="Hướng dẫn" aria-expanded={panel === "help"} onClick={() => setPanel(panel === "help" ? null : "help")}><Icon name="help" /></button><button className="sw-icon-button" aria-label="Thông báo" aria-expanded={panel === "notifications"} onClick={() => setPanel(panel === "notifications" ? null : "notifications")}><Icon name="bell" /></button><div className="sw-account" ref={accountRef} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPanel(p => p === "account" ? null : p); }}><button ref={accountButton} className="sw-avatar" aria-label={`Tài khoản ${name}`} aria-expanded={panel === "account"} aria-controls="student-account-menu" onClick={() => setPanel(panel === "account" ? null : "account")}>{initials}</button>{panel === "account" && <div id="student-account-menu" className="sw-account-dropdown"><strong>{name}</strong><span>{profile?.email ?? user.email}</span><a href="#profile" onClick={() => navigate("profile")}><Icon name="user" />Hồ sơ & bảng điểm</a><button disabled={loggingOut} onClick={() => void exit()}><Icon name="logout" />{loggingOut ? "Đang đăng xuất…" : "Đăng xuất"}</button></div>}</div></div>{panel && panel !== "account" && <section className="sw-popover"><button className="sw-popover-close" onClick={() => setPanel(null)} aria-label="Đóng">×</button><h3>{panel === "help" ? "Bắt đầu với EduPath" : "Thông báo"}</h3><p>{panel === "help" ? "Xem thông tin tại Hồ sơ & bảng điểm. Các mục năng lực, nghề nghiệp và lộ trình sẽ được bổ sung khi chức năng tương ứng sẵn sàng." : "Chức năng thông báo học tập đang được phát triển."}</p></section>}</header>
      <div className={`sw-body ${menu ? "sw-body-menu-open" : ""}`}>
      {menu && <aside id="student-sidebar" className="sw-drawer" aria-label="Menu bên trái"><div className="sw-drawer-heading"><strong>Danh mục học tập</strong></div><nav aria-label="Danh mục bên trái">{pages.map(p => <a key={p.id} href={`#${p.id}`} aria-current={page === p.id ? "page" : undefined} onClick={() => { navigate(p.id); navigationButton.current?.focus(); }}>{p.label}</a>)}<a href="/">Về trang giới thiệu</a></nav><p>Hiểu năng lực.<br /><strong>Chủ động tương lai.</strong></p></aside>}
      <div className="sw-body-content"><main className="sw-main" id="student-main" tabIndex={-1}>
        {error && <div className="sw-error" role="alert">{error}<button onClick={() => setReload(n => n + 1)}>Thử lại</button></div>}
        <div className="sw-page-heading">
          <div><p className="sw-eyebrow">CỔNG QUẢN LÝ HỌC TẬP</p><h1>{page === "overview" ? "Tổng quan học tập" : selected.label}</h1><p>{page === "overview" ? `Xin chào, ${name}. Cùng tiếp tục hành trình của bạn nhé.` : page === "profile" ? "Thông tin cá nhân và kết quả học tập của bạn, tại một nơi." : "Khám phá bước tiếp theo trên hành trình học tập của bạn."}</p></div>
          {page === "overview" && <button className="sw-outline" onClick={() => navigate("profile")}>Xem hồ sơ của tôi <Icon name="arrow" /></button>}
        </div>
        {page === "overview" ? <>
          <section className="so-student-strip" aria-label="Thông tin sinh viên">
            <div className="so-student-identity"><span className="sw-avatar sw-avatar-large">{initials}</span><div><strong>{name}</strong><span>{profile?.email ?? user.email ?? "Chưa cập nhật email"}</span></div></div>
            <dl><div><dt>Mã sinh viên</dt><dd>{loading ? "Đang tải…" : profile?.studentCode ?? "Chưa cập nhật"}</dd></div><div><dt>Khóa · Lớp</dt><dd>{loading ? "Đang tải…" : [profile?.cohortCode, profile?.className].filter(Boolean).join(" · ") || "Chưa cập nhật"}</dd></div><div><dt>Năm nhập học</dt><dd>{loading ? "Đang tải…" : profile?.cohortYear ?? "Chưa cập nhật"}</dd></div></dl>
          </section>
          <StudentOverview profile={profile} loading={loading} navigate={navigate} />
        </> : page === "profile" ? <div className="sr-profile-layout">{profileCard}{profile && <StudentProfileEditor profile={profile} onSaved={() => setReload(n => n + 1)} />}<StudentTranscript /></div> : <section className="sw-panel sw-feature"><span className="sw-card-icon"><Icon name={selected.icon} /></span><span className="sw-tag">Sắp ra mắt</span><h2>{featureCopy[page]?.title}</h2><p>{featureCopy[page]?.text}</p><div className="sw-feature-steps">{featureCopy[page]?.steps.map((step, i) => <div key={step}><span>0{i + 1}</span><h3>{step}</h3></div>)}</div><p className="sw-muted">Chức năng này chưa sẵn sàng sử dụng. Bạn có thể xem thông tin học tập hiện có trong hồ sơ.</p><button className="sw-primary" onClick={() => navigate("profile")}>Xem hồ sơ học tập <Icon name="arrow" /></button></section>}
        <footer className="sw-footer"><span>© 2026 EduPath AI · Khoa Công nghệ Thông tin · Đại học Văn Lang</span><span>AI đồng hành · Học tập bứt phá</span></footer>
      </main></div>
      </div>
    </div>
  </div>;
}
