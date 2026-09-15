import type { Request } from "express";
import type { z } from "zod";

import { HTTP_STATUS } from "../constants/http-status.js";
import { RefreshInFlightError, UnauthorizedError } from "../errors/http-errors.js";
import { COOKIE_NAMES } from "../constants/auth.js";
import * as authService from "../services/auth.service.js";
import type { SessionMeta } from "../services/token.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { sendNoContent, sendSuccess } from "../utils/api-response.js";
import { clearAuthCookies, setAuthCookies } from "../utils/cookies.js";
import type {
  changePasswordSchema,
  emailOnlySchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "../validations/auth.validation.js";

const GENERIC_ACCEPTED = {
  message: "If that address is registered, check your inbox for further instructions.",
};

const sessionMetaFromRequest = (req: Request): SessionMeta => ({
  userAgent: req.get("user-agent") ?? null,
  ipAddress: req.ip ?? null,
});

export const register = asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof registerSchema>;
  await authService.register(body, { requestId: String(req.id) });
  sendSuccess(res, GENERIC_ACCEPTED, HTTP_STATUS.ACCEPTED);
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body as z.infer<typeof verifyEmailSchema>;
  const user = await authService.verifyEmail(token, { requestId: String(req.id) });
  sendSuccess(res, { user });
});

export const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body as z.infer<typeof emailOnlySchema>;
  await authService.resendVerification(email);
  sendSuccess(res, GENERIC_ACCEPTED, HTTP_STATUS.ACCEPTED);
});

export const login = asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof loginSchema>;
  const { user, tokens } = await authService.login(body, sessionMetaFromRequest(req), {
    requestId: String(req.id),
  });
  setAuthCookies(res, tokens);
  sendSuccess(res, { user });
});

export const refresh = asyncHandler(async (req, res) => {
  const rawToken = (req.cookies as Record<string, string> | undefined)?.[
    COOKIE_NAMES.REFRESH_TOKEN
  ];
  if (!rawToken) throw new UnauthorizedError("Missing refresh token");

  try {
    const { user, tokens } = await authService.refreshSession(
      rawToken,
      sessionMetaFromRequest(req),
      {
        requestId: String(req.id),
      },
    );
    setAuthCookies(res, tokens);
    sendSuccess(res, { user });
  } catch (err) {
    // A racing tab's honest client already holds the successor cookie the
    // winning request set -- clearing cookies here would destroy it.
    if (!(err instanceof RefreshInFlightError)) {
      clearAuthCookies(res);
    }
    throw err;
  }
});

export const logout = asyncHandler(async (req, res) => {
  if (req.sessionId && req.user) {
    await authService.logout(req.sessionId, req.user.id, { requestId: String(req.id) });
  }
  clearAuthCookies(res);
  sendNoContent(res);
});

export const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAll(req.user!.id, { requestId: String(req.id) });
  clearAuthCookies(res);
  sendNoContent(res);
});

export const me = asyncHandler(async (req, res) => {
  sendSuccess(res, { user: req.user });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body as z.infer<typeof emailOnlySchema>;
  await authService.forgotPassword(email, { requestId: String(req.id) });
  sendSuccess(res, GENERIC_ACCEPTED, HTTP_STATUS.ACCEPTED);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof resetPasswordSchema>;
  await authService.resetPassword(body, { requestId: String(req.id) });
  sendSuccess(res, { message: "Password has been reset." });
});

export const changePassword = asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof changePasswordSchema>;
  await authService.changePassword(req.user!.id, req.sessionId!, body, {
    requestId: String(req.id),
  });
  sendNoContent(res);
});
