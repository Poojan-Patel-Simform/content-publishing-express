import type { z } from "zod";

import * as editorialService from "../services/editorial.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { sendNoContent, sendSuccess } from "../utils/api-response.js";
import type {
  approveSchema,
  editorialQueueQuerySchema,
  itemIdParamsSchema,
  publishSchema,
  rejectSchema,
  restoreParamsSchema,
  restoreSchema,
  scheduleSchema,
  versionIdParamsSchema,
} from "../validations/editorial.validation.js";

const requestContext = (req: { user?: { id: string }; id: unknown }) => ({
  actorId: req.user!.id,
  requestId: String(req.id),
});

export const getQueue = asyncHandler(async (req, res) => {
  const query = req.validatedQuery as z.infer<typeof editorialQueueQuerySchema>;
  const result = await editorialService.getQueue(query);
  sendSuccess(res, result);
});

export const approve = asyncHandler(async (req, res) => {
  const { versionId } = req.params as unknown as z.infer<typeof versionIdParamsSchema>;
  const body = req.body as z.infer<typeof approveSchema>;
  const version = await editorialService.approve(versionId, body, requestContext(req));
  sendSuccess(res, { version });
});

export const reject = asyncHandler(async (req, res) => {
  const { versionId } = req.params as unknown as z.infer<typeof versionIdParamsSchema>;
  const body = req.body as z.infer<typeof rejectSchema>;
  const version = await editorialService.reject(versionId, body, requestContext(req));
  sendSuccess(res, { version });
});

export const publish = asyncHandler(async (req, res) => {
  const { versionId } = req.params as unknown as z.infer<typeof versionIdParamsSchema>;
  const body = req.body as z.infer<typeof publishSchema>;
  const version = await editorialService.publish(versionId, body, requestContext(req));
  sendSuccess(res, { version });
});

export const schedule = asyncHandler(async (req, res) => {
  const { versionId } = req.params as unknown as z.infer<typeof versionIdParamsSchema>;
  const body = req.body as z.infer<typeof scheduleSchema>;
  const version = await editorialService.schedule(versionId, body, requestContext(req));
  sendSuccess(res, { version });
});

export const cancelSchedule = asyncHandler(async (req, res) => {
  const { versionId } = req.params as unknown as z.infer<typeof versionIdParamsSchema>;
  await editorialService.cancelSchedule(versionId, requestContext(req));
  sendNoContent(res);
});

export const unpublish = asyncHandler(async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof itemIdParamsSchema>;
  await editorialService.unpublish(id, requestContext(req));
  sendNoContent(res);
});

export const restore = asyncHandler(async (req, res) => {
  const { id, versionId } = req.params as unknown as z.infer<typeof restoreParamsSchema>;
  const body = req.body as z.infer<typeof restoreSchema>;
  const version = await editorialService.restore(id, versionId, body, requestContext(req));
  sendSuccess(res, { version });
});
