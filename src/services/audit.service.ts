import { prisma } from "../config/prisma.js";
import type { AuditAction } from "../generated/prisma-client/enums.js";
import type { InputJsonValue } from "../generated/prisma-client/internal/prismaNamespace.js";

export const recordAuditEvent = (
  action: AuditAction,
  actorId: string | null,
  requestId: string,
  metadata?: Record<string, unknown>,
): Promise<unknown> =>
  prisma.auditEvent.create({
    data: {
      action,
      actorId,
      requestId,
      ...(metadata !== undefined ? { metadata: metadata as InputJsonValue } : {}),
    },
  });
