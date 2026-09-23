import { prisma } from "../config/prisma.js";
import { AuditAction, VersionStatus } from "../generated/prisma-client/enums.js";
import type * as Prisma from "../generated/prisma-client/internal/prismaNamespace.js";
import { ConflictError, NotFoundError } from "../errors/http-errors.js";
import * as auditService from "./audit.service.js";
import { assertTransition } from "./content-state.js";

interface PublishContext {
  /** `null` for a system trigger (the scheduler worker) rather than an editor click. */
  actorId: string | null;
  requestId: string;
  /** Present when this publish satisfies a `ScheduledPublication` row. */
  jobId?: string;
  /** Lets a caller (editorial.service) fold its own writes -- e.g. the
   * `Review` row for a direct publish -- into the same transaction. Defaults
   * to a new one, which is what the future BullMQ worker uses. */
  client?: Prisma.TransactionClient;
}

/**
 * The only code path that makes a version live (plan.md §5). Whether the
 * trigger is an editor's publish click or the scheduler worker, this function
 * runs unchanged.
 *
 * A version only becomes eligible here once review has passed: APPROVED (an
 * editor publishing after approval), SCHEDULED (the worker firing a job that
 * was itself only bookable from APPROVED), or UNPUBLISHED (re-publishing
 * something that was already live). PENDING_REVIEW is deliberately absent --
 * this guard is the SQL-level twin of the transition table in
 * content-state.ts, and the two must agree.
 *
 * Step 1's status-guarded `updateMany` is the idempotency hinge: a replay (a
 * stalled job re-picked by another worker, two editors clicking publish at
 * once) affects 0 rows and returns `{ alreadyPublished: true }` without
 * touching anything else, so there is never a window where the item is live
 * but a satisfied job row still reads PENDING.
 */
export const publishVersion = async (
  versionId: string,
  ctx: PublishContext,
): Promise<{ alreadyPublished: boolean }> => {
  const run = async (tx: Prisma.TransactionClient): Promise<{ alreadyPublished: boolean }> => {
    const publishedAt = new Date();

    const guarded = await tx.contentVersion.updateMany({
      where: {
        id: versionId,
        status: {
          in: [VersionStatus.APPROVED, VersionStatus.SCHEDULED, VersionStatus.UNPUBLISHED],
        },
        item: { archivedAt: null },
      },
      data: { status: VersionStatus.PUBLISHED, publishedAt },
    });
    if (guarded.count === 0) return { alreadyPublished: true };

    const version = await tx.contentVersion.findUniqueOrThrow({ where: { id: versionId } });
    const item = await tx.contentItem.findUniqueOrThrow({ where: { id: version.contentItemId } });

    if (item.publishedVersionId && item.publishedVersionId !== versionId) {
      await tx.contentVersion.updateMany({
        where: { id: item.publishedVersionId, status: VersionStatus.PUBLISHED },
        data: { status: VersionStatus.SUPERSEDED, supersededAt: publishedAt },
      });
    }

    await tx.contentItem.update({
      where: { id: item.id },
      data: {
        publishedVersionId: versionId,
        publishedTitle: version.title,
        publishedAt,
        status: "PUBLISHED",
        unpublishedAt: null,
      },
    });

    if (ctx.jobId) {
      await tx.scheduledPublication.updateMany({
        where: { id: ctx.jobId, status: { in: ["PENDING", "CLAIMED"] } },
        data: { status: "SUCCEEDED", completedAt: publishedAt },
      });
    }

    await auditService.recordAuditEvent(
      ctx.actorId === null ? AuditAction.SCHEDULED_PUBLISH_EXECUTED : AuditAction.PUBLISHED,
      ctx.actorId,
      ctx.requestId,
      { contentItemId: item.id, versionId, client: tx },
    );

    return { alreadyPublished: false };
  };

  if (ctx.client) return run(ctx.client);
  return prisma.$transaction(run);
};

export const unpublish = async (
  itemId: string,
  ctx: { actorId: string; requestId: string },
): Promise<void> => {
  const item = await prisma.contentItem.findUnique({ where: { id: itemId } });
  if (!item) throw new NotFoundError("Content item not found");
  if (item.status !== "PUBLISHED" || !item.publishedVersionId) {
    throw new ConflictError("Item has no published version to unpublish");
  }

  const versionId = item.publishedVersionId;
  const version = await prisma.contentVersion.findUniqueOrThrow({ where: { id: versionId } });
  assertTransition(version.status, VersionStatus.UNPUBLISHED);

  await prisma.$transaction(async (tx) => {
    const unpublishedAt = new Date();

    const guarded = await tx.contentItem.updateMany({
      where: { id: itemId, status: "PUBLISHED" },
      data: { status: "UNPUBLISHED", publishedVersionId: null, unpublishedAt },
    });
    if (guarded.count === 0) throw new ConflictError("Item has no published version to unpublish");

    await tx.contentVersion.update({
      where: { id: versionId },
      data: { status: VersionStatus.UNPUBLISHED, unpublishedAt },
    });

    await auditService.recordAuditEvent(AuditAction.UNPUBLISHED, ctx.actorId, ctx.requestId, {
      contentItemId: itemId,
      versionId,
      client: tx,
    });
  });
};
