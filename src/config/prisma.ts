import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma-client/client.js";
import { env, isProduction } from "./env.js";

declare global {
  var prismaClient: PrismaClient | undefined;
}

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = globalThis.prismaClient ?? new PrismaClient({ adapter });

if (!isProduction) {
  globalThis.prismaClient = prisma;
}
