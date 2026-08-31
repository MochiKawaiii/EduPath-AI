import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, {
  type ErrorRequestHandler,
  type RequestHandler
} from "express";
import session from "express-session";
import helmet from "helmet";
import type { AppConfig } from "./config.js";
import { createAuthRouter } from "./auth/router.js";
import type { MicrosoftAuthClient } from "./auth/types.js";
import {
  requireAuthentication,
  requireRole
} from "./middleware/authorization.js";

export interface CreateAppDependencies {
  config: AppConfig;
  microsoftAuthClient: MicrosoftAuthClient;
}

const webDistPath = fileURLToPath(new URL("../../web/dist/", import.meta.url));

export function createApp({ config, microsoftAuthClient }: CreateAppDependencies) {
  const app = express();

  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" }
    })
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));

  const correlationId: RequestHandler = (request, response, next) => {
    const id = request.get("x-correlation-id") ?? randomUUID();
    response.setHeader("x-correlation-id", id);
    next();
  };
  app.use(correlationId);

  app.use(
    session({
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

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", service: "edupath-api" });
  });

  app.use(
    "/api/auth",
    createAuthRouter({ config, microsoftAuthClient })
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
