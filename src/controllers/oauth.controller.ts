import { env, isGoogleConfigured } from "../config/env.js";
import { COOKIE_NAMES } from "../constants/auth.js";
import { BadRequestError, NotFoundError } from "../errors/http-errors.js";
import * as oauthService from "../services/oauth.service.js";
import { OAuthAccountExistsUnverifiedError } from "../services/oauth.service.js";
import * as tokenService from "../services/token.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { clearOAuthStateCookie, setAuthCookies, setOAuthStateCookie } from "../utils/cookies.js";
import { timingSafeEqualStr } from "../utils/crypto.js";
import { sessionMetaFromRequest } from "../utils/session-meta.js";

export const googleStart = asyncHandler(async (req, res) => {
  // A blank .env degrades cleanly instead of 500-ing.
  if (!isGoogleConfigured) throw new NotFoundError();

  const requestedReturnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/";
  const returnTo = oauthService.isSafeReturnTo(requestedReturnTo) ? requestedReturnTo : "/";

  const state = oauthService.generateOAuthState();
  const { verifier, challenge } = oauthService.generatePkcePair();

  const stateToken = await oauthService.signOAuthState({ state, verifier, returnTo });
  setOAuthStateCookie(res, stateToken);

  res.redirect(oauthService.buildGoogleAuthUrl(state, challenge));
});

export const googleCallback = asyncHandler(async (req, res) => {
  if (!isGoogleConfigured) throw new NotFoundError();

  const stateCookie = (req.cookies as Record<string, string> | undefined)?.[
    COOKIE_NAMES.OAUTH_STATE
  ];
  clearOAuthStateCookie(res);

  const queryState = typeof req.query.state === "string" ? req.query.state : undefined;
  const code = typeof req.query.code === "string" ? req.query.code : undefined;

  if (!stateCookie || !queryState || !code) {
    throw new BadRequestError("Missing or invalid OAuth callback parameters");
  }

  const oauthState = await oauthService.verifyOAuthStateToken(stateCookie).catch(() => {
    throw new BadRequestError("Invalid or expired OAuth state");
  });

  if (!timingSafeEqualStr(oauthState.state, queryState)) {
    throw new BadRequestError("OAuth state mismatch");
  }

  const identity = await oauthService.exchangeGoogleCode(code, oauthState.verifier);

  let user;
  try {
    user = await oauthService.resolveGoogleIdentity(identity, String(req.id));
  } catch (err) {
    if (err instanceof OAuthAccountExistsUnverifiedError) {
      res.redirect(`${env.FRONTEND_URL}/login?error=account_exists_unverified`);
      return;
    }
    throw err;
  }

  const tokens = await tokenService.issueSession(user, sessionMetaFromRequest(req));
  setAuthCookies(res, tokens);

  const returnTo = oauthService.isSafeReturnTo(oauthState.returnTo) ? oauthState.returnTo : "/";
  res.redirect(`${env.FRONTEND_URL}${returnTo}`);
});
