import { ZodError } from "zod";

import { HTTP_STATUS } from "../constants/http-status.js";
import { AppError, type ErrorDetail } from "./app-error.js";

export interface NormalizedError {
  statusCode: number;
  code: string;
  message: string;
  isOperational: boolean;
  details?: ErrorDetail[];
}

/**
 * Prisma's own messages embed model, column, and constraint names. Surfacing
 * them would hand a client a map of the database schema, so each known code is
 * translated into a deliberately vague, client-safe message.
 */
const PRISMA_ERROR_MAP: Record<string, { statusCode: number; code: string; message: string }> = {
  P2000: {
    statusCode: HTTP_STATUS.BAD_REQUEST,
    code: "VALUE_TOO_LONG",
    message: "A provided value is too long",
  },
  P2002: {
    statusCode: HTTP_STATUS.CONFLICT,
    code: "CONFLICT",
    message: "A record with these values already exists",
  },
  P2003: {
    statusCode: HTTP_STATUS.BAD_REQUEST,
    code: "INVALID_REFERENCE",
    message: "A referenced record does not exist",
  },
  P2011: {
    statusCode: HTTP_STATUS.BAD_REQUEST,
    code: "NULL_CONSTRAINT",
    message: "A required field was missing",
  },
  P2025: {
    statusCode: HTTP_STATUS.NOT_FOUND,
    code: "NOT_FOUND",
    message: "The requested record was not found",
  },
};

/** Structural checks, so regenerating the Prisma client cannot break them. */
const isPrismaKnownError = (err: unknown): err is { code: string } =>
  err instanceof Error &&
  err.name === "PrismaClientKnownRequestError" &&
  typeof (err as { code?: unknown }).code === "string";

const isPrismaValidationError = (err: unknown): boolean =>
  err instanceof Error && err.name === "PrismaClientValidationError";

const isPrismaInitError = (err: unknown): boolean =>
  err instanceof Error &&
  (err.name === "PrismaClientInitializationError" ||
    err.name === "PrismaClientRustPanicError" ||
    err.name === "PrismaClientUnknownRequestError");

/** body-parser tags its failures with `type` and an http `status`. */
const isBodyParserError = (err: unknown): err is { type: string; status?: number } =>
  err instanceof Error && typeof (err as { type?: unknown }).type === "string";

const zodToDetails = (err: ZodError): ErrorDetail[] =>
  err.issues.map((issue) => ({
    field: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));

export const normalizeError = (err: unknown): NormalizedError => {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      isOperational: err.isOperational,
      ...(err.details ? { details: err.details } : {}),
    };
  }

  if (err instanceof ZodError) {
    return {
      statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      isOperational: true,
      details: zodToDetails(err),
    };
  }

  if (isPrismaKnownError(err)) {
    const mapped = PRISMA_ERROR_MAP[err.code];
    if (mapped) return { ...mapped, isOperational: true };

    return {
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      code: "DATABASE_ERROR",
      message: "A database error occurred",
      isOperational: false,
    };
  }

  if (isPrismaValidationError(err)) {
    return {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: "BAD_REQUEST",
      message: "The request could not be processed",
      isOperational: true,
    };
  }

  if (isPrismaInitError(err)) {
    return {
      statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
      code: "SERVICE_UNAVAILABLE",
      message: "Service temporarily unavailable",
      isOperational: false,
    };
  }

  if (isBodyParserError(err)) {
    if (err.type === "entity.too.large") {
      return {
        statusCode: HTTP_STATUS.PAYLOAD_TOO_LARGE,
        code: "PAYLOAD_TOO_LARGE",
        message: "Request payload is too large",
        isOperational: true,
      };
    }

    if (err.type === "entity.parse.failed") {
      return {
        statusCode: HTTP_STATUS.BAD_REQUEST,
        code: "MALFORMED_JSON",
        message: "Request body is not valid JSON",
        isOperational: true,
      };
    }

    if (err.type === "encoding.unsupported" || err.type === "charset.unsupported") {
      return {
        statusCode: HTTP_STATUS.BAD_REQUEST,
        code: "UNSUPPORTED_ENCODING",
        message: "Request encoding is not supported",
        isOperational: true,
      };
    }
  }

  // Unrecognised: treat as a bug. The caller answers with a generic message.
  return {
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred",
    isOperational: false,
  };
};
