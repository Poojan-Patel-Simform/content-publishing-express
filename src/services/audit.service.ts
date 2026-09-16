import { prisma } from "../config/prisma.js";
import type { AuditAction } from "../generated/prisma-client/enums.js";
import type * as Prisma from "../generated/prisma-client/internal/prismaNamespace.js";
import type { InputJsonValue } from "../generated/prisma-client/internal/prismaNamespace.js";

export interface AuditEventContext {
  /** Set whenever the event concerns a specific item -- populates the
   * indexed `contentItemId` column so `GET /items/:id/audit` (and any other
   * per-item audit query) can use `@@index([contentItemId, createdAt])`
   * instead of scanning `metadata`. */
  contentItemId?: string;
  versionId?: string;
  metadata?: Record<string, unknown>;
  /** Defaults to the top-level `prisma` but accepts a `tx` so a
   * content/editorial state change and its audit row can commit atomically. */
  client?: Prisma.TransactionClient;
}

export const recordAuditEvent = (
  action: AuditAction,
  actorId: string | null,
  requestId: string,
  ctx: AuditEventContext = {},
): Promise<unknown> =>
  (ctx.client ?? prisma).auditEvent.create({
    data: {
      action,
      actorId,
      requestId,
      ...(ctx.contentItemId !== undefined ? { contentItemId: ctx.contentItemId } : {}),
      ...(ctx.versionId !== undefined ? { versionId: ctx.versionId } : {}),
      ...(ctx.metadata !== undefined ? { metadata: ctx.metadata as InputJsonValue } : {}),
    },
  });
