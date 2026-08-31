import type { NextFunction, Request, Response } from "express";
import type { AppRole } from "../auth/types.js";

export function requireAuthentication(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  if (!request.session.user) {
    response.status(401).json({ error: "authentication_required" });
    return;
  }
  next();
}

export function requireRole(role: AppRole) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!request.session.user) {
      response.status(401).json({ error: "authentication_required" });
      return;
    }
    if (request.session.user.role !== role) {
      response.status(403).json({ error: "insufficient_role" });
      return;
    }
    next();
  };
}

