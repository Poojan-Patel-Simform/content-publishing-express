import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import * as scheduledPublicationQueue from "../queues/scheduled-publication.queue.js";
import * as scheduledPublicationRepository from "../repositories/scheduled-publication.repository.js";

let interval: NodeJS.Timeout | undefined;

/**
 * Heals the gap between "Postgres says this must still publish" (a `PENDING`
 * row) and "Redis has no memory of it" -- a queue flush, a Redis restart, or
 * a swallowed enqueue failure in `editorial.service.schedule` all show up
 * the same way and get the same fix (plan.md §5).
 */
const runReconcile = async (): Promise<void> => {
  try {
    const pending = await scheduledPublicationRepository.listPending();
    let enqueued = 0;

    for (const row of pending) {
      const alreadyQueued = await scheduledPublicationQueue.hasQueuedJob(row.id);
      if (alreadyQueued) continue;

      await scheduledPublicationQueue.enqueuePublish(row.id, row.versionId, row.scheduledFor);
      enqueued += 1;
    }

    logger.info({ checked: pending.length, enqueued }, "Scheduled publication reconcile ran");
  } catch (err) {
    logger.error({ err }, "Scheduled publication reconcile failed");
  }
};

export const startScheduledPublicationReconciler = (): void => {
  if (!env.SCHEDULER_ENABLED || interval) return;

  void runReconcile();
  interval = setInterval(() => void runReconcile(), env.SCHEDULER_RECONCILE_INTERVAL_MS);
  interval.unref();
};

export const stopScheduledPublicationReconciler = (): void => {
  if (interval) clearInterval(interval);
  interval = undefined;
};
