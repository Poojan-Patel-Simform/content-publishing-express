import { prisma } from "../config/prisma.js";
import { AuditAction, VersionStatus } from "../generated/prisma-client/enums.js";
import type { ContentItemModel, ContentVersionModel } from "../generated/prisma-client/models.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/http-errors.js";
import type {
  AuthorshipScope,
  ContentItemDetailDto,
  ContentItemDto,
  ContentVersionDto,
  ContentVersionSummaryDto,
  PagedResult,
} from "../interfaces/content.interface.js";
import * as contentItemRepository from "../repositories/content-item.repository.js";
import type { ListItemsFilters } from "../repositories/content-item.repository.js";
import * as contentVersionRepository from "../repositories/content-version.repository.js";
import * as taxonomyRepository from "../repositories/taxonomy.repository.js";
import { buildPageMeta, toSkipTake } from "../utils/pagination.js";
import { slugify, withUniquenessSuffix } from "../utils/slug.js";
import * as auditService from "./audit.service.js";
import { assertEditable, assertTransition } from "./content-state.js";

interface RequestContext {
  requestId: string;
}

/** `findById`/`findByIdForItem` fetch `tags` for the full DTO; every other
 * read of a version is scalar-only and never needs it. */
type ContentVersionWithTags = ContentVersionModel & { tags: { tagId: string }[] };

const toItemDto = (item: ContentItemModel): ContentItemDto => ({
  id: item.id,
  slug: item.slug,
  authorId: item.authorId,
  status: item.status,
  publishedVersionId: item.publishedVersionId,
  publishedTitle: item.publishedTitle,
  publishedAt: item.publishedAt,
  unpublishedAt: item.unpublishedAt,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  archivedAt: item.archivedAt,
});

const toVersionSummaryDto = (version: ContentVersionModel): ContentVersionSummaryDto => ({
  id: version.id,
  versionNumber: version.versionNumber,
  status: version.status,
  title: version.title,
  changeSummary: version.changeSummary,
  createdById: version.createdById,
  createdAt: version.createdAt,
  submittedAt: version.submittedAt,
  publishedAt: version.publishedAt,
});

const toVersionDto = (version: ContentVersionWithTags): ContentVersionDto => ({
  id: version.id,
  contentItemId: version.contentItemId,
  versionNumber: version.versionNumber,
  status: version.status,
  title: version.title,
  body: version.body,
  excerpt: version.excerpt,
  categoryId: version.categoryId,
  tagIds: version.tags?.map((t) => t.tagId) ?? [],
  parentVersionId: version.parentVersionId,
  changeSummary: version.changeSummary,
  createdById: version.createdById,
  createdAt: version.createdAt,
  updatedAt: version.updatedAt,
  submittedAt: version.submittedAt,
  reviewedAt: version.reviewedAt,
  publishedAt: version.publishedAt,
  unpublishedAt: version.unpublishedAt,
  scheduledPublishAt: version.scheduledPublishAt,
});

const resolveUniqueSlug = async (title: string): Promise<string> => {
  const base = slugify(title) || "item";
  let candidate = base;
  let attempt = 0;
  // Collisions are rare and bounded by title length, so a short retry loop
  // beats a database-generated suffix scheme for a first cut.
  while (await contentItemRepository.findBySlugExists(candidate)) {
    candidate = withUniquenessSuffix(base, attempt);
    attempt += 1;
  }
  return candidate;
};

const resolveTaxonomy = async (
  categorySlug: string | undefined,
  tagSlugs: string[] | undefined,
): Promise<{ categoryId: string | null; tagIds: string[] }> => {
  const category = categorySlug
    ? await taxonomyRepository.upsertCategoryBySlug(categorySlug)
    : null;
  const tags = tagSlugs ? await taxonomyRepository.upsertTagsBySlug(tagSlugs) : [];
  return { categoryId: category?.id ?? null, tagIds: tags.map((tag) => tag.id) };
};

export interface CreateItemInput {
  title: string;
  body: string;
  excerpt?: string | null | undefined;
  categorySlug?: string | undefined;
  tagSlugs?: string[] | undefined;
  changeSummary: string;
}

