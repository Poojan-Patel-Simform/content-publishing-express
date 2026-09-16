import { Worker, type Job } from "bullmq";

import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getRedisConnection } from "../config/redis.js";
import * as scheduledPublicationRepository from "../repositories/scheduled-publication.repository.js";
import * as publishingService from "../services/publishing.service.js";
import {
  SCHEDULED_PUBLICATION_QUEUE_NAME,
  type PublishJobData,
} from "../queues/scheduled-publication.queue.js";

let worker: Worker<PublishJobData> | undefined;

const isFinalAttempt = (job: Job<PublishJobData>): boolean =>
  job.attemptsMade >= (job.opts.attempts ?? 1);

export const startScheduledPublicationWorker = (): void => {
  if (!env.SCHEDULER_ENABLED || worker) return;

  worker = new Worker<PublishJobData>(
    SCHEDULED_PUBLICATION_QUEUE_NAME,
    async (job) => {
      await publishingService.publishVersion(job.data.versionId, {
        actorId: null,
        requestId: `scheduler:${job.id ?? job.data.jobRowId}`,
        jobId: job.data.jobRowId,
      });
    },
    {
      connection: getRedisConnection(),
      concurrency: env.SCHEDULER_CONCURRENCY,
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  );

  worker.on("failed", (job, err) => {
    if (!job) return;
    logger.error({ err, jobId: job.id, versionId: job.data.versionId }, "Scheduled publish failed");

    // Only park the row FAILED once BullMQ's own attempts are exhausted --
    // otherwise a retry still in flight would be marked failed prematurely
    // and the reconciler would never touch it again.
    if (isFinalAttempt(job)) {
      void scheduledPublicationRepository
        .markFailed(job.data.jobRowId, err.message)
        .catch((markErr) =>
          logger.error({ err: markErr, jobId: job.data.jobRowId }, "Failed to mark job FAILED"),
        );
    }
  });
};

export const stopScheduledPublicationWorker = async (): Promise<void> => {
  if (!worker) return;
  await worker.close();
  worker = undefined;
};
