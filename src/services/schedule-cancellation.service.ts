import { logger } from "../config/logger.js";
import { AuditAction, VersionStatus } from "../generated/prisma-client/enums.js";
import type * as Prisma from "../generated/prisma-client/internal/prismaNamespace.js";
import * as scheduledPublicationQueue from "../queues/scheduled-publication.queue.js";
import * as contentVersionRepository from "../repositories/content-version.repository.js";
import * as scheduledPublicationRepository from "../repositories/scheduled-publication.repository.js";
import * as auditService from "./audit.service.js";

export interface CancelledSchedule {
  jobId: string;
}

/**
 * Cancels the live ScheduledPublication row for a version and moves the
 * version off SCHEDULED, inside the caller's transaction. SCHEDULED ->
 * APPROVED is the only legal target in content-state.ts's TRANSITIONS table
 * (VersionStatus has no ARCHIVED member), so every caller unwinding a
 * schedule lands here regardless of why.
 *
 * Returns null if there was no live job to cancel, or if the job was
 * claimed/resolved concurrently -- publishVersion's own item-archived guard
 * is the real backstop against resurrection, so callers don't need to fail
 * their whole transaction over this race.
 */
export const cancelLiveScheduleInTx = async (
  tx: Prisma.TransactionClient,
  versionId: string,
  contentItemId: string,
  actorId: string | null,
  requestId: string,
): Promise<CancelledSchedule | null> => {
  const job = await scheduledPublicationRepository.findLiveForVersion(versionId);
  if (!job) return null;

  const guarded = await contentVersionRepository.updateStatus(
    tx,
    versionId,
    VersionStatus.SCHEDULED,
    {
      status: VersionStatus.APPROVED,
      scheduledPublishAt: null,
    },
  );
  if (guarded.count === 0) return null;

  const cancelled = await scheduledPublicationRepository.cancel(tx, job.id);
  if (cancelled.count === 0) return null;

  await auditService.recordAuditEvent(AuditAction.SCHEDULE_CANCELLED, actorId, requestId, {
    contentItemId,
    versionId,
    client: tx,
  });

  return { jobId: job.id };
};

/** Best-effort, same reasoning as everywhere else this queue is touched: a
 * race with the worker having already claimed the job is tolerated. */
export const removeCancelledScheduleJob = async (
  job: CancelledSchedule | null,
  versionId: string,
): Promise<void> => {
  if (!job) return;
  try {
    await scheduledPublicationQueue.removeQueuedPublish(job.jobId);
  } catch (err) {
    logger.warn({ err, jobId: job.jobId, versionId }, "Failed to remove queued publish job");
  }
};