export const createItem = async (
  authorId: string,
  input: CreateItemInput,
  ctx: RequestContext,
): Promise<{ item: ContentItemDto; version: ContentVersionSummaryDto }> => {
  const slug = await resolveUniqueSlug(input.title);
  const { categoryId, tagIds } = await resolveTaxonomy(input.categorySlug, input.tagSlugs);

  const { item, version } = await prisma.$transaction(async (tx) => {
    const created = await contentItemRepository.create(tx, { slug, authorId });
    const bumped = await contentItemRepository.bumpVersionCounter(tx, created.id);
    const createdVersion = await contentVersionRepository.create(tx, {
      contentItemId: created.id,
      versionNumber: bumped.versionCounter,
      title: input.title,
      body: input.body,
      excerpt: input.excerpt,
      categoryId,
      tagIds,
      changeSummary: input.changeSummary,
      createdById: authorId,
    });

    await auditService.recordAuditEvent(AuditAction.ITEM_CREATED, authorId, ctx.requestId, {
      contentItemId: created.id,
      client: tx,
    });
    await auditService.recordAuditEvent(AuditAction.VERSION_CREATED, authorId, ctx.requestId, {
      contentItemId: created.id,
      versionId: createdVersion.id,
      client: tx,
    });

    return { item: bumped, version: createdVersion };
  });

  return { item: toItemDto(item), version: toVersionSummaryDto(version) };
};

export interface ListItemsQuery {
  page: number;
  pageSize: number;
  authorId?: string | undefined;
  status?: ListItemsFilters["status"] | undefined;
}

export const listMyItems = async (
  scope: AuthorshipScope,
  query: ListItemsQuery,
): Promise<PagedResult<ContentItemDto>> => {
  const filters: ListItemsFilters = {
    ...(query.authorId !== undefined ? { authorId: query.authorId } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
  };
  const { skip, take } = toSkipTake(query);

  const totalItems = await contentItemRepository.countScoped(scope, filters);
  const meta = buildPageMeta(query, totalItems);
  if (query.page > meta.totalPages) throw new ValidationError("page is beyond the last page");

  const rows = await contentItemRepository.listScoped(scope, filters, skip, take);
  return { items: rows.map(toItemDto), meta };
};

const requireOwnedItem = async (id: string, scope: AuthorshipScope): Promise<ContentItemModel> => {
  const item = await contentItemRepository.findByIdScoped(id, scope);
  if (!item) throw new NotFoundError("Content item not found");
  return item;
};

const requireOwnedVersion = async (
  itemId: string,
  versionId: string,
  scope: AuthorshipScope,
): Promise<{ item: ContentItemModel; version: ContentVersionWithTags }> => {
  const item = await requireOwnedItem(itemId, scope);
  const version = await contentVersionRepository.findByIdForItem(itemId, versionId);
  if (!version) throw new NotFoundError("Version not found");
  return { item, version };
};

export const getItem = async (
  id: string,
  scope: AuthorshipScope,
): Promise<ContentItemDetailDto> => {
  const item = await requireOwnedItem(id, scope);
  const latest = await contentVersionRepository.findLatestForItem(id);
  const published = item.publishedVersionId
    ? await contentVersionRepository.findById(item.publishedVersionId)
    : null;

  return {
    ...toItemDto(item),
    currentDraft: latest ? toVersionSummaryDto(latest) : null,
    publishedVersion: published ? toVersionSummaryDto(published) : null,
  };
};

export interface UpdateVersionInput {
  title?: string | undefined;
  body?: string | undefined;
  excerpt?: string | null | undefined;
  categorySlug?: string | null | undefined;
  tagSlugs?: string[] | undefined;
  changeSummary: string;
}

export const updateVersion = async (
  itemId: string,
  versionId: string,
  scope: AuthorshipScope,
  input: UpdateVersionInput,
  ctx: RequestContext,
): Promise<ContentVersionDto> => {
  const { version } = await requireOwnedVersion(itemId, versionId, scope);
  assertEditable(version.status);

  const categoryId =
    input.categorySlug === undefined
      ? undefined
      : input.categorySlug === null
        ? null
        : (await taxonomyRepository.upsertCategoryBySlug(input.categorySlug)).id;
  const tagIds = input.tagSlugs
    ? (await taxonomyRepository.upsertTagsBySlug(input.tagSlugs)).map((tag) => tag.id)
    : undefined;

  await prisma.$transaction(async (tx) => {
    const updated = await contentVersionRepository.updateIfEditable(tx, versionId, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
      ...(categoryId !== undefined ? { categoryId } : {}),
      changeSummary: input.changeSummary,
    });
    if (updated.count === 0) throw new ConflictError("Version is no longer editable");

    if (tagIds !== undefined) await contentVersionRepository.replaceTags(tx, versionId, tagIds);

    await auditService.recordAuditEvent(
      AuditAction.VERSION_UPDATED,
      scope.role === "AUTHOR" ? scope.userId : null,
      ctx.requestId,
      { contentItemId: itemId, versionId, client: tx },
    );
  });

  const refreshed = await contentVersionRepository.findById(versionId);
  return toVersionDto(refreshed!);
};

