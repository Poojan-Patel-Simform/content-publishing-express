import { Queue } from "bullmq";

import { getRedisConnection } from "../config/redis.js";
import { env } from "../config/env.js";

export const SCHEDULED_PUBLICATION_QUEUE_NAME = "scheduled-publications";

export interface PublishJobData {
  versionId: string;
  jobRowId: string;
}

let queue: Queue<PublishJobData> | undefined;

/** Constructed on first use, never at import time, so a disabled scheduler
 * never opens a Redis connection (see `getRedisConnection`). */
export const getQueue = (): Queue<PublishJobData> => {
  queue ??= new Queue<PublishJobData>(SCHEDULED_PUBLICATION_QUEUE_NAME, {
    connection: getRedisConnection(),
  });
  return queue;
};

/**
 * Passing the `scheduled_publications` row's own id as BullMQ's `jobId` makes
 * this idempotent -- adding the same id twice is a no-op -- and gives the
 * reconciler a stable key to check the queue against (plan.md §5).
 */
export const enqueuePublish = async (
  jobRowId: string,
  versionId: string,
  scheduledFor: Date,
): Promise<void> => {
  if (!env.SCHEDULER_ENABLED) return;

  await getQueue().add(
    "publish",
    { versionId, jobRowId },
    {
      jobId: jobRowId,
      delay: Math.max(0, scheduledFor.getTime() - Date.now()),
      attempts: env.SCHEDULER_MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: env.SCHEDULER_BACKOFF_MS },
    },
  );
};

/** Best-effort: a race with the worker having already claimed the job is
 * fine -- `publishVersion`'s status guard is the real defence against a
 * cancelled item going live (plan.md §5). */
export const removeQueuedPublish = async (jobRowId: string): Promise<void> => {
  if (!env.SCHEDULER_ENABLED) return;

  const job = await getQueue().getJob(jobRowId);
  await job?.remove();
};

/** Used by the reconciler to tell "queue already knows about this row" apart
 * from "queue lost track of it and it needs re-enqueuing". */
export const hasQueuedJob = async (jobRowId: string): Promise<boolean> => {
  if (!env.SCHEDULER_ENABLED) return true;

  return (await getQueue().getJob(jobRowId)) !== undefined;
};
