import { Router } from "express";

import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { getRedisConnection } from "../config/redis.js";
import { ServiceUnavailableError } from "../errors/http-errors.js";
import { asyncHandler } from "../utils/async-handler.js";
import { sendSuccess } from "../utils/api-response.js";

export const healthRouter: Router = Router();

/** Liveness: is the process up? Deliberately touches no dependency. */
healthRouter.get("/", (_req, res) => {
  sendSuccess(res, { status: "ok", uptime: process.uptime() });
});

/** Readiness: can this instance actually serve traffic? */
healthRouter.get(
  "/ready",
  asyncHandler(async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;

      // Guarded so a deliberately scheduler-less instance does not report
      // itself unready, and so the probe never opens a Redis connection that
      // `getRedisConnection`'s laziness exists to avoid.
      if (env.SCHEDULER_ENABLED) {
        await getRedisConnection().ping();
      }
    } catch (err) {
      // Log the real reason, but tell the caller nothing about which
      // dependency failed or why.
      req.log.error({ err }, "Readiness check failed");
      throw new ServiceUnavailableError("Dependencies are not ready");
    }

    sendSuccess(res, { status: "ready" });
  }),
);
