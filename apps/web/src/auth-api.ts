import type { AuthResponse } from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function getCurrentUser(): Promise<AuthResponse> {
  const response = await fetch("/api/auth/me", {
    credentials: "include",
    headers: { Accept: "application/json" }
  });
  return parseJson<AuthResponse>(response);
}

export function beginMicrosoftLogin(returnTo = "/dashboard"): void {
  const target = new URL("/api/auth/microsoft/start", window.location.origin);
  target.searchParams.set("returnTo", returnTo);
  window.location.assign(target.toString());
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" }
  });
  const data = await parseJson<{ logoutUrl: string }>(response);
  window.location.assign(data.logoutUrl);
}

