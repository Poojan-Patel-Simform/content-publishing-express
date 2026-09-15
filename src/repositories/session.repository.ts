import { prisma } from "../config/prisma.js";

export interface CreateSessionInput {
  userId: string;
  refreshTokenHash: string;
  familyId: string;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export const create = (input: CreateSessionInput) =>
  prisma.session.create({
    data: {
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      familyId: input.familyId,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    },
  });

export const findById = (id: string) => prisma.session.findUnique({ where: { id } });

export const findActiveById = (id: string) =>
  prisma.session.findFirst({
    where: { id, revokedAt: null, expiresAt: { gt: new Date() } },
  });

export const findByRefreshTokenHash = (refreshTokenHash: string) =>
  prisma.session.findUnique({ where: { refreshTokenHash } });

/** Revokes exactly this row, but only if it has not already been revoked --
 * a `count` of 0 means a concurrent request already won the race. */
export const revokeIfLive = (id: string, rotatedAt: Date) =>
  prisma.session.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: rotatedAt, rotatedAt },
  });

export const revokeById = (id: string) =>
  prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });

export const revokeFamily = (familyId: string) =>
  prisma.session.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

export const revokeAllForUser = (userId: string) =>
  prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

/** Every other session for this user -- used by change-password, which keeps
 * the session making the request alive. */
export const revokeAllForUserExcept = (userId: string, keepId: string) =>
  prisma.session.updateMany({
    where: { userId, id: { not: keepId }, revokedAt: null },
    data: { revokedAt: new Date() },
  });

export const deleteExpired = (olderThan: Date) =>
  prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: olderThan } }, { revokedAt: { lt: olderThan } }] },
  });
