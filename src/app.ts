import express, { type Express } from "express";
import { pinoHttp } from "pino-http";

import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { corsMiddleware } from "./middlewares/cors.js";
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

  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(globalRateLimiter);

  // Body limits bound memory use per request; without them a single client can
  // push arbitrarily large payloads. `extended: false` keeps urlencoded parsing
  // on the simpler querystring parser instead of qs's nested-object surface.
  app.use(express.json({ limit: env.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: env.BODY_LIMIT }));

  app.use("/api/v1", apiRouter);

  // Order matters: 404 then the terminal error handler.
  app.use(notFound);
  app.use(errorHandler);

  return app;
};
