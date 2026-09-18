import type { ItemStatus, VersionStatus } from "../generated/prisma-client/enums.js";
import type { PageMeta } from "../utils/pagination.js";

/** Folded into repository queries as a `WHERE` predicate, never checked with
 * an `if` after the read -- see prisma/SCHEMA.md §5. */
export type AuthorshipScope = { role: "EDITOR" } | { role: "AUTHOR"; userId: string };

export interface ContentVersionDto {
  id: string;
  contentItemId: string;
  versionNumber: number;
  status: VersionStatus;
  title: string;
  body: string;
  excerpt: string | null;
  categoryId: string | null;
  tagIds: string[];
  parentVersionId: string | null;
  changeSummary: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  publishedAt: Date | null;
  unpublishedAt: Date | null;
  scheduledPublishAt: Date | null;
}

export interface ContentVersionSummaryDto {
  id: string;
  contentItemId: string;
  versionNumber: number;
  status: VersionStatus;
  title: string;
  changeSummary: string | null;
  createdById: string;
  createdAt: Date;
  submittedAt: Date | null;
  publishedAt: Date | null;
}

/** A review-queue row. The queue is the one place a version is read without
 * its item already in hand, so it carries the author identity the editor needs
 * to triage -- everywhere else the caller already knows whose item it is. */
export interface ReviewQueueEntryDto extends ContentVersionSummaryDto {
  author: { id: string; displayName: string };
}

export interface ContentItemDto {
  id: string;
  slug: string;
  authorId: string;
  status: ItemStatus;
  publishedVersionId: string | null;
  publishedTitle: string | null;
  publishedAt: Date | null;
  unpublishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface ContentItemDetailDto extends ContentItemDto {
  currentDraft: ContentVersionSummaryDto | null;
  publishedVersion: ContentVersionSummaryDto | null;
}

export interface PublicContentListItemDto {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  publishedAt: Date;
}

export interface PublicContentDetailDto {
  id: string;
  slug: string;
  title: string;
  body: string;
  excerpt: string | null;
  publishedAt: Date;
}

export interface CategoryDto {
  id: string;
  slug: string;
  name: string;
}

export interface PagedResult<T> {
  items: T[];
  meta: PageMeta;
}
