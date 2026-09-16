export type AppRole = "admin" | "student" | "faculty_board" | "department_head" | "lecturer";
export const canAccessAdmin = (role: AppRole) => ["admin", "faculty_board", "department_head", "lecturer"].includes(role);

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
  // studentPortal is false for staff mailboxes, which belong to the admin portal only.
  | { authenticated: true; user: AuthenticatedUser; studentPortal?: boolean };
