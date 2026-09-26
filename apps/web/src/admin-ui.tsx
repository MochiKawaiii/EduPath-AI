import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon, readResponse } from "./admin-account-shared";
import { useLiveData } from "./use-live-data";
import { layoutZoom } from "./page-scale";

export function useData<T>(url: string, revision = 0) {
  const [retry, setRetry] = useState(0);
  return { ...useLiveData<T>(url, `${revision}.${retry}`, readResponse), retry: () => setRetry((n) => n + 1) };
}
export function Status({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => void }) {
  return loading ? <p className="am-empty" role="status">Đang tải dữ liệu…</p> : error ? <div className="am-empty"><p className="admin-error" role="alert">{error}</p><button className="am-outline" onClick={retry}><Icon name="refresh" /> Thử lại</button></div> : null;
}
export function Pagination({ total, page, setPage }: { total: number; page: number; setPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / 10));
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages, setPage]);
  return <div className="am-pagination"><span role="status">{total} kết quả</span><div><button className="am-outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button><span>Trang {page} / {pages}</span><button className="am-outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau</button></div></div>;
}
export function Modal({ title, children, onClose, busy = false, size }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; size?: "sm" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    opener.current ??= document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); opener.current?.focus(); };
  }, []);
  return <dialog ref={ref} className={`am-dialog${size === "sm" ? " am-dialog-sm" : ""}`} aria-labelledby="account-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}><div className="am-dialog-heading"><h2 id="account-dialog-title">{title}</h2><button className="am-icon-btn" type="button" disabled={busy} onClick={onClose} aria-label="Đóng hộp thoại" title="Đóng"><Icon name="close" /></button></div>{children}</dialog>;
}
export type MenuEntry = { key: string; icon: string; label: string; danger?: boolean; disabled?: boolean; onSelect: () => void };
/** The ⋮ row-actions button and the popup menu it opens, shared so every admin
    table offers its row actions the same way. */
export function ActionMenu({ label, items, note }: { label: string; items: MenuEntry[]; note?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    // The popup hangs off the row button, so it is placed by measurement: fixed
    // to the viewport to escape the table's horizontal scroll, flipped above the
    // button when the row sits near the bottom of the screen.
    function position() {
      const anchor = trigger.current, box = popup.current;
      if (!anchor || !box) return;
      const zoom = layoutZoom(anchor), gap = 6 * zoom, edge = 8 * zoom;
      const rect = anchor.getBoundingClientRect(), menu = box.getBoundingClientRect();
      const left = Math.max(edge, Math.min(rect.right - menu.width, window.innerWidth - menu.width - edge));
      const below = rect.bottom + gap, above = rect.top - menu.height - gap;
      const top = below + menu.height <= window.innerHeight - edge ? below
        : above >= edge ? above
          : Math.max(edge, window.innerHeight - menu.height - edge);
      setPlace({ top: top / zoom, left: left / zoom });
    }
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    popup.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    const away = (event: Event) => { const target = event.target as Node; if (!popup.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false); };
    const keyed = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", keyed, true);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", keyed, true); };
  }, [open]);
  function step(by: number) {
    const buttons = [...popup.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []];
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[at < 0 ? (by > 0 ? 0 : buttons.length - 1) : (at + by + buttons.length) % buttons.length].focus();
  }
  function pick(item: MenuEntry) { trigger.current?.focus(); setOpen(false); item.onSelect(); }
  return <div className="am-menu-anchor">
    <button ref={trigger} className="am-icon-btn" type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} title="Thao tác" onClick={() => { setPlace(null); setOpen(!open); }}><Icon name="more" /></button>
    {open && <div ref={popup} className="am-menu" style={place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: "hidden" }}>
      <div className="am-menu-items" role="menu" aria-label={label}
        onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); step(event.key === "ArrowDown" ? 1 : -1); } }}>
        {items.map((item) => <button key={item.key} type="button" role="menuitem" className={`am-menu-item${item.danger ? " am-menu-danger" : ""}`} disabled={item.disabled} onClick={() => pick(item)}><Icon name={item.icon} />{item.label}</button>)}
      </div>
      {note && <p className="am-menu-note">{note}</p>}
    </div>}
  </div>;
}
