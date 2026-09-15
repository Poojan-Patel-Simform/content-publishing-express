import { prisma } from "../config/prisma.js";
import type { AuthProvider } from "../generated/prisma-client/enums.js";

export const findByProviderAccount = (provider: AuthProvider, providerAccountId: string) =>
  prisma.account.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    include: { user: true },
  });

export const create = (userId: string, provider: AuthProvider, providerAccountId: string) =>
  prisma.account.create({ data: { userId, provider, providerAccountId } });
