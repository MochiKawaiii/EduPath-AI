import { useEffect, useState } from "react";
import EduPathBrand from "./EduPathBrand";
import PublicFooter from "./PublicFooter";
import FaqAnswer, { withEmailLinks } from "./FaqAnswer";
import { Icon } from "./ui-icon";
import { frequentlyAskedQuestions, informationPolicies, policyUpdatedAt, publicInformationLinks, supportEmail, type PolicyKind } from "./public-information";
import "./landing.css";
import "./public-information.css";

function Chevron({ className = "" }: { className?: string }) {
  return <Icon name="chevronDown" className={`pi-chevron ${className}`} />;
}

function QuestionIcon() {
  return <Icon name="help" className="pi-question-icon" />;
}

const policyGroups: { kind: PolicyKind; id: string; title: string }[] = [
  { kind: "privacy", id: "bao-mat", title: "Chính sách bảo mật" },
  { kind: "terms", id: "dieu-khoan", title: "Điều khoản sử dụng" }
];

const policyCategories = policyGroups.flatMap((group) =>
  informationPolicies[group.kind].categories.map((category) => ({
    ...category,
    groupId: group.id,
    fragment: `${group.id}-${category.id}`
  }))
);

function categoryFromLocation() {
  const fragment = window.location.hash.slice(1);
  const category = policyCategories.find((item) => item.fragment === fragment || item.groupId === fragment);
  if (category) return category.fragment;
  return window.location.pathname.replace(/\/+$/, "") === "/dieu-khoan-su-dung"
    ? policyCategories.find((item) => item.groupId === "dieu-khoan")!.fragment
    : policyCategories[0].fragment;
}

function PolicyContent() {
  const [activeId, setActiveId] = useState(categoryFromLocation);
  const activeCategory = policyCategories.find((category) => category.fragment === activeId)!;

  useEffect(() => {
    const updateCategory = () => setActiveId(categoryFromLocation());
    window.addEventListener("hashchange", updateCategory);
    window.addEventListener("popstate", updateCategory);
    return () => {
      window.removeEventListener("hashchange", updateCategory);
      window.removeEventListener("popstate", updateCategory);
    };
  }, []);

  function selectCategory(fragment: string) {
    setActiveId(fragment);
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}#${fragment}`);
  }

  return (
    <>
      <section className="pi-policy-banner" aria-labelledby="information-heading">
        <img src="/vlu-information-campus.jpg" width="2048" height="1365" alt="" fetchPriority="high" />
        <div className="pi-policy-container"><h1 id="information-heading">Chính sách & Điều khoản</h1></div>
      </section>
      <div className="pi-policy-container pi-policy-layout">
        <aside className="pi-policy-sidebar">
          <h2 className="pi-policy-column-heading">Danh mục</h2>
          <nav className="pi-policy-menu" aria-label="Mục lục chính sách và điều khoản">
            {policyGroups.map((group) => (
              <div className="pi-policy-menu-group" id={group.id} key={group.id}>
                <h3>{group.title}</h3>
                {policyCategories.filter((category) => category.groupId === group.id).map((category) => (
                  <button key={category.fragment} type="button" aria-current={activeId === category.fragment ? "true" : undefined} aria-controls="policy-description" onClick={() => selectCategory(category.fragment)}>
                    <span>{category.label}</span><Chevron />
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>
        <section className="pi-policy-content" aria-labelledby="policy-description-heading">
          <h2 className="pi-policy-column-heading" id="policy-description-heading">Thông tin mô tả</h2>
          <div id="policy-description" aria-live="polite">
            <section id={activeCategory.fragment} key={activeCategory.fragment} aria-labelledby="policy-category-heading">
              <h3 id="policy-category-heading" className="pi-policy-category-title">{activeCategory.label}</h3>
              <div className="pi-policy-accordions">
                {activeCategory.sections.map((section) => (
                  <details className="pi-policy-detail" key={section.title} open>
                    <summary>{section.title}</summary>
                    <div className="pi-policy-text">
                      {section.paragraphs.map((block, index) => typeof block === "string"
                        ? <p key={index}>{withEmailLinks(block)}</p>
                        : <ul key={index}>{block.map((item) => <li key={item}>{withEmailLinks(item)}</li>)}</ul>)}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          </div>
          <p className="pi-policy-updated">Cập nhật lần cuối: {policyUpdatedAt}</p>
          <p className="pi-policy-help">Cần hướng dẫn sử dụng EduPath AI? <a href="/cau-hoi-thuong-gap">Xem câu hỏi thường gặp <Icon name="arrow" /></a></p>
        </section>
      </div>
    </>
  );
}

function FrequentlyAskedQuestions() {
  return (
    <section className="pi-faq" aria-labelledby="information-heading">
      <div className="pi-container">
        <h1 id="information-heading">Câu hỏi thường gặp</h1>
        <div className="pi-faq-list">
          {frequentlyAskedQuestions.map((faq) => (
            <details className="pi-faq-detail" key={faq.question}>
              <summary><QuestionIcon /><span>{faq.question}</span><Chevron /></summary>
              <FaqAnswer faq={faq} />
            </details>
          ))}
        </div>
        <p className="pi-faq-help">Bạn cần thêm hỗ trợ? Hãy gửi email đến <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>
      </div>
    </section>
  );
}

export default function PublicInformationPage({ page }: { page: "policy" | "faq" }) {
  const title = page === "faq" ? "Câu hỏi thường gặp" : "Chính sách & Điều khoản";
  const currentHref = publicInformationLinks[page === "policy" ? 0 : 1].href;
  useEffect(() => {
    document.title = `${title} – EduPath AI`;
    if (page === "policy") {
      const pathname = window.location.pathname.replace(/\/+$/, "");
      if (pathname === "/chinh-sach-bao-mat" || pathname === "/dieu-khoan-su-dung") {
        const fragment = window.location.hash || (pathname === "/chinh-sach-bao-mat" ? "#bao-mat" : "#dieu-khoan");
        window.history.replaceState(null, "", `${publicInformationLinks[0].href}${window.location.search}${fragment}`);
      }
      if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    }
  }, [page, title]);

  return (
    <div className={`lp-page pi-page${page === "policy" ? " pi-page-policy" : ""}`}>
      <a className="lp-skip-link" href="#noi-dung">Chuyển đến nội dung</a>
      <header className="lp-header pi-header">
        <div className={`${page === "policy" ? "pi-policy-container" : "pi-container"} pi-header-inner`}>
          <EduPathBrand href="/" />
          <nav className="pi-navigation" aria-label="Điều hướng thông tin">
            <a href="/">Trang chủ</a>
            {publicInformationLinks.map((link) => <a key={link.href} href={link.href} aria-current={link.href === currentHref ? "page" : undefined}>{link.label}</a>)}
          </nav>
          <a className="lp-button lp-button-small pi-login" href="/login">Đăng nhập <Icon name="arrow" /></a>
        </div>
      </header>
      <main id="noi-dung">
        {page === "faq" ? <FrequentlyAskedQuestions /> : <PolicyContent />}
      </main>
      <PublicFooter />
    </div>
  );
}
