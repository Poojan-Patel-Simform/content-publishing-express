import { prisma } from "../config/prisma.js";
import { NotFoundError, ValidationError } from "../errors/http-errors.js";
import type {
  PagedResult,
  PublicContentDetailDto,
  PublicContentListItemDto,
} from "../interfaces/content.interface.js";
import * as contentItemRepository from "../repositories/content-item.repository.js";
import type { PublicListFilters } from "../repositories/content-item.repository.js";
import { buildPageMeta, toSkipTake } from "../utils/pagination.js";

export interface PublicListQuery {
  page: number;
  pageSize: number;
  categorySlug?: string | undefined;
  tagSlug?: string | undefined;
  q?: string | undefined;
  sort: "newest" | "oldest";
}

export const listPublished = async (
  query: PublicListQuery,
): Promise<PagedResult<PublicContentListItemDto>> => {
  const filters: PublicListFilters = {
    ...(query.categorySlug !== undefined ? { categorySlug: query.categorySlug } : {}),
    ...(query.tagSlug !== undefined ? { tagSlug: query.tagSlug } : {}),
    ...(query.q !== undefined ? { titlePrefix: query.q } : {}),
  };
  const { skip, take } = toSkipTake(query);

  // Count and page share one transaction so `totalItems` never drifts from
  // the rows actually returned (plan.md §1.1).
  const [totalItems, rows] = await prisma.$transaction([
    contentItemRepository.countPublished(filters),
    contentItemRepository.listPublished(filters, query.sort, skip, take),
  ]);

  const meta = buildPageMeta(query, totalItems);
  if (query.page > meta.totalPages) throw new ValidationError("page is beyond the last page");

  const items: PublicContentListItemDto[] = rows.map((item) => ({
    id: item.id,
    slug: item.slug,
    title: item.publishedTitle!,
    excerpt: item.publishedVersion?.excerpt ?? null,
    publishedAt: item.publishedAt!,
  }));

  return { items, meta };
};

export const getPublishedBySlug = async (slug: string): Promise<PublicContentDetailDto> => {
  const item = await contentItemRepository.findBySlugPublished(slug);
  if (!item || !item.publishedVersion) throw new NotFoundError("Content not found");

  return {
    id: item.id,
    slug: item.slug,
    title: item.publishedVersion.title,
    body: item.publishedVersion.body,
    excerpt: item.publishedVersion.excerpt,
    publishedAt: item.publishedAt!,
  };
};
