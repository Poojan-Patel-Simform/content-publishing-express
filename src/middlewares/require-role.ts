import type { NextFunction, Request, RequestHandler, Response } from "express";

import { EmailNotVerifiedError, ForbiddenError, UnauthorizedError } from "../errors/http-errors.js";
import { UserRole, UserStatus } from "../generated/prisma-client/enums.js";

export const requireRole =
  (...roles: UserRole[]): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };

export const requireEditor: RequestHandler = requireRole(UserRole.EDITOR);

export const requireActiveAccount = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user) {
    next(new UnauthorizedError());
    return;
  }
  if (req.user.status !== UserStatus.ACTIVE) {
    next(new ForbiddenError("This account has been suspended"));
    return;
  }
  next();
};

export const requireVerifiedEmail = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user) {
    next(new UnauthorizedError());
    return;
  }
  if (req.user.emailVerifiedAt === null) {
    next(new EmailNotVerifiedError());
    return;
  }
  next();
};
