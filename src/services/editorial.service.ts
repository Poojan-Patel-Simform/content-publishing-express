import { randomUUID } from "node:crypto";

import { logger } from "../config/logger.js";
import { prisma } from "../config/prisma.js";
import { AuditAction, ReviewDecision, VersionStatus } from "../generated/prisma-client/enums.js";
import type { ContentVersionModel } from "../generated/prisma-client/models.js";
import { ConflictError, NotFoundError } from "../errors/http-errors.js";
import type {
  ContentVersionSummaryDto,
  PagedResult,
  ReviewQueueEntryDto,
} from "../interfaces/content.interface.js";
import * as scheduledPublicationQueue from "../queues/scheduled-publication.queue.js";
import * as contentItemRepository from "../repositories/content-item.repository.js";
import * as contentVersionRepository from "../repositories/content-version.repository.js";
import * as reviewRepository from "../repositories/review.repository.js";
import * as scheduledPublicationRepository from "../repositories/scheduled-publication.repository.js";
import { buildPageMeta, toSkipTake } from "../utils/pagination.js";
import * as auditService from "./audit.service.js";
import { assertTransition } from "./content-state.js";
import * as publishingService from "./publishing.service.js";
import * as scheduleCancellationService from "./schedule-cancellation.service.js";

interface RequestContext {
  actorId: string;
  requestId: string;
}

const toSummaryDto = (version: ContentVersionModel): ContentVersionSummaryDto => ({
  id: version.id,
  contentItemId: version.contentItemId,
  versionNumber: version.versionNumber,
  status: version.status,
  title: version.title,
  changeSummary: version.changeSummary,
  createdById: version.createdById,
  createdAt: version.createdAt,
  submittedAt: version.submittedAt,
  publishedAt: version.publishedAt,
});

const requireVersion = async (versionId: string): Promise<ContentVersionModel> => {
  const version = await contentVersionRepository.findById(versionId);
  if (!version) throw new NotFoundError("Version not found");
  return version;
};

// Used by transitions that must not touch an archived item (EC-4): approve,
// reject, publish, schedule. cancelSchedule is deliberately exempt -- it only
// moves a version away from being publishable, so it shouldn't be blocked by
// the same archived state it helps clean up.
const requireVersionWithItem = async (versionId: string) => {
  const version = await contentVersionRepository.findByIdWithItem(versionId);
  if (!version) throw new NotFoundError("Version not found");
  if (version.item.archivedAt) {
    throw new ConflictError("Item is archived; version cannot be transitioned");
  }
  return version;
};

export const getQueue = async (query: {
  page: number;
  pageSize: number;
}): Promise<PagedResult<ReviewQueueEntryDto>> => {
  const { skip, take } = toSkipTake(query);

  // Count and page share one transaction so `totalItems` never drifts from
  // the rows actually returned, same pattern as public-content.service.ts.
  const [totalItems, rows] = await prisma.$transaction([
    contentVersionRepository.countPendingReview(),
    contentVersionRepository.listPendingReview(skip, take),
  ]);

  const meta = buildPageMeta(query, totalItems);
  const items = rows.map(({ createdBy, ...version }) => ({
    ...toSummaryDto(version),
    author: createdBy,
  }));
  return { items, meta };
};

export const approve = async (
  versionId: string,
  input: { comment?: string | undefined },
  ctx: RequestContext,
): Promise<ContentVersionSummaryDto> => {
  const version = await requireVersionWithItem(versionId);
  assertTransition(version.status, VersionStatus.APPROVED);

  const updated = await prisma.$transaction(async (tx) => {
    const guarded = await contentVersionRepository.updateStatus(tx, versionId, version.status, {
      status: VersionStatus.APPROVED,
      reviewedAt: new Date(),
    });
    if (guarded.count === 0) throw new ConflictError("Version was transitioned concurrently");
    await reviewRepository.create(tx, {
      contentItemId: version.contentItemId,
      versionId,
      reviewerId: ctx.actorId,
      decision: ReviewDecision.APPROVE,
      comment: input.comment ?? null,
    });
    await auditService.recordAuditEvent(AuditAction.REVIEW_APPROVED, ctx.actorId, ctx.requestId, {
      contentItemId: version.contentItemId,
      versionId,
      client: tx,
    });
    return tx.contentVersion.findUniqueOrThrow({ where: { id: versionId } });
  });

  return toSummaryDto(updated);
};

export const reject = async (
  versionId: string,
  input: { comment: string },
  ctx: RequestContext,
): Promise<ContentVersionSummaryDto> => {
  const version = await requireVersionWithItem(versionId);
  assertTransition(version.status, VersionStatus.REJECTED);

  const updated = await prisma.$transaction(async (tx) => {
    const guarded = await contentVersionRepository.updateStatus(tx, versionId, version.status, {
      status: VersionStatus.REJECTED,
      reviewedAt: new Date(),
    });
    if (guarded.count === 0) throw new ConflictError("Version was transitioned concurrently");
    await reviewRepository.create(tx, {
      contentItemId: version.contentItemId,
      versionId,
      reviewerId: ctx.actorId,
      decision: ReviewDecision.REJECT,
      comment: input.comment,
    });
    await auditService.recordAuditEvent(AuditAction.REVIEW_REJECTED, ctx.actorId, ctx.requestId, {
      contentItemId: version.contentItemId,
      versionId,
      client: tx,
    });
    return tx.contentVersion.findUniqueOrThrow({ where: { id: versionId } });
  });

  return toSummaryDto(updated);
};

