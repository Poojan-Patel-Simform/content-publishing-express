import type { CookieOptions, Response } from "express";

import { env } from "../config/env.js";
import { COOKIE_NAMES } from "../constants/auth.js";

const AUTH_PATH = "/api/v1/auth";

interface CookieSpec {
  set: (res: Response, value: string, maxAgeMs: number) => void;
  clear: (res: Response) => void;
}

/**
 * One factory builds both the set and the clear options for a cookie.
 * `res.clearCookie` silently no-ops when path/sameSite/secure differ from how
 * the cookie was set, and that failure mode looks exactly like "logout
 * doesn't work" -- deriving both from the same options makes that impossible.
 */
const makeCookieSpec = (
  name: string,
  path: string,
  sameSite: NonNullable<CookieOptions["sameSite"]>,
): CookieSpec => {
  const options: CookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite,
    path,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };

  return {
    set: (res, value, maxAgeMs) => res.cookie(name, value, { ...options, maxAge: maxAgeMs }),
    clear: (res) => res.clearCookie(name, options),
  };
};

const accessTokenCookie = makeCookieSpec(COOKIE_NAMES.ACCESS_TOKEN, "/", env.COOKIE_SAMESITE);

// Scoping the refresh cookie to /api/v1/auth keeps the widest-blast-radius
// credential off the ~95% of requests that only need the access token.
const refreshTokenCookie = makeCookieSpec(
  COOKIE_NAMES.REFRESH_TOKEN,
  AUTH_PATH,
  env.COOKIE_SAMESITE,
);

// Google's callback is a cross-site top-level navigation, so a `strict`
// SameSite policy would withhold this cookie and break state/PKCE.
const oauthStateCookie = makeCookieSpec(
  COOKIE_NAMES.OAUTH_STATE,
  AUTH_PATH,
  env.COOKIE_SAMESITE === "strict" ? "lax" : env.COOKIE_SAMESITE,
);

export const setAuthCookies = (
  res: Response,
  tokens: { accessToken: string; refreshToken: string; refreshTokenExpiresAt: Date },
): void => {
  accessTokenCookie.set(res, tokens.accessToken, env.ACCESS_TOKEN_TTL_S * 1000);
  refreshTokenCookie.set(
    res,
    tokens.refreshToken,
    Math.max(0, tokens.refreshTokenExpiresAt.getTime() - Date.now()),
  );
};

export const clearAuthCookies = (res: Response): void => {
  accessTokenCookie.clear(res);
  refreshTokenCookie.clear(res);
};

export const setOAuthStateCookie = (res: Response, value: string): void => {
  oauthStateCookie.set(res, value, env.OAUTH_STATE_TTL_MS);
};

export const clearOAuthStateCookie = (res: Response): void => {
  oauthStateCookie.clear(res);
};
