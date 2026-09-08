import "./edupath-brand.css";

/** Shared homepage identity. Omit href in admin portals to preserve navigation. */
export default function EduPathBrand({ href, light = false }: { href?: string; light?: boolean }) {
  const content = <><img src="/favicon.svg" width="42" height="42" alt="" /><span className="ep-brand-wordmark">EduPath <em>AI</em><small>AI đồng hành · Học tập bứt phá</small></span></>;
  const className = `ep-brand${light ? " ep-brand-light" : ""}`;
  return href ? <a className={className} href={href} aria-label="EduPath AI — Trang chủ">{content}</a> : <div className={className}>{content}</div>;
}
