import { Router } from "express";

import * as contentController from "../controllers/content.controller.js";
import { validate } from "../middlewares/validate.js";
import {
  createItemSchema,
  idParamsSchema,
  listMyItemsQuerySchema,
  startRevisionSchema,
  updateVersionSchema,
  versionParamsSchema,
} from "../validations/content.validation.js";

export const contentRouter: Router = Router();

contentRouter.post("/", validate({ body: createItemSchema }), contentController.createItem);
contentRouter.get("/", validate({ query: listMyItemsQuerySchema }), contentController.listMyItems);
contentRouter.get("/:id", validate({ params: idParamsSchema }), contentController.getItem);
contentRouter.patch(
  "/:id/versions/:versionId",
  validate({ params: versionParamsSchema, body: updateVersionSchema }),
  contentController.updateVersion,
);
contentRouter.post(
  "/:id/submit",
  validate({ params: idParamsSchema }),
  contentController.submitVersion,
);
contentRouter.post(
  "/:id/revisions",
  validate({ params: idParamsSchema, body: startRevisionSchema }),
  contentController.startRevision,
);
contentRouter.get(
  "/:id/versions",
  validate({ params: idParamsSchema }),
  contentController.listVersions,
);
contentRouter.get(
  "/:id/versions/:versionId",
  validate({ params: versionParamsSchema }),
  contentController.getVersion,
);
contentRouter.get("/:id/audit", validate({ params: idParamsSchema }), contentController.getAudit);
contentRouter.delete("/:id", validate({ params: idParamsSchema }), contentController.archiveItem);
