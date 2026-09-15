import type { NextFunction, Request, Response } from "express";

import { env } from "../config/env.js";
import { SAFE_METHODS } from "../constants/auth.js";
import { ForbiddenError } from "../errors/http-errors.js";

const allowlist = new Set(env.CORS_ORIGINS);

/**
 * Cookies are the credential, so `SameSite=Lax` is the primary CSRF defence.
 * This is the backstop: an unsafe-method request whose `Origin` (or, lacking
 * that, `Referer`) is not in the existing CORS allowlist is rejected outright.
 * A request with neither header is not a browser cross-site request (curl,
 * server-to-server) and is let through, matching `corsMiddleware`'s handling
 * of a missing Origin.
 */
export const csrfOriginGuard = (req: Request, _res: Response, next: NextFunction): void => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const source = req.get("origin") ?? req.get("referer");
  if (!source) {
    next();
    return;
  }

  let origin: string;
  try {
    origin = new URL(source).origin;
  } catch {
    next(new ForbiddenError("Invalid Origin header"));
    return;
  }

  if (!allowlist.has(origin)) {
    next(new ForbiddenError(`Origin ${origin} is not allowed`));
    return;
  }

  next();
};
