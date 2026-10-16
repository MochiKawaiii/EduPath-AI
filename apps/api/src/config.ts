import { z } from "zod";

const booleanFromString = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  return value.trim().toLowerCase() === "true";
}, z.boolean());

const postgresUrl = z.string().trim().min(1).refine((value) => {
  try {
    return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, "DATABASE_URL must be a valid PostgreSQL connection URL");

const optionalWorkerKey = z.preprocess(v => typeof v === "string" && !v.trim() ? undefined : v, z.string().min(32).optional());
const blankToUndefined = (value: unknown) => typeof value === "string" && !value.trim() ? undefined : typeof value === "string" ? value.trim() : value;

const environmentSchema = z.object({
  OCR_WORKER_KEY: optionalWorkerKey,
  // Bearer key of the local AI worker (competency comments). Optional: without it AI is disabled.
  AI_WORKER_KEY: optionalWorkerKey,
  // Claude API key of the competency "AI 100%" mode (comp-ai-v1). Optional: when set, the API server itself
  // computes the competency numbers and comments with Claude instead of queuing laptop comments.
  ANTHROPIC_API_KEY: z.preprocess(blankToUndefined, z.string().min(20).regex(/^\S+$/).optional()),
  // Workspace of a key that is not scoped to one ("sk-ant-usr-…"); sent as the anthropic-workspace-id header.
  ANTHROPIC_WORKSPACE_ID: z.preprocess(blankToUndefined, z.string().regex(/^wrkspc_[A-Za-z0-9]+$/).optional()),
  ANTHROPIC_MODEL: z.preprocess(blankToUndefined, z.string().min(1).default("claude-haiku-5-5")),
  ANTHROPIC_EFFORT: z.preprocess(blankToUndefined, z.enum(["low", "medium", "high", "xhigh", "max"]).default("high")),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url().optional(),
  RENDER_EXTERNAL_HOSTNAME: z.string().trim().min(1).optional(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must contain at least 32 characters"),
  SESSION_MAX_AGE_MS: z.coerce.number().int().positive().default(28_800_000),
  TRUST_PROXY: booleanFromString.default(false),
  DATABASE_URL: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    postgresUrl.optional()
  ),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5_000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),
  DATABASE_AUTO_MIGRATE: booleanFromString.default(true),
  ENTRA_CLIENT_ID: z.uuid(),
  ENTRA_CLIENT_SECRET: z.string().min(1),
  ENTRA_TENANT_ID: z.uuid().optional(),
  ENTRA_AUTHORITY: z.url().default("https://login.microsoftonline.com/organizations"),
  ENTRA_REDIRECT_URI: z.url().optional(),
  ENTRA_POST_LOGOUT_REDIRECT_URI: z.url().optional(),
  ENTRA_ALLOW_ANY_TENANT: booleanFromString.default(false),
  ENTRA_ALLOWED_TENANT_IDS: z.string().default(""),
  AUTH_DEFAULT_ROLE: z.enum(["student", "none"]).default("none"),
  // Staff mailbox domains. These accounts belong to lecturers and university
  // staff, so they may only reach the admin portal, and only once an admin has
  // approved a role for them.
  STAFF_EMAIL_DOMAINS: z.string().default("vlu.edu.vn")
}).refine(
  (env) => !env.AI_WORKER_KEY || env.AI_WORKER_KEY !== env.OCR_WORKER_KEY,
  { message: "AI_WORKER_KEY must differ from OCR_WORKER_KEY", path: ["AI_WORKER_KEY"] }
);

export interface AppConfig {
  ocrWorkerKey?: string;
  aiWorkerKey?: string;
  /** Present when ANTHROPIC_API_KEY is set: competency assessments run in "AI 100%" mode. */
  anthropic?: {
    apiKey: string;
    workspaceId?: string;
    model: string;
    effort: "low" | "medium" | "high" | "xhigh" | "max";
  };
  nodeEnv: "development" | "test" | "production";
  port: number;
  webOrigin: string;
  session: {
    secret: string;
    maxAgeMs: number;
    secure: boolean;
  };
  trustProxy: boolean;
  database: {
    url: string | undefined;
    maxConnections: number;
    connectionTimeoutMs: number;
    idleTimeoutMs: number;
    autoMigrate: boolean;
  };
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
  staffEmailDomains: ReadonlySet<string>;
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
  // Student logout returns to the introduction page, including older configs
  // that point at the login page or an authenticated route.
  const postLogoutRedirectUri = new URL(
    "/",
    parsed.ENTRA_POST_LOGOUT_REDIRECT_URI ?? `${webOrigin}/`
  ).toString();
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

  return {
    ...(parsed.OCR_WORKER_KEY ? {ocrWorkerKey:parsed.OCR_WORKER_KEY} : {}),
    ...(parsed.AI_WORKER_KEY ? { aiWorkerKey: parsed.AI_WORKER_KEY } : {}),
    ...(parsed.ANTHROPIC_API_KEY ? {
      anthropic: {
        apiKey: parsed.ANTHROPIC_API_KEY,
        ...(parsed.ANTHROPIC_WORKSPACE_ID ? { workspaceId: parsed.ANTHROPIC_WORKSPACE_ID } : {}),
        model: parsed.ANTHROPIC_MODEL,
        effort: parsed.ANTHROPIC_EFFORT,
      },
    } : {}),
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    webOrigin,
    session: {
      secret: parsed.SESSION_SECRET,
      maxAgeMs: parsed.SESSION_MAX_AGE_MS,
      secure: parsed.NODE_ENV === "production"
    },
    trustProxy: parsed.TRUST_PROXY,
    database: {
      url: parsed.DATABASE_URL,
      maxConnections: parsed.DATABASE_POOL_MAX,
      connectionTimeoutMs: parsed.DATABASE_CONNECTION_TIMEOUT_MS,
      idleTimeoutMs: parsed.DATABASE_IDLE_TIMEOUT_MS,
      autoMigrate: parsed.DATABASE_AUTO_MIGRATE
    },
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
    authDefaultRole: parsed.AUTH_DEFAULT_ROLE,
    staffEmailDomains: new Set(
      parsed.STAFF_EMAIL_DOMAINS.split(",")
        .map((value) => value.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean)
    )
  };
}
