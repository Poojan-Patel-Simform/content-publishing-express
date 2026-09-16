import type { z } from "zod";

import * as publicContentService from "../services/public-content.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { sendSuccess } from "../utils/api-response.js";
import type { publicListQuerySchema, slugParamSchema } from "../validations/content.validation.js";

export const listPublished = asyncHandler(async (req, res) => {
  const query = req.validatedQuery as z.infer<typeof publicListQuerySchema>;
  const result = await publicContentService.listPublished(query);
  sendSuccess(res, result);
});

export const getBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params as unknown as z.infer<typeof slugParamSchema>;
  const item = await publicContentService.getPublishedBySlug(slug);
  sendSuccess(res, { item });
});
