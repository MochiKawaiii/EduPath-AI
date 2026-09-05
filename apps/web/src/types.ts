export type AppRole = "admin" | "student";

export interface AuthenticatedUser {
  userId: string;
  identityKey: string;
  tenantId: string;
  objectId: string;
  name: string;
  email: string | null;
  username: string | null;
  role: AppRole;
  signedInAt: string;
}

export type AuthResponse =
  | { authenticated: false }
  | { authenticated: true; user: AuthenticatedUser };
