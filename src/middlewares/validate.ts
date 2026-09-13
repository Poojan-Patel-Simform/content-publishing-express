import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";

import type { ErrorDetail } from "../errors/app-error.js";
import { ValidationError } from "../errors/http-errors.js";

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

const toDetails = (issues: { path: PropertyKey[]; message: string }[]): ErrorDetail[] =>
  issues.map((issue) => ({
    field: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));

/**
 * Validates a request against zod schemas and writes the *parsed* result back,
 * so handlers only ever see stripped, coerced data rather than raw client
 * input. Unknown keys are dropped by zod objects by default.
 */
export const validate =
  (schemas: ValidationSchemas): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const details: ErrorDetail[] = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) req.body = result.data;
      else details.push(...toDetails(result.error.issues));
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) Object.assign(req.params, result.data);
      else details.push(...toDetails(result.error.issues));
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      // Express 5 exposes `req.query` as a getter, so the parsed value goes to a
      // separate property instead of being assigned back.
      if (result.success) req.validatedQuery = result.data;
      else details.push(...toDetails(result.error.issues));
    }

    if (details.length > 0) {
      next(new ValidationError("Request validation failed", details));
      return;
    }

    next();
  };
