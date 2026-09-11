import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma-client/client.js";

declare global {
  var prismaClient: PrismaClient | undefined;
}

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"] });

export const prisma = globalThis.prismaClient ?? new PrismaClient({ adapter });

if (process.env["NODE_ENV"] !== "production") {
  globalThis.prismaClient = prisma;
}