/**
 * Publishes a version that has already cleared review -- APPROVED, or
 * UNPUBLISHED when re-publishing something that was live before. Approval is
 * a hard gate: a PENDING_REVIEW version is refused by `assertTransition` with
 * a 409 before any write. The `Review` row and `publishVersion`'s state
 * change commit in one transaction --
 * `publishVersion` accepts the same `tx` via `client` rather than opening its
 * own, so a crash between the two can never record a decision without the
 * publish (or vice versa). The future BullMQ worker calls `publishVersion`
 * with no `client`, letting it open its own transaction as usual.
 */
export const publish = async (
  versionId: string,
  input: { comment?: string | undefined },
  ctx: RequestContext,
): Promise<ContentVersionSummaryDto> => {
  const version = await requireVersionWithItem(versionId);
  assertTransition(version.status, VersionStatus.PUBLISHED);

  await prisma.$transaction(async (tx) => {
    await reviewRepository.create(tx, {
      contentItemId: version.contentItemId,
      versionId,
      reviewerId: ctx.actorId,
      decision: ReviewDecision.PUBLISH,
      comment: input.comment ?? null,
    });
    const result = await publishingService.publishVersion(versionId, {
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      client: tx,
    });
    if (result.alreadyPublished) throw new ConflictError("Version was already published");
  });

  const refreshed = await requireVersion(versionId);
  return toSummaryDto(refreshed);
};

export const schedule = async (
  versionId: string,
  input: { scheduledFor: Date },
  ctx: RequestContext,
): Promise<ContentVersionSummaryDto> => {
  const version = await requireVersionWithItem(versionId);
  assertTransition(version.status, VersionStatus.SCHEDULED);

  // Caller-supplied id doubles as the BullMQ job id (plan.md §5).
  const jobId = randomUUID();

  const updated = await prisma.$transaction(async (tx) => {
    const guarded = await contentVersionRepository.updateStatus(tx, versionId, version.status, {
      status: VersionStatus.SCHEDULED,
      scheduledPublishAt: input.scheduledFor,
    });
    if (guarded.count === 0) throw new ConflictError("Version was transitioned concurrently");
    await scheduledPublicationRepository.create(tx, {
      id: jobId,
      contentItemId: version.contentItemId,
      versionId,
      scheduledFor: input.scheduledFor,
      createdById: ctx.actorId,
    });
    await reviewRepository.create(tx, {
      contentItemId: version.contentItemId,
      versionId,
      reviewerId: ctx.actorId,
      decision: ReviewDecision.SCHEDULE,
      scheduledFor: input.scheduledFor,
    });
    await auditService.recordAuditEvent(AuditAction.PUBLISH_SCHEDULED, ctx.actorId, ctx.requestId, {
      contentItemId: version.contentItemId,
      versionId,
      metadata: { jobId, scheduledFor: input.scheduledFor.toISOString() },
      client: tx,
    });
    return tx.contentVersion.findUniqueOrThrow({ where: { id: versionId } });
  });

  // Redis/BullMQ are not in the transaction above -- if this throws (Redis
  // down), swallow it rather than fail the request: the row already
  // committed as PENDING, and the reconciler enqueues anything the queue
  // doesn't know about on its next sweep (plan.md §5).
  try {
    await scheduledPublicationQueue.enqueuePublish(jobId, versionId, input.scheduledFor);
  } catch (err) {
    logger.warn(
      { err, jobId, versionId },
      "Failed to enqueue scheduled publish, reconciler will retry",
    );
  }

  return toSummaryDto(updated);
};

export const cancelSchedule = async (versionId: string, ctx: RequestContext): Promise<void> => {
  const version = await requireVersion(versionId);
  if (version.status !== VersionStatus.SCHEDULED) {
    throw new ConflictError("Version is not scheduled");
  }

  assertTransition(version.status, VersionStatus.APPROVED);

  const cancelled = await prisma.$transaction((tx) =>
    scheduleCancellationService.cancelLiveScheduleInTx(
      tx,
      versionId,
      version.contentItemId,
      ctx.actorId,
      ctx.requestId,
    ),
  );
  if (!cancelled) throw new NotFoundError("No pending schedule for this version");

  await scheduleCancellationService.removeCancelledScheduleJob(cancelled, versionId);
};

export const unpublish = async (itemId: string, ctx: RequestContext): Promise<void> => {
  // `ReviewDecision` has no UNPUBLISH member (APPROVE/REJECT/PUBLISH/SCHEDULE
  // only) -- unpublish records only the AuditEvent, not a Review row. Adding
  // a decision value is a schema change out of scope here.
  await publishingService.unpublish(itemId, ctx);
};

export const restore = async (
  itemId: string,
  versionId: string,
  input: { changeSummary?: string | undefined },
  ctx: RequestContext,
): Promise<ContentVersionSummaryDto> => {
  const item = await contentItemRepository.findByIdScoped(itemId, { role: "EDITOR" });
  if (!item) throw new NotFoundError("Content item not found");

  const source = await contentVersionRepository.findByIdForItem(itemId, versionId);
  if (!source) throw new NotFoundError("Version not found");

  const created = await prisma.$transaction(async (tx) => {
    const bumped = await contentItemRepository.bumpVersionCounter(tx, itemId);
    const version = await contentVersionRepository.create(tx, {
      contentItemId: itemId,
      versionNumber: bumped.versionCounter,
      title: source.title,
      body: source.body,
      excerpt: source.excerpt,
      categoryId: source.categoryId,
      tagIds: source.tags?.map((t) => t.tagId) ?? [],
      parentVersionId: source.id,
      changeSummary: input.changeSummary ?? `Restored from version ${source.versionNumber}`,
      createdById: ctx.actorId,
    });

    await auditService.recordAuditEvent(AuditAction.REVISION_RESTORED, ctx.actorId, ctx.requestId, {
      contentItemId: itemId,
      versionId: version.id,
      metadata: { restoredFromVersionId: source.id },
      client: tx,
    });

    return version;
  });

  return toSummaryDto(created);
};
