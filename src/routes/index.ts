import { Router } from "express";

import { healthRouter } from "./health.routes.js";

export const apiRouter: Router = Router();

apiRouter.use("/health", healthRouter);
