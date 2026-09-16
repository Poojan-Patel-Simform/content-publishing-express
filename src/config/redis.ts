import { Redis } from "ioredis";

import { env, isProduction } from "./env.js";

declare global {
  var redisClient: Redis | undefined;
}

/**
 * Lazily constructed so importing this module never opens a connection --
 * only `getRedisConnection()` does, and every caller (queue/worker/
 * reconciler) only reaches that behind an `env.SCHEDULER_ENABLED` guard. That
 * keeps `SCHEDULER_ENABLED=false` from touching Redis at all, not even a
 * dangling idle client.
 */
let client: Redis | undefined;

export const getRedisConnection = (): Redis => {
  if (client) return client;
  if (!isProduction && globalThis.redisClient) return (client = globalThis.redisClient);

  // BullMQ manages its own retry/backoff per job; a client-level retry limit
  // on top of that just races BullMQ's own logic, so it must be disabled.
  client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  if (!isProduction) globalThis.redisClient = client;
  return client;
};

/** No-op if `getRedisConnection` was never called -- lets shutdown stay
 * unconditional without opening a connection just to close it. */
export const disconnectRedis = async (): Promise<void> => {
  if (!client) return;
  await client.quit();
  client = undefined;
  globalThis.redisClient = undefined;
};
