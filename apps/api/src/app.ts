import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, {
  type ErrorRequestHandler,
  type RequestHandler
} from "express";
import session from "express-session";
import type { Store } from "express-session";
import helmet from "helmet";
import type { DatabasePool } from "./db/pool.js";
import { createStudentDataRouter } from "./student/router.js";
import { createCurriculaRouter } from "./curricula/router.js";
import { createStudentCurriculaRouter } from "./curricula/student-router.js";
import { createTranscriptWorkerRouter } from "./student/transcript-jobs.js";
import type { AppConfig } from "./config.js";
import { createAuthRouter } from "./auth/router.js";
import type { MicrosoftAuthClient } from "./auth/types.js";
import type { UserRepository } from "./users/user-repository.js";
import type { AuthActivity } from "./auth/activity.js";
import { createStudentProfilesRouter, type StudentProfileRepository } from "./admin/student-profiles.js";
import { createAdminAccountsRouter, type AdminAccountRepository } from "./admin/accounts.js";
import {
  requireAuthentication,
  requireRole, requireAdminAccess
} from "./middleware/authorization.js";

export interface CreateAppDependencies {
  databasePool?: DatabasePool;
  studentProfileRepository?: StudentProfileRepository;
  authActivity?: AuthActivity;
  config: AppConfig;
  microsoftAuthClient: MicrosoftAuthClient;
  userRepository: UserRepository;
  sessionStore?: Store;
  adminAccountRepository?: AdminAccountRepository;
}

const webDistPath = fileURLToPath(new URL("../../web/dist/", import.meta.url));

export function createApp({
  databasePool,
  config,
  microsoftAuthClient,
  userRepository,
  sessionStore,
  adminAccountRepository,
  authActivity,
  studentProfileRepository
}: CreateAppDependencies) {
  const app = express();

  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" }
    })
  );
  app.use("/api/worker/transcripts", createTranscriptWorkerRouter(databasePool,config.ocrWorkerKey));
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));

  const correlationId: RequestHandler = (request, response, next) => {
    const id = request.get("x-correlation-id") ?? randomUUID();
    response.setHeader("x-correlation-id", id);
    next();
  };
  app.use(correlationId);

  app.use(["/api/auth", "/api/admin"], (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use(
    session({
      ...(sessionStore ? { store: sessionStore } : {}),
      name: "edupath.sid",
      secret: config.session.secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: config.session.secure,
        sameSite: "lax",
        maxAge: config.session.maxAgeMs,
        path: "/"
      }
    })
  );

  app.use("/api", async (request, response, next) => {
    const user = request.session.user;
    if (authActivity && user && !await authActivity.current(user)) {
      await new Promise<void>((resolve, reject) => request.session.destroy((err) => err ? reject(err) : resolve()));
      response.clearCookie("edupath.sid", { path: "/", httpOnly: true, secure: config.session.secure, sameSite: "lax" });
      response.status(401).json({ error: "authentication_required" });
      return;
    }
    next();
  });

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", service: "edupath-api" });
  });

  app.use(
    "/api/auth",
    createAuthRouter({ config, microsoftAuthClient, userRepository, ...(authActivity ? { authActivity } : {}) })
  );

  app.get(
    "/api/student/summary",
    requireAuthentication,
    (request, response) => {
      response.json({
        message: `Xin chào ${request.session.user?.name ?? "sinh viên"}`,
        role: request.session.user?.role
      });
    }
  );

  app.get("/api/admin/summary", requireRole("admin"), (request, response) => {
    response.json({
      message: `Xin chào quản trị viên ${request.session.user?.name ?? ""}`.trim(),
      role: request.session.user?.role
    });
  });

  app.get("/api/student/profile", requireAuthentication, async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!studentProfileRepository) {
      response.status(503).json({ error: "database_required" });
      return;
    }
    const user = request.session.user!;
    response.json({ student: await studentProfileRepository.detail(user, user.userId) });
  });

  app.get("/api/admin/me", requireAdminAccess, (request, response) => {
    response.json({ authenticated: true, user: request.session.user });
  });

  app.use("/api/admin/accounts", createAdminAccountsRouter(adminAccountRepository, config.webOrigin));
  app.use("/api/admin/curricula", createCurriculaRouter(databasePool, config.webOrigin));
  app.use("/api/student/curricula", createStudentCurriculaRouter(databasePool));
  app.use("/api/student", createStudentDataRouter(databasePool, config.webOrigin,Boolean(config.ocrWorkerKey)));
  app.use("/api/admin/students", createStudentProfilesRouter(studentProfileRepository, adminAccountRepository));

  if (config.nodeEnv === "production") {
    app.use(
      express.static(webDistPath, {
        index: false,
        maxAge: "1h"
      })
    );

    app.get(/^(?!\/api(?:\/|$)).*/, (_request, response, next) => {
      response.setHeader("Cache-Control", "no-cache");
      response.sendFile("index.html", { root: webDistPath }, (error) => {
        if (error) next(error);
      });
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: "not_found" });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const message = error instanceof Error ? error.message : "Unknown server error";
    console.error(`[SERVER] ${message}`);
    if (!response.headersSent) {
      response.status(500).json({ error: "internal_server_error" });
    }
  };
  app.use(errorHandler);

  return app;
}
