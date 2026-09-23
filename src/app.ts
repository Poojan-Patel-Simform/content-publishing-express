import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { pinoHttp } from "pino-http";

import { BULL_BOARD_PATH, createBullBoardRouter } from "./admin/bull-board.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { corsMiddleware } from "./middlewares/cors.js";
import { csrfOriginGuard } from "./middlewares/csrf.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { notFound } from "./middlewares/not-found.js";
import { globalRateLimiter } from "./middlewares/rate-limit.js";
import { requestId } from "./middlewares/request-id.js";
import { securityHeaders } from "./middlewares/security.js";
import { apiRouter } from "./routes/index.js";

export const createApp = (): Express => {
  const app = express();

  // Don't advertise the framework.
  app.disable("x-powered-by");

  // Hop count, not a boolean -- needed for rate limiting and req.ip to see the
  // real client address behind a reverse proxy.
  app.set("trust proxy", env.TRUST_PROXY);

  // Correlation id first, so every later log line carries it.
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );

  // Ahead of the global headers, rate limiter and CSRF guard: the board needs
  // a looser CSP, polls too often for the global limit, and brings its own
  // auth and same-origin guard (see admin/bull-board.ts).
  if (env.BULL_BOARD_ENABLED) {
    if (env.SCHEDULER_ENABLED) {
      app.use(BULL_BOARD_PATH, createBullBoardRouter());
    } else {
      logger.warn(
        "BULL_BOARD_ENABLED is set but SCHEDULER_ENABLED is false; not mounting Bull Board",
      );
    }
  }

  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(globalRateLimiter);

  // Body limits bound memory use per request; without them a single client can
  // push arbitrarily large payloads. `extended: false` keeps urlencoded parsing
  // on the simpler querystring parser instead of qs's nested-object surface.
  app.use(express.json({ limit: env.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: env.BODY_LIMIT }));

  // Must precede any route reading cp_at/cp_rt.
  app.use(cookieParser());
  app.use(csrfOriginGuard);

  app.use("/api/v1", apiRouter);

  // Order matters: 404 then the terminal error handler.
  app.use(notFound);
  app.use(errorHandler);

  return app;
};
