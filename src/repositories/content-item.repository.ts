import { prisma } from "../config/prisma.js";
import type { ItemStatus } from "../generated/prisma-client/enums.js";
import type * as Prisma from "../generated/prisma-client/internal/prismaNamespace.js";
import type { AuthorshipScope } from "../interfaces/content.interface.js";

/** Folded directly into the `WHERE` clause -- an author scope never returns a
 * row it doesn't own, so a lookup by id alone cannot leak another author's
 * item (prisma/SCHEMA.md §5). */
const scopeWhere = (scope: AuthorshipScope): Prisma.ContentItemWhereInput =>
  scope.role === "EDITOR" ? {} : { authorId: scope.userId };

export interface CreateContentItemInput {
  slug: string;
  authorId: string;
}

export const create = (tx: Prisma.TransactionClient, input: CreateContentItemInput) =>
  tx.contentItem.create({ data: { slug: input.slug, authorId: input.authorId } });

export const findByIdScoped = (id: string, scope: AuthorshipScope) =>
  prisma.contentItem.findFirst({ where: { id, ...scopeWhere(scope) } });

export const findBySlugExists = (slug: string) =>
  prisma.contentItem.findUnique({ where: { slug } });

export const findBySlugPublished = (slug: string) =>
  prisma.contentItem.findFirst({
    where: { slug, status: "PUBLISHED" },
    include: { publishedVersion: true },
  });

export interface ListItemsFilters {
  authorId?: string;
  status?: ItemStatus;
}

export const listScoped = (
  scope: AuthorshipScope,
  filters: ListItemsFilters,
  skip: number,
  take: number,
) =>
  prisma.contentItem.findMany({
    where: {
      ...scopeWhere(scope),
      ...(filters.authorId !== undefined ? { authorId: filters.authorId } : {}),
      ...(filters.status !== undefined ? { status: filters.status } : {}),
      ...(filters.status !== "ARCHIVED" ? { archivedAt: null } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip,
    take,
  });

export const countScoped = (scope: AuthorshipScope, filters: ListItemsFilters) =>
  prisma.contentItem.count({
    where: {
      ...scopeWhere(scope),
      ...(filters.authorId !== undefined ? { authorId: filters.authorId } : {}),
      ...(filters.status !== undefined ? { status: filters.status } : {}),
      ...(filters.status !== "ARCHIVED" ? { archivedAt: null } : {}),
    },
  });

export interface PublicListFilters {
  categorySlug?: string;
  tagSlug?: string;
  titlePrefix?: string;
}

const publicWhere = (filters: PublicListFilters): Prisma.ContentItemWhereInput => ({
  status: "PUBLISHED",
  ...(filters.titlePrefix !== undefined
    ? { publishedTitle: { startsWith: filters.titlePrefix, mode: "insensitive" } }
    : {}),
  ...(filters.categorySlug !== undefined || filters.tagSlug !== undefined
    ? {
        publishedVersion: {
          ...(filters.categorySlug !== undefined
            ? { category: { slug: filters.categorySlug } }
            : {}),
          ...(filters.tagSlug !== undefined
            ? { tags: { some: { tag: { slug: filters.tagSlug } } } }
            : {}),
        },
      }
    : {}),
});

export const listPublished = (
  filters: PublicListFilters,
  sort: "newest" | "oldest",
  skip: number,
  take: number,
) =>
  prisma.contentItem.findMany({
    where: publicWhere(filters),
    orderBy: [{ publishedAt: sort === "newest" ? "desc" : "asc" }, { id: "desc" }],
    skip,
    take,
  });

export const countPublished = (filters: PublicListFilters) =>
  prisma.contentItem.count({ where: publicWhere(filters) });

export const bumpVersionCounter = (tx: Prisma.TransactionClient, id: string) =>
  tx.contentItem.update({
    where: { id },
    data: { versionCounter: { increment: 1 } },
  });
