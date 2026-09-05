import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config.js";
import type { UserRepository } from "../users/user-repository.js";
import type { AuthTransaction, MicrosoftAuthClient } from "./types.js";
import {
  assertIdentityIsAllowed,
  createAuthTransaction,
  isAuthTransactionFresh,
  isSafeEqual,
  resolveAppRole
} from "./security.js";

export interface AuthRouterDependencies {
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

function authErrorRedirect(config: AppConfig, code: string): string {
  const url = new URL("/login", `${config.webOrigin}/`);
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
  userRepository
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
      response.redirect(authErrorRedirect(config, "microsoft_denied"));
      return;
    }

    if (
      !transaction ||
      !isAuthTransactionFresh(transaction) ||
      !isSafeEqual(request.query.state, transaction.state)
    ) {
      await saveSession(request);
      response.redirect(authErrorRedirect(config, "invalid_state"));
      return;
    }

    const code = request.query.code;
    if (typeof code !== "string" || code.length === 0) {
      await saveSession(request);
      response.redirect(authErrorRedirect(config, "missing_code"));
      return;
    }

    try {
      const identity = await microsoftAuthClient.exchangeAuthorizationCode(
        code,
        transaction.codeVerifier,
        transaction.nonce
      );
      assertIdentityIsAllowed(identity, transaction, config);
      const role = resolveAppRole(identity.roles, config.authDefaultRole);
      const user = await userRepository.upsertMicrosoftUser(identity, role);

      await regenerateSession(request);
      request.session.user = user;
      await saveSession(request);

      response.redirect(callbackRedirect(config, transaction.returnTo));
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownAuthError";
      console.error(`[AUTH:${correlationId}] Microsoft callback failed (${errorName})`);
      response.redirect(authErrorRedirect(config, "callback_failed"));
    }
  });

  router.get("/me", (request, response) => {
    if (!request.session.user) {
      response.json({ authenticated: false });
      return;
    }

    response.json({
      authenticated: true,
      user: request.session.user
    });
  });

  router.post("/logout", async (request, response) => {
    if (!isSameOrigin(request, config.webOrigin)) {
      response.status(403).json({ error: "invalid_origin" });
      return;
    }

    const tenantId = request.session.user?.tenantId;
    const logoutUrl = microsoftAuthClient.getLogoutUrl(tenantId);
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
