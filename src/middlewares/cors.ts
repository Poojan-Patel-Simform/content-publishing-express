import cors, { type CorsOptions } from "cors";
import type { RequestHandler } from "express";

import { env, isProduction } from "../config/env.js";
import { ForbiddenError } from "../errors/http-errors.js";

const allowlist = new Set(env.CORS_ORIGINS);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Same-origin, curl, and server-to-server requests send no Origin header.
    // They are not subject to the browser's cross-origin rules, so there is
    // nothing for CORS to decide here.
    if (!origin) return callback(null, true);

    if (allowlist.has(origin)) return callback(null, true);

    // Never reflect an unknown origin. Failing closed is the whole point of the
    // allowlist -- `origin: true` would hand any site on the internet a
    // credentialed cross-origin channel to this API.
    return callback(new ForbiddenError(`Origin ${origin} is not allowed by CORS policy`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
  exposedHeaders: ["X-Request-Id"],
  maxAge: 600,
  optionsSuccessStatus: 204,
};

if (!isProduction && allowlist.size === 0) {
  console.warn(
    "[cors] CORS_ORIGINS is empty - all cross-origin browser requests will be rejected.",
  );
}

export const corsMiddleware: RequestHandler = cors(corsOptions);
