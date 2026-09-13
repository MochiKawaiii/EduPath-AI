import { useEffect, useRef, useState } from "react";

type Filters = { q: string } & Record<string, string>;
export function validFilterDates(filters: Record<string, string>) {
  const { from, to } = filters;
  const valid = (date: string | undefined) => !date || (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= "0001-01-01" && date <= "9999-12-30" && Number.isFinite(Date.parse(`${date}T00:00:00+07:00`)));
  return valid(from) && valid(to) && (!from || !to || from <= to);
}

export function useLiveFilters<T extends Filters>(initial: T) {
  const [draft, setInput] = useState(initial);
  const [filters, setFilters] = useState(initial);
  const [page, setPage] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => { clearTimeout(timer.current); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const apply = (value: T) => {
    if (!validFilterDates(value)) return;
    setFilters({ ...value, q: value.q.trim() });
    setPage(1);
  };
  const setDraft = (value: T) => {
    cancel();
    setInput(value);
    if (value.q !== draft.q && value.q.trim()) timer.current = setTimeout(() => apply(value), 300);
    else apply(value);
  };
  const flush = () => { cancel(); apply(draft); };
  const reset = () => { cancel(); setInput(initial); apply(initial); };
  return { draft, setDraft, filters, page, setPage, flush, reset, datesValid: validFilterDates(draft) };
}
