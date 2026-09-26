/** Line icons shared by the student portal screens. */
export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8",
    user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
    chart: "M4 20V10m8 10V4m8 16v-7M2 21h20",
    compass: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM16 8l-3 5-5 3 3-5 5-3Z",
    route: "M5 3v12a5 5 0 0 0 10 0V9m-4 4 4-4 4 4M2 3h6",
    book: "M12 5v16M3 3l9 2 9-2v16l-9 2-9-2V3Z",
    shield: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4",
    spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z",
    bell: "M5 17h14l-2-3V8A5 5 0 0 0 7 8v6l-2 3ZM10 21h4",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6",
    logout: "M9 3H3v18h6m1-9h12m-5-5 5 5-5 5",
    menu: "M3 6h18M3 12h18M3 18h18",
    help: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v1",
    refresh: "M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8M21 3v5h-5",
    upload: "M12 16V4m-5 5 5-5 5 5M4 15v6h16v-6",
    trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
    edit: "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z"
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.book} /></svg>;
}
