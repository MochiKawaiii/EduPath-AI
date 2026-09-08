export type AppRoute = "landing" | "login" | "authenticated" | "admin";

export function resolveAppRoute(pathname: string, search: string): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/quantri" || path.startsWith("/quantri/")) return "admin";
  if (path === "/") {
    // Older deployments sent authentication failures to the home page.
    return new URLSearchParams(search).has("authError") ? "login" : "landing";
  }
  return path === "/login" ? "login" : "authenticated";
}

export function safeReturnTo(search: string): string {
  const fallback = "/dashboard";
  const value = new URLSearchParams(search).get("returnTo");
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const base = "https://edupath.local";
    const target = new URL(value, base);
    // Only known application destinations are allowed.
    // Returning to /login or /auth/callback would create a redirect loop.
    if (target.origin !== base || !["/dashboard", "/quantri"].includes(target.pathname)) {
      return fallback;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
