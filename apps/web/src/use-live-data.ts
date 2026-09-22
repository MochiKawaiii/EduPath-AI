import { useEffect, useRef, useState } from "react";

/** How often a page on screen asks the server for newer data. */
const refreshEvery = 30_000;
/** Focus and visibility changes usually arrive together; one request answers both. */
const minimumGap = 5_000;

/**
 * Fetches `url` and keeps it current on its own, so pages need no reload button:
 * the request repeats every 30 s while the tab is visible and again as soon as
 * the person returns to the tab. These background refreshes leave the page as it
 * is — no loading state, a failed one keeps the last good data, and an unchanged
 * response keeps the same object so nothing re-renders. Only a new `url` or
 * `revision` clears the page and shows loading; after such a load fails, the
 * next refresh tries it again.
 *
 * `read` turns the response into data or throws the message to show. Pass a
 * function declared outside the component so every render hands over the same one.
 */
export function useLiveData<T>(url: string, revision: number | string, read: (response: Response) => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const shown = useRef("");
  const requestedAt = useRef(0);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && Date.now() - requestedAt.current >= minimumGap) setTick((n) => n + 1);
    };
    const timer = window.setInterval(refresh, refreshEvery);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    const request = `${revision} ${url}`;
    const background = shown.current === request;
    const controller = new AbortController();
    if (!background) {
      shown.current = "";
      setState({ data: null, error: null, loading: true });
    }
    requestedAt.current = Date.now();
    void fetch(url, { credentials: "include", cache: "no-store", signal: controller.signal }).then(read)
      .then((data) => {
        if (controller.signal.aborted) return;
        shown.current = request;
        setState((previous) => background && JSON.stringify(previous.data) === JSON.stringify(data) ? previous : { data, error: null, loading: false });
      })
      .catch((error) => { if (!controller.signal.aborted && !background) setState({ data: null, error: (error as Error).message, loading: false }); });
    return () => controller.abort();
  }, [url, revision, read, tick]);
  return state;
}
