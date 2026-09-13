import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown> | unknown;

/**
 * Funnels a handler's rejections into the central error handler.
 *
 * Express 5 already forwards rejected promises from async handlers, so this is
 * belt-and-braces rather than strictly required. It is kept because it makes
 * the async boundary explicit at each route and gives one place to hook
 * per-request concerns later.
 */
export const asyncHandler =
  (fn: AsyncRequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
