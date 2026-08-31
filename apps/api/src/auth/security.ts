import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config.js";
import type {
  AppRole,
  AuthTransaction,
  AuthenticatedUser,
  MicrosoftIdentity
} from "./types.js";

const AUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;

export function normalizeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/dashboard";
  if (value.startsWith("//") || value.includes("\\") || value.includes("\0")) {
    return "/dashboard";
  }

  try {
    const parsed = new URL(value, "https://edupath.local");
    if (parsed.origin !== "https://edupath.local") return "/dashboard";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/dashboard";
  }
}

export function createAuthTransaction(returnTo: unknown): AuthTransaction {
  const codeVerifier = randomBytes(64).toString("base64url");
  return {
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
    returnTo: normalizeReturnTo(returnTo),
    createdAt: Date.now()
  };
}

export function isSafeEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function isAuthTransactionFresh(transaction: AuthTransaction): boolean {
  const age = Date.now() - transaction.createdAt;
  return age >= 0 && age <= AUTH_TRANSACTION_TTL_MS;
}

export function assertIdentityIsAllowed(
  identity: MicrosoftIdentity,
  transaction: AuthTransaction,
  config: AppConfig
): void {
  if (!isSafeEqual(identity.nonce, transaction.nonce)) {
    throw new Error("The ID token nonce is invalid");
  }

  if (identity.audience !== config.entra.clientId) {
    throw new Error("The ID token audience is invalid");
  }

  const expectedIssuer = `https://login.microsoftonline.com/${identity.tenantId}/v2.0`;
  if (identity.issuer !== expectedIssuer) {
    throw new Error("The ID token issuer is invalid");
  }

  if (identity.expiresAt * 1000 <= Date.now()) {
    throw new Error("The ID token has expired");
  }

  if (
    !config.entra.allowAnyTenant &&
    !config.entra.allowedTenantIds.has(identity.tenantId.toLowerCase())
  ) {
    throw new Error("The Microsoft Entra tenant is not allowed");
  }
}

export function resolveAppRole(
  roles: readonly string[],
  defaultRole: AppConfig["authDefaultRole"]
): AppRole {
  if (roles.includes("Admin")) return "admin";
  if (roles.includes("Student")) return "student";
  if (defaultRole === "student") return "student";
  throw new Error("The account has not been assigned an EduPath role");
}

export function toAuthenticatedUser(
  identity: MicrosoftIdentity,
  role: AppRole
): AuthenticatedUser {
  return {
    identityKey: `${identity.tenantId}:${identity.objectId}`,
    tenantId: identity.tenantId,
    objectId: identity.objectId,
    name: identity.name,
    email: identity.email,
    username: identity.username,
    role,
    signedInAt: new Date().toISOString()
  };
}

