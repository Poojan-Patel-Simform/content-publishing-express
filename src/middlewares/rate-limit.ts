import { rateLimit } from "express-rate-limit";
import type { RequestHandler } from "express";

import { env } from "../config/env.js";
import { TooManyRequestsError } from "../errors/http-errors.js";

const baseOptions = {
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  standardHeaders: "draft-7" as const,
  legacyHeaders: false,
  // Route the rejection through the central error handler so a 429 uses the
  // same response envelope as every other error.
  handler: (): never => {
    throw new TooManyRequestsError();
  },
};

/** Applied to every request as a blanket abuse guard. */
export const globalRateLimiter: RequestHandler = rateLimit({
  ...baseOptions,
  limit: env.RATE_LIMIT_MAX,
});

/**
 * Stricter bucket for credential endpoints. Mount explicitly on login, signup,
 * and password-reset routes, where the global limit is far too generous to slow
 * down brute forcing.
 */
export const authRateLimiter: RequestHandler = rateLimit({
  ...baseOptions,
  limit: env.AUTH_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
});
