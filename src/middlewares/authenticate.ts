import type { Request } from "express";

import { prisma } from "../config/prisma.js";
import { COOKIE_NAMES } from "../constants/auth.js";
import { UnauthorizedError } from "../errors/http-errors.js";
import * as userRepository from "../repositories/user.repository.js";
import * as tokenService from "../services/token.service.js";
import { asyncHandler } from "../utils/async-handler.js";

const BEARER_PREFIX = "Bearer ";

const extractAccessToken = (req: Request): string | undefined => {
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[
    COOKIE_NAMES.ACCESS_TOKEN
  ];
  if (cookieToken) return cookieToken;

  const header = req.get("authorization");
  if (header?.startsWith(BEARER_PREFIX)) return header.slice(BEARER_PREFIX.length);

  return undefined;
};

/**
 * Verifies the access JWT, then does one indexed session lookup. That single
 * PK read (rather than trusting the token's own claims) is what makes logout
 * and suspension take effect immediately instead of at the end of the access
 * token's lifetime.
 */
const resolveUser = async (req: Request): Promise<boolean> => {
  const token = extractAccessToken(req);
  if (!token) return false;

  const claims = await tokenService.verifyAccessToken(token).catch(() => null);
  if (!claims) return false;

  const session = await prisma.session.findFirst({
    where: { id: claims.sid, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  if (!session) return false;

  req.user = userRepository.toAuthUser(session.user);
  req.sessionId = session.id;
  return true;
};

export const requireAuth = asyncHandler(async (req, _res, next) => {
  if (!(await resolveUser(req))) throw new UnauthorizedError();
  next();
});

/** For routes that behave differently for an authenticated caller but must
 * not reject an anonymous one (the public content read paths). */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  await resolveUser(req);
  next();
});
