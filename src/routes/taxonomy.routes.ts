import { Router } from "express";

import * as taxonomyController from "../controllers/taxonomy.controller.js";

export const taxonomyRouter: Router = Router();

taxonomyRouter.get("/", taxonomyController.listCategories);
