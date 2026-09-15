import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AuditAction, TokenPurpose, UserStatus } from "../generated/prisma-client/enums.js";
import {
  BadRequestError,
  EmailNotVerifiedError,
  ForbiddenError,
  RefreshInFlightError,
  UnauthorizedError,
} from "../errors/http-errors.js";
import type { AuthUser, IssuedTokens } from "../interfaces/auth.interface.js";
import * as sessionRepository from "../repositories/session.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import * as verificationTokenRepository from "../repositories/verification-token.repository.js";
import { generateOpaqueToken, sha256Hex } from "../utils/crypto.js";
import * as auditService from "./audit.service.js";
import * as mailerService from "./mailer.service.js";
import * as passwordService from "./password.service.js";
import * as tokenService from "./token.service.js";
import type { SessionMeta } from "./token.service.js";

interface RequestContext {
  requestId: string;
}

const issueEmailVerification = async (userId: string, email: string): Promise<void> => {
  const rawToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);

  await verificationTokenRepository.create({
    userId,
    purpose: TokenPurpose.EMAIL_VERIFICATION,
    tokenHash: sha256Hex(rawToken),
    expiresAt,
  });

  await mailerService.sendVerificationEmail(email, rawToken);
};

export const register = async (
  input: { email: string; password: string; displayName: string },
  ctx: RequestContext,
): Promise<void> => {
  // Enumeration-safe: a duplicate address is a silent no-op, same as success.
  const existing = await userRepository.findByEmail(input.email);
  if (existing) return;

  const passwordHash = await passwordService.hashPassword(input.password);
  const user = await userRepository.create({
    email: input.email,
    displayName: input.displayName,
    passwordHash,
  });

  await auditService.recordAuditEvent(AuditAction.USER_REGISTERED, user.id, ctx.requestId);
  await issueEmailVerification(user.id, user.email);
};

export const resendVerification = async (email: string): Promise<void> => {
  const user = await userRepository.findByEmail(email);
  if (!user || user.emailVerifiedAt !== null) return;

  // Required by the one_live_per_purpose unique index before issuing another.
  await verificationTokenRepository.deleteOutstanding(user.id, TokenPurpose.EMAIL_VERIFICATION);
  await issueEmailVerification(user.id, user.email);
};

export const verifyEmail = async (token: string, ctx: RequestContext): Promise<AuthUser> => {
  const record = await verificationTokenRepository.findValidByHash(sha256Hex(token));
  if (!record || record.purpose !== TokenPurpose.EMAIL_VERIFICATION) {
    throw new BadRequestError("Invalid or expired token");
  }

  const user = await prisma.$transaction(async (tx) => {
    const consumed = await tx.verificationToken.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw new BadRequestError("Invalid or expired token");

    return tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
  });

  await auditService.recordAuditEvent(AuditAction.EMAIL_VERIFIED, user.id, ctx.requestId);
  return userRepository.toAuthUser(user);
};

export const forgotPassword = async (email: string, ctx: RequestContext): Promise<void> => {
  const user = await userRepository.findByEmail(email);
  if (!user) return;

  await verificationTokenRepository.deleteOutstanding(user.id, TokenPurpose.PASSWORD_RESET);

  const rawToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
  await verificationTokenRepository.create({
    userId: user.id,
    purpose: TokenPurpose.PASSWORD_RESET,
    tokenHash: sha256Hex(rawToken),
    expiresAt,
  });

  await auditService.recordAuditEvent(AuditAction.PASSWORD_RESET_REQUESTED, user.id, ctx.requestId);
  await mailerService.sendPasswordResetEmail(user.email, rawToken);
};

export const resetPassword = async (
  input: { token: string; password: string },
  ctx: RequestContext,
): Promise<void> => {
  const record = await verificationTokenRepository.findValidByHash(sha256Hex(input.token));
  if (!record || record.purpose !== TokenPurpose.PASSWORD_RESET) {
    throw new BadRequestError("Invalid or expired token");
  }

  const passwordHash = await passwordService.hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const consumed = await tx.verificationToken.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw new BadRequestError("Invalid or expired token");

    // Reaching the mailbox proves ownership, same as clicking a verification link.
    await tx.user.updateMany({
      where: { id: record.userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });

    return tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
  });

  await sessionRepository.revokeAllForUser(user.id);
  await auditService.recordAuditEvent(AuditAction.PASSWORD_RESET_COMPLETED, user.id, ctx.requestId);
};

export const login = async (
  input: { email: string; password: string },
  meta: SessionMeta,
  ctx: RequestContext,
): Promise<{ user: AuthUser; tokens: IssuedTokens }> => {
  const userRow = await userRepository.findByEmail(input.email);

  const valid = userRow?.passwordHash
    ? await passwordService.verifyPassword(userRow.passwordHash, input.password)
    : false;

  if (!userRow || !valid) {
    throw new UnauthorizedError("Invalid email or password");
  }

  if (userRow.status !== UserStatus.ACTIVE) {
    throw new ForbiddenError("This account has been suspended");
  }

  if (userRow.emailVerifiedAt === null) {
    throw new EmailNotVerifiedError();
  }

  const authUser = userRepository.toAuthUser(userRow);
  const issued = await tokenService.issueSession(authUser, meta);

  await auditService.recordAuditEvent(AuditAction.USER_LOGGED_IN, authUser.id, ctx.requestId);
  return {
    user: authUser,
    tokens: {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      refreshTokenExpiresAt: issued.refreshTokenExpiresAt,
    },
  };
};

