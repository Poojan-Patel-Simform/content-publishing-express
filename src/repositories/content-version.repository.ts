import { prisma } from "../config/prisma.js";
import type { VersionStatus } from "../generated/prisma-client/enums.js";
import type * as Prisma from "../generated/prisma-client/internal/prismaNamespace.js";

export interface CreateContentVersionInput {
  contentItemId: string;
  versionNumber: number;
  title: string;
  body: string;
  excerpt?: string | null | undefined;
  categoryId?: string | null | undefined;
  tagIds?: string[] | undefined;
  parentVersionId?: string | null | undefined;
  changeSummary?: string | null | undefined;
  createdById: string;
  status?: VersionStatus | undefined;
}

export const create = (tx: Prisma.TransactionClient, input: CreateContentVersionInput) =>
  tx.contentVersion.create({
    data: {
      contentItemId: input.contentItemId,
      versionNumber: input.versionNumber,
      title: input.title,
      body: input.body,
      excerpt: input.excerpt ?? null,
      categoryId: input.categoryId ?? null,
      parentVersionId: input.parentVersionId ?? null,
      changeSummary: input.changeSummary ?? null,
      createdById: input.createdById,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.tagIds && input.tagIds.length > 0
        ? { tags: { create: input.tagIds.map((tagId) => ({ tagId })) } }
        : {}),
    },
  });

export const findById = (id: string) =>
  prisma.contentVersion.findUnique({ where: { id }, include: { tags: true } });

export const findByIdForItem = (contentItemId: string, id: string) =>
  prisma.contentVersion.findFirst({
    where: { id, contentItemId },
    include: { tags: true },
  });

export const findLatestForItem = (contentItemId: string) =>
  prisma.contentVersion.findFirst({
    where: { contentItemId },
    orderBy: { versionNumber: "desc" },
  });

export const listForItem = (contentItemId: string) =>
  prisma.contentVersion.findMany({
    where: { contentItemId },
    orderBy: { versionNumber: "desc" },
  });

export interface UpdateDraftInput {
  title?: string;
  body?: string;
  excerpt?: string | null;
  categoryId?: string | null;
  changeSummary?: string | null;
}

/** Status-guarded: only a version still in `DRAFT`/`REJECTED` is touched, so a
 * race with a concurrent submit cannot edit content mid-review. `count === 0`
 * means the mutability rule (plan.md §2) already tripped. */
export const updateIfEditable = (
  tx: Prisma.TransactionClient,
  id: string,
  data: UpdateDraftInput,
) =>
  tx.contentVersion.updateMany({
    where: { id, status: { in: ["DRAFT", "REJECTED"] } },
    data,
  });

export const replaceTags = (tx: Prisma.TransactionClient, versionId: string, tagIds: string[]) =>
  tx.contentVersionTag
    .deleteMany({ where: { versionId } })
    .then(() =>
      tagIds.length > 0
        ? tx.contentVersionTag.createMany({ data: tagIds.map((tagId) => ({ versionId, tagId })) })
        : Promise.resolve({ count: 0 }),
    );

export const updateStatus = (
  tx: Prisma.TransactionClient,
  id: string,
  data: Prisma.ContentVersionUpdateInput,
) => tx.contentVersion.update({ where: { id }, data });

/** Editor review queue: `WHERE status = 'PENDING_REVIEW' ORDER BY submittedAt
 * ASC` -- served by the `(status, submittedAt)` index (prisma/schema.prisma). */
export const listPendingReview = (skip: number, take: number) =>
  prisma.contentVersion.findMany({
    where: { status: "PENDING_REVIEW" },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    skip,
    take,
  });

export const countPendingReview = () =>
  prisma.contentVersion.count({ where: { status: "PENDING_REVIEW" } });
