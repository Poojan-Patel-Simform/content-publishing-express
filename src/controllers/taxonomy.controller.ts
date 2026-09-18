import * as taxonomyService from "../services/taxonomy.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { asyncHandler } from "../utils/async-handler.js";

export const listCategories = asyncHandler(async (_req, res) => {
  const categories = await taxonomyService.listCategories();
  sendSuccess(res, { categories });
});
