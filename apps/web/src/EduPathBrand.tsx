import "./edupath-brand.css";

/** Shared homepage identity. Omit href in admin portals to preserve navigation. */
export default function EduPathBrand({ href, light = false }: { href?: string; light?: boolean }) {
  const content = <img src="/edupath-logo.png" width="2172" height="724" alt="EduPath AI — AI đồng hành · Học tập bứt phá" />;
  const className = `ep-brand${light ? " ep-brand-light" : ""}`;
  return href ? <a className={className} href={href} aria-label="EduPath AI — Trang chủ">{content}</a> : <div className={className}>{content}</div>;
}
