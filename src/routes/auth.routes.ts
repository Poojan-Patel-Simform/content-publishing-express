import { Router } from "express";

import * as authController from "../controllers/auth.controller.js";
import * as oauthController from "../controllers/oauth.controller.js";
import { requireAuth } from "../middlewares/authenticate.js";
import { authRateLimiter } from "../middlewares/rate-limit.js";
import { validate } from "../middlewares/validate.js";
import {
  changePasswordSchema,
  emailOnlySchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "../validations/auth.validation.js";

export const authRouter: Router = Router();

authRouter.post(
  "/register",
  authRateLimiter,
  validate({ body: registerSchema }),
  authController.register,
);
authRouter.post(
  "/verify-email",
  authRateLimiter,
  validate({ body: verifyEmailSchema }),
  authController.verifyEmail,
);
authRouter.post(
  "/resend-verification",
  authRateLimiter,
  validate({ body: emailOnlySchema }),
  authController.resendVerification,
);
authRouter.post("/login", authRateLimiter, validate({ body: loginSchema }), authController.login);
authRouter.post("/refresh", authRateLimiter, authController.refresh);
authRouter.post("/logout", requireAuth, authController.logout);
authRouter.post("/logout-all", requireAuth, authController.logoutAll);
authRouter.get("/me", requireAuth, authController.me);
authRouter.post(
  "/forgot-password",
  authRateLimiter,
  validate({ body: emailOnlySchema }),
  authController.forgotPassword,
);
authRouter.post(
  "/reset-password",
  authRateLimiter,
  validate({ body: resetPasswordSchema }),
  authController.resetPassword,
);
authRouter.post(
  "/change-password",
  requireAuth,
  validate({ body: changePasswordSchema }),
  authController.changePassword,
);

authRouter.get("/google", oauthController.googleStart);
authRouter.get("/google/callback", oauthController.googleCallback);
