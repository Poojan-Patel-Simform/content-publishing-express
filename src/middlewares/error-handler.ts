import type { ErrorRequestHandler } from "express";

import { isProduction } from "../config/env.js";
import { logger } from "../config/logger.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import { normalizeError } from "../errors/normalize-error.js";

interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
    stack?: string;
  };
}

/**
 * The single exit point for every error in the application. Mounted last.
 *
 * The rule that matters: a non-operational error (i.e. a bug) never has its
 * message or stack sent to the client in production. It is logged in full and
 * answered with a generic 500.
 */
// Express identifies error middleware by arity; `next` must stay in the signature.
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const { statusCode, code, message, details, isOperational } = normalizeError(err);

  const log = req.log ?? logger;
  const context = {
    err,
    requestId: String(req.id),
    method: req.method,
    path: req.originalUrl,
    statusCode,
    code,
  };

  if (statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR || !isOperational) {
    log.error(context, message);
  } else {
    log.warn(context, message);
  }

  // Express cannot rewrite a response whose headers are already flushed;
  // delegate to the default handler, which closes the connection.
  if (res.headersSent) {
    next(err);
    return;
  }

  const exposeDetail = isOperational || !isProduction;

  const body: ErrorBody = {
    success: false,
    error: {
      code,
      message: exposeDetail ? message : "An unexpected error occurred",
      requestId: String(req.id),
    },
  };

  if (details) body.error.details = details;
  if (!isProduction && err instanceof Error && err.stack) body.error.stack = err.stack;

  res.status(statusCode).json(body);
};
