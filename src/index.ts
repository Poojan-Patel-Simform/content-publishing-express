// Imported first: a bad environment should abort the process before anything
// else initializes or opens a connection.
import { env } from "./config/env.js";

import { createApp } from "./app.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { disconnectRedis } from "./config/redis.js";
import {
  startScheduledPublicationReconciler,
  stopScheduledPublicationReconciler,
} from "./jobs/scheduled-publication.reconciler.js";
import { startSessionCleanup, stopSessionCleanup } from "./jobs/session-cleanup.job.js";
import {
  startScheduledPublicationWorker,
  stopScheduledPublicationWorker,
} from "./workers/scheduled-publication.worker.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Server listening");
  startSessionCleanup();
  startScheduledPublicationWorker();
  startScheduledPublicationReconciler();
});

let shuttingDown = false;

const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, "Shutting down");

  // A connection that never drains must not be able to block a deploy.
  const forceExit = setTimeout(() => {
    logger.fatal("Graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    stopSessionCleanup();
    stopScheduledPublicationReconciler();
    await stopScheduledPublicationWorker();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await prisma.$disconnect();
    await disconnectRedis();
    logger.info("Shutdown complete");
    process.exit(exitCode);
  } catch (err) {
    logger.error({ err }, "Error during shutdown");
    process.exit(1);
  }
};

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void shutdown(signal));
}

// After an uncaught exception the process state is undefined. Staying alive is
// the unsafe option, so log it and shut down.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  void shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  void shutdown("unhandledRejection", 1);
});
