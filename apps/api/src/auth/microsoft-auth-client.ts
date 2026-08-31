import {
  ConfidentialClientApplication,
  LogLevel,
  ResponseMode,
  type AuthenticationResult,
  type Configuration
} from "@azure/msal-node";
import type { AppConfig } from "../config.js";
import type {
  AuthTransaction,
  MicrosoftAuthClient,
  MicrosoftIdentity
} from "./types.js";

const LOGIN_SCOPES = ["openid", "profile", "email"];

type Claims = Record<string, unknown>;

function requiredString(claims: Claims, key: string): string {
  const value = claims[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The Microsoft ID token is missing the ${key} claim`);
  }
  return value;
}

function optionalString(claims: Claims, key: string): string | null {
  const value = claims[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function identityFromResult(result: AuthenticationResult): MicrosoftIdentity {
  const claims = result.idTokenClaims as Claims | undefined;
  if (!claims) throw new Error("Microsoft did not return ID token claims");

  const roles = Array.isArray(claims.roles)
    ? claims.roles.filter((role): role is string => typeof role === "string")
    : [];
  const expiresAt = claims.exp;
  if (typeof expiresAt !== "number") {
    throw new Error("The Microsoft ID token is missing the exp claim");
  }

  return {
    tenantId: requiredString(claims, "tid"),
    objectId: requiredString(claims, "oid"),
    subject: requiredString(claims, "sub"),
    name:
      optionalString(claims, "name") ??
      optionalString(claims, "preferred_username") ??
      "Microsoft user",
    email: optionalString(claims, "email"),
    username: optionalString(claims, "preferred_username"),
    roles,
    nonce: requiredString(claims, "nonce"),
    audience: requiredString(claims, "aud"),
    issuer: requiredString(claims, "iss"),
    expiresAt
  };
}

export class MsalMicrosoftAuthClient implements MicrosoftAuthClient {
  private readonly client: ConfidentialClientApplication;

  public constructor(private readonly config: AppConfig) {
    const msalConfig: Configuration = {
      auth: {
        clientId: config.entra.clientId,
        clientSecret: config.entra.clientSecret,
        authority: config.entra.authority
      },
      system: {
        loggerOptions: {
          piiLoggingEnabled: false,
          logLevel: LogLevel.Warning,
          loggerCallback: (_level, message, containsPii) => {
            if (!containsPii && config.nodeEnv !== "test") {
              console.warn(`[MSAL] ${message}`);
            }
          }
        }
      }
    };
    this.client = new ConfidentialClientApplication(msalConfig);
  }

  public getAuthorizationUrl(transaction: AuthTransaction): Promise<string> {
    return this.client.getAuthCodeUrl({
      scopes: LOGIN_SCOPES,
      redirectUri: this.config.entra.redirectUri,
      responseMode: ResponseMode.QUERY,
      prompt: "select_account",
      state: transaction.state,
      nonce: transaction.nonce,
      codeChallenge: transaction.codeChallenge,
      codeChallengeMethod: "S256"
    });
  }

  public async exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
    nonce: string
  ): Promise<MicrosoftIdentity> {
    const result = await this.client.acquireTokenByCode({
      code,
      scopes: LOGIN_SCOPES,
      redirectUri: this.config.entra.redirectUri,
      codeVerifier,
      nonce
    });
    return identityFromResult(result);
  }

  public getLogoutUrl(tenantId?: string): string {
    const tenant = tenantId ?? "organizations";
    const url = new URL(
      `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/logout`
    );
    url.searchParams.set(
      "post_logout_redirect_uri",
      this.config.entra.postLogoutRedirectUri
    );
    return url.toString();
  }
}
