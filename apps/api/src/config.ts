import { z } from "zod";

const booleanFromString = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  return value.trim().toLowerCase() === "true";
}, z.boolean());

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url().optional(),
  RENDER_EXTERNAL_HOSTNAME: z.string().trim().min(1).optional(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must contain at least 32 characters"),
  SESSION_MAX_AGE_MS: z.coerce.number().int().positive().default(28_800_000),
  TRUST_PROXY: booleanFromString.default(false),
  ENTRA_CLIENT_ID: z.uuid(),
  ENTRA_CLIENT_SECRET: z.string().min(1),
  ENTRA_TENANT_ID: z.uuid().optional(),
  ENTRA_AUTHORITY: z.url().default("https://login.microsoftonline.com/organizations"),
  ENTRA_REDIRECT_URI: z.url().optional(),
  ENTRA_POST_LOGOUT_REDIRECT_URI: z.url().optional(),
  ENTRA_ALLOW_ANY_TENANT: booleanFromString.default(false),
  ENTRA_ALLOWED_TENANT_IDS: z.string().default(""),
  AUTH_DEFAULT_ROLE: z.enum(["student", "none"]).default("none")
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  webOrigin: string;
  session: {
    secret: string;
    maxAgeMs: number;
    secure: boolean;
  };
  trustProxy: boolean;
  entra: {
    clientId: string;
    clientSecret: string;
    tenantId?: string;
    authority: string;
    redirectUri: string;
    postLogoutRedirectUri: string;
    allowAnyTenant: boolean;
    allowedTenantIds: ReadonlySet<string>;
  };
  authDefaultRole: "student" | "none";
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const renderOrigin = parsed.RENDER_EXTERNAL_HOSTNAME
    ? `https://${parsed.RENDER_EXTERNAL_HOSTNAME}`
    : undefined;
  const webOrigin = (parsed.WEB_ORIGIN ?? renderOrigin ?? "http://localhost:5173")
    .replace(/\/$/, "");
  const redirectUri =
    parsed.ENTRA_REDIRECT_URI ??
    new URL("/api/auth/microsoft/callback", `${webOrigin}/`).toString();
  const postLogoutRedirectUri =
    parsed.ENTRA_POST_LOGOUT_REDIRECT_URI ??
    new URL("/", `${webOrigin}/`).toString();
  const allowedTenantIds = new Set(
    parsed.ENTRA_ALLOWED_TENANT_IDS.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );

  if (parsed.ENTRA_TENANT_ID) {
    allowedTenantIds.add(parsed.ENTRA_TENANT_ID.toLowerCase());
  }

  if (!parsed.ENTRA_ALLOW_ANY_TENANT && allowedTenantIds.size === 0) {
    throw new Error(
      "At least one tenant must be configured when ENTRA_ALLOW_ANY_TENANT is false"
    );
  }

  if (
    parsed.NODE_ENV === "production" &&
    parsed.ENTRA_ALLOW_ANY_TENANT &&
    parsed.AUTH_DEFAULT_ROLE === "student"
  ) {
    throw new Error(
      "Production cannot allow every tenant while assigning Student as the default role"
    );
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    webOrigin,
    session: {
      secret: parsed.SESSION_SECRET,
      maxAgeMs: parsed.SESSION_MAX_AGE_MS,
      secure: parsed.NODE_ENV === "production"
    },
    trustProxy: parsed.TRUST_PROXY,
    entra: {
      clientId: parsed.ENTRA_CLIENT_ID,
      clientSecret: parsed.ENTRA_CLIENT_SECRET,
      ...(parsed.ENTRA_TENANT_ID ? { tenantId: parsed.ENTRA_TENANT_ID } : {}),
      authority: parsed.ENTRA_AUTHORITY.replace(/\/$/, ""),
      redirectUri,
      postLogoutRedirectUri,
      allowAnyTenant: parsed.ENTRA_ALLOW_ANY_TENANT,
      allowedTenantIds
    },
    authDefaultRole: parsed.AUTH_DEFAULT_ROLE
  };
}
