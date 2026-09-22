import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma-client/client.js";
import { env, isProduction } from "./env.js";

declare global {
  var prismaClient: PrismaClient | undefined;
}

// DATABASE_URL now points at Neon's direct (unpooled) endpoint, with pooling
// handled by Neon's own connection pooler server-side. The local pg pool can
// afford more headroom than before since it's no longer stacked on top of a
// second, shared remote pooler.
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 10,
});

export const prisma =
  globalThis.prismaClient ??
  new PrismaClient({
    adapter,
    transactionOptions: {
      maxWait: 5000,
      timeout: 10000,
    },
  });

if (!isProduction) {
  globalThis.prismaClient = prisma;
}
