import { Router } from "express";

import {
  requireActiveAccount,
  requireEditor,
  requireVerifiedEmail,
} from "../middlewares/require-role.js";
import { requireAuth } from "../middlewares/authenticate.js";
import { authRouter } from "./auth.routes.js";
import { contentRouter } from "./content.routes.js";
import { editorialRouter } from "./editorial.routes.js";
import { healthRouter } from "./health.routes.js";
import { publicContentRouter } from "./public-content.routes.js";

export const apiRouter: Router = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/content", publicContentRouter);
apiRouter.use("/items", requireAuth, requireActiveAccount, requireVerifiedEmail, contentRouter);
apiRouter.use(
  "/editorial",
  requireAuth,
  requireActiveAccount,
  requireVerifiedEmail,
  requireEditor,
  editorialRouter,
);
