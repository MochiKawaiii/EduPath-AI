export type AppRole = "admin" | "student" | "faculty_board" | "department_head" | "lecturer";
export const canAccessAdmin = (role: AppRole) => ["admin", "faculty_board", "department_head", "lecturer"].includes(role);

export interface AuthTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
  returnTo: string;
  createdAt: number;
}

export interface MicrosoftIdentity {
  tenantId: string;
  objectId: string;
  subject: string;
  name: string;
  email: string | null;
  username: string | null;
  // The login_hint optional claim, replayed as logout_hint so Microsoft can end
  // the right session without showing its account picker.
  loginHint: string | null;
  roles: string[];
  nonce: string;
  audience: string;
  issuer: string;
  expiresAt: number;
}

export interface AuthenticatedUser {
  authVersion?: number;
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

export interface MicrosoftAuthClient {
  getAuthorizationUrl(transaction: AuthTransaction): Promise<string>;
  exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
    nonce: string
  ): Promise<MicrosoftIdentity>;
  getLogoutUrl(
    tenantId?: string,
    returnPath?: "/" | "/quantri",
    logoutHint?: string
  ): string;
}
