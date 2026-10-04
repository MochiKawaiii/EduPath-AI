import EduPathBrand from "./EduPathBrand";
import { publicInformationLinks } from "./public-information";
import { Icon } from "./ui-icon";

export default function PublicFooter({ home = false, portal }: { home?: boolean; portal?: string | null }) {
  const homePrefix = home ? "" : "/";
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer-main">
          <div>
            <EduPathBrand href="/" light />
            <p>Hệ thống đánh giá năng lực và tư vấn lộ trình học tập cho sinh viên Công nghệ Thông tin với AI.</p>
          </div>
          <nav aria-label="Liên kết cuối trang">
            <h2>Khám phá</h2>
            <a href={`${homePrefix}#gioi-thieu`}>Về EduPath AI</a>
            <a href={`${homePrefix}#tinh-nang`}>Tính năng</a>
            <a href={`${homePrefix}#huong-dan`}>Cách hoạt động</a>
            {publicInformationLinks.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
          </nav>
          <div className="lp-footer-university">
            <h2>Trường Đại học Văn Lang · Khoa Công nghệ Thông tin</h2>
            <a href="https://www.vlu.edu.vn/" target="_blank" rel="noreferrer">
              Website trường <Icon name="arrowUpRight" />
              <span className="sr-only"> (mở trong tab mới)</span>
            </a>
            <a href={portal ?? "/login"}>
              {portal ? "Quay lại cổng quản lý học tập" : "Đăng nhập hệ thống"} <Icon name="arrow" />
            </a>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span>© {new Date().getFullYear()} · Bản Quyền Thuộc Khoa Công nghệ Thông tin · Trường Đại Học Văn Lang.</span>
          <span>AI đồng hành · Học tập bứt phá</span>
          <a href="#noi-dung">Về đầu trang <Icon name="arrowUp" /></a>
        </div>
      </div>
    </footer>
  );
}
