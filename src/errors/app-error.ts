import { HTTP_STATUS } from "../constants/http-status.js";

/** Field-level context safe to return to the client. */
export interface ErrorDetail {
  field?: string;
  message: string;
}

/**
 * Base class for every error this application raises deliberately.
 *
 * `isOperational` is the important flag: it marks an error as *expected* -- a
 * bad request, a missing record, a conflict. The central error handler trusts
 * an operational error's message enough to return it to the client. Anything
 * else is treated as a bug and answered with a generic 500, so internal detail
 * never leaks.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: ErrorDetail[];

  constructor(
    message: string,
    statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR,
    code = "INTERNAL_SERVER_ERROR",
    details?: ErrorDetail[],
    isOperational = true,
  ) {
    super(message);

    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    if (details) this.details = details;

    Error.captureStackTrace(this, new.target);
  }
}
