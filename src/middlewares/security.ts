import helmet from "helmet";
import type { RequestHandler } from "express";

import { isProduction } from "../config/env.js";

/**
 * Baseline response hardening. This is a JSON API, so the CSP is locked all the
 * way down rather than tuned for scripts or styles it will never serve.
 */
export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      "default-src": ["'none'"],
      "frame-ancestors": ["'none'"],
      "base-uri": ["'none'"],
      "form-action": ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: "same-site" },
  frameguard: { action: "deny" },
  referrerPolicy: { policy: "no-referrer" },
  // HSTS only in production: sending it from localhost would pin http://localhost
  // to HTTPS in the developer's browser.
  hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
});