export const logout = async (
  sessionId: string,
  actorId: string,
  ctx: RequestContext,
): Promise<void> => {
  await sessionRepository.revokeById(sessionId);
  await auditService.recordAuditEvent(AuditAction.USER_LOGGED_OUT, actorId, ctx.requestId);
};

export const logoutAll = async (userId: string, ctx: RequestContext): Promise<void> => {
  await sessionRepository.revokeAllForUser(userId);
  await auditService.recordAuditEvent(AuditAction.USER_LOGGED_OUT, userId, ctx.requestId);
};

export const changePassword = async (
  userId: string,
  currentSessionId: string,
  input: { currentPassword: string; newPassword: string },
  ctx: RequestContext,
): Promise<void> => {
  const userRow = await userRepository.findById(userId);
  const valid = userRow?.passwordHash
    ? await passwordService.verifyPassword(userRow.passwordHash, input.currentPassword)
    : false;

  if (!userRow || !valid) {
    throw new UnauthorizedError("Current password is incorrect");
  }

  const passwordHash = await passwordService.hashPassword(input.newPassword);
  await userRepository.setPasswordHash(userId, passwordHash);
  await sessionRepository.revokeAllForUserExcept(userId, currentSessionId);
  await auditService.recordAuditEvent(AuditAction.PASSWORD_CHANGED, userId, ctx.requestId);
};

/**
 * Refresh-token rotation with reuse detection, all inside one transaction.
 * See prisma/schema.prisma `Session` and plan.md section 3 for the state
 * machine this implements.
 */
export const refreshSession = async (
  rawRefreshToken: string,
  meta: SessionMeta,
  ctx: RequestContext,
): Promise<{ user: AuthUser; tokens: IssuedTokens }> => {
  const tokenHash = sha256Hex(rawRefreshToken);
  const now = new Date();

  // A thrown error rolls back every write made earlier in the same
  // transaction, which would silently undo the reuse-detection revocation
  // it is meant to enforce. So the callback only ever returns a result --
  // the caller throws afterwards, once the writes below are already
  // committed.
  const outcome = await prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({ where: { refreshTokenHash: tokenHash } });

    if (!session) return { kind: "not-found" } as const;
    if (session.expiresAt < now) return { kind: "expired" } as const;

    if (session.revokedAt !== null) {
      const isRacingTab =
        session.rotatedAt !== null &&
        now.getTime() - session.rotatedAt.getTime() < env.REFRESH_REUSE_GRACE_MS;

      if (isRacingTab) return { kind: "in-flight" } as const;

      // Outside the grace window, a spent token being replayed is theft:
      // revoke every descendant of the family it came from.
      await tx.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.auditEvent.create({
        data: {
          action: AuditAction.SESSION_REUSE_DETECTED,
          actorId: session.userId,
          requestId: ctx.requestId,
          metadata: { sessionId: session.id, familyId: session.familyId },
        },
      });
      return { kind: "reuse-detected" } as const;
    }

    const rotated = await tx.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now, rotatedAt: now },
    });
    // A count of 0 means a concurrent request already won this exact race.
    if (rotated.count === 0) return { kind: "in-flight" } as const;

    // Re-loaded from current DB state, not the old token's claims, so a role
    // change or suspension lands within one access-token lifetime.
    const userRow = await tx.user.findUnique({ where: { id: session.userId } });
    if (!userRow) return { kind: "not-found" } as const;
    const authUser = userRepository.toAuthUser(userRow);

    const refreshToken = generateOpaqueToken();
    const successor = await tx.session.create({
      data: {
        userId: authUser.id,
        refreshTokenHash: sha256Hex(refreshToken),
        // Same family, same absolute expiry: carrying the deadline forward
        // rather than extending it keeps the chain bounded, not immortal.
        familyId: session.familyId,
        expiresAt: session.expiresAt,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
    });

    const accessToken = tokenService.issueAccessToken(authUser, successor.id);

    return {
      kind: "success",
      user: authUser,
      tokens: { accessToken, refreshToken, refreshTokenExpiresAt: session.expiresAt },
    } as const;
  });

  switch (outcome.kind) {
    case "success":
      return { user: outcome.user, tokens: outcome.tokens };
    case "in-flight":
      throw new RefreshInFlightError();
    case "reuse-detected":
      throw new UnauthorizedError("Refresh token reuse detected");
    case "expired":
      throw new UnauthorizedError("Refresh token expired");
    case "not-found":
      throw new UnauthorizedError("Invalid refresh token");
  }
};
