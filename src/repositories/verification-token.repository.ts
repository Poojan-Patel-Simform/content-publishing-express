import { prisma } from "../config/prisma.js";
import type { TokenPurpose } from "../generated/prisma-client/enums.js";

export interface CreateVerificationTokenInput {
  userId: string;
  purpose: TokenPurpose;
  tokenHash: string;
  expiresAt: Date;
}

export const create = (input: CreateVerificationTokenInput) =>
  prisma.verificationToken.create({ data: input });

export const findValidByHash = (tokenHash: string) =>
  prisma.verificationToken.findFirst({
    where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
  });

export const consume = (id: string) =>
  prisma.verificationToken.update({ where: { id }, data: { consumedAt: new Date() } });

/** Required before issuing a fresh token of the same purpose: the
 * `one_live_per_purpose` partial unique index allows at most one outstanding
 * (unconsumed) token per user per purpose. */
export const deleteOutstanding = (userId: string, purpose: TokenPurpose) =>
  prisma.verificationToken.deleteMany({ where: { userId, purpose, consumedAt: null } });

export const deleteExpired = (olderThan: Date) =>
  prisma.verificationToken.deleteMany({ where: { expiresAt: { lt: olderThan } } });
