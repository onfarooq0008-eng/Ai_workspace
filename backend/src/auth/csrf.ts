import * as crypto from "crypto";
import { Request, Response, NextFunction } from "express";

declare module "express-session" {
  interface SessionData {
    csrfToken?: string;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Issues a per-session CSRF token the first time it's needed, and verifies
 * the X-CSRF-Token header against it on every state-changing request. The
 * login endpoint itself is exempt (no session exists yet to carry a token);
 * everything else behind requireAuth is protected.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if ((req as any).apiTokenAuth) return next(); // bearer-token clients carry no ambient cookie, so CSRF does not apply
  if (!req.session) return next();

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  }

  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const header = req.get("X-CSRF-Token");
  if (!header || header !== req.session.csrfToken) {
    return res.status(403).json({ error: "Invalid or missing CSRF token" });
  }
  next();
}
