import { useState, type KeyboardEvent, type ReactNode } from "react";
import "./landing.css";

type IconName =
  | "arrow"
  | "spark"
  | "cap"
  | "chart"
  | "route"
  | "target"
  | "check"
  | "book"
  | "shield"
  | "menu"
  | "close";

function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: (
      <>
        <path d="M4 12h15M13 5l7 7-7 7" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z" />
        <path d="m20 2 .7 2.3L23 5l-2.3.7L20 8l-.7-2.3L17 5l2.3-.7L20 2Z" />
      </>
    ),
    cap: (
      <>
        <path d="m2 9 10-5 10 5-10 5L2 9Zm4 2v6c4 3 8 3 12 0v-6M22 9v8" />
      </>
    ),
    chart: (
      <>
        <path d="M4 3v17h17M9 15v-4m5 4V7m5 8V4" />
      </>
    ),
    route: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="19" r="2" />
        <path d="M8 5h9a4 4 0 0 1 0 8H7a3 3 0 0 0 0 6h9" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    book: (
      <>
        <path d="M12 5v15M3 4h4c3 0 5 2 5 2s2-2 5-2h4v15h-4c-3 0-5 2-5 2s-2-2-5-2H3V4Z" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    close: <path d="m5 5 14 14M19 5 5 19" />
  };
  return (
    <svg
      className={`lp-icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

const navigation = [
  { id: "gioi-thieu", label: "Về EduPath AI" },
  { id: "tinh-nang", label: "Tính năng" },
  { id: "huong-dan", label: "Cách hoạt động" }
];

const features = [
  {
    id: "nang-luc",
    icon: "chart" as const,
    number: "01",
    title: "Hiểu rõ năng lực của bạn",
    description:
      "Kết nối kết quả học tập và kỹ năng cá nhân để nhận diện điểm mạnh, những khoảng trống và điều bạn cần tập trung tiếp theo."
  },
  {
    id: "lo-trinh",
    icon: "route" as const,
    number: "02",
    title: "Lộ trình học tập có định hướng",
    description:
      "Gợi ý môn học theo từng học kỳ, có xét đến chương trình đào tạo và môn tiên quyết để kế hoạch phù hợp với việc học tại trường."
  },
  {
    id: "nghe-nghiep",
    icon: "target" as const,
    number: "03",
    title: "Đến gần nghề nghiệp mong muốn",
    description:
      "Đối chiếu kỹ năng hiện tại với yêu cầu nghề nghiệp để xác định môn tự chọn, kỹ năng tự học và trải nghiệm cần bổ sung."
  }
];

function Brand({ light = false }: { light?: boolean }) {
  return (
    <a
      className={`lp-brand${light ? " lp-brand-light" : ""}`}
      href="/"
      aria-label="EduPath AI — Trang chủ"
    >
      <img src="/favicon.svg" width="42" height="42" alt="" />
      <span>
        EduPath <em>AI</em>
        <small>AI đồng hành · Học tập bứt phá</small>
      </span>
    </a>
  );
}

function FeaturePreview({ selected, active }: { selected: number; active: boolean }) {
  return (
    <div
      className="lp-preview"
      id={`panel-${features[selected].id}`}
      role="tabpanel"
      aria-labelledby={`tab-${features[selected].id}`}
      tabIndex={0}
      hidden={!active}
    >
      <div className="lp-preview-top">
        <span>
          <img src="/favicon.svg" alt="" width="22" height="22" /> EduPath AI
        </span>
        <span className="lp-demo-label">Dữ liệu minh họa</span>
      </div>
      {selected === 0 ? (
        <div className="lp-preview-body">
          <p className="lp-mini-label">BỨC TRANH NĂNG LỰC</p>
          <h3>Mỗi điểm mạnh, một cơ hội.</h3>
          <p>Kỹ năng trên hành trình trở thành lập trình viên.</p>
          <div className="lp-skills">
            {[
              { label: "Tư duy lập trình", level: "Nền tảng tốt", value: 82 },
              { label: "Phát triển giao diện", level: "Đang phát triển", value: 66 },
              { label: "Cơ sở dữ liệu", level: "Cần củng cố", value: 44 }
            ].map((skill) => (
              <div className="lp-skill" key={skill.label}>
                <div>
                  <strong>{skill.label}</strong>
                  <span>{skill.level}</span>
                </div>
                <div className="lp-skill-track" aria-hidden="true">
                  <span style={{ width: `${skill.value}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="lp-insight">
            <Icon name="spark" />
            <p>
              <strong>Bước tiếp theo dành cho bạn</strong>Củng cố SQL và thực hành thiết kế một cơ
              sở dữ liệu nhỏ.
            </p>
          </div>
        </div>
      ) : selected === 1 ? (
        <div className="lp-preview-body">
          <p className="lp-mini-label">KẾ HOẠCH HỌC TẬP</p>
          <h3>Một lộ trình. Từng bước tiến.</h3>
          <p>Môn học được kết nối với nền tảng bạn đã có.</p>
          <div className="lp-semesters">
            <div className="lp-semester">
              <span>Đã tích lũy</span>
              <h4>Nền tảng</h4>
              <p>
                <Icon name="check" /> Nhập môn lập trình
              </p>
              <p>
                <Icon name="check" /> Cơ sở dữ liệu
              </p>
            </div>
            <Icon name="arrow" />
            <div className="lp-semester lp-semester-next">
              <span>Học kỳ tiếp theo</span>
              <h4>Phát triển</h4>
              <p>
                <Icon name="book" /> Lập trình Web
              </p>
              <p>
                <Icon name="book" /> Cấu trúc dữ liệu
              </p>
            </div>
          </div>
          <div className="lp-insight">
            <Icon name="route" />
            <p>
              <strong>Đặt tính khả thi lên trước</strong>Lộ trình dự kiến được đối chiếu với môn
              tiên quyết của trường.
            </p>
          </div>
        </div>
      ) : (
        <div className="lp-preview-body">
          <p className="lp-mini-label">ĐỊNH HƯỚNG NGHỀ NGHIỆP</p>
          <h3>Học hôm nay, cho ngày mai.</h3>
          <p>Từ mục tiêu nghề nghiệp đến kỹ năng cần trau dồi.</p>
          <div className="lp-career-target">
            <span className="lp-feature-icon">
              <Icon name="target" />
            </span>
            <div>
              <small>MỤC TIÊU CỦA BẠN</small>
              <h4>Front-end Developer</h4>
            </div>
          </div>
          <div className="lp-career-skills">
            <span>
              HTML & CSS <Icon name="check" />
            </span>
            <span>
              JavaScript <Icon name="check" />
            </span>
            <span className="lp-skill-pending">
              React <Icon name="book" />
            </span>
            <span className="lp-skill-pending">
              Kiểm thử <Icon name="book" />
            </span>
          </div>
          <div className="lp-insight">
            <Icon name="spark" />
            <p>
              <strong>Biến định hướng thành hành động</strong>Thực hành một dự án React và bổ sung
              vào portfolio cá nhân.
            </p>
          </div>
        </div>
      )}
      <div className="lp-preview-foot">
        <span className="lp-status-dot" /> Minh họa tính năng dự kiến của đồ án
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState(0);

  function handleTabKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowRight")
      next = (index + 1) % features.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft")
      next = (index + features.length - 1) % features.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = features.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      setSelectedFeature(next);
      document.getElementById(`tab-${features[next].id}`)?.focus();
    }
  }

  return (
    <div className="lp-page">
      <a className="lp-skip-link" href="#noi-dung">
        Chuyển đến nội dung
      </a>
      <div className="lp-announcement">
        <span>Một hành trình học tập, mang dấu ấn của bạn.</span>
        <a href="#gioi-thieu">
          Khám phá EduPath AI <Icon name="arrow" />
        </a>
      </div>
      <header
        className="lp-header"
        onKeyDown={(event) => {
          if (event.key === "Escape" && menuOpen) {
            setMenuOpen(false);
            document.getElementById("landing-menu-toggle")?.focus();
          }
        }}
      >
        <div className="lp-container lp-header-inner">
          <Brand />
          <nav
            className={`lp-navigation${menuOpen ? " is-open" : ""}`}
            id="landing-navigation"
            aria-label="Điều hướng trang tổng quan"
          >
            {navigation.map((item) => (
              <a key={item.id} href={`#${item.id}`} onClick={() => setMenuOpen(false)}>
                {item.label}
              </a>
            ))}
            <a href="#cau-hoi" onClick={() => setMenuOpen(false)}>
              Câu hỏi thường gặp
            </a>
          </nav>
          <div className="lp-header-actions">
            <a className="lp-button lp-button-small" href="/login">
              Đăng nhập <Icon name="arrow" />
            </a>
            <button
              id="landing-menu-toggle"
              type="button"
              className="lp-menu-toggle"
              aria-label={menuOpen ? "Đóng menu" : "Mở menu"}
              aria-expanded={menuOpen}
              aria-controls="landing-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Icon name={menuOpen ? "close" : "menu"} />
            </button>
          </div>
        </div>
      </header>

      <main id="noi-dung">
        <section className="lp-hero">
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-eyebrow">
                <span /> DÀNH CHO SINH VIÊN CNTT VĂN LANG
              </p>
              <h1>
                Hiểu mình hơn.
                <br />
                Chọn đúng hướng.
                <br />
                <em>Vững tương lai.</em>
              </h1>
              <p className="lp-hero-description">
                Từ năng lực hôm nay đến nghề nghiệp ngày mai. EduPath AI giúp bạn kết nối việc học,
                kỹ năng và mục tiêu thành một lộ trình của riêng mình.
              </p>
              <div className="lp-hero-actions">
                <a className="lp-button" href="/login">
                  Bắt đầu hành trình <Icon name="arrow" />
                </a>
                <a className="lp-text-link" href="#tinh-nang">
                  Khám phá tính năng <span>↗</span>
                </a>
              </div>
              <div className="lp-hero-note">
                <Icon name="shield" /> Đăng nhập bằng tài khoản Microsoft Văn Lang
              </div>
            </div>
            <div className="lp-hero-visual">
              <div className="lp-campus-frame">
                <img
                  className="lp-campus-image"
                  src="/vlu-campus.jpg"
                  alt="Phối cảnh khuôn viên Trường Đại học Văn Lang bên sông"
                  width="2100"
                  height="1400"
                  fetchPriority="high"
                />
                <div className="lp-campus-caption">
                  <span>VAN LANG UNIVERSITY</span>
                  <strong>Nơi hành trình của bạn bắt đầu.</strong>
                </div>
              </div>
              <div className="lp-visual-label">
                <Icon name="spark" /> HỌC TẬP CÓ ĐỊNH HƯỚNG
              </div>
              <div className="lp-floating-path">
                <div className="lp-floating-title">
                  <span className="lp-feature-icon">
                    <Icon name="route" />
                  </span>
                  <div>
                    <small>HÀNH TRÌNH CỦA BẠN</small>
                    <strong>Từng bước, đúng hướng.</strong>
                  </div>
                </div>
                <div className="lp-path-stops">
                  <span>
                    <i>
                      <Icon name="check" />
                    </i>
                    Hiểu năng lực
                  </span>
                  <b />
                  <span>
                    <i>2</i>Chọn lộ trình
                  </span>
                  <b />
                  <span>
                    <i>3</i>Chạm mục tiêu
                  </span>
                </div>
              </div>
              <span className="lp-visual-caption">Hình minh họa ý tưởng EduPath AI</span>
            </div>
          </div>
        </section>

        <div className="lp-university-strip">
          <div className="lp-container">
            <img src="/vlu-logo-horizontal.png" alt="Van Lang University" width="180" height="46" />
            <div>
              <strong>Được xây dựng từ câu chuyện học tập của sinh viên.</strong>
              <span>Công nghệ Thông tin · Trường Đại học Văn Lang</span>
            </div>
            <Icon name="cap" />
          </div>
        </div>

        <section
          className="lp-section lp-container"
          id="gioi-thieu"
          aria-labelledby="about-heading"
        >
          <div className="lp-section-heading lp-about-heading">
            <div>
              <p className="lp-eyebrow">VÌ SAO CÓ EDUPATH AI?</p>
              <h2 id="about-heading">
                Đừng đợi đến năm cuối
                <br />
                mới hỏi <em>“mình sẽ làm gì?”</em>
              </h2>
            </div>
            <p>
              Chọn môn nào? Kỹ năng nào còn thiếu? Mình phù hợp với hướng đi nào? Đồ án EduPath AI
              được xây dựng để giúp sinh viên trả lời những câu hỏi ấy sớm hơn, ngay từ năm 2–3.
            </p>
          </div>
          <div className="lp-principles">
            <article>
              <span className="lp-principle-number">01 / HIỂU MÌNH</span>
              <h3>Nhìn xa hơn bảng điểm.</h3>
              <p>
                Kết hợp kết quả học tập, kỹ năng và mục tiêu cá nhân để nhìn rõ điểm xuất phát của
                bạn.
              </p>
            </article>
            <article>
              <span className="lp-principle-number">02 / CHỦ ĐỘNG</span>
              <h3>Mỗi học kỳ đều có ý nghĩa.</h3>
              <p>
                Chuẩn bị sớm để tận dụng những học kỳ còn lại, chọn môn có mục đích và bổ sung nền
                tảng đúng lúc.
              </p>
            </article>
            <article>
              <span className="lp-principle-number">03 / KẾT NỐI</span>
              <h3>Việc học gần hơn với nghề.</h3>
              <p>
                Gắn chương trình đào tạo tại trường với kỹ năng cần thiết trên hành trình bước vào
                thị trường lao động.
              </p>
            </article>
          </div>
        </section>

        <section className="lp-features-section" id="tinh-nang" aria-labelledby="features-heading">
          <div className="lp-container">
            <div className="lp-section-heading">
              <div>
                <p className="lp-eyebrow">MỘT GÓC NHÌN TRỌN VẸN</p>
                <h2 id="features-heading">
                  Từ “mình đang ở đâu”
                  <br />
                  đến <em>“mình muốn trở thành ai”.</em>
                </h2>
              </div>
              <p>
                Ba nhóm tính năng định hướng phát triển của EduPath AI, cùng kết nối trong một hành
                trình học tập.
              </p>
            </div>
            <div className="lp-feature-explorer">
              <div
                className="lp-feature-tabs"
                role="tablist"
                aria-label="Khám phá tính năng dự kiến"
                aria-orientation="vertical"
              >
                {features.map((feature, index) => (
                  <button
                    key={feature.id}
                    id={`tab-${feature.id}`}
                    className={`lp-feature-tab${selectedFeature === index ? " is-active" : ""}`}
                    role="tab"
                    type="button"
                    aria-selected={selectedFeature === index}
                    aria-controls={`panel-${feature.id}`}
                    tabIndex={selectedFeature === index ? 0 : -1}
                    onClick={() => setSelectedFeature(index)}
                    onKeyDown={(event) => handleTabKeys(event, index)}
                  >
                    <span className="lp-feature-icon">
                      <Icon name={feature.icon} />
                    </span>
                    <span>
                      <strong>{feature.title}</strong>
                      <span>{feature.description}</span>
                    </span>
                    <Icon name="arrow" />
                  </button>
                ))}
              </div>
              {features.map((feature, index) => (
                <FeaturePreview
                  key={feature.id}
                  selected={index}
                  active={selectedFeature === index}
                />
              ))}
            </div>
          </div>
        </section>

        <section
          className="lp-section lp-container"
          id="huong-dan"
          aria-labelledby="journey-heading"
        >
          <div className="lp-centered-heading">
            <p className="lp-eyebrow">HÀNH TRÌNH ĐƯỢC THIẾT KẾ CHO BẠN</p>
            <h2 id="journey-heading">
              Bắt đầu từ bạn.
              <br />
              <em>Tiến xa theo cách của bạn.</em>
            </h2>
            <p>Đăng nhập là bước đầu tiên. Đây là hành trình trải nghiệm mà đồ án hướng đến.</p>
          </div>
          <ol className="lp-journey">
            {[
              {
                icon: "shield" as const,
                title: "Kết nối tài khoản",
                description: "Sử dụng tài khoản Microsoft do Văn Lang cấp để truy cập hệ thống.",
                tag: "Đã có thể sử dụng"
              },
              {
                icon: "chart" as const,
                title: "Phác họa năng lực",
                description: "Bổ sung bảng điểm, kỹ năng và mục tiêu để hiểu rõ điểm xuất phát.",
                tag: "Tính năng dự kiến"
              },
              {
                icon: "route" as const,
                title: "Xây dựng lộ trình",
                description:
                  "Tham khảo gợi ý môn học và kỹ năng cần bổ sung theo định hướng đã chọn.",
                tag: "Tính năng dự kiến"
              },
              {
                icon: "target" as const,
                title: "Theo dõi, điều chỉnh",
                description:
                  "Cập nhật tiến bộ qua từng học kỳ và điều chỉnh kế hoạch khi mục tiêu thay đổi.",
                tag: "Tính năng dự kiến"
              }
            ].map((step, index) => (
              <li key={step.title}>
                <div className="lp-step-top">
                  <span>0{index + 1}</span>
                  <Icon name={step.icon} />
                </div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
                <small className={index === 0 ? "lp-step-live" : ""}>{step.tag}</small>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-campus-story" aria-labelledby="campus-heading">
          <div className="lp-campus-story-photo">
            <img
              src="/vlu-campus.jpg"
              alt="Không gian học tập tại cơ sở chính Trường Đại học Văn Lang"
              width="2100"
              height="1400"
              loading="lazy"
            />
          </div>
          <div className="lp-campus-story-copy">
            <p className="lp-eyebrow">MANG TINH THẦN VĂN LANG</p>
            <h2 id="campus-heading">
              Học để trưởng thành.
              <br />
              <em>Sẵn sàng để vươn xa.</em>
            </h2>
            <p>
              Mỗi sinh viên có một điểm xuất phát, một thế mạnh và một ước mơ riêng. EduPath AI
              hướng đến việc đồng hành cùng sinh viên CNTT Văn Lang, để mỗi lựa chọn hôm nay có thể
              mở ra cơ hội cho ngày mai.
            </p>
            <a className="lp-text-link" href="#gioi-thieu">
              Tìm hiểu về đồ án <Icon name="arrow" />
            </a>
          </div>
        </section>

        <section
          className="lp-section lp-container lp-faq"
          id="cau-hoi"
          aria-labelledby="faq-heading"
        >
          <div>
            <p className="lp-eyebrow">BẠN CÓ THỂ ĐANG TÒ MÒ</p>
            <h2 id="faq-heading">
              Một vài điều
              <br />
              <em>trước khi bắt đầu.</em>
            </h2>
            <p>Hiểu thêm về EduPath AI và cách tham gia.</p>
          </div>
          <div className="lp-faq-list">
            {[
              {
                question: "EduPath AI dành cho ai?",
                answer:
                  "Đồ án hướng đến sinh viên Công nghệ Thông tin tại Trường Đại học Văn Lang, đặc biệt là sinh viên năm 2–3 muốn đánh giá năng lực và chủ động chuẩn bị lộ trình học tập, nghề nghiệp."
              },
              {
                question: "Tôi cần tài khoản nào để đăng nhập?",
                answer:
                  "Bạn sử dụng tài khoản Microsoft do Trường Đại học Văn Lang cấp. Nhấn Đăng nhập để đến cổng xác thực Microsoft. EduPath AI không yêu cầu bạn tạo mật khẩu riêng."
              },
              {
                question: "Hiện tại tôi có thể sử dụng những gì?",
                answer:
                  "Hiện hệ thống đã có chức năng đăng nhập Microsoft và nhận diện người dùng. Các nội dung đánh giá năng lực, tư vấn lộ trình và định hướng nghề nghiệp trên trang này mô tả mục tiêu phát triển của đồ án; các hình xem trước sử dụng dữ liệu minh họa."
              },
              {
                question: "Lộ trình AI có thay thế tư vấn của giảng viên không?",
                answer:
                  "Lộ trình dự kiến đóng vai trò tham khảo, hỗ trợ sinh viên chuẩn bị kế hoạch. Bạn vẫn cần đối chiếu chương trình đào tạo, thông báo đăng ký học phần và trao đổi với cố vấn học tập trước khi quyết định."
              }
            ].map((faq) => (
              <details key={faq.question}>
                <summary>
                  {faq.question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-cta">
          <div className="lp-container">
            <div>
              <p className="lp-eyebrow">BƯỚC TIẾP THEO BẮT ĐẦU TỪ HÔM NAY</p>
              <h2>
                Hành trình của bạn.
                <br />
                <em>Định hướng của riêng bạn.</em>
              </h2>
            </div>
            <div className="lp-cta-action">
              <a className="lp-button lp-button-white" href="/login">
                Khám phá EduPath AI <Icon name="arrow" />
              </a>
              <span>Dành cho tài khoản Microsoft Văn Lang</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-main">
            <div>
              <Brand light />
              <p>
                Hệ thống đánh giá năng lực và tư vấn lộ trình học tập cho sinh viên Công nghệ Thông
                tin với AI.
              </p>
            </div>
            <nav aria-label="Liên kết cuối trang">
              <h2>Khám phá</h2>
              {navigation.map((item) => (
                <a key={item.id} href={`#${item.id}`}>
                  {item.label}
                </a>
              ))}
              <a href="#cau-hoi">Câu hỏi thường gặp</a>
            </nav>
            <div className="lp-footer-university">
              <h2>Trường Đại học Văn Lang</h2>
              <p>Đồ án tốt nghiệp · Công nghệ Thông tin</p>
              <a href="https://www.vlu.edu.vn/" target="_blank" rel="noreferrer">
                Website trường <span aria-hidden="true">↗</span>
                <span className="sr-only"> (mở trong tab mới)</span>
              </a>
              <a href="/login">
                Đăng nhập hệ thống <Icon name="arrow" />
              </a>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>© {new Date().getFullYear()} EduPath AI</span>
            <span>AI đồng hành · Học tập bứt phá</span>
            <a href="#noi-dung">Về đầu trang ↑</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
