import { canAccessAdmin } from "./types.js";
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config.js";
import type { UserRepository } from "../users/user-repository.js";
import type { AuthTransaction, MicrosoftAuthClient } from "./types.js";
import type { MicrosoftIdentity } from "./types.js";
import type { AuthActivity } from "./activity.js";
import {
  assertIdentityIsAllowed,
  createAuthTransaction,
  isAuthTransactionFresh,
  isSafeEqual,
  isStaffAccount,
  resolveAppRole
} from "./security.js";

export interface AuthRouterDependencies {
  authActivity?: AuthActivity;
  config: AppConfig;
  microsoftAuthClient: MicrosoftAuthClient;
  userRepository: UserRepository;
}

function saveSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function frontendUrl(config: AppConfig, path: string): string {
  return new URL(path, `${config.webOrigin}/`).toString();
}

function authErrorRedirect(config: AppConfig, code: string, returnTo?: string): string {
  const url = new URL(returnTo === "/quantri" ? "/quantri" : "/login", `${config.webOrigin}/`);
  url.searchParams.set("authError", code);
  return url.toString();
}

function callbackRedirect(config: AppConfig, returnTo: string): string {
  const url = new URL("/auth/callback", `${config.webOrigin}/`);
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

function isSameOrigin(request: Request, expectedOrigin: string): boolean {
  const origin = request.get("origin");
  return !origin || origin === expectedOrigin;
}

function addAuthTransaction(request: Request, transaction: AuthTransaction): void {
  const activeTransactions = (request.session.authTransactions ?? [])
    .filter(isAuthTransactionFresh)
    .slice(-4);
  activeTransactions.push(transaction);
  request.session.authTransactions = activeTransactions;
}

function takeAuthTransaction(request: Request, state: unknown): AuthTransaction | undefined {
  const transactions = request.session.authTransactions ?? [];
  const index = transactions.findIndex((item) => isSafeEqual(state, item.state));
  if (index < 0) return undefined;

  const [transaction] = transactions.splice(index, 1);
  request.session.authTransactions = transactions;
  return transaction;
}

export function createAuthRouter({
  config,
  microsoftAuthClient,
  userRepository,
  authActivity
}: AuthRouterDependencies): Router {
  const router = Router();

  router.get("/microsoft/start", async (request, response) => {
    const transaction = createAuthTransaction(request.query.returnTo);
    addAuthTransaction(request, transaction);

    const authorizationUrl = await microsoftAuthClient.getAuthorizationUrl(transaction);
    await saveSession(request);
    response.redirect(authorizationUrl);
  });

  router.get("/microsoft/callback", async (request, response) => {
    const correlationId = randomUUID();
    const transaction = takeAuthTransaction(request, request.query.state);
    const microsoftError = request.query.error;
    if (typeof microsoftError === "string") {
      await saveSession(request);
      response.redirect(authErrorRedirect(config, "microsoft_denied", transaction?.returnTo));
      return;
    }

    if (
      !transaction ||
      !isAuthTransactionFresh(transaction) ||
      !isSafeEqual(request.query.state, transaction.state)
    ) {
      await saveSession(request);
      response.redirect(authErrorRedirect(config, "invalid_state", transaction?.returnTo));
      return;
    }

    const code = request.query.code;
    if (typeof code !== "string" || code.length === 0) {
      await saveSession(request);
      response.redirect(authErrorRedirect(config, "missing_code", transaction.returnTo));
      return;
    }

    let verifiedIdentity: MicrosoftIdentity | undefined;
    const portal = transaction.returnTo === "/quantri" ? "admin" : "student";
    try {
      const identity = await microsoftAuthClient.exchangeAuthorizationCode(
        code,
        transaction.codeVerifier,
        transaction.nonce
      );
      assertIdentityIsAllowed(identity, transaction, config);
      verifiedIdentity = identity;
      // Staff mailboxes may only sign in through the admin portal, and only
      // after an admin approves a role for them below.
      if (transaction.returnTo !== "/quantri" && isStaffAccount(identity, config.staffEmailDomains)) {
        await authActivity?.record(identity, "denied", "student_portal_blocked", portal);
        await saveSession(request);
        response.redirect(authErrorRedirect(config, "staff_portal_only", transaction.returnTo));
        return;
      }
      const roleOverride = await userRepository.getRoleOverride(identity);
      const role = roleOverride ?? resolveAppRole(identity.roles, config.authDefaultRole);
      if (transaction.returnTo === "/quantri" && !canAccessAdmin(role)) {
        await authActivity?.record(identity, "denied", "admin_required", portal);
        await saveSession(request);
        response.redirect(authErrorRedirect(config, "admin_required", transaction.returnTo));
        return;
      }
      const user = await userRepository.upsertMicrosoftUser(identity, role);
      // Check the persisted role too, in case an override changed during sign-in.
      if (transaction.returnTo === "/quantri" && !canAccessAdmin(user.role)) {
        await authActivity?.record(identity, "denied", "admin_required", portal);
        await saveSession(request);
        response.redirect(authErrorRedirect(config, "admin_required", transaction.returnTo));
        return;
      }

      await regenerateSession(request);
      request.session.user = user;
      if (identity.loginHint) request.session.logoutHint = identity.loginHint;
      await saveSession(request);

      await authActivity?.record(identity, "success", "signed_in", portal);
      response.redirect(transaction.returnTo === "/quantri"
        ? frontendUrl(config, "/quantri")
        : callbackRedirect(config, transaction.returnTo));
    } catch (error) {
      await destroySession(request);
      if (verifiedIdentity) await authActivity?.record(verifiedIdentity, "denied", "callback_failed", portal).catch(() => undefined);
      const errorName = error instanceof Error ? error.name : "UnknownAuthError";
      console.error(`[AUTH:${correlationId}] Microsoft callback failed (${errorName})`);
      response.redirect(authErrorRedirect(config, "callback_failed", transaction.returnTo));
    }
  });

  router.get("/me", (request, response) => {
    if (!request.session.user) {
      response.json({ authenticated: false });
      return;
    }

    response.json({
      authenticated: true,
      user: request.session.user,
      studentPortal: !isStaffAccount(request.session.user, config.staffEmailDomains)
    });
  });

  router.post("/logout", async (request, response) => {
    if (!isSameOrigin(request, config.webOrigin)) {
      response.status(403).json({ error: "invalid_origin" });
      return;
    }

    const tenantId = request.session.user?.tenantId;
    const logoutHint = request.session.logoutHint;
    // Only fixed local destinations are accepted; this is not a role grant.
    const returnPath = request.query.portal === "admin"
      ? "/quantri" : "/";
    const logoutUrl = microsoftAuthClient.getLogoutUrl(tenantId, returnPath, logoutHint);
    await destroySession(request);
    response.clearCookie("edupath.sid", {
      httpOnly: true,
      secure: config.session.secure,
      sameSite: "lax",
      path: "/"
    });
    response.json({ logoutUrl });
  });

  return router;
}
