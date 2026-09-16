import { prisma } from "../config/prisma.js";
import type { ReviewDecision } from "../generated/prisma-client/enums.js";
import type * as Prisma from "../generated/prisma-client/internal/prismaNamespace.js";

export interface CreateReviewInput {
  contentItemId: string;
  versionId: string;
  reviewerId: string;
  decision: ReviewDecision;
  comment?: string | null;
  scheduledFor?: Date | null;
}

export const create = (tx: Prisma.TransactionClient, input: CreateReviewInput) =>
  tx.review.create({
    data: {
      contentItemId: input.contentItemId,
      versionId: input.versionId,
      reviewerId: input.reviewerId,
      decision: input.decision,
      comment: input.comment ?? null,
      scheduledFor: input.scheduledFor ?? null,
    },
  });

export const listForItem = (contentItemId: string) =>
  prisma.review.findMany({ where: { contentItemId }, orderBy: { createdAt: "desc" } });

export const listForVersion = (versionId: string) =>
  prisma.review.findMany({ where: { versionId }, orderBy: { createdAt: "desc" } });
