import type { Logger } from "pino";

import type { AuthUser } from "../interfaces/auth.interface.js";

declare global {
  namespace Express {
    interface Request {
      /**
       * Per-request child logger attached by pino-http.
       * `id` is declared by pino-http itself (as `ReqId`) and set by the
       * requestId middleware.
       */
      log: Logger;
      /**
       * Parsed + coerced query params produced by the `validate` middleware.
       * Express 5 exposes `req.query` as a getter, so it cannot be reassigned.
       */
      validatedQuery?: unknown;
      /** Set by `requireAuth` / `optionalAuth` once the access token and its
       * session have both been verified. */
      user?: AuthUser;
      sessionId?: string;
    }
  }
}

export {};
