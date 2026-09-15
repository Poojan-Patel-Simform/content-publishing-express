import { HTTP_STATUS } from "../constants/http-status.js";
import { AppError, type ErrorDetail } from "./app-error.js";

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: ErrorDetail[]) {
    super(message, HTTP_STATUS.BAD_REQUEST, "BAD_REQUEST", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, HTTP_STATUS.UNAUTHORIZED, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, HTTP_STATUS.FORBIDDEN, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, HTTP_STATUS.NOT_FOUND, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource already exists", details?: ErrorDetail[]) {
    super(message, HTTP_STATUS.CONFLICT, "CONFLICT", details);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "Request payload is too large") {
    super(message, HTTP_STATUS.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE");
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: ErrorDetail[]) {
    super(message, HTTP_STATUS.UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests, please try again later") {
    super(message, HTTP_STATUS.TOO_MANY_REQUESTS, "TOO_MANY_REQUESTS");
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable") {
    super(message, HTTP_STATUS.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE");
  }
}

export class EmailNotVerifiedError extends AppError {
  constructor(message = "Email address is not verified") {
    super(message, HTTP_STATUS.FORBIDDEN, "EMAIL_NOT_VERIFIED");
  }
}

/** A racing tab replayed the previous refresh token while its sibling request
 * was already rotating the family. The honest client already holds the
 * successor cookie, so the caller must retry rather than treat this as theft. */
export class RefreshInFlightError extends AppError {
  constructor(message = "Refresh already in progress, retry with the current cookies") {
    super(message, HTTP_STATUS.UNAUTHORIZED, "REFRESH_IN_FLIGHT");
  }
}
