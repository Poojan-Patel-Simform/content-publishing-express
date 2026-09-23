import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma-client/client.js";
import { env, isProduction } from "./env.js";

declare global {
  var prismaClient: PrismaClient | undefined;
}

// DATABASE_URL points at Neon's pooled (`-pooler`, PgBouncer transaction-mode)
// endpoint; interactive transactions still work since each one pins a single
// server connection for its lifetime.
//
// Connections are kept idle for a minute (pg's default is 10s) so bursts of
// scheduled publishes reuse warm sockets instead of each paying for a fresh
// TLS + SCRAM handshake -- or a Neon cold start after auto-suspend.
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 10_000,
});

export const prisma =
  globalThis.prismaClient ??
  new PrismaClient({
    adapter,
    transactionOptions: {
      // Covers acquiring a connection, which can include a Neon cold start.
      maxWait: 15000,
      timeout: 10000,
    },
  });

if (!isProduction) {
  globalThis.prismaClient = prisma;
}