/** Submits the item's current (latest) version -- the endpoint takes no
 * `versionId` because "the draft in progress" is always unambiguous: a new
 * version is only ever created by `startRevision`, and its predecessor is
 * already terminal. */
export const submitVersion = async (
  itemId: string,
  scope: AuthorshipScope,
  ctx: RequestContext,
): Promise<ContentVersionDto> => {
  const item = await requireOwnedItem(itemId, scope);
  const version = await contentVersionRepository.findLatestForItem(itemId);
  if (!version) throw new NotFoundError("Version not found");
  assertTransition(version.status, VersionStatus.PENDING_REVIEW);

  await prisma.$transaction(async (tx) => {
    await contentVersionRepository.updateStatus(tx, version.id, {
      status: VersionStatus.PENDING_REVIEW,
      submittedAt: new Date(),
    });
    await auditService.recordAuditEvent(
      AuditAction.SUBMITTED_FOR_REVIEW,
      scope.role === "AUTHOR" ? scope.userId : null,
      ctx.requestId,
      { contentItemId: item.id, versionId: version.id, client: tx },
    );
  });

  const refreshed = await contentVersionRepository.findById(version.id);
  return toVersionDto(refreshed!);
};

export const startRevision = async (
  itemId: string,
  scope: AuthorshipScope,
  input: { changeSummary?: string | undefined },
  ctx: RequestContext,
): Promise<ContentVersionDto> => {
  const item = await requireOwnedItem(itemId, scope);
  if (!item.publishedVersionId) throw new ConflictError("Item has no published version to revise");

  const live = await contentVersionRepository.findById(item.publishedVersionId);
  if (!live) throw new ConflictError("Published version is missing");

  const created = await prisma.$transaction(async (tx) => {
    const bumped = await contentItemRepository.bumpVersionCounter(tx, itemId);
    const version = await contentVersionRepository.create(tx, {
      contentItemId: itemId,
      versionNumber: bumped.versionCounter,
      title: live.title,
      body: live.body,
      excerpt: live.excerpt,
      categoryId: live.categoryId,
      tagIds: live.tags?.map((t) => t.tagId) ?? [],
      parentVersionId: live.id,
      changeSummary: input.changeSummary ?? null,
      createdById: scope.role === "AUTHOR" ? scope.userId : item.authorId,
    });

    await auditService.recordAuditEvent(
      AuditAction.REVISION_STARTED,
      scope.role === "AUTHOR" ? scope.userId : null,
      ctx.requestId,
      {
        contentItemId: itemId,
        versionId: version.id,
        metadata: { parentVersionId: live.id },
        client: tx,
      },
    );

    return version;
  });

  return toVersionDto({ ...created, tags: live.tags });
};

export const listVersions = async (
  itemId: string,
  scope: AuthorshipScope,
): Promise<ContentVersionSummaryDto[]> => {
  await requireOwnedItem(itemId, scope);
  const versions = await contentVersionRepository.listForItem(itemId);
  return versions.map(toVersionSummaryDto);
};

export const getVersion = async (
  itemId: string,
  versionId: string,
  scope: AuthorshipScope,
): Promise<ContentVersionDto> => {
  const { version } = await requireOwnedVersion(itemId, versionId, scope);
  return toVersionDto(version);
};

export const getAudit = async (itemId: string, scope: AuthorshipScope) => {
  await requireOwnedItem(itemId, scope);
  return prisma.auditEvent.findMany({
    where: { contentItemId: itemId },
    orderBy: { createdAt: "desc" },
  });
};

export const archiveItem = async (
  id: string,
  scope: AuthorshipScope,
  ctx: RequestContext,
): Promise<void> => {
  const item = await requireOwnedItem(id, scope);
  if (item.archivedAt) throw new ConflictError("Item is already archived");
  if (scope.role === "AUTHOR" && item.status === "PUBLISHED") {
    throw new ConflictError("A published item can only be archived by an editor");
  }

  await prisma.$transaction(async (tx) => {
    await tx.contentItem.update({
      where: { id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    await auditService.recordAuditEvent(
      AuditAction.ITEM_ARCHIVED,
      scope.role === "AUTHOR" ? scope.userId : null,
      ctx.requestId,
      { contentItemId: id, client: tx },
    );
  });
};
