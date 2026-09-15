import { Router } from "express";

import { prisma } from "../config/prisma.js";
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
    } catch (err) {
      // Log the real reason, but tell the caller nothing about the database.
      req.log.error({ err }, "Readiness check failed");
      throw new ServiceUnavailableError("Dependencies are not ready");
    }

    sendSuccess(res, { status: "ready" });
  }),
);
