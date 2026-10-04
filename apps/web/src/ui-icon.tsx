/** Shared 24px line-icon family for public, student and administration screens. */
const paths: Record<string, string> = {
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8",
  info: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 11v6M12 7v1",
  download: "M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6",
  upload: "M12 16V4m-5 5 5-5 5 5M4 15v6h16v-6",
  edit: "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  plus: "M12 5v14M5 12h14",
  book: "M12 5v16M12 5C9 2 4 2 2 3v16c4-1 7 0 10 2 3-2 6-3 10-2V3c-2-1-7-1-10 2Z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  add: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M20 8v6M17 11h6",
  profile: "M4 3h16v18H4zM9 8a3 3 0 1 0 6 0 3 3 0 1 0-6 0M7 18a5 5 0 0 1 10 0",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3ZM8 12l3 3 5-6",
  lock: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4M12 14v3",
  clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 6v6l4 2",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  logout: "M9 21H3V3h6M10 12h12M18 8l4 4-4 4",
  menu: "M3 6h18M3 12h18M3 18h18",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  unlock: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 7.75-1.4M12 14v3",
  chevron: "m9 6 6 6-6 6",
  chevronDown: "m6 9 6 6 6-6",
  back: "m12 19-7-7 7-7M19 12H5",
  refresh: "M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8M21 3v5h-5",
  close: "M18 6 6 18M6 6l12 12",
  home: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
  chart: "M4 20V10m8 10V4m8 16v-7M2 21h20",
  compass: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM16 8l-3 5-5 3 3-5 5-3Z",
  route: "M8 5h9a4 4 0 0 1 0 8H7a3 3 0 0 0 0 6h9M8 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM20 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z",
  bell: "M5 17h14l-2-3V8A5 5 0 0 0 7 8v6l-2 3ZM10 21h4",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  arrowUpRight: "M7 17 17 7M7 7h10v10",
  arrowUp: "M12 20V4m-6 6 6-6 6 6",
  help: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v1",
  cap: "m2 9 10-5 10 5-10 5L2 9Zm4 2v6c4 3 8 3 12 0v-6M22 9v8",
  check: "m5 12 4 4L19 6",
  target: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  document: "M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 8h8M8 12h8M8 16h5"
};

export function Icon({ name, className = "" }: { name: string; className?: string }) {
  const canonicalName = name === "exit" ? "logout" : name;
  if (name === "more") return <svg className={`ep-icon ${className}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>;
  return <svg className={`ep-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[canonicalName] ?? paths.book} /></svg>;
}
