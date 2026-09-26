import StudentPlans from "./StudentPlans";
import StudentGraduation from "./StudentGraduation";
import { useEffect, useRef, useState } from "react";
import EduPathBrand from "./EduPathBrand";
import { layoutHeight } from "./page-scale";
import StudentProfileEditor from "./StudentProfileEditor";
import StudentTranscript from "./StudentTranscript";
import StudentCurriculum from "./StudentCurriculum";
import StudentOverview, { type StudentProfile } from "./StudentOverview";
import { logout } from "./auth-api";
import { Icon } from "./student-icons";
import type { AuthenticatedUser } from "./types";
import "./student-workspace.css";
import "./student-header.css";
import "./student-layout.css";

const pages = [
  { id: "overview", label: "Tổng quan", icon: "home" },
  { id: "profile", label: "Hồ sơ & bảng điểm", icon: "user" },
  { id: "competency", label: "Đánh giá năng lực", icon: "chart" },
  { id: "career", label: "Định hướng nghề nghiệp", icon: "compass" },
  { id: "roadmap", label: "Lộ trình học tập", icon: "route" },
  { id: "curriculum", label: "Chương trình đào tạo", icon: "book" },
  { id: "plans", label: "Kế hoạch đào tạo", icon: "book" },
  { id: "graduation", label: "Điều kiện xét tốt nghiệp", icon: "shield" },
  { id: "assistant", label: "Trợ lý AI", icon: "spark" }
] as const;
type Page = typeof pages[number]["id"];
// The main nav only carries the core journey; profile, curriculum, plans and graduation live in the account menu instead.
const navPageIds = new Set<Page>(["overview", "competency", "career", "roadmap", "assistant"]);
const navPages = pages.filter(p => navPageIds.has(p.id));
type Profile = StudentProfile;
function currentPage(): Page {
  const hash = window.location.hash.slice(1);
  return pages.find(p => p.id === hash)?.id ?? "overview";
}
const featureCopy: Partial<Record<Page, { title: string; text: string; steps: string[] }>> = {
  competency: { title: "Hiểu năng lực, biết điểm cần cải thiện", text: "Đánh giá các nhóm kỹ năng từ kết quả học tập, theo dõi sự thay đổi và nhận diện kỹ năng cần bổ sung.", steps: ["Kết quả theo nhóm kỹ năng", "Phân tích khoảng trống kỹ năng", "Theo dõi năng lực theo thời gian"] },
  career: { title: "Tìm hướng đi phù hợp với bạn", text: "Khám phá nghề nghiệp trong ngành CNTT và đối chiếu năng lực hiện tại với các kỹ năng nghề nghiệp yêu cầu.", steps: ["Khám phá vị trí nghề nghiệp", "Lựa chọn nghề nghiệp mục tiêu", "Đối chiếu yêu cầu kỹ năng"] },
  roadmap: { title: "Từng học kỳ, tiến gần hơn đến mục tiêu", text: "Lộ trình học tập sẽ kết hợp năng lực, mục tiêu nghề nghiệp và chương trình đào tạo của bạn.", steps: ["Kiểm tra môn tiên quyết và tín chỉ", "Gợi ý môn học theo từng học kỳ", "Bổ sung kỹ năng và tài nguyên tự học"] },
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
      header.closest<HTMLElement>(".sw-shell")?.style.setProperty("--sw-header-height", `${layoutHeight(header)}px`);
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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => {
    const update = () => {
      const hash = window.location.hash.slice(1);
      if (!hash || pages.some(p => p.id === hash)) setPage(currentPage());
      setPanel(null);
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
  const navigate = (id: Page) => {
    window.location.hash = id;
    setPage(id);
    setPanel(null);
    if (window.matchMedia("(max-width: 700px)").matches) {
      setMenu(false);
      navigationButton.current?.focus();
    }
  };
  const exit = async () => {
    setLoggingOut(true);
    try { await logout(); }
    catch { setError("Đăng xuất chưa thành công. Vui lòng thử lại."); setLoggingOut(false); }
  };
  const fields = { "Mã sinh viên": profile?.studentCode, "Khóa học": profile?.cohortCode, "Lớp học": profile?.className, "Năm nhập học": profile?.cohortYear, "Email": profile?.email ?? user.email };
  const profileCard = <section className="sw-panel sw-profile"><div className="sw-section-heading"><h2>Thông tin học tập</h2><span className="sw-tag">Hồ sơ của bạn</span></div><div className="sw-profile-intro"><span className="sw-avatar sw-avatar-large">{initials}</span><div><h3>{name}</h3><p>{profile?.email ?? user.email ?? "Chưa cập nhật email"}</p></div></div><dl className="sw-fields">{Object.entries(fields).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{loading ? "Đang tải…" : value ?? "Chưa cập nhật"}</dd></div>)}</dl></section>;
  return <div className="sw-shell">
    <a className="sw-skip" href="#student-main">Đến nội dung chính</a>
    <div className="sw-workspace">
      <header ref={headerRef} className="sw-topbar"><button ref={navigationButton} className="sw-icon-button sw-menu-button" aria-label={menu ? "Ẩn menu bên trái" : "Hiện menu bên trái"} aria-controls="student-sidebar" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="menu" /></button><div className="sw-header-brand"><EduPathBrand href="/dashboard" /></div><nav id="student-navigation" className="sw-header-nav" aria-label="Điều hướng sinh viên">{navPages.map(p => <a key={p.id} href={`#${p.id}`} aria-current={page === p.id ? "page" : undefined} onClick={() => navigate(p.id)}><span>{p.label}</span></a>)}</nav><div className="sw-tools"><button className="sw-icon-button" aria-label="Hướng dẫn" aria-expanded={panel === "help"} onClick={() => setPanel(panel === "help" ? null : "help")}><Icon name="help" /></button><button className="sw-icon-button" aria-label="Thông báo" aria-expanded={panel === "notifications"} onClick={() => setPanel(panel === "notifications" ? null : "notifications")}><Icon name="bell" /></button><div className="sw-account" ref={accountRef} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPanel(p => p === "account" ? null : p); }}><button ref={accountButton} className="sw-avatar" aria-label={`Tài khoản ${name}`} aria-expanded={panel === "account"} aria-controls="student-account-menu" onClick={() => setPanel(panel === "account" ? null : "account")}>{initials}</button>{panel === "account" && <div id="student-account-menu" className="sw-account-dropdown"><strong>{name}</strong><span>{profile?.email ?? user.email}</span><a href="#profile" onClick={() => navigate("profile")}><Icon name="user" />Hồ sơ & bảng điểm</a><a href="#curriculum" onClick={() => navigate("curriculum")}><Icon name="book" />Chương trình đào tạo</a><a href="#plans" onClick={() => navigate("plans")}><Icon name="book" />Kế hoạch đào tạo</a><a href="#graduation" onClick={() => navigate("graduation")}><Icon name="shield" />Điều kiện xét tốt nghiệp</a><button disabled={loggingOut} onClick={() => void exit()}><Icon name="logout" />{loggingOut ? "Đang đăng xuất…" : "Đăng xuất"}</button></div>}</div></div>{panel && panel !== "account" && <section className="sw-popover"><button className="sw-popover-close" onClick={() => setPanel(null)} aria-label="Đóng">×</button><h3>{panel === "help" ? "Bắt đầu với EduPath" : "Thông báo"}</h3><p>{panel === "help" ? "Xem thông tin tại Hồ sơ & bảng điểm. Các mục năng lực, nghề nghiệp và lộ trình sẽ được bổ sung khi chức năng tương ứng sẵn sàng." : "Chức năng thông báo học tập đang được phát triển."}</p></section>}</header>
      <div className={`sw-body ${menu ? "sw-body-menu-open" : ""}`}>
        {menu && <button className="sw-drawer-backdrop" aria-label="Đóng menu bên trái" tabIndex={-1} onClick={() => { setMenu(false); navigationButton.current?.focus(); }} />}
        {menu && <aside id="student-sidebar" className="sw-drawer" aria-label="Menu bên trái"><div className="sw-drawer-heading"><strong>Danh mục học tập</strong></div><nav aria-label="Danh mục bên trái">{pages.map(p => <a key={p.id} href={`#${p.id}`} aria-current={page === p.id ? "page" : undefined} onClick={() => navigate(p.id)}>{p.label}</a>)}<a href="/">Về trang giới thiệu</a></nav><p>Hiểu năng lực.<br /><strong>Chủ động tương lai.</strong></p></aside>}
        <div className="sw-body-content"><main className="sw-main" id="student-main" tabIndex={-1}>
          {error && <div className="sw-error" role="alert">{error}<button onClick={() => setReload(n => n + 1)}>Thử lại</button></div>}
          <div className="sw-page-heading">
            <div><p className="sw-eyebrow">CỔNG QUẢN LÝ HỌC TẬP</p><h1>{page === "overview" ? "Tổng quan học tập" : selected.label}</h1><p>{page === "overview" ? `Xin chào, ${name}. Cùng tiếp tục hành trình của bạn nhé.` : page === "profile" ? "Thông tin cá nhân và kết quả học tập của bạn, tại một nơi." : page === "plans" ? "Xem các môn học dự kiến theo năm học và học kỳ." : page === "graduation" ? "Tín chỉ, điểm trung bình và nhóm học phần cần hoàn thành để xét tốt nghiệp." : page === "curriculum" ? "Tra cứu học phần, tín chỉ và điều kiện học theo chương trình đào tạo." : "Khám phá bước tiếp theo trên hành trình học tập của bạn."}</p></div>
            {page === "overview" && <button className="sw-outline" onClick={() => navigate("profile")}>Xem hồ sơ của tôi <Icon name="arrow" /></button>}
          </div>
          {page === "overview" ? <>
            <section className="so-student-strip" aria-label="Thông tin sinh viên">
              <div className="so-student-identity"><span className="sw-avatar sw-avatar-large">{initials}</span><div><strong>{name}</strong><span>{profile?.email ?? user.email ?? "Chưa cập nhật email"}</span></div></div>
              <dl><div><dt>Mã sinh viên</dt><dd>{loading ? "Đang tải…" : profile?.studentCode ?? "Chưa cập nhật"}</dd></div><div><dt>Khóa · Lớp</dt><dd>{loading ? "Đang tải…" : [profile?.cohortCode, profile?.className].filter(Boolean).join(" · ") || "Chưa cập nhật"}</dd></div><div><dt>Năm nhập học</dt><dd>{loading ? "Đang tải…" : profile?.cohortYear ?? "Chưa cập nhật"}</dd></div></dl>
            </section>
            <StudentOverview profile={profile} loading={loading} navigate={navigate} />
          </> : page === "profile" ? <div className="sr-profile-layout">{profileCard}{profile && <StudentProfileEditor profile={profile} onSaved={() => setReload(n => n + 1)} />}<StudentTranscript /></div> : page === "curriculum" ? <StudentCurriculum /> : page === "plans" ? <StudentPlans /> : page === "graduation" ? <StudentGraduation /> : <section className="sw-panel sw-feature"><span className="sw-card-icon"><Icon name={selected.icon} /></span><span className="sw-tag">Sắp ra mắt</span><h2>{featureCopy[page]?.title}</h2><p>{featureCopy[page]?.text}</p><div className="sw-feature-steps">{featureCopy[page]?.steps.map((step, i) => <div key={step}><span>0{i + 1}</span><h3>{step}</h3></div>)}</div><p className="sw-muted">Chức năng này chưa sẵn sàng sử dụng. Bạn có thể xem thông tin học tập hiện có trong hồ sơ.</p><button className="sw-primary" onClick={() => navigate("profile")}>Xem hồ sơ học tập <Icon name="arrow" /></button></section>}
          <footer className="sw-footer"><span>© 2026 · Bản Quyền Thuộc Khoa Công nghệ Thông tin · Trường Đại Học Văn Lang.</span></footer>
        </main></div>
      </div>
    </div>
  </div>;
}
