import { z } from "zod";

import { ItemStatus, VersionStatus } from "../generated/prisma-client/enums.js";

const title = z.string().trim().min(1).max(200);
const body = z.string().min(1).max(100_000);
const excerpt = z.string().trim().max(500).nullable().optional();
const changeSummary = z.string().trim().min(1).max(500);
const slugRef = z.string().trim().min(1).max(200);

export const createItemSchema = z.object({
  title,
  body,
  excerpt,
  categorySlug: slugRef.optional(),
  tagSlugs: z.array(slugRef).max(20).optional(),
  changeSummary,
});

export const updateVersionSchema = z.object({
  title: title.optional(),
  body: body.optional(),
  excerpt,
  categorySlug: slugRef.nullable().optional(),
  tagSlugs: z.array(slugRef).max(20).optional(),
  changeSummary,
});

export const startRevisionSchema = z.object({
  changeSummary: changeSummary.optional(),
});

export const idParamsSchema = z.object({
  id: z.uuid(),
});

export const versionParamsSchema = z.object({
  id: z.uuid(),
  versionId: z.uuid(),
});

const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(50).default(20);

export const listMyItemsQuerySchema = z.object({
  page,
  pageSize,
  authorId: z.uuid().optional(),
  status: z.enum(ItemStatus).optional(),
  /** Filters on the item's *versions* rather than the item itself -- the only
   * way to ask for something like "rejected", which is a version state and
   * leaves the item sitting at `DRAFT`. */
  versionStatus: z.enum(VersionStatus).optional(),
});

export const publicListQuerySchema = z.object({
  page,
  pageSize,
  categorySlug: slugRef.optional(),
  tagSlug: slugRef.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
});

export const slugParamSchema = z.object({
  slug: z.string().trim().min(1).max(200),
});
