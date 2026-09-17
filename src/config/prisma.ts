import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma-client/client.js";
import { env, isProduction } from "./env.js";

declare global {
  var prismaClient: PrismaClient | undefined;
}

// `max` is deliberately small: DATABASE_URL points at Neon's pooler, and the
// free tier gives the whole project a modest connection budget. A generous
// local pool on top of a shared remote pooler just moves the exhaustion.
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 5,
});

export const prisma = globalThis.prismaClient ?? new PrismaClient({ adapter });

if (!isProduction) {
  globalThis.prismaClient = prisma;
}
