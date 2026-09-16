import { prisma } from "../config/prisma.js";
import type * as Prisma from "../generated/prisma-client/internal/prismaNamespace.js";

export interface CreateScheduledPublicationInput {
  id: string;
  contentItemId: string;
  versionId: string;
  scheduledFor: Date;
  createdById: string;
}

/** `id` is caller-supplied (not `@default(uuid(7))`-generated) so it can also
 * serve as the BullMQ job id, making the queue enqueue idempotent -- see
 * plan.md §5. */
export const create = (tx: Prisma.TransactionClient, input: CreateScheduledPublicationInput) =>
  tx.scheduledPublication.create({
    data: {
      id: input.id,
      contentItemId: input.contentItemId,
      versionId: input.versionId,
      scheduledFor: input.scheduledFor,
      createdById: input.createdById,
    },
  });

export const findById = (id: string) => prisma.scheduledPublication.findUnique({ where: { id } });

export const findLiveForVersion = (versionId: string) =>
  prisma.scheduledPublication.findFirst({
    where: { versionId, status: { in: ["PENDING", "CLAIMED"] } },
  });

/** Status-guarded: a job already claimed or terminal is left untouched. */
export const cancel = (tx: Prisma.TransactionClient, id: string) =>
  tx.scheduledPublication.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });

/** Everything the reconciler needs to re-check against the queue -- every
 * `PENDING` row, not just due ones, since a row not yet due but missing from
 * the queue (e.g. added while Redis was down) still needs enqueuing with the
 * right delay. */
export const listPending = () =>
  prisma.scheduledPublication.findMany({ where: { status: "PENDING" } });

export const markFailed = (id: string, lastError: string) =>
  prisma.scheduledPublication.updateMany({
    where: { id, status: { in: ["PENDING", "CLAIMED"] } },
    data: { status: "FAILED", lastError },
  });
