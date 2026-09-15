import { prisma } from "../config/prisma.js";
import type { UserRole } from "../generated/prisma-client/enums.js";
import type { AuthUser } from "../interfaces/auth.interface.js";

export interface CreateUserInput {
  email: string;
  displayName: string;
  passwordHash: string | null;
  role?: UserRole;
  emailVerifiedAt?: Date | null;
  avatarUrl?: string | null;
}

/** Full row, including `passwordHash` -- only for use by services that verify
 * or rewrite a password. Never forward this object directly to a response;
 * use `toAuthUser` first. */
export const findByEmail = (email: string) => prisma.user.findUnique({ where: { email } });

export const findById = (id: string) => prisma.user.findUnique({ where: { id } });

export const create = (input: CreateUserInput) =>
  prisma.user.create({
    data: {
      email: input.email,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      ...(input.role !== undefined ? { role: input.role } : {}),
      emailVerifiedAt: input.emailVerifiedAt ?? null,
      avatarUrl: input.avatarUrl ?? null,
    },
  });

export const setEmailVerified = (id: string) =>
  prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });

export const setPasswordHash = (id: string, passwordHash: string) =>
  prisma.user.update({ where: { id }, data: { passwordHash } });

type UserWithPasswordHash = Awaited<ReturnType<typeof findById>>;

/** The only path from a Prisma `User` row to anything that may reach a response. */
export const toAuthUser = (user: NonNullable<UserWithPasswordHash>): AuthUser => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
  status: user.status,
  emailVerifiedAt: user.emailVerifiedAt,
  avatarUrl: user.avatarUrl,
});
