import { Router } from "express";

import * as publicContentController from "../controllers/public-content.controller.js";
import { validate } from "../middlewares/validate.js";
import { publicListQuerySchema, slugParamSchema } from "../validations/content.validation.js";

export const publicContentRouter: Router = Router();

publicContentRouter.get(
  "/",
  validate({ query: publicListQuerySchema }),
  publicContentController.listPublished,
);
publicContentRouter.get(
  "/:slug",
  validate({ params: slugParamSchema }),
  publicContentController.getBySlug,
);
