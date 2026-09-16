import { z } from "zod";

import { env } from "../config/env.js";

const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(50).default(20);

export const editorialQueueQuerySchema = z.object({ page, pageSize });

export const versionIdParamsSchema = z.object({
  versionId: z.uuid(),
});

export const itemIdParamsSchema = z.object({
  id: z.uuid(),
});

export const restoreParamsSchema = z.object({
  id: z.uuid(),
  versionId: z.uuid(),
});

export const approveSchema = z.object({
  comment: z.string().trim().min(1).max(2000).optional(),
});

export const rejectSchema = z.object({
  comment: z.string().trim().min(1, "A reject decision requires a comment").max(2000),
});

export const publishSchema = z.object({
  comment: z.string().trim().min(1).max(2000).optional(),
});

export const scheduleSchema = z.object({
  scheduledFor: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .refine((date) => date.getTime() >= Date.now() + env.SCHEDULE_MIN_LEAD_MS, {
      message: `scheduledFor must be at least ${env.SCHEDULE_MIN_LEAD_MS}ms in the future`,
    }),
});

export const restoreSchema = z.object({
  changeSummary: z.string().trim().min(1).max(500).optional(),
});
