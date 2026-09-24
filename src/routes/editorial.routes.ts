import { Router } from "express";

import * as editorialController from "../controllers/editorial.controller.js";
import { validate } from "../middlewares/validate.js";
import {
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

export const editorialRouter: Router = Router();

editorialRouter.get(
  "/queue",
  validate({ query: editorialQueueQuerySchema }),
  editorialController.getQueue,
);
editorialRouter.get("/authors", editorialController.listAuthors);
editorialRouter.post(
  "/versions/:versionId/approve",
  validate({ params: versionIdParamsSchema, body: approveSchema }),
  editorialController.approve,
);
editorialRouter.post(
  "/versions/:versionId/reject",
  validate({ params: versionIdParamsSchema, body: rejectSchema }),
  editorialController.reject,
);
editorialRouter.post(
  "/versions/:versionId/publish",
  validate({ params: versionIdParamsSchema, body: publishSchema }),
  editorialController.publish,
);
editorialRouter.post(
  "/versions/:versionId/schedule",
  validate({ params: versionIdParamsSchema, body: scheduleSchema }),
  editorialController.schedule,
);
editorialRouter.delete(
  "/versions/:versionId/schedule",
  validate({ params: versionIdParamsSchema }),
  editorialController.cancelSchedule,
);
editorialRouter.post(
  "/items/:id/unpublish",
  validate({ params: itemIdParamsSchema }),
  editorialController.unpublish,
);
editorialRouter.post(
  "/items/:id/restore/:versionId",
  validate({ params: restoreParamsSchema, body: restoreSchema }),
  editorialController.restore,
);
