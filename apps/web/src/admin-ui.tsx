import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { readResponse } from "./admin-account-shared";

export function useData<T>(url: string, revision = 0) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, error: null, loading: true });
    void fetch(url, { credentials: "include", cache: "no-store", signal: controller.signal }).then(readResponse<T>)
      .then((data) => { if (!controller.signal.aborted) setState({ data, error: null, loading: false }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ data: null, error: error.message, loading: false }); });
    return () => controller.abort();
  }, [url, revision, retry]);
  return { ...state, retry: () => setRetry((n) => n + 1) };
}
export function Status({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => void }) {
  return loading ? <p className="am-empty" role="status">Đang tải dữ liệu…</p> : error ? <div className="am-empty"><p className="admin-error" role="alert">{error}</p><button className="am-outline" onClick={retry}>Thử lại</button></div> : null;
}
export function Pagination({ total, page, setPage }: { total: number; page: number; setPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / 10));
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages, setPage]);
  return <div className="am-pagination"><span role="status">{total} kết quả</span><div><button className="am-outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button><span>Trang {page} / {pages}</span><button className="am-outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau</button></div></div>;
}
export function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    opener.current ??= document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); opener.current?.focus(); };
  }, []);
  return <dialog ref={ref} className="am-dialog" aria-labelledby="account-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}><div className="am-dialog-heading"><h2 id="account-dialog-title">{title}</h2><button className="am-outline" disabled={busy} onClick={onClose} aria-label="Đóng hộp thoại">Đóng</button></div>{children}</dialog>;
}
