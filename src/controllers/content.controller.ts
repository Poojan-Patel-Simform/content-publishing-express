import type { Request } from "express";
import type { z } from "zod";

import { HTTP_STATUS } from "../constants/http-status.js";
import { UserRole } from "../generated/prisma-client/enums.js";
import type { AuthorshipScope } from "../interfaces/content.interface.js";
import * as contentService from "../services/content.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { sendNoContent, sendSuccess } from "../utils/api-response.js";
import type {
  createItemSchema,
  idParamsSchema,
  listMyItemsQuerySchema,
  startRevisionSchema,
  updateVersionSchema,
  versionParamsSchema,
} from "../validations/content.validation.js";

const scopeFromRequest = (req: Request): AuthorshipScope =>
  req.user!.role === UserRole.EDITOR
    ? { role: "EDITOR" }
    : { role: "AUTHOR", userId: req.user!.id };

export const createItem = asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof createItemSchema>;
  const result = await contentService.createItem(req.user!.id, body, {
    requestId: String(req.id),
  });
  sendSuccess(res, result, HTTP_STATUS.CREATED);
});

export const listMyItems = asyncHandler(async (req, res) => {
  const query = req.validatedQuery as z.infer<typeof listMyItemsQuerySchema>;
  const result = await contentService.listMyItems(scopeFromRequest(req), query);
  sendSuccess(res, result);
});

export const getItem = asyncHandler(async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
  const item = await contentService.getItem(id, scopeFromRequest(req));
  sendSuccess(res, { item });
});

export const updateVersion = asyncHandler(async (req, res) => {
  const { id, versionId } = req.params as unknown as z.infer<typeof versionParamsSchema>;
  const body = req.body as z.infer<typeof updateVersionSchema>;
  const version = await contentService.updateVersion(id, versionId, scopeFromRequest(req), body, {
    requestId: String(req.id),
  });
  sendSuccess(res, { version });
});

export const submitVersion = asyncHandler(async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
  const version = await contentService.submitVersion(id, scopeFromRequest(req), {
    requestId: String(req.id),
  });
  sendSuccess(res, { version });
});

export const startRevision = asyncHandler(async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
  const body = req.body as z.infer<typeof startRevisionSchema>;
  const version = await contentService.startRevision(id, scopeFromRequest(req), body, {
    requestId: String(req.id),
  });
  sendSuccess(res, { version }, HTTP_STATUS.CREATED);
});

export const listVersions = asyncHandler(async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
  const versions = await contentService.listVersions(id, scopeFromRequest(req));
  sendSuccess(res, { versions });
});

export const getVersion = asyncHandler(async (req, res) => {
  const { id, versionId } = req.params as unknown as z.infer<typeof versionParamsSchema>;
  const version = await contentService.getVersion(id, versionId, scopeFromRequest(req));
  sendSuccess(res, { version });
});

export const getAudit = asyncHandler(async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
  const events = await contentService.getAudit(id, scopeFromRequest(req));
  sendSuccess(res, { events });
});

export const archiveItem = asyncHandler(async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParamsSchema>;
  await contentService.archiveItem(id, scopeFromRequest(req), { requestId: String(req.id) });
  sendNoContent(res);
});
