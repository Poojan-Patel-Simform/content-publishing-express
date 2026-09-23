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

/** Taxonomy comes back as slugs as well as ids: ids are what the rows store,
 * but slugs are what the API speaks and what an edit form can round-trip --
 * there is no endpoint to resolve an id back to a slug. */
const withTaxonomy = {
  tags: { include: { tag: { select: { slug: true } } } },
  category: { select: { slug: true } },
} as const;

export const findById = (id: string) =>
  prisma.contentVersion.findUnique({ where: { id }, include: withTaxonomy });

export const findByIdWithItem = (id: string) =>
  prisma.contentVersion.findUnique({
    where: { id },
    include: { item: { select: { id: true, status: true, archivedAt: true } } },
  });

export const findByIdForItem = (contentItemId: string, id: string) =>
  prisma.contentVersion.findFirst({
    where: { id, contentItemId },
    include: withTaxonomy,
  });

export const findLatestForItem = (contentItemId: string) =>
  prisma.contentVersion.findFirst({
    where: { contentItemId },
    orderBy: { versionNumber: "desc" },
  });

export const findLatestByStatusForItem = (contentItemId: string, status: VersionStatus) =>
  prisma.contentVersion.findFirst({
    where: { contentItemId, status },
    orderBy: { versionNumber: "desc" },
  });

export const listForItem = (contentItemId: string) =>
  prisma.contentVersion.findMany({
    where: { contentItemId },
    orderBy: { versionNumber: "desc" },
  });

/** At most one version can be SCHEDULED per item in practice (the review
 * pipeline only ever advances one version at a time), so findFirst is safe. */
export const findLiveScheduledForItem = (contentItemId: string) =>
  prisma.contentVersion.findFirst({
    where: { contentItemId, status: "SCHEDULED" },
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
    // The queue is triaged without the item in hand, so the author comes along
    // for the ride -- one join beats N lookups from the client.
    include: { createdBy: { select: { id: true, displayName: true } } },
  });

export const countPendingReview = () =>
  prisma.contentVersion.count({ where: { status: "PENDING_REVIEW" } });
