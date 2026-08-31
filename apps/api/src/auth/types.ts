export type AppRole = "admin" | "student";

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
  roles: string[];
  nonce: string;
  audience: string;
  issuer: string;
  expiresAt: number;
}

export interface AuthenticatedUser {
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
  getLogoutUrl(tenantId?: string): string;
}
