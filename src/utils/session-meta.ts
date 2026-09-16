import type { Request } from "express";

import type { SessionMeta } from "../services/token.service.js";

export const sessionMetaFromRequest = (req: Request): SessionMeta => ({
  userAgent: req.get("user-agent") ?? null,
  ipAddress: req.ip ?? null,
});
