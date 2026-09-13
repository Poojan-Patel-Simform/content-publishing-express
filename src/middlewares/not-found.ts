import type { NextFunction, Request, Response } from "express";

import { NotFoundError } from "../errors/http-errors.js";

/** Terminal route. Anything reaching here matched no handler. */
export const notFound = (req: Request, _res: Response, next: NextFunction): void => {
  next(new NotFoundError(`Cannot ${req.method} ${req.path}`));
};
