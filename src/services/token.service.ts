import { randomUUID } from "node:crypto";

import jwt from "jsonwebtoken";
import { jwtVerify } from "jose";

import { env } from "../config/env.js";
import { UnauthorizedError } from "../errors/http-errors.js";
import type { AccessTokenClaims, AuthUser, IssuedTokens } from "../interfaces/auth.interface.js";
import * as sessionRepository from "../repositories/session.repository.js";
import { generateOpaqueToken, sha256Hex } from "../utils/crypto.js";

const secretKey = new TextEncoder().encode(env.JWT_SECRET);

export const issueAccessToken = (user: AuthUser, sessionId: string): string =>
  jwt.sign(
    {
      sub: user.id,
      sid: sessionId,
      role: user.role,
      ev: user.emailVerifiedAt !== null,
      typ: "access",
    },
    env.JWT_SECRET,
    {
      algorithm: "HS256",
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      expiresIn: env.ACCESS_TOKEN_TTL_S,
    },
  );

/** `typ` discriminates the access token from anything else ever signed with
 * the same key. */
export const verifyAccessToken = async (token: string): Promise<AccessTokenClaims> => {
  const { payload } = await jwtVerify(token, secretKey, {
    algorithms: ["HS256"],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });

  if (payload.typ !== "access") {
    throw new UnauthorizedError("Invalid access token");
  }

  return payload as unknown as AccessTokenClaims;
};

export interface SessionMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

const refreshExpiryDate = (): Date =>
  new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

/** A brand-new login: starts a fresh rotation family. */
export const issueSession = async (
  user: AuthUser,
  meta: SessionMeta = {},
): Promise<IssuedTokens & { sessionId: string }> => {
  const refreshToken = generateOpaqueToken();
  const familyId = randomUUID();
  const expiresAt = refreshExpiryDate();

  const session = await sessionRepository.create({
    userId: user.id,
    refreshTokenHash: sha256Hex(refreshToken),
    familyId,
    expiresAt,
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ipAddress ?? null,
  });

  return {
    accessToken: issueAccessToken(user, session.id),
    refreshToken,
    refreshTokenExpiresAt: expiresAt,
    sessionId: session.id,
  };
};
